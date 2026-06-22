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
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import { TenantPrismaPool } from '../tenancy/tenant-prisma.pool';
import { TenantProvisioningService } from '../tenancy/tenant-provisioning.service';
import { PlatformAuditService } from './platform-audit.service';
import { assertSuperAdmin } from './platform-mfa.util';
import { PLANS, type PlanKey } from '../billing/plans';

const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);

@Injectable()
export class PlatformTenantsService {
  private readonly log = new Logger(PlatformTenantsService.name);

  constructor(
    private readonly catalog: CatalogPrismaService,
    private readonly pool: TenantPrismaPool,
    private readonly provisioning: TenantProvisioningService,
    private readonly jwt: JwtService,
    private readonly audit: PlatformAuditService,
  ) {}

  async list(filter: { search?: string; status?: string; plan?: string }) {
    const where: any = {};
    if (filter.status && filter.status !== 'all') where.status = filter.status;
    if (filter.plan && filter.plan !== 'all') where.plan = filter.plan;
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { slug: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    const tenants = await this.catalog.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, slug: true, name: true, dbName: true, status: true, plan: true,
        subscriptionStatus: true, trialEndsAt: true, currentPeriodEnd: true,
        createdAt: true, updatedAt: true,
      },
    });

    // Each tenant is a separate DB — fan out and gather basic counts in parallel.
    const enriched = await Promise.all(tenants.map(async (t) => {
      let userCount = 0, assetCount = 0;
      try {
        if (t.status === 'ACTIVE' || t.status === 'PROVISIONING') {
          const db = this.pool.get(t.dbName);
          [userCount, assetCount] = await Promise.all([
            db.user.count(),
            db.asset.count(),
          ]);
        }
      } catch (e: any) {
        // A tenant DB that is unreachable should not block the whole list.
        this.log.warn(`Stats unavailable for ${t.dbName}: ${e.message}`);
      }
      return { ...t, userCount, assetCount };
    }));
    return enriched;
  }

  async getById(id: string) {
    const t = await this.catalog.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();

    let stats: any = { userCount: 0, assetCount: 0, ticketCount: 0, lastActivityAt: null };
    let admins: any[] = [];
    // Suspended tenants still have a live DB — read what we can so support staff
    // can investigate. Only skip when the DB itself is gone (DELETED).
    if (t.status !== 'DELETED') {
      try {
        const db = this.pool.get(t.dbName);
        const [u, a, tk, lastAudit] = await Promise.all([
          db.user.count(),
          db.asset.count(),
          db.serviceTicket.count().catch(() => 0),
          db.auditLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }).catch(() => null),
        ]);
        stats = { userCount: u, assetCount: a, ticketCount: tk, lastActivityAt: lastAudit?.createdAt || null };
        admins = await db.user.findMany({
          where: { role: 'ADMIN' },
          select: { id: true, email: true, firstName: true, lastName: true, active: true, totpEnabled: true, createdAt: true },
        }).catch(() => []);
      } catch (e: any) {
        this.log.warn(`Failed to read stats for ${t.dbName}: ${e.message}`);
      }
    }
    return { ...t, stats, admins };
  }

  async setStatus(actor: { id: string; email: string; role?: string }, id: string, status: 'ACTIVE' | 'SUSPENDED', req?: any) {
    assertSuperAdmin(actor);
    const t = await this.catalog.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    if (t.status === 'DELETED') throw new ConflictException('Tenant is deleted; restore is not supported.');
    const updated = await this.catalog.tenant.update({ where: { id }, data: { status } });
    await this.audit.record(actor, status === 'SUSPENDED' ? 'tenant.suspend' : 'tenant.activate',
      { type: 'tenant', id }, { previousStatus: t.status }, req);
    return updated;
  }

  async hardDelete(actor: { id: string; email: string; role?: string }, id: string, confirmSlug: string, req?: any) {
    assertSuperAdmin(actor);
    const t = await this.catalog.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    if (t.slug !== confirmSlug) throw new BadRequestException('Confirmation slug does not match');

    // Order: drop DB first, then the catalog rows. If the DB drop fails we keep
    // the catalog row so the operator can retry; orphaning catalog without DB
    // is preferable to orphaning a DB without catalog (no way to find it later).
    await this.provisioning.dropDatabase(t.dbName).catch((e) => {
      this.log.warn(`dropDatabase failed for ${t.dbName}: ${e?.message}`);
    });
    await this.catalog.tenantUser.deleteMany({ where: { tenantId: id } });
    await this.catalog.tenant.delete({ where: { id } });
    await this.audit.record(actor, 'tenant.delete', { type: 'tenant', id },
      { slug: t.slug, name: t.name, dbName: t.dbName }, req);
    return { ok: true };
  }

  async updatePlan(actor: { id: string; email: string; role?: string }, id: string, plan: PlanKey, req?: any) {
    assertSuperAdmin(actor);
    if (!PLANS[plan]) throw new BadRequestException('Unknown plan');
    const t = await this.catalog.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    const updated = await this.catalog.tenant.update({
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
    const t = await this.catalog.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    const data: any = {};
    if (patch.subscriptionStatus) data.subscriptionStatus = patch.subscriptionStatus;
    if (patch.trialEndsAt !== undefined) data.trialEndsAt = patch.trialEndsAt ? new Date(patch.trialEndsAt) : null;
    if (patch.currentPeriodEnd !== undefined) data.currentPeriodEnd = patch.currentPeriodEnd ? new Date(patch.currentPeriodEnd) : null;
    const updated = await this.catalog.tenant.update({ where: { id }, data });
    await this.audit.record(actor, 'tenant.updateSubscription', { type: 'tenant', id }, patch, req);
    return updated;
  }

  async listTenantUsers(id: string) {
    const t = await this.catalog.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    if (t.status === 'DELETED') {
      throw new ConflictException('Tenant has been deleted');
    }
    const db = this.pool.get(t.dbName);
    return db.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true,
        active: true, totpEnabled: true, lockedUntil: true, createdAt: true,
      },
    });
  }

  async resetTenantUserPassword(actor: { id: string; email: string; role?: string }, tenantId: string, userId: string, req?: any) {
    assertSuperAdmin(actor); // SUPPORT is read-only — cannot reset tenant-user passwords (Option B)
    const t = await this.catalog.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant not found');
    if (t.status !== 'ACTIVE') throw new ConflictException('Tenant is not active');
    const db = this.pool.get(t.dbName);
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
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

  /**
   * Issue a normal tenant-scoped JWT for any user inside the target tenant.
   * Used by support staff to "view as" — the existing tenant-side audit log
   * still records every action they take, and we record an entry here too.
   */
  async impersonate(actor: { id: string; email: string; role?: string }, tenantId: string, userId: string, req?: any) {
    assertSuperAdmin(actor); // SUPPORT cannot impersonate tenant users
    const t = await this.catalog.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant not found');
    if (t.status !== 'ACTIVE') throw new ConflictException('Tenant is not active');
    const db = this.pool.get(t.dbName);
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u || !u.active) throw new NotFoundException('User not found');

    // Impersonation tokens are deliberately stand-alone access tokens:
    //   • no refresh token is issued, so the lifetime is hard-capped at IMPERSONATE_TTL
    //     (defaults to 30 minutes) — there is no way to silently extend it via
    //     /auth/refresh (which requires a refresh token jti);
    //   • `imp: true` and `impersonatedBy` are embedded so every downstream
    //     audit row and any future per-route check can tell this is impersonation.
    const ttl = Number(process.env.IMPERSONATE_TTL || 1800);
    const access = this.jwt.sign(
      {
        sub: u.id, tid: t.id, slug: t.slug, db: t.dbName, role: u.role, email: u.email,
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
      this.catalog.tenant.count(),
      this.catalog.tenant.groupBy({ by: ['status'], _count: true }),
      this.catalog.tenant.groupBy({ by: ['plan'], _count: true }),
    ]);

    const active = await this.catalog.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { dbName: true },
    });

    let users = 0, assets = 0, errors = 0;
    await Promise.all(active.map(async (t) => {
      try {
        const db = this.pool.get(t.dbName);
        const [u, a] = await Promise.all([db.user.count(), db.asset.count()]);
        users += u; assets += a;
      } catch { errors++; }
    }));

    const recentTenants = await this.catalog.tenant.findMany({
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
    return this.catalog.platformAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      ...(filter.cursor ? { skip: 1, cursor: { id: filter.cursor } } : {}),
    });
  }
}
