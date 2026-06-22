import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import { BillingService } from '../billing/billing.module';
import { writeAuditEntry } from '../common/audit-hash';
import { clearTenantMfaUserData } from '../auth/tenant-mfa-clear';

type Actor = { id: string; role: string };

@Injectable()
export class UsersService {
  constructor(
    private readonly ctx: TenantContextService,
    private readonly catalog: CatalogPrismaService,
    private readonly billing: BillingService,
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
    const existing = await this.ctx.prisma().user.findUnique({ where: { email } });
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
      action: 'user.remove',
      performedById: actor.id,
      detail: { userId: id, email: u.email },
      impersonatedBy: this.ctx.impersonatedBy ?? null,
    }).catch(() => {});
  }
}
