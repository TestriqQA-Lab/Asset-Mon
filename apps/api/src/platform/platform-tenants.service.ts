import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { GlobalPrismaService } from '../tenancy/global-prisma.service';
import { TENANT_OWNED_MODELS } from '../tenancy/scoped-client';
import { PlatformAuditService } from './platform-audit.service';
import { assertSuperAdmin } from './platform-mfa.util';
import { PLANS, type PlanKey } from '../billing/plans';
import { mergeSettings, MODULE_KEYS } from '../tenant-settings/tenant-settings.types';
import { clearTenantMfaUserData } from '../auth/tenant-mfa-clear';
import { WorkspaceInviteService } from '../workspace-invite/workspace-invite.service';

const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);

@Injectable()
export class PlatformTenantsService {
  private readonly log = new Logger(PlatformTenantsService.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly jwt: JwtService,
    private readonly audit: PlatformAuditService,
    private readonly invites: WorkspaceInviteService,
  ) {}

  async list(filter: { search?: string; status?: string; plan?: string }) {
    const where: any = {};
    if (filter.status && filter.status !== 'all') where.status = filter.status;
    if (filter.plan && filter.plan !== 'all') where.plan = filter.plan;
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search } },
        { slug: { contains: filter.search } },
      ];
    }
    const tenants = await this.globalPrisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, slug: true, name: true, status: true, plan: true,
        subscriptionStatus: true, trialEndsAt: true, currentPeriodEnd: true,
        createdAt: true, updatedAt: true,
      },
    });

    // Counts are per-tenant filters on shared tables — gather them in parallel.
    const enriched = await Promise.all(tenants.map(async (t) => {
      let userCount = 0, assetCount = 0;
      try {
        if (t.status === 'ACTIVE' || t.status === 'PROVISIONING') {
          const db = this.globalPrisma;
          [userCount, assetCount] = await Promise.all([
            db.user.count({ where: { tenantId: t.id } }),
            db.asset.count({ where: { tenantId: t.id } }),
          ]);
        }
      } catch (e: any) {
        // One tenant's counts failing should not block the whole list.
        this.log.warn(`Stats unavailable for ${t.slug}: ${e.message}`);
      }
      return { ...t, userCount, assetCount };
    }));
    return enriched;
  }

  /** Count of tenants needing attention (suspended or expiring in <= 7 days) */
  async attentionCount() {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    return this.globalPrisma.tenant.count({
      where: {
        OR: [
          { status: 'SUSPENDED' },
          { trialEndsAt: { lte: nextWeek }, status: 'ACTIVE' },
        ],
      },
    });
  }

  async getById(id: string) {
    const t = await this.globalPrisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();

    let stats: any = { userCount: 0, assetCount: 0, ticketCount: 0, lastActivityAt: null };
    let admins: any[] = [];
    // A suspended tenant's rows are still there — read what we can so support staff
    // can investigate. Only skip once the rows have been deleted (DELETED).
    if (t.status !== 'DELETED') {
      try {
        const db = this.globalPrisma;
        const [u, a, ti, lastAudit] = await Promise.all([
          db.user.count({ where: { tenantId: t.id } }),
          db.asset.count({ where: { tenantId: t.id } }),
          db.serviceTicket.count({ where: { tenantId: t.id } }).catch(() => 0),
          db.auditLog.findFirst({
            where: { tenantId: t.id },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          }).catch(() => null),
        ]);
        stats = { userCount: u, assetCount: a, ticketCount: ti, lastActivityAt: lastAudit?.createdAt || null };
        admins = await db.user.findMany({
          where: { tenantId: t.id, role: 'ADMIN' },
          select: { id: true, email: true, firstName: true, lastName: true, active: true, totpEnabled: true, createdAt: true },
        }).catch(() => []);
      } catch (e: any) {
        this.log.warn(`Failed to read stats for ${t.slug}: ${e.message}`);
      }
    }
    return { ...t, stats, admins };
  }

  async setStatus(actor: { id: string; email: string; role?: string }, id: string, status: 'ACTIVE' | 'SUSPENDED', req?: any) {
    assertSuperAdmin(actor);
    const t = await this.globalPrisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    if (t.status === 'DELETED') throw new ConflictException('Tenant is deleted; restore is not supported.');
    const updated = await this.globalPrisma.tenant.update({ where: { id }, data: { status } });
    await this.audit.record(actor, status === 'SUSPENDED' ? 'tenant.suspend' : 'tenant.activate',
      { type: 'tenant', id }, { previousStatus: t.status }, req);
    return updated;
  }

  async hardDelete(actor: { id: string; email: string; role?: string }, id: string, confirmSlug: string, req?: any) {
    assertSuperAdmin(actor);
    const t = await this.globalPrisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    if (t.slug !== confirmSlug) throw new BadRequestException('Confirmation slug does not match');

    // This used to call dropDatabase() and then delete TenantUser + Tenant, which
    // was right when every workspace had its own database. Since the MySQL
    // migration they share one, separated by tenantId, and dropDatabase() is a
    // no-op — so "delete tenant" removed two rows and left the workspace's assets,
    // users, audit log and everything else behind, permanently, under a tenantId
    // that no longer resolved. For a customer exercising a deletion right that is
    // not a cosmetic bug.
    //
    // The model list is not repeated here. TENANT_OWNED_MODELS is derived from what
    // the scoping client enforces, and scoped-client.spec.ts fails if it drifts from
    // the schema — so a model added later is covered by this delete automatically.
    //
    // Four foreign keys are RESTRICT and all of them point at User (AssetRequest,
    // Reservation, PurchaseRequest, Assignment), so User goes last. Everything else
    // is CASCADE or SET NULL and needs no ordering.
    const ordered = [...TENANT_OWNED_MODELS.filter((m) => m !== 'User'), 'User'];

    const removed: Record<string, number> = {};
    await this.globalPrisma.$transaction(
      async (tx) => {
        for (const model of ordered) {
          const delegate = (tx as any)[model.charAt(0).toLowerCase() + model.slice(1)];
          if (!delegate?.deleteMany) throw new Error(`No Prisma delegate for model ${model}`);
          const { count } = await delegate.deleteMany({ where: { tenantId: id } });
          if (count) removed[model] = count;
        }
        await tx.tenant.delete({ where: { id } });
      },
      // A busy workspace is a lot of rows and the default 5s is not enough; a
      // partial delete is exactly the orphaning this exists to prevent.
      { timeout: 120_000, maxWait: 15_000 },
    );

    const totalRows = Object.values(removed).reduce((a, b) => a + b, 0);
    this.log.warn(`Tenant ${t.slug} (${id}) hard-deleted: ${totalRows} rows across ${Object.keys(removed).length} tables`);
    await this.audit.record(actor, 'tenant.delete', { type: 'tenant', id },
      { slug: t.slug, name: t.name, totalRows, removed }, req);
    return { ok: true, totalRows, removed };
  }

  async updatePlan(actor: { id: string; email: string; role?: string }, id: string, plan: PlanKey, req?: any) {
    assertSuperAdmin(actor);
    if (!PLANS[plan]) throw new BadRequestException('Unknown plan');
    const t = await this.globalPrisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    const updated = await this.globalPrisma.tenant.update({
      where: { id },
      data: { plan, subscriptionStatus: plan === 'starter' ? 'free' : t.subscriptionStatus },
    });
    await this.audit.record(actor, 'tenant.updatePlan', { type: 'tenant', id }, { previousPlan: t.plan, plan }, req);
    return updated;
  }

  async updateSubscription(
    actor: { id: string; email: string; role?: string },
    id: string,
    patch: { subscriptionStatus?: string; trialEndsAt?: string | null; currentPeriodEnd?: string | null },
    req?: any,
  ) {
    assertSuperAdmin(actor);
    const t = await this.globalPrisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    const data: any = {};
    if (patch.subscriptionStatus) data.subscriptionStatus = patch.subscriptionStatus;
    if (patch.trialEndsAt !== undefined) data.trialEndsAt = patch.trialEndsAt ? new Date(patch.trialEndsAt) : null;
    if (patch.currentPeriodEnd !== undefined) data.currentPeriodEnd = patch.currentPeriodEnd ? new Date(patch.currentPeriodEnd) : null;
    const updated = await this.globalPrisma.tenant.update({ where: { id }, data });
    await this.audit.record(actor, 'tenant.updateSubscription', { type: 'tenant', id }, patch, req);
    return updated;
  }

  // One-click trial / grace-period extension (Slice 7a). Pushes trialEndsAt forward
  // by N days and marks the tenant trialing — the safe version of hand-editing the
  // raw subscription date. Audited.
  async extendTrial(
    actor: { id: string; email: string; role?: string },
    id: string,
    days: number,
    req?: any,
  ) {
    assertSuperAdmin(actor);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new BadRequestException('days must be an integer 1–365');
    const t = await this.globalPrisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    // Extend from the later of "now" and the current trial end, so a future trial is
    // pushed forward (never shortened) and a null/expired one is based off now.
    const now = new Date();
    const base = t.trialEndsAt && t.trialEndsAt > now ? t.trialEndsAt : now;
    const trialEndsAt = new Date(base.getTime() + days * 86_400_000);
    const updated = await this.globalPrisma.tenant.update({
      where: { id },
      data: { trialEndsAt, subscriptionStatus: 'trialing' },
    });
    await this.audit.record(actor, 'tenant.extendTrial', { type: 'tenant', id },
      { days, previousTrialEndsAt: t.trialEndsAt, trialEndsAt, previousStatus: t.subscriptionStatus }, req);
    return updated;
  }

  // ── Feature modules (operator-side; same switch the tenant Settings → Modules page uses) ──
  // Readable by SUPER_ADMIN and SUPPORT (no assertSuperAdmin); returns ONLY the
  // merged module map — no plan-tier comparison (the old "beyond plan" idea was a bug).
  async getModules(id: string) {
    const t = await this.globalPrisma.tenant.findUnique({ where: { id }, select: { settings: true } });
    if (!t) throw new NotFoundException();
    return { modules: mergeSettings(t.settings).modules };
  }

  async updateModules(
    actor: { id: string; email: string; role?: string },
    id: string,
    modules: Record<string, boolean>,
    req?: any,
  ) {
    assertSuperAdmin(actor);
    const t = await this.globalPrisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    if (t.status === 'DELETED') throw new ConflictException('Tenant is deleted.');
    const current = mergeSettings(t.settings);
    // Accept only known module keys, only boolean values; merge onto current.
    const accepted: Record<string, boolean> = {};
    for (const k of MODULE_KEYS) {
      if (typeof modules?.[k] === 'boolean') accepted[k] = modules[k];
    }
    const nextModules = { ...current.modules, ...accepted };
    const changed = MODULE_KEYS
      .filter((k) => current.modules[k] !== nextModules[k])
      .map((k) => ({ key: k, from: current.modules[k], to: nextModules[k] }));
    await this.globalPrisma.tenant.update({
      where: { id },
      data: { settings: { ...current, modules: nextModules } as any },
    });
    await this.audit.record(actor, 'tenant.updateModules', { type: 'tenant', id }, { changed }, req);
    return { modules: nextModules };
  }

  async listTenantUsers(id: string) {
    const t = await this.globalPrisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    if (t.status === 'DELETED') {
      throw new ConflictException('Tenant has been deleted');
    }
    const db = this.globalPrisma;
    const users = await db.user.findMany({
      where: { tenantId: t.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true,
        active: true, totpEnabled: true, mfaMethod: true, lockedUntil: true, createdAt: true,
      },
    });
    return users;
  }

  async resetTenantUserPassword(actor: { id: string; email: string; role?: string }, tenantId: string, userId: string, req?: any) {
    assertSuperAdmin(actor); // SUPPORT is read-only — cannot reset tenant-user passwords (Option B)
    const t = await this.globalPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant not found');
    if (t.status !== 'ACTIVE') throw new ConflictException('Tenant is not active');
    const db = this.globalPrisma;
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u || u.tenantId !== t.id) throw new NotFoundException('User not found');
    // Temporary password: high-entropy and conforms to the public policy
    // (≥10 chars, includes letter + digit + symbol) so the new owner can hold
    // it until they self-rotate without immediately hitting policy errors.
    const tempPassword = `Temp${crypto.randomBytes(8).toString('hex')}!9`;
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_COST);
    await db.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        tokenVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.audit.record(actor, 'tenant.resetUserPassword',
      { type: 'tenantUser', id: userId },
      { tenantId, tenantSlug: t.slug, email: u.email },
      req);
    // Returning the temp password is safe here: the platform user is operating
    // with explicit support intent, and the channel is HTTPS to their browser.
    return { tempPassword, email: u.email };
  }

  // ── Login & access help (Slice 2) — operator rescues a stuck tenant user ──

  // Wipe a tenant user's MFA so they can re-enroll (lost device/email). Mirrors the
  // tenant-side admin reset (users.service.ts) but WITHOUT the step-up: the operator
  // is already 3FA-gated and super-admin-only.
  async resetTenantUserMfa(actor: { id: string; email: string; role?: string }, tenantId: string, userId: string, req?: any) {
    assertSuperAdmin(actor);
    const t = await this.globalPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant not found');
    if (t.status !== 'ACTIVE') throw new ConflictException('Tenant is not active');
    const db = this.globalPrisma;
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u || u.tenantId !== t.id) throw new NotFoundException('User not found');
    await db.$transaction(async (tx: any) => {
      await tx.tenantBackupCode.deleteMany({ where: { userId } });
      await tx.tenantMfaPending.deleteMany({ where: { userId } });
      await tx.user.update({ where: { id: userId }, data: clearTenantMfaUserData() });
    });
    await this.audit.record(actor, 'tenant.resetUserMfa',
      { type: 'tenantUser', id: userId },
      { tenantId, tenantSlug: t.slug, email: u.email },
      req);
    return { ok: true, email: u.email };
  }

  // Clear the failed-login lock so the user can try signing in again. Does NOT bump
  // tokenVersion — unlocking is "let them retry", not a compromise reset.
  async unlockTenantUser(actor: { id: string; email: string; role?: string }, tenantId: string, userId: string, req?: any) {
    assertSuperAdmin(actor);
    const t = await this.globalPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant not found');
    if (t.status !== 'ACTIVE') throw new ConflictException('Tenant is not active');
    const db = this.globalPrisma;
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u || u.tenantId !== t.id) throw new NotFoundException('User not found');
    await db.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null } });
    await this.audit.record(actor, 'tenant.unlockUser',
      { type: 'tenantUser', id: userId },
      { tenantId, tenantSlug: t.slug, email: u.email },
      req);
    return { ok: true, email: u.email };
  }

  // ── Workspace invite link (operator side) ──
  // Read-only status (SUPPORT may view). Non-minting — looking never creates a link.
  async getTenantInvite(tenantId: string) {
    const t = await this.globalPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant not found');
    return this.invites.status(tenantId);
  }

  async regenerateTenantInvite(actor: { id: string; email: string; role?: string }, tenantId: string, req?: any) {
    assertSuperAdmin(actor);
    const t = await this.globalPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant not found');
    if (t.status !== 'ACTIVE') throw new ConflictException('Tenant is not active');
    const r = await this.invites.rotate(tenantId);
    await this.audit.record(actor, 'tenant.inviteRotate', { type: 'tenant', id: tenantId }, { tenantSlug: t.slug }, req);
    return r;
  }

  async disableTenantInvite(actor: { id: string; email: string; role?: string }, tenantId: string, req?: any) {
    assertSuperAdmin(actor);
    const t = await this.globalPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant not found');
    const r = await this.invites.disable(tenantId);
    await this.audit.record(actor, 'tenant.inviteDisable', { type: 'tenant', id: tenantId }, { tenantSlug: t.slug }, req);
    return r;
  }

  /**
   * Issue a normal tenant-scoped JWT for any user inside the target tenant.
   * Used by support staff to "view as" — the existing tenant-side audit log
   * still records every action they take, and we record an entry here too.
   */
  async impersonate(actor: { id: string; email: string; role?: string }, tenantId: string, userId: string, req?: any) {
    assertSuperAdmin(actor); // SUPPORT cannot impersonate tenant users
    const t = await this.globalPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant not found');
    if (t.status !== 'ACTIVE') throw new ConflictException('Tenant is not active');
    const db = this.globalPrisma;
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u || !u.active || u.tenantId !== t.id) throw new NotFoundException('User not found');

    // Impersonation tokens are deliberately stand-alone access tokens:
    //   • no refresh token is issued, so the lifetime is hard-capped at IMPERSONATE_TTL
    //     (defaults to 30 minutes) — there is no way to silently extend it via
    //     /auth/refresh (which requires a refresh token jti);
    //   • `imp: true` and `impersonatedBy` are embedded so every downstream
    //     audit row and any future per-route check can tell this is impersonation.
    const ttl = Number(process.env.IMPERSONATE_TTL || 1800);
    const access = this.jwt.sign(
      {
        sub: u.id, tid: t.id, slug: t.slug, role: u.role, email: u.email,
        tv: u.tokenVersion, imp: true, impersonatedBy: actor.id,
      },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: ttl },
    );

    await this.audit.record(actor, 'tenant.impersonate',
      { type: 'tenantUser', id: u.id },
      { tenantId: t.id, tenantSlug: t.slug, email: u.email, ttlSeconds: ttl },
      req);

    return {
      accessToken: access,
      tenant: { id: t.id, slug: t.slug, name: t.name },
      user: { id: u.id, email: u.email, role: u.role, firstName: u.firstName, lastName: u.lastName },
    };
  }

  /** Aggregate dashboard counters across the whole platform. */
  async metrics() {
    const [tenants, byStatus, byPlan] = await Promise.all([
      this.globalPrisma.tenant.count(),
      this.globalPrisma.tenant.groupBy({ by: ['status'], _count: true }),
      this.globalPrisma.tenant.groupBy({ by: ['plan'], _count: true }),
    ]);

    const active = await this.globalPrisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });

    let users = 0, assets = 0, errors = 0;
    await Promise.all(active.map(async (t) => {
      try {
        const db = this.globalPrisma;
        const [u, a] = await Promise.all([db.user.count({ where: { tenantId: t.id } }), db.asset.count({ where: { tenantId: t.id } })]);
        users += u; assets += a;
      } catch { errors++; }
    }));

    const recentTenants = await this.globalPrisma.tenant.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      select: { id: true, slug: true, name: true, createdAt: true, plan: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      tenants: {
        total: tenants,
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
        byPlan: Object.fromEntries(byPlan.map((r) => [r.plan, r._count])),
      },
      users,
      assets,
      readErrors: errors,
      recentTenants,
    };
  }

  /**
   * `limit` is hard-capped at 500 by the controller, but we re-clamp here so a
   * service-level caller can't bypass it. `cursor` is the id of the last
   * already-fetched row; together with the descending createdAt ordering this
   * gives us cheap keyset pagination without an offset.
   */
  async auditLog(filter: {
    actorId?: string; action?: string; targetType?: string; targetId?: string;
    limit?: number; cursor?: string;
  }) {
    const where: any = {};
    if (filter.actorId) where.actorId = filter.actorId;
    if (filter.action) where.action = { contains: filter.action };
    if (filter.targetType) where.targetType = filter.targetType;
    if (filter.targetId) where.targetId = filter.targetId;
    const take = Math.max(1, Math.min(filter.limit || 50, 500));
    return this.globalPrisma.platformAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      ...(filter.cursor ? { skip: 1, cursor: { id: filter.cursor } } : {}),
    });
  }
}
