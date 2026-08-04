import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import { BillingService } from '../billing/billing.module';
import { writeAuditEntry } from '../common/audit-hash';
import { clearTenantMfaUserData } from '../auth/tenant-mfa-clear';
import { NotificationsService } from '../notifications/notifications.module';

type Actor = { id: string; role: string };

@Injectable()
export class UsersService {
  constructor(
    private readonly ctx: TenantContextService,
    private readonly catalog: CatalogPrismaService,
    private readonly billing: BillingService,
    private readonly notifications: NotificationsService,
  ) {}

  list() {
    return this.ctx.prisma().user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true, active: true,
        departmentId: true, department: { select: { id: true, name: true } },
        scopedDepartmentId: true, scopedDepartment: { select: { id: true, name: true } },
        mfaMethod: true, // lets the admin UI show who has sign-in verification + a reset control
        createdAt: true,
      },
    });
  }

  async create(
    data: { email: string; password: string; firstName: string; lastName: string; role: any; departmentId?: string | null; scopedDepartmentId?: string | null },
    actor: Actor,
  ) {
    // Defence in depth: role enforcement even when the global RolesGuard is disabled.
    if (actor.role !== 'ADMIN') throw new ForbiddenException('Only an admin can create users');

    const email = data.email.toLowerCase();
    if (this.ctx.tenantId) await this.billing.assertCanAddUser(this.ctx.tenantId);
    const existing = await this.ctx.prisma().user.findUnique({ where: { tenantId_email: { tenantId: this.ctx.tenantId!, email } } });
    if (existing) throw new BadRequestException('Email already exists in this workspace');
    const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);
    // Write catalog mapping FIRST so a tenant-side failure leaves no orphan tenant user.
    await this.catalog.tenantUser.upsert({
      where: { email_tenantId: { email, tenantId: this.ctx.tenantId! } },
      update: {},
      create: { email, tenantId: this.ctx.tenantId! },
    });
    let user: any;
    try {
      user = await this.ctx.prisma().user.create({
        data: {
          tenantId: this.ctx.tenantId!,
          email, passwordHash,
          firstName: data.firstName, lastName: data.lastName,
          role: data.role, departmentId: data.departmentId || null,
          scopedDepartmentId: data.scopedDepartmentId || null,
          passwordChangedAt: new Date(),
        },
        select: { id: true, email: true, firstName: true, lastName: true, role: true, active: true, departmentId: true, scopedDepartmentId: true, createdAt: true },
      });
    } catch (e) {
      await this.catalog.tenantUser
        .delete({ where: { email_tenantId: { email, tenantId: this.ctx.tenantId! } } })
        .catch(() => {});
      throw e;
    }
    await writeAuditEntry(this.ctx.prisma(), {
      tenantId: this.ctx.tenantId!,
      action: 'user.create',
      performedById: actor.id,
      detail: { userId: user.id, email: user.email, role: user.role },
      impersonatedBy: this.ctx.impersonatedBy ?? null,
    }).catch(() => {});
    return user;
  }

  async update(id: string, data: any, actor: Actor) {
    const target = await this.ctx.prisma().user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');

    const elevatingKeys = ['role', 'active', 'departmentId', 'scopedDepartmentId'];
    const wantsElevation = elevatingKeys.some((k) => data[k] !== undefined);
    const wantsPasswordChange = typeof data.password === 'string' && data.password.length > 0;

    // 1. Only admins can change privilege-laden fields, even with RolesGuard off.
    if (wantsElevation && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Only an admin can change role / active / department');
    }
    // 2. Admins changing someone *else's* password must use a dedicated reset flow
    //    (not implemented here). Self-password changes are allowed for any user.
    if (wantsPasswordChange && actor.id !== id && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Only an admin can reset another user\'s password');
    }
    // 3. Last-admin guard — never let the last active admin demote, deactivate,
    //    or otherwise lose their admin role.
    if (target.role === 'ADMIN' && (data.role && data.role !== 'ADMIN' || data.active === false)) {
      const otherAdmins = await this.ctx.prisma().user.count({
        where: { role: 'ADMIN', active: true, id: { not: id } },
      });
      if (otherAdmins === 0) {
        throw new ConflictException('Cannot demote or deactivate the last remaining admin');
      }
    }

    const patch: any = { ...data };
    if (wantsPasswordChange) {
      const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);
      patch.passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);
      delete patch.password;
      patch.passwordChangedAt = new Date();
    }
    if (data.scopedDepartmentId !== undefined) patch.scopedDepartmentId = data.scopedDepartmentId || null;
    if (data.departmentId !== undefined) patch.departmentId = data.departmentId || null;

    // Any sensitive change (password / role / active) invalidates all outstanding
    // access tokens for the target — they'll fail the tokenVersion check on next request.
    const sensitiveChange = wantsPasswordChange || data.role !== undefined || data.active !== undefined;
    if (sensitiveChange) {
      patch.tokenVersion = { increment: 1 };
    }

    const updated = await this.ctx.prisma().user.update({
      where: { id }, data: patch,
      select: { id: true, email: true, firstName: true, lastName: true, role: true, active: true, departmentId: true, scopedDepartmentId: true, createdAt: true },
    });

    await writeAuditEntry(this.ctx.prisma(), {
      tenantId: this.ctx.tenantId!,
      action: 'user.update',
      performedById: actor.id,
      detail: {
        userId: id,
        changed: Object.keys(patch).filter((k) => k !== 'passwordHash'),
        passwordChanged: wantsPasswordChange,
      },
      impersonatedBy: this.ctx.impersonatedBy ?? null,
    }).catch(() => {});

    return updated;
  }

  /**
   * Company-admin "Reset this user's MFA" — the employee-recovery rung from
   * docs/tenant-mfa-plan.md §6/§7. Clears the target's MFA so a user who lost
   * their email and/or authenticator device can re-enroll from scratch.
   *
   * Distinct from PATCH /users/:id password reset, which is independent of MFA
   * and does NOT touch the authenticator (see update()). This action uses the
   * full clear set (clearTenantMfaUserData) — which DOES null the authenticator —
   * because a reset that left totpEnabled=true would still wall a device-lost
   * user at the legacy TOTP login step.
   *
   * Guards: ADMIN-only (defence in depth even with RolesGuard off) + step-up —
   * if the acting admin has their OWN MFA enabled, they must re-enter their
   * password before they can clear someone else's. Audited.
   */
  async resetUserMfa(targetId: string, actor: Actor, password?: string) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException('Only an admin can reset a user\'s MFA');

    const db = this.ctx.prisma();
    const target = await db.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');

    // Step-up: only required when the acting admin actually has MFA enabled
    // (per the tenant plan §7). Re-assert the admin's OWN password.
    const admin = await db.user.findUnique({ where: { id: actor.id } });
    if (admin && admin.mfaMethod && admin.mfaMethod !== 'NONE') {
      const ok = await bcrypt.compare(password || '', admin.passwordHash);
      if (!ok) throw new UnauthorizedException('Re-enter your password to reset a user\'s MFA.');
    }

    const hadMfa = target.mfaMethod !== 'NONE' || target.totpEnabled;

    await db.$transaction(async (tx: any) => {
      await tx.tenantBackupCode.deleteMany({ where: { userId: targetId } });
      await tx.tenantMfaPending.deleteMany({ where: { userId: targetId } });
      await tx.user.update({ where: { id: targetId }, data: clearTenantMfaUserData() });
    });

    await writeAuditEntry(db, {
      tenantId: this.ctx.tenantId!,
      action: 'user.reset_mfa',
      performedById: actor.id,
      detail: { userId: targetId, email: target.email, hadMfa, previousMethod: target.mfaMethod },
      impersonatedBy: this.ctx.impersonatedBy ?? null,
    }).catch(() => {});

    return { ok: true };
  }

  async remove(id: string, actor: Actor) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException('Only an admin can delete users');

    const u = await this.ctx.prisma().user.findUnique({ where: { id } });
    if (!u) return;
    if (u.role === 'ADMIN' && u.active) {
      const otherAdmins = await this.ctx.prisma().user.count({
        where: { role: 'ADMIN', active: true, id: { not: id } },
      });
      if (otherAdmins === 0) {
        throw new ConflictException('Cannot delete the last remaining admin');
      }
    }
    try {
      await this.ctx.prisma().user.delete({ where: { id } });
    } catch (e: any) {
      if (e?.code === 'P2003') {
        // FK conflict: the user owns assignments / tickets / etc. Soft-delete instead.
        await this.ctx.prisma().user.update({
          where: { id },
          data: { active: false, email: `deleted+${id}@invalid.local`, totpEnabled: false, totpSecret: null },
        });
      } else {
        throw e;
      }
    }
    await this.catalog.tenantUser
      .delete({ where: { email_tenantId: { email: u.email, tenantId: this.ctx.tenantId! } } })
      .catch(() => {});
    await writeAuditEntry(this.ctx.prisma(), {
      tenantId: this.ctx.tenantId!,
      action: 'user.remove',
      performedById: actor.id,
      detail: { userId: id, email: u.email },
      impersonatedBy: this.ctx.impersonatedBy ?? null,
    }).catch(() => {});
  }

  // ── Phase 4: Employee ⇄ Asset-Manager role switch ─────────────────────────
  // Dedicated, ADMIN-only path (controller @Roles + this service-level check, so
  // it holds even if the guard were disabled). NEVER touches ADMIN as source or
  // target — admin role changes stay in update() with the last-admin guard.
  // A demotion reassigns the manager's open requests + tickets before the flip so
  // nothing is orphaned; the flip bumps tokenVersion so the demoted session dies on
  // its next request (JwtAuthGuard re-checks it) — enforced at the API, not the UI.

  async getRoleChangePreview(id: string, to: string, actor: Actor) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException('Only an admin can change roles');
    const db = this.ctx.prisma();
    const target = await db.user.findUnique({
      where: { id },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, active: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const [openRequests, openTickets, eligibleManagers] = await Promise.all([
      db.assetRequest.findMany({
        where: { assignedToId: id, status: { in: ['PENDING', 'APPROVED'] } },
        select: { id: true, number: true, title: true, status: true },
      }),
      db.serviceTicket.findMany({
        where: { assignedToId: id, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR'] } },
        select: { id: true, ticketNumber: true, title: true, status: true },
      }),
      db.user.findMany({
        where: { active: true, id: { not: id }, role: { in: ['ASSET_MANAGER', 'ADMIN'] } },
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
        orderBy: { firstName: 'asc' },
      }),
    ]);

    const isDemotion = target.role === 'ASSET_MANAGER' && to === 'EMPLOYEE';
    return {
      user: target,
      to,
      isDemotion,
      counts: { requests: openRequests.length, tickets: openTickets.length },
      openRequests,
      openTickets,
      eligibleManagers,
    };
  }

  async changeRole(id: string, dto: { role: string; reassignToId?: string }, actor: Actor) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException('Only an admin can change roles');
    const role = dto.role;
    if (role !== 'EMPLOYEE' && role !== 'ASSET_MANAGER') {
      throw new BadRequestException('This action only switches between Employee and Asset-Manager');
    }
    const db = this.ctx.prisma();
    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === 'ADMIN') {
      throw new BadRequestException("Change an admin's role from Edit — this action does not touch admins");
    }
    if (target.role === role) {
      throw new BadRequestException(`User is already ${role === 'ASSET_MANAGER' ? 'an Asset-Manager' : 'an Employee'}`);
    }

    const demotion = target.role === 'ASSET_MANAGER' && role === 'EMPLOYEE';

    // Resolve the hand-off target for a demotion: the admin's pick, else the active
    // manager with the fewest open requests, else null (unassign back to the pool).
    let handoffTargetId: string | null = null;
    if (demotion) {
      if (dto.reassignToId) {
        if (dto.reassignToId === id) throw new BadRequestException('Reassign target must be a different user');
        const to = await db.user.findUnique({ where: { id: dto.reassignToId }, select: { active: true, role: true } });
        if (!to || !to.active || !['ASSET_MANAGER', 'ADMIN'].includes(to.role)) {
          throw new BadRequestException('Reassign target must be an active manager or admin');
        }
        handoffTargetId = dto.reassignToId;
      } else {
        handoffTargetId = await this.pickFallbackManager(id);
      }
    }

    const runTx = () =>
      db.$transaction(
        async (tx: any) => {
          // X-lock the subject user for the whole handover. The counts below are read
          // and acted on, so two concurrent role changes on the same user would
          // otherwise each move the same requests/tickets and double-count.
          await tx.$queryRawUnsafe(
            `SELECT \`id\` FROM \`User\` WHERE \`id\` = ? AND \`tenantId\` = ? FOR UPDATE`,
            id, this.ctx.tenantId!,
          );
          let movedRequests = 0;
          let movedTickets = 0;
          if (demotion) {
            const rr = await tx.assetRequest.updateMany({
              where: { assignedToId: id, status: { in: ['PENDING', 'APPROVED'] } },
              data: { assignedToId: handoffTargetId },
            });
            movedRequests = rr.count;
            const tt = await tx.serviceTicket.updateMany({
              where: { assignedToId: id, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR'] } },
              data: { assignedToId: handoffTargetId },
            });
            movedTickets = tt.count;
          }
          // Flip the role + kill the target's live sessions (JwtAuthGuard's
          // tokenVersion check). Promotion clears any leftover dept access-scope.
          await tx.user.update({
            where: { id },
            data: {
              role: role as any,
              tokenVersion: { increment: 1 },
              ...(role === 'ASSET_MANAGER' ? { scopedDepartmentId: null } : {}),
            },
          });
          return { movedRequests, movedTickets };
        },
        { isolationLevel: 'ReadCommitted' },
      );

    let counts: { movedRequests: number; movedTickets: number };
    for (let attempt = 1; ; attempt++) {
      try { counts = await runTx(); break; }
      catch (e: any) {
        const serialization = e?.code === 'P2034' || /serial|deadlock/i.test(e?.message || '');
        if (serialization && attempt < 3) continue;
        throw e;
      }
    }

    // Best-effort: tell the hand-off manager that work landed on them.
    if (demotion && handoffTargetId && counts.movedRequests + counts.movedTickets > 0) {
      this.notifications.push({
        userId: handoffTargetId,
        kind: 'asset_request.created',
        title: 'Work reassigned to you',
        body: `${counts.movedRequests} request(s) and ${counts.movedTickets} ticket(s) moved from ${target.firstName} ${target.lastName} (role change).`,
        href: '/dashboard/asset-requests',
      }).catch(() => {});
    }

    await writeAuditEntry(db, {
      tenantId: this.ctx.tenantId!,
      action: 'user.role_change',
      performedById: actor.id,
      detail: { userId: id, email: target.email, from: target.role, to: role, reassignToId: handoffTargetId, ...counts },
      impersonatedBy: this.ctx.impersonatedBy ?? null,
    }).catch(() => {});

    return { id, from: target.role, to: role, reassignToId: handoffTargetId, ...counts };
  }

  // Fallback hand-off pick: active ASSET_MANAGER (excluding the leaver) with the
  // fewest open PENDING requests; null when there is no other manager.
  private async pickFallbackManager(excludeId: string): Promise<string | null> {
    const db = this.ctx.prisma();
    const managers = await db.user.findMany({
      where: { role: 'ASSET_MANAGER', active: true, id: { not: excludeId } },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    if (managers.length === 0) return null;
    if (managers.length === 1) return managers[0].id;
    const counts = await db.assetRequest.groupBy({
      by: ['assignedToId'],
      where: { assignedToId: { in: managers.map((m: any) => m.id) }, status: 'PENDING' },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c: any) => [c.assignedToId, c._count._all]));
    let best = managers[0];
    let bestCount = countMap.get(best.id) || 0;
    for (let i = 1; i < managers.length; i++) {
      const c = countMap.get(managers[i].id) || 0;
      if (c < bestCount) { best = managers[i]; bestCount = c; }
    }
    return best.id;
  }

  // ── Offboarding (Slice 6a + 6b reassign) ──────────────────────────────────
  // Read-only preview of everything a user is still holding, plus the list of
  // active teammates a reassign could hand it to. ADMIN-only.
  async getOffboardingPreview(id: string, actor: Actor) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException('Only an admin can offboard users');
    const db = this.ctx.prisma();
    const target = await db.user.findUnique({
      where: { id },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, active: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const [assets, tickets, reservations, seats, openRequests, apiKeys, eligibleTargets] = await Promise.all([
      db.assignment.findMany({
        where: { userId: id, returnedAt: null },
        select: { id: true, asset: { select: { id: true, assetTag: true, name: true, status: true } } },
      }),
      db.serviceTicket.findMany({
        where: { assignedToId: id, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR'] } },
        select: { id: true, ticketNumber: true, title: true, status: true },
      }),
      db.reservation.findMany({
        where: { userId: id, status: { in: ['REQUESTED', 'CONFIRMED', 'CHECKED_OUT'] } },
        select: { id: true, status: true, startAt: true, endAt: true, asset: { select: { id: true, assetTag: true, name: true } } },
      }),
      db.softwareAssignment.findMany({
        where: { userId: id, returnedAt: null },
        select: { id: true, license: { select: { id: true, software: { select: { name: true } } } } },
      }),
      // Open asset-requests still assigned to them (a leaving manager's approve/decline queue).
      db.assetRequest.findMany({
        where: { assignedToId: id, status: { in: ['PENDING', 'APPROVED'] } },
        select: { id: true, number: true, title: true, status: true },
      }),
      // Live API keys they created — revoked on deactivation (a departed user's key must not survive).
      db.apiKey.findMany({
        where: { createdById: id, revokedAt: null },
        select: { id: true, name: true, prefix: true },
      }),
      // Active teammates a reassign can hand the holdings to (exclude the leaver).
      db.user.findMany({
        where: { active: true, id: { not: id } },
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
        orderBy: { firstName: 'asc' },
      }),
    ]);

    const isLastAdmin =
      target.role === 'ADMIN' &&
      target.active &&
      (await db.user.count({ where: { role: 'ADMIN', active: true, id: { not: id } } })) === 0;

    return {
      user: target,
      counts: {
        assets: assets.length,
        tickets: tickets.length,
        reservations: reservations.length,
        seats: seats.length,
        requests: openRequests.length,
        apiKeys: apiKeys.length,
      },
      assets, tickets, reservations, seats, openRequests, apiKeys,
      eligibleTargets,
      isLastAdmin,
    };
  }

  // Offboard a user in one atomic (serialization-retried) transaction: either RELEASE
  // everything they hold back to the pool (default) or REASSIGN it to a chosen target
  // user (Slice 6b, single-target). Bookings are always cancelled in both modes. Writes
  // one summary audit entry.
  async offboardUser(
    id: string,
    dto: { deactivate?: boolean; password?: string; targetUserId?: string },
    actor: Actor,
  ) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException('Only an admin can offboard users');
    if (id === actor.id) throw new BadRequestException('You cannot offboard yourself');

    const db = this.ctx.prisma();
    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');

    const deactivate = dto.deactivate !== false;
    const targetUserId = dto.targetUserId || null;
    const mode: 'release' | 'reassign' = targetUserId ? 'reassign' : 'release';

    // Reassign target must be a different, active user.
    if (targetUserId) {
      if (targetUserId === id) throw new BadRequestException('Reassign target must be a different user');
      const to = await db.user.findUnique({ where: { id: targetUserId }, select: { active: true } });
      if (!to || !to.active) throw new BadRequestException('Reassign target is no longer an active user');
    }

    // Last-admin guard (mirror update()): never deactivate the last active admin.
    if (deactivate && target.role === 'ADMIN' && target.active) {
      const otherAdmins = await db.user.count({ where: { role: 'ADMIN', active: true, id: { not: id } } });
      if (otherAdmins === 0) throw new ConflictException('Cannot deactivate the last remaining admin');
    }

    // MFA step-up (mirror resetUserMfa): the acting admin re-enters their password
    // when they themselves have MFA enabled.
    const admin = await db.user.findUnique({ where: { id: actor.id } });
    if (admin && admin.mfaMethod && admin.mfaMethod !== 'NONE') {
      const ok = await bcrypt.compare(dto.password || '', admin.passwordHash);
      if (!ok) throw new UnauthorizedException('Re-enter your password to offboard a user.');
    }

    // Request hand-off target: asset-requests are only actionable by a manager/admin, so a
    // leaver's open queue must land on one — the chosen reassign target when they qualify,
    // else the active manager with the fewest open requests, else unassigned (null).
    let requestHandoffId: string | null = null;
    if (mode === 'reassign') {
      const rt = await db.user.findUnique({ where: { id: targetUserId! }, select: { role: true } });
      requestHandoffId =
        rt && (rt.role === 'ASSET_MANAGER' || rt.role === 'ADMIN')
          ? targetUserId
          : await this.pickFallbackManager(id);
    } else {
      requestHandoffId = await this.pickFallbackManager(id);
    }

    const now = new Date();
    const runTx = () =>
      db.$transaction(
        async (tx: any) => {
          // X-lock the leaver for the whole offboard. Every branch below reads a set
          // of rows and then releases or reassigns them; concurrent offboards of the
          // same user would otherwise both see the same open assignments.
          await tx.$queryRawUnsafe(
            `SELECT \`id\` FROM \`User\` WHERE \`id\` = ? AND \`tenantId\` = ? FOR UPDATE`,
            id, this.ctx.tenantId!,
          );
          let assets = 0;
          let seats = 0;
          let seatsSkipped = 0;

          // Assets: close the leaver's open assignments. RELEASE → free each asset to
          // the pool (if nothing else holds it, not ARCHIVED/LOST_STOLEN). REASSIGN → create a
          // new assignment to the target (asset stays ASSIGNED); skip if the target
          // already holds that asset.
          const open = await tx.assignment.findMany({ where: { userId: id, returnedAt: null }, select: { id: true, assetId: true } });
          for (const a of open) await tx.assignment.update({ where: { id: a.id }, data: { returnedAt: now } });
          if (mode === 'reassign') {
            for (const a of open) {
              const dup = await tx.assignment.count({ where: { assetId: a.assetId, userId: targetUserId, returnedAt: null } });
              if (dup === 0) { await tx.assignment.create({ data: { assetId: a.assetId, userId: targetUserId } }); assets++; }
            }
          } else {
            for (const assetId of Array.from(new Set(open.map((a: any) => a.assetId)))) {
              const remaining = await tx.assignment.count({ where: { assetId, returnedAt: null } });
              if (remaining === 0) {
                const asset = await tx.asset.findUnique({ where: { id: assetId }, select: { status: true } });
                if (asset && asset.status !== 'ARCHIVED' && asset.status !== 'LOST_STOLEN') {
                  await tx.asset.update({ where: { id: assetId }, data: { status: 'AVAILABLE' } });
                }
              }
            }
            assets = open.length;
          }

          // Tickets: RELEASE → unassign (back to the queue); REASSIGN → hand to target.
          const t = await tx.serviceTicket.updateMany({
            where: { assignedToId: id, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR'] } },
            data: { assignedToId: mode === 'reassign' ? targetUserId : null },
          });

          // Reservations: always cancelled (bookings don't transfer; a CHECKED_OUT
          // one's asset custody already moved via the Assets step above).
          const r = await tx.reservation.updateMany({
            where: { userId: id, status: { in: ['REQUESTED', 'CONFIRMED', 'CHECKED_OUT'] } },
            data: { status: 'CANCELLED' },
          });

          // Software seats: RELEASE → return every open seat. REASSIGN → move to the
          // target, but if the target already holds that licence, return the leaver's
          // seat instead (free it) and count it as skipped.
          if (mode === 'reassign') {
            const openSeats = await tx.softwareAssignment.findMany({ where: { userId: id, returnedAt: null }, select: { id: true, licenseId: true } });
            for (const seat of openSeats) {
              const held = await tx.softwareAssignment.findFirst({ where: { licenseId: seat.licenseId, userId: targetUserId, returnedAt: null }, select: { id: true } });
              if (held) { await tx.softwareAssignment.update({ where: { id: seat.id }, data: { returnedAt: now } }); seatsSkipped++; }
              else { await tx.softwareAssignment.update({ where: { id: seat.id }, data: { userId: targetUserId } }); seats++; }
            }
          } else {
            const s = await tx.softwareAssignment.updateMany({ where: { userId: id, returnedAt: null }, data: { returnedAt: now } });
            seats = s.count;
          }

          // Asset-requests: hand the leaver's open queue to a manager/admin (or unassign).
          const rq = await tx.assetRequest.updateMany({
            where: { assignedToId: id, status: { in: ['PENDING', 'APPROVED'] } },
            data: { assignedToId: requestHandoffId },
          });

          // API keys: revoke every live key the leaver created — only when we deactivate
          // them (an active user keeps their integrations). Idempotent (revokedAt was null).
          let apiKeys = 0;
          if (deactivate) {
            const ak = await tx.apiKey.updateMany({
              where: { createdById: id, revokedAt: null },
              data: { revokedAt: now },
            });
            apiKeys = ak.count;
          }

          // Deactivate + invalidate the leaver's outstanding access tokens.
          if (deactivate) await tx.user.update({ where: { id }, data: { active: false, tokenVersion: { increment: 1 } } });
          return { assets, tickets: t.count, reservations: r.count, seats, seatsSkipped, requests: rq.count, apiKeys };
        },
        { isolationLevel: 'ReadCommitted' },
      );

    // Serialization-failure retry (codebase pattern, common/audit-hash.ts): retry the
    // whole transaction on P2034 / Postgres 40001, up to 3 attempts.
    let counts: { assets: number; tickets: number; reservations: number; seats: number; seatsSkipped: number; requests: number; apiKeys: number };
    for (let attempt = 1; ; attempt++) {
      try { counts = await runTx(); break; }
      catch (e: any) {
        const serialization = e?.code === 'P2034' || /serial|deadlock/i.test(e?.message || '');
        if (serialization && attempt < 3) continue;
        throw e;
      }
    }

    const summary = { mode, targetUserId, deactivated: deactivate, ...counts };
    const changed = counts.assets + counts.tickets + counts.reservations + counts.seats + counts.seatsSkipped + counts.requests + counts.apiKeys;
    // ONE summary audit entry (amendment #5: not one per asset). Skip on a pure no-op.
    if (deactivate || changed > 0) {
      await writeAuditEntry(db, {
        tenantId: this.ctx.tenantId!,
        action: 'user.offboard',
        performedById: actor.id,
        detail: { userId: id, email: target.email, ...summary },
        impersonatedBy: this.ctx.impersonatedBy ?? null,
      }).catch(() => {});
    }

    return summary;
  }
}
