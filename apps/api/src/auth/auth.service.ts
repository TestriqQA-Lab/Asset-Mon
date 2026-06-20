import { BadRequestException, HttpException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { authenticator } from 'otplib';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import { TenantProvisioningService } from '../tenancy/tenant-provisioning.service';
import { TenantPrismaPool } from '../tenancy/tenant-prisma.pool';
import { SignupDto, LoginDto, AcceptInviteDto } from './dto';
import { decryptSecret } from '../common/crypto';
import { WorkspaceInviteService } from '../workspace-invite/workspace-invite.service';
import { PLANS, type PlanKey } from '../billing/plans';

// Pre-computed bcrypt hash for a value no real user can have — used as a
// constant-time dummy when the supplied email does not exist in the catalog.
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuuC1jXrwzgQp1/Eu0XPLDC9D7K0qJ7lI2';
const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);

// Account-lockout knobs.
const LOCK_THRESHOLD = Number(process.env.LOGIN_LOCK_THRESHOLD || 5);
const LOCK_WINDOW_MS = Number(process.env.LOGIN_LOCK_WINDOW_MS || 15 * 60_000);
const LOCK_DURATION_MS = Number(process.env.LOGIN_LOCK_DURATION_MS || 15 * 60_000);

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly catalog: CatalogPrismaService,
    private readonly provisioning: TenantProvisioningService,
    private readonly pool: TenantPrismaPool,
    private readonly jwt: JwtService,
    private readonly invites: WorkspaceInviteService,
  ) {}

  async inspectInvite(token: string) {
    const tenant = await this.invites.findTenantByToken(token);
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new BadRequestException('Invite link is invalid or revoked');
    }
    return { workspaceName: tenant.name, slug: tenant.slug };
  }

  async acceptInvite(token: string, dto: AcceptInviteDto) {
    const tenant = await this.invites.findTenantByToken(token);
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new BadRequestException('Invite link is invalid or revoked');
    }
    if (tenant.subscriptionStatus && ['expired', 'past_due'].includes(tenant.subscriptionStatus)) {
      throw new BadRequestException('This workspace is not accepting new members right now');
    }

    const email = dto.email.toLowerCase();
    const tenantDb = this.pool.get(tenant.dbName);

    const planKey: PlanKey = (PLANS[tenant.plan as PlanKey] ? tenant.plan : 'business') as PlanKey;
    const plan = PLANS[planKey];
    if (plan.limits.users != null) {
      const userCount = await tenantDb.user.count();
      if (userCount >= plan.limits.users) {
        throw new BadRequestException(`This workspace has reached its plan limit (${plan.limits.users} users).`);
      }
    }

    const existing = await tenantDb.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('A user with this email already exists in this workspace');
    }

    // Compensating-write order: catalog mapping FIRST so a failure leaves no orphan
    // tenant-DB user; then the tenant-DB user, rolling the catalog row back if that fails.
    await this.catalog.tenantUser.upsert({
      where: { email_tenantId: { email, tenantId: tenant.id } },
      update: {},
      create: { email, tenantId: tenant.id },
    });
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    let user: any;
    try {
      user = await tenantDb.user.create({
        data: {
          email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: 'EMPLOYEE',
          passwordChangedAt: new Date(),
        },
      });
    } catch (e) {
      await this.catalog.tenantUser.delete({ where: { email_tenantId: { email, tenantId: tenant.id } } }).catch(() => {});
      throw e;
    }
    return this.issueTokens(tenant.id, tenant.slug, tenant.dbName, user.id, user.role, user.email, user.tokenVersion);
  }

  async signup(dto: SignupDto) {
    const existing = await this.catalog.tenant.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new BadRequestException('Workspace slug is already taken');

    const dbName = `assetmon_t_${dto.slug.replace(/-/g, '_')}`;
    const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const tenant = await this.catalog.tenant.create({
      data: {
        slug: dto.slug, name: dto.workspaceName, dbName, status: 'PROVISIONING',
        plan: 'business', subscriptionStatus: 'trialing', trialEndsAt: trialEnd,
      },
    });

    // Extended rollback: cleans up any partially-provisioned state regardless of
    // where the failure occurred.
    try {
      await this.provisioning.createDatabase(dbName);
      await this.provisioning.runMigrations(dbName);

      const tenantDb = this.pool.get(dbName);
      await this.seedDefaults(tenantDb);
      const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
      const user = await tenantDb.user.create({
        data: {
          email: dto.email.toLowerCase(),
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: 'ADMIN',
          passwordChangedAt: new Date(),
        },
      });

      await this.catalog.tenantUser.create({
        data: { email: dto.email.toLowerCase(), tenantId: tenant.id },
      });
      await this.catalog.tenant.update({ where: { id: tenant.id }, data: { status: 'ACTIVE' } });

      try { await this.seedDemoData(tenantDb, user.id); } catch (e: any) { this.log.warn(`Demo seed failed: ${e.message}`); }

      return this.issueTokens(tenant.id, tenant.slug, dbName, user.id, user.role, user.email, user.tokenVersion);
    } catch (err: any) {
      this.log.error(`Provisioning failed: ${err.message}`);
      await this.catalog.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
      await this.provisioning.dropDatabase(dbName).catch(() => {});
      throw new BadRequestException(`Failed to provision workspace: ${err.message}`);
    }
  }

  private async seedDemoData(db: any, _adminId: string) {
    const eng = await db.department.create({ data: { name: 'Engineering', costCenter: 'E-100' } });
    const ops = await db.department.create({ data: { name: 'Operations', costCenter: 'O-200' } });
    const hq = await db.location.create({ data: { name: 'HQ', type: 'BUILDING' } });
    const floor2 = await db.location.create({ data: { name: 'Floor 2', type: 'FLOOR', parentId: hq.id } });
    const apple = await db.vendor.create({ data: { name: 'Apple Inc', email: 'sales@apple.com' } });
    const dell = await db.vendor.create({ data: { name: 'Dell Technologies', email: 'sales@dell.com' } });
    const cats = await db.category.findMany();
    const byName = (n: string) => cats.find((c: any) => c.name === n);

    const seed = [
      { name: 'MacBook Pro 14"', cat: 'Laptop', vendor: apple.id, dept: eng.id, loc: floor2.id, cost: 2199, serial: 'C02XY1' },
      { name: 'MacBook Air 13"', cat: 'Laptop', vendor: apple.id, dept: eng.id, loc: floor2.id, cost: 1299, serial: 'C02XY2' },
      { name: 'Dell XPS 13', cat: 'Laptop', vendor: dell.id, dept: ops.id, loc: hq.id, cost: 1499, serial: 'XPS-1' },
      { name: 'Dell U2724QE Monitor', cat: 'Monitor', vendor: dell.id, dept: eng.id, loc: floor2.id, cost: 549, serial: 'U2-1' },
      { name: 'iPhone 15 Pro', cat: 'Phone', vendor: apple.id, dept: ops.id, loc: hq.id, cost: 999, serial: 'IP15-1' },
      { name: 'Logitech MX Master 3S', cat: 'Peripheral', vendor: null, dept: eng.id, loc: floor2.id, cost: 99, serial: 'MX-1' },
    ];

    for (const s of seed) {
      const cat = byName(s.cat) || cats[0];
      const tag = `AM-${String((await db.asset.count()) + 1).padStart(5, '0')}`;
      await db.asset.create({
        data: {
          assetTag: tag, name: s.name, status: 'IN_STOCK',
          categoryId: cat.id, locationId: s.loc, departmentId: s.dept, vendorId: s.vendor,
          serialNumber: s.serial, purchaseCost: s.cost,
          purchaseDate: new Date(Date.now() - 200 * 86_400_000),
          depreciationMethod: 'STRAIGHT_LINE', salvageValue: Math.round(s.cost * 0.1),
          usefulLifeMonths: 36, depreciationStart: new Date(Date.now() - 180 * 86_400_000),
        },
      });
    }
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const mappings = await this.catalog.tenantUser.findMany({
      where: { email },
      include: { tenant: true },
    });

    if (!mappings.length) {
      await bcrypt.compare(dto.password || '', DUMMY_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }

    // If multiple workspaces match and the caller did not specify one, ask explicitly
    // instead of silently picking [0] — prevents wrong-workspace logins / phishing primitives.
    if (mappings.length > 1 && !dto.workspaceSlug) {
      throw new BadRequestException({
        code: 'WORKSPACE_REQUIRED',
        message: 'Multiple workspaces match this email. Provide workspaceSlug.',
        availableSlugs: mappings.map((m) => m.tenant.slug),
      });
    }

    let chosen = mappings[0];
    if (dto.workspaceSlug) {
      const m = mappings.find((m) => m.tenant.slug === dto.workspaceSlug);
      if (!m) {
        await bcrypt.compare(dto.password || '', DUMMY_HASH);
        throw new UnauthorizedException('Invalid credentials');
      }
      chosen = m;
    }
    if (chosen.tenant.status !== 'ACTIVE') {
      await bcrypt.compare(dto.password || '', DUMMY_HASH);
      throw new UnauthorizedException('Workspace not active');
    }

    const tenantDb = this.pool.get(chosen.tenant.dbName);
    const user = await tenantDb.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      await bcrypt.compare(dto.password || '', DUMMY_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Lockout check. RFC 4918 423 LOCKED is the right code here - a generic 401
    // hides the lockout from rate-limit / WAF tooling and from honest users who
    // would otherwise keep retrying valid credentials and burn through more
    // throttler budget. (Nest's HttpStatus enum doesn't include LOCKED, so we
    // hand-roll the integer.)
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        { statusCode: 423, message: 'Account temporarily locked. Try again later.', error: 'Locked' },
        423,
      );
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.recordFailedLogin(tenantDb, user);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.totpEnabled) {
      if (!dto.totp) throw new UnauthorizedException('TOTP_REQUIRED');
      let secret: string;
      try { secret = decryptSecret(user.totpSecret!); }
      catch { throw new UnauthorizedException('2FA misconfigured — contact an admin'); }
      if (!authenticator.check(dto.totp, secret)) {
        await this.recordFailedLogin(tenantDb, user);
        throw new UnauthorizedException('Invalid TOTP code');
      }
    }

    // Successful login: reset lockout state and rehash password if cost is below current setting.
    const fresh = await this.maybeRehash(tenantDb, user, dto.password);
    await tenantDb.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    return this.issueTokens(chosen.tenant.id, chosen.tenant.slug, chosen.tenant.dbName, fresh.id, fresh.role, fresh.email, fresh.tokenVersion);
  }

  private async recordFailedLogin(db: any, user: any) {
    const now = new Date();
    const windowStart = new Date(now.getTime() - LOCK_WINDOW_MS);
    // If the last failure was outside the window, reset the counter.
    const newCount = (user.passwordChangedAt && user.passwordChangedAt > windowStart)
      ? user.failedLoginCount + 1
      : Math.max(1, user.failedLoginCount + 1);
    const shouldLock = newCount >= LOCK_THRESHOLD;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : newCount,
        lockedUntil: shouldLock ? new Date(now.getTime() + LOCK_DURATION_MS) : user.lockedUntil,
      },
    }).catch(() => {});
  }

  private async maybeRehash(db: any, user: any, plain: string) {
    try {
      const rounds = (() => {
        const m = /^\$2[aby]\$(\d{2})\$/.exec(user.passwordHash);
        return m ? Number(m[1]) : BCRYPT_COST;
      })();
      if (rounds < BCRYPT_COST) {
        const fresh = await bcrypt.hash(plain, BCRYPT_COST);
        return await db.user.update({ where: { id: user.id }, data: { passwordHash: fresh } });
      }
    } catch {
      // never block login on rehash failures
    }
    return user;
  }

  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwt.verify(refreshToken, { secret: process.env.JWT_REFRESH_SECRET });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!payload.jti) throw new UnauthorizedException('Invalid refresh token');
    // Impersonation tokens are intentionally never refreshable. Even though the
    // impersonate flow only issues an access token (not a refresh token), we
    // defensively refuse here in case the access token leaks and is replayed
    // through this endpoint.
    if (payload.imp || payload.impersonatedBy) throw new UnauthorizedException('Invalid refresh token');

    const tenant = await this.catalog.tenant.findUnique({ where: { id: payload.tid } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new UnauthorizedException();
    const db = this.pool.get(tenant.dbName);

    // Persisted reuse check. If the JTI was already consumed:
    //   - via /auth/logout: the legit user clicked sign-out; refuse silently without
    //     tearing down every other session they may have open.
    //   - via /auth/refresh: legitimate rotation already happened; a second attempt
    //     with the same JTI is theft — invalidate every outstanding access token.
    const seen = await db.refreshTokenJti.findUnique({ where: { jti: payload.jti } }).catch(() => null);
    if (seen) {
      if (seen.reason !== 'logout') {
        this.log.warn(`Refresh token reuse detected for user ${payload.sub} — invalidating all sessions`);
        await db.user.update({ where: { id: payload.sub }, data: { tokenVersion: { increment: 1 } } }).catch(() => {});
      }
      throw new UnauthorizedException('Refresh token reused');
    }

    const user = await db.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw new UnauthorizedException();

    // Enforce tokenVersion on refresh too — otherwise logout-all / role-change /
    // password-reset only invalidates *access* tokens; an attacker with a stolen
    // refresh issued before the bump could still mint fresh access tokens.
    if (typeof payload.tv === 'number' && payload.tv !== user.tokenVersion) {
      throw new UnauthorizedException('Refresh token expired');
    }

    await db.refreshTokenJti.create({
      data: {
        jti: payload.jti,
        userId: payload.sub,
        reason: 'refresh',
        expiresAt: new Date((payload.exp || 0) * 1000),
      },
    }).catch(() => {});

    return this.issueTokens(tenant.id, tenant.slug, tenant.dbName, user.id, user.role, user.email, user.tokenVersion);
  }

  async logout(refreshToken: string | undefined, _ctx?: { tid?: string; sub?: string }) {
    if (refreshToken) {
      let payload: any;
      try { payload = this.jwt.verify(refreshToken, { secret: process.env.JWT_REFRESH_SECRET }); } catch { return { ok: true }; }
      if (payload.jti && payload.tid) {
        const tenant = await this.catalog.tenant.findUnique({ where: { id: payload.tid } });
        if (tenant) {
          const db = this.pool.get(tenant.dbName);
          await db.refreshTokenJti.upsert({
            where: { jti: payload.jti },
            update: { reason: 'logout' },
            create: {
              jti: payload.jti,
              userId: payload.sub,
              reason: 'logout',
              expiresAt: new Date((payload.exp || 0) * 1000),
            },
          }).catch(() => {});
        }
      }
    }
    return { ok: true };
  }

  async logoutAll(tid: string, sub: string) {
    const tenant = await this.catalog.tenant.findUnique({ where: { id: tid } });
    if (!tenant) return { ok: true };
    const db = this.pool.get(tenant.dbName);
    await db.user.update({ where: { id: sub }, data: { tokenVersion: { increment: 1 } } }).catch(() => {});
    return { ok: true };
  }

  private async seedDefaults(db: any) {
    const cats = [
      { name: 'Laptop', customFields: [{ name: 'RAM_GB', type: 'number' }, { name: 'OS', type: 'text' }] },
      { name: 'Monitor', customFields: [{ name: 'Size_inches', type: 'number' }, { name: 'Resolution', type: 'text' }] },
      { name: 'Phone', customFields: [{ name: 'IMEI', type: 'text' }] },
      { name: 'Peripheral', customFields: [] },
      { name: 'Furniture', customFields: [] },
    ];
    for (const c of cats) await db.category.create({ data: c });

    const SYSTEM_STATUSES = ['IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'RETIRED', 'LOST'] as const;
    const SYSTEM_COLOR: Record<string, string> = {
      IN_STOCK: 'green', ASSIGNED: 'blue', IN_REPAIR: 'amber', RETIRED: 'gray', LOST: 'red',
    };
    for (let i = 0; i < SYSTEM_STATUSES.length; i++) {
      const s = SYSTEM_STATUSES[i];
      const label = s.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      await db.assetStatusDef.create({
        data: { key: s, label, color: SYSTEM_COLOR[s], mapsTo: s, isSystem: true, order: i },
      }).catch(() => {});
    }
  }

  private issueTokens(tid: string, slug: string, db: string, sub: string, role: string, email: string, tv: number = 0) {
    const access = this.jwt.sign(
      { sub, tid, slug, db, role, email, tv },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: Number(process.env.JWT_ACCESS_TTL || 900) },
    );
    const jti = crypto.randomUUID();
    const refresh = this.jwt.sign(
      { sub, tid, jti, tv },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: Number(process.env.JWT_REFRESH_TTL || 2592000) },
    );
    return { accessToken: access, refreshToken: refresh, tenant: { id: tid, slug }, user: { id: sub, email, role } };
  }
}
