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
import { MailerService } from '../events/events.module';
import { MfaTicketService, MFA_TICKET_PURPOSE } from '../common/mfa/mfa-ticket.service';
import { generateNumericOtp, hashCode, verifyCode, normalizeCode } from '../common/mfa/otp.util';
import { currentPepperVersion } from '../common/mfa/backup-codes.util';
import { maskEmail } from '../platform/platform-mfa.util';

// Pre-computed bcrypt hash for a value no real user can have — used as a
// constant-time dummy when the supplied email does not exist in the catalog.
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuuC1jXrwzgQp1/Eu0XPLDC9D7K0qJ7lI2';
const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);

// Account-lockout knobs.
const LOCK_THRESHOLD = Number(process.env.LOGIN_LOCK_THRESHOLD || 5);
const LOCK_WINDOW_MS = Number(process.env.LOGIN_LOCK_WINDOW_MS || 15 * 60_000);
const LOCK_DURATION_MS = Number(process.env.LOGIN_LOCK_DURATION_MS || 15 * 60_000);
const OTP_TTL_MS = 5 * 60_000;
const CHAIN_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5; // per emailed code, then it is burned
const MAX_CHAIN_ATTEMPTS = 5; // per login chain, then it restarts

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly catalog: CatalogPrismaService,
    private readonly provisioning: TenantProvisioningService,
    private readonly pool: TenantPrismaPool,
    private readonly jwt: JwtService,
    private readonly invites: WorkspaceInviteService,
    private readonly mfaTicket: MfaTicketService,
    private readonly mailer: MailerService,
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

    // Opt-in email-based MFA. When the user enabled it, start the multi-step
    // chain (email, then TOTP for EMAIL_TOTP) instead of issuing tokens here.
    // The legacy single-call TOTP path below is preserved for mfaMethod === NONE
    // so existing authenticator-only users are unaffected. Lockout is NOT cleared
    // yet — it clears only on a successful FULL login (end of the chain).
    if (user.mfaMethod === 'EMAIL' || user.mfaMethod === 'EMAIL_TOTP') {
      return this.beginTenantLoginChain(tenantDb, chosen.tenant, user);
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
        // BF-1: keep accumulating (do NOT zero on lock); cleared only on a
        // successful full login.
        failedLoginCount: newCount,
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

  // ── Tenant MFA login chain (opt-in; only when mfaMethod != NONE) ───────────
  // Mirrors the platform chain but in the tenant DB, carrying tenant context in
  // the ticket. IMPORTANT: each step's transaction RETURNS a fail descriptor
  // instead of throwing inside the tx, so the committed attempt-counter
  // increments are not rolled back (burn-at-5 / chain-cap / lockout accumulate);
  // the actual HTTP error is thrown OUTSIDE the tx via throwChainFailure.
  private async beginTenantLoginChain(tenantDb: any, tenant: any, user: any) {
    const code = generateNumericOtp(6);
    const nonce = crypto.randomUUID();
    await tenantDb.tenantMfaPending.create({
      data: {
        userId: user.id, nonce, stage: 'EMAIL',
        tvSnapshot: user.tokenVersion, pwdAtSnapshot: user.passwordChangedAt ?? null,
        emailOtpHash: hashCode(code), emailTarget: user.email,
        emailExpiresAt: new Date(Date.now() + OTP_TTL_MS), emailLastSentAt: new Date(),
        emailSendCount: 1, emailCodeAttempts: 0, chainAttempts: 0,
        expiresAt: new Date(Date.now() + CHAIN_TTL_MS),
      },
    });
    const ticket = this.mfaTicket.sign(
      MFA_TICKET_PURPOSE.PENDING,
      { scope: 'tenant', sub: user.id, tid: tenant.id, db: tenant.dbName, nonce, tv: user.tokenVersion },
      600,
    );
    void this.sendTenantLoginEmail(tenantDb, user.email, code); // fire-and-forget
    const dev = (process.env.NODE_ENV || 'development') !== 'production';
    return { code: 'EMAIL_OTP_REQUIRED', ticket, resendIn: 60, maskedEmail: maskEmail(user.email), ...(dev ? { devCode: code } : {}) };
  }

  private async sendTenantLoginEmail(tenantDb: any, to: string, code: string) {
    const subject = 'Your AssetMon sign-in code';
    const body = `Your AssetMon sign-in code is ${code}\n\nIt expires in 5 minutes. If this was not you, change your password.`;
    const res = await this.mailer.send(to, subject, body);
    // Reuse the tenant EmailLog, but NEVER store the code in the body.
    await tenantDb.emailLog.create({ data: { toEmail: to, subject, body: '[sign-in code omitted]', sent: res.ok, error: res.ok ? null : (res as any).error || 'send failed' } }).catch(() => {});
  }

  private sameInstant(a: Date | null, b: Date | null): boolean {
    return (a ? a.getTime() : null) === (b ? b.getTime() : null);
  }

  private throwChainFailure(o: any): never {
    if (o.fail === 'LOCKED') throw new HttpException({ statusCode: 423, code: 'LOCKED', message: 'Account temporarily locked. Try again later.' }, 423);
    if (o.fail === 'CODE_EXPIRED') throw new BadRequestException({ code: 'CODE_EXPIRED', message: 'Code expired — restart sign-in.' });
    if (o.fail === 'BACKUP_TWICE') throw new BadRequestException({ code: 'INVALID_CODE', message: 'A backup code cannot replace both steps.' });
    if (o.fail === 'INVALID_CODE') throw new UnauthorizedException({ code: 'INVALID_CODE', ...(typeof o.attemptsRemaining === 'number' ? { attemptsRemaining: o.attemptsRemaining } : {}) });
    throw new UnauthorizedException({ code: 'MFA_RESTART' });
  }

  private async loadTenantChainTx(tx: any, nonce: string, expectStage: 'EMAIL' | 'TOTP'): Promise<any> {
    const row = await tx.tenantMfaPending.findUnique({ where: { nonce } });
    if (!row || row.consumedAt || row.expiresAt < new Date()) return { fail: 'MFA_RESTART' };
    const user = await tx.user.findUnique({ where: { id: row.userId } });
    if (!user || !user.active) return { fail: 'MFA_RESTART' };
    if (user.lockedUntil && user.lockedUntil > new Date()) return { fail: 'LOCKED' };
    if (row.tvSnapshot !== user.tokenVersion || !this.sameInstant(row.pwdAtSnapshot, user.passwordChangedAt)) return { fail: 'MFA_RESTART' };
    if (user.mfaMethod === 'NONE') return { fail: 'MFA_RESTART' };
    if (row.stage !== expectStage) return { fail: 'MFA_RESTART' };
    if ((row.chainAttempts ?? 0) >= MAX_CHAIN_ATTEMPTS) {
      await tx.tenantMfaPending.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      return { fail: 'MFA_RESTART' };
    }
    return { row, user };
  }

  private async redeemTenantBackupCode(tx: any, userId: string, code: string, usedFor: 'EMAIL' | 'TOTP'): Promise<boolean> {
    const candidates = await tx.tenantBackupCode.findMany({ where: { userId, usedAt: null, pepperVersion: currentPepperVersion() } });
    for (const c of candidates) {
      if (verifyCode(code, c.codeHash)) {
        const res = await tx.tenantBackupCode.updateMany({ where: { id: c.id, usedAt: null }, data: { usedAt: new Date(), usedFor } });
        if (res.count === 1) return true;
      }
    }
    return false;
  }

  /** Step 2 of the tenant login chain: emailed code OR a backup code. */
  async loginMfaEmail(ticket: string, code: string) {
    const claims = this.mfaTicket.verify(ticket, MFA_TICKET_PURPOSE.PENDING);
    if (claims.scope !== 'tenant' || !claims.nonce || !claims.tid) throw new UnauthorizedException({ code: 'MFA_RESTART' });
    const tenant = await this.catalog.tenant.findUnique({ where: { id: claims.tid } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new UnauthorizedException({ code: 'MFA_RESTART' });
    const db = this.pool.get(tenant.dbName);
    const outcome = await db.$transaction(async (tx: any) => {
      const v = await this.loadTenantChainTx(tx, claims.nonce!, 'EMAIL');
      if (v.fail) return v;
      const { row, user } = v;
      const isNumeric = /^[0-9]{6}$/.test(normalizeCode(code));
      let usedBackup = false;
      if (isNumeric) {
        if (!row.emailOtpHash || !row.emailExpiresAt || row.emailExpiresAt < new Date() || (row.emailCodeAttempts ?? 0) >= MAX_CODE_ATTEMPTS) {
          await tx.tenantMfaPending.update({ where: { id: row.id }, data: { chainAttempts: (row.chainAttempts ?? 0) + 1 } });
          return { fail: 'CODE_EXPIRED' };
        }
        if (!verifyCode(code, row.emailOtpHash)) {
          const attempts = (row.emailCodeAttempts ?? 0) + 1;
          await tx.tenantMfaPending.update({ where: { id: row.id }, data: { emailCodeAttempts: attempts, chainAttempts: (row.chainAttempts ?? 0) + 1 } });
          await this.recordFailedLogin(tx, user);
          return { fail: 'INVALID_CODE', attemptsRemaining: Math.max(0, MAX_CODE_ATTEMPTS - attempts) };
        }
      } else {
        if (row.backupCodeUsed) return { fail: 'BACKUP_TWICE' };
        usedBackup = await this.redeemTenantBackupCode(tx, user.id, code, 'EMAIL');
        if (!usedBackup) {
          await tx.tenantMfaPending.update({ where: { id: row.id }, data: { chainAttempts: (row.chainAttempts ?? 0) + 1 } });
          await this.recordFailedLogin(tx, user);
          return { fail: 'INVALID_CODE' };
        }
      }
      if (user.mfaMethod === 'EMAIL') {
        await tx.tenantMfaPending.update({ where: { id: row.id }, data: { consumedAt: new Date(), backupCodeUsed: row.backupCodeUsed || usedBackup } });
        await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
        await tx.tenantMfaPending.deleteMany({ where: { userId: user.id, consumedAt: null } });
        return { tokens: this.issueTokens(tenant.id, tenant.slug, tenant.dbName, user.id, user.role, user.email, user.tokenVersion) };
      }
      const newNonce = crypto.randomUUID();
      await tx.tenantMfaPending.update({ where: { id: row.id }, data: { stage: 'TOTP', nonce: newNonce, emailOtpHash: null, backupCodeUsed: row.backupCodeUsed || usedBackup } });
      const next = this.mfaTicket.sign(MFA_TICKET_PURPOSE.PENDING, { scope: 'tenant', sub: user.id, tid: tenant.id, db: tenant.dbName, nonce: newNonce, tv: user.tokenVersion }, 600);
      return { next };
    }, { isolationLevel: 'Serializable' });
    if (outcome.fail) this.throwChainFailure(outcome);
    if (outcome.tokens) return outcome.tokens;
    return { code: 'TOTP_REQUIRED', ticket: outcome.next };
  }

  /** Step 3 of the tenant login chain (EMAIL_TOTP only): authenticator OR backup code. */
  async loginMfaTotp(ticket: string, code: string) {
    const claims = this.mfaTicket.verify(ticket, MFA_TICKET_PURPOSE.PENDING);
    if (claims.scope !== 'tenant' || !claims.nonce || !claims.tid) throw new UnauthorizedException({ code: 'MFA_RESTART' });
    const tenant = await this.catalog.tenant.findUnique({ where: { id: claims.tid } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new UnauthorizedException({ code: 'MFA_RESTART' });
    const db = this.pool.get(tenant.dbName);
    const outcome = await db.$transaction(async (tx: any) => {
      const v = await this.loadTenantChainTx(tx, claims.nonce!, 'TOTP');
      if (v.fail) return v;
      const { row, user } = v;
      const isNumeric = /^[0-9]{6}$/.test(normalizeCode(code));
      let usedBackup = false;
      let acceptedStep: bigint | null = null;
      if (isNumeric) {
        if (!user.totpSecret) return { fail: 'MFA_RESTART' };
        let secret: string;
        try { secret = decryptSecret(user.totpSecret); } catch { return { fail: 'MFA_RESTART' }; }
        const delta = authenticator.checkDelta(code, secret);
        if (delta !== null && delta !== undefined) {
          const step = BigInt(Math.floor(Date.now() / 1000 / 30) + delta);
          if (user.lastTotpStep == null || step > user.lastTotpStep) acceptedStep = step;
        }
        if (acceptedStep == null) {
          await tx.tenantMfaPending.update({ where: { id: row.id }, data: { chainAttempts: (row.chainAttempts ?? 0) + 1 } });
          await this.recordFailedLogin(tx, user);
          return { fail: 'INVALID_CODE' };
        }
      } else {
        if (row.backupCodeUsed) return { fail: 'BACKUP_TWICE' };
        usedBackup = await this.redeemTenantBackupCode(tx, user.id, code, 'TOTP');
        if (!usedBackup) {
          await tx.tenantMfaPending.update({ where: { id: row.id }, data: { chainAttempts: (row.chainAttempts ?? 0) + 1 } });
          await this.recordFailedLogin(tx, user);
          return { fail: 'INVALID_CODE' };
        }
      }
      await tx.tenantMfaPending.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, ...(acceptedStep != null ? { lastTotpStep: acceptedStep } : {}) } });
      await tx.tenantMfaPending.deleteMany({ where: { userId: user.id, consumedAt: null } });
      return { tokens: this.issueTokens(tenant.id, tenant.slug, tenant.dbName, user.id, user.role, user.email, user.tokenVersion) };
    }, { isolationLevel: 'Serializable' });
    if (outcome.fail) this.throwChainFailure(outcome);
    return outcome.tokens;
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
