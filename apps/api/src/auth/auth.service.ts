import { BadRequestException, HttpException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { authenticator } from 'otplib';
import { GlobalPrismaService } from '../tenancy/global-prisma.service';
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
    private readonly globalPrisma: GlobalPrismaService,
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
    const tenantDb = this.globalPrisma;

    const planKey: PlanKey = (PLANS[tenant.plan as PlanKey] ? tenant.plan : 'business') as PlanKey;
    const plan = PLANS[planKey];
    if (plan.limits.users != null) {
      const userCount = await tenantDb.user.count({ where: { tenantId: tenant.id } });
      if (userCount >= plan.limits.users) {
        throw new BadRequestException(`This workspace has reached its plan limit (${plan.limits.users} users).`);
      }
    }

    const existing = await tenantDb.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } } });
    if (existing) {
      throw new BadRequestException('A user with this email already exists in this workspace');
    }

    // Compensating-write order: catalog mapping FIRST so a failure leaves no orphan
    // tenant-DB user; then the tenant-DB user, rolling the catalog row back if that fails.
    await this.globalPrisma.tenantUser.upsert({
      where: { email_tenantId: { email, tenantId: tenant.id } },
      update: {},
      create: { email, tenantId: tenant.id },
    });
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    let user: any;
    try {
      user = await tenantDb.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: 'EMPLOYEE',
          passwordChangedAt: new Date(),
        },
      });
    } catch (e) {
      await this.globalPrisma.tenantUser.delete({ where: { email_tenantId: { email, tenantId: tenant.id } } }).catch(() => {});
      throw e;
    }
    return this.issueTokens(tenant.id, tenant.slug, user.id, user.role, user.email, user.tokenVersion);
  }

  /**
   * Provision a workspace. Everything that defines an existing workspace — the
   * Tenant row, its admin, the catalog mapping and the seed rows — is written in ONE
   * transaction, so a failure leaves no trace.
   *
   * This used to be a sequence of independent writes with a `catalog.tenant.delete()`
   * in the catch as compensation. That worked under database-per-tenant, where the
   * tenant's rows lived in a database we dropped separately. Under shared tables the
   * seeded User/Category/AssetStatusDef/AuditCounter rows reference their tenant by a
   * plain `tenantId` column with no foreign key, so deleting the Tenant row orphaned
   * them permanently — invisible rows, billable against nothing, impossible to reach.
   */
  async signup(dto: SignupDto) {
    const email = dto.email.toLowerCase();
    const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Hashing is deliberately done before opening the transaction — at cost 12 it
    // takes long enough that holding a transaction across it would be wasteful.
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);

    let tenant: any, user: any;
    try {
      ({ tenant, user } = await this.globalPrisma.$transaction(async (tx) => {
        const t = await tx.tenant.create({
          data: {
            slug: dto.slug, name: dto.workspaceName, status: 'ACTIVE',
            plan: 'business', subscriptionStatus: 'trialing', trialEndsAt: trialEnd,
          },
        });
        await this.seedDefaults(tx, t.id);
        const u = await tx.user.create({
          data: {
            tenantId: t.id,
            email,
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: 'ADMIN',
            passwordChangedAt: new Date(),
          },
        });
        await tx.tenantUser.create({ data: { email, tenantId: t.id } });
        return { tenant: t, user: u };
      }));
    } catch (err: any) {
      // The slug is unique, so a racing signup surfaces here rather than through the
      // old check-then-create, which could interleave between the two statements.
      if (err?.code === 'P2002') throw new BadRequestException('Workspace slug is already taken');
      this.log.error(`Provisioning failed: ${err.message}`);
      throw new BadRequestException(`Failed to provision workspace: ${err.message}`);
    }

    // Demo content is a nicety, not part of what makes the workspace valid — it stays
    // outside the transaction so a failure here cannot undo a good signup.
    try {
      await this.seedDemoData(this.globalPrisma, tenant.id, user.id);
    } catch (e: any) {
      this.log.warn(`Demo seed failed: ${e.message}`);
    }

    return this.issueTokens(tenant.id, tenant.slug, user.id, user.role, user.email, user.tokenVersion);
  }

  private async seedDemoData(db: any, tenantId: string, _adminId: string) {
    const eng = await db.department.create({ data: { tenantId, name: 'Engineering', costCenter: 'E-100' } });
    const ops = await db.department.create({ data: { tenantId, name: 'Operations', costCenter: 'O-200' } });
    const hq = await db.location.create({ data: { tenantId, name: 'HQ', type: 'BUILDING' } });
    const floor2 = await db.location.create({ data: { tenantId, name: 'Floor 2', type: 'FLOOR', parentId: hq.id } });
    const apple = await db.vendor.create({ data: { tenantId, name: 'Apple Inc', email: 'sales@apple.com' } });
    const dell = await db.vendor.create({ data: { tenantId, name: 'Dell Technologies', email: 'sales@dell.com' } });
    const cats = await db.category.findMany({ where: { tenantId } });
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
      const tag = `AM-${String((await db.asset.count({ where: { tenantId } })) + 1).padStart(5, '0')}`;
      await db.asset.create({
        data: {
          tenantId,
          assetTag: tag, name: s.name, status: 'AVAILABLE',
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
    const mappings = await this.globalPrisma.tenantUser.findMany({
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

    const tenantDb = this.globalPrisma;
    const user = await tenantDb.user.findUnique({ where: { tenantId_email: { tenantId: chosen.tenant.id, email } } });
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

    let acceptedTotpStep: bigint | null = null;
    if (user.totpEnabled) {
      if (!dto.totp) throw new UnauthorizedException('TOTP_REQUIRED');
      let secret: string;
      try { secret = decryptSecret(user.totpSecret!); }
      catch { throw new UnauthorizedException('2FA misconfigured — contact an admin'); }
      // Single-use guard (same as the modern MFA chain in loginMfaTotp): accept the code
      // only if its time-step is newer than the last one we accepted, so the same code
      // cannot be replayed within its ~60-90s validity window.
      const delta = authenticator.checkDelta(dto.totp, secret);
      if (delta !== null && delta !== undefined) {
        const step = BigInt(Math.floor(Date.now() / 1000 / 30) + delta);
        if (user.lastTotpStep == null || step > user.lastTotpStep) acceptedTotpStep = step;
      }
      if (acceptedTotpStep == null) {
        await this.recordFailedLogin(tenantDb, user);
        throw new UnauthorizedException('Invalid TOTP code');
      }
    }

    // Successful login: reset lockout state and rehash password if cost is below current setting.
    const fresh = await this.maybeRehash(tenantDb, user, dto.password);
    await tenantDb.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, ...(acceptedTotpStep != null ? { lastTotpStep: acceptedTotpStep } : {}) },
    });

    return this.issueTokens(chosen.tenant.id, chosen.tenant.slug, fresh.id, fresh.role, fresh.email, fresh.tokenVersion);
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

    const tenant = await this.globalPrisma.tenant.findUnique({ where: { id: payload.tid } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new UnauthorizedException();
    const db = this.globalPrisma;

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
        tenantId: tenant.id,
        jti: payload.jti,
        userId: payload.sub,
        reason: 'refresh',
        expiresAt: new Date((payload.exp || 0) * 1000),
      },
    }).catch(() => {});

    return this.issueTokens(tenant.id, tenant.slug, user.id, user.role, user.email, user.tokenVersion);
  }

  async logout(refreshToken: string | undefined, _ctx?: { tid?: string; sub?: string }) {
    if (refreshToken) {
      let payload: any;
      try { payload = this.jwt.verify(refreshToken, { secret: process.env.JWT_REFRESH_SECRET }); } catch { return { ok: true }; }
      if (payload.jti && payload.tid) {
        const tenant = await this.globalPrisma.tenant.findUnique({ where: { id: payload.tid } });
        if (tenant) {
          const db = this.globalPrisma;
          await db.refreshTokenJti.upsert({
            where: { jti: payload.jti },
            update: { reason: 'logout' },
            create: {
              tenantId: payload.tid,
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
    const tenant = await this.globalPrisma.tenant.findUnique({ where: { id: tid } });
    if (!tenant) return { ok: true };
    const db = this.globalPrisma;
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
        tenantId: tenant.id,
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
      { scope: 'tenant', sub: user.id, tid: tenant.id, nonce, tv: user.tokenVersion },
      600,
    );
    void this.sendTenantLoginEmail(tenantDb, tenant.id, user.email, code); // fire-and-forget
    const dev = (process.env.NODE_ENV || 'development') !== 'production';
    return { code: 'EMAIL_OTP_REQUIRED', ticket, resendIn: 60, maskedEmail: maskEmail(user.email), ...(dev ? { devCode: code } : {}) };
  }

  private async sendTenantLoginEmail(tenantDb: any, tenantId: string, to: string, code: string) {
    const subject = 'Your AssetMon sign-in code';
    const body = `Your AssetMon sign-in code is ${code}\n\nIt expires in 5 minutes. If this was not you, change your password.`;
    const res = await this.mailer.send(to, subject, body);
    // Reuse the tenant EmailLog, but NEVER store the code in the body.
    await tenantDb.emailLog.create({ data: { tenantId, toEmail: to, subject, body: '[sign-in code omitted]', sent: res.ok, error: res.ok ? null : (res as any).error || 'send failed' } }).catch(() => {});
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

  // `tx` here is the raw global client, not the tenant-scoped one, so every lookup
  // names its tenant explicitly. `nonce` alone stopped being unique when the
  // per-tenant databases were merged — it is now @@unique([tenantId, nonce]).
  private async loadTenantChainTx(tx: any, tenantId: string, nonce: string, expectStage: 'EMAIL' | 'TOTP'): Promise<any> {
    // Take the row lock BEFORE reading. Every caller reads an attempt counter and
    // then writes it back, so without this two concurrent code submissions both read
    // the same `chainAttempts`/`emailCodeAttempts` and both write value+1 — the
    // brute-force ceiling silently doubles. Postgres SERIALIZABLE used to cover this;
    // under MySQL an explicit X lock is the equivalent, and unlike MySQL's
    // SERIALIZABLE it cannot deadlock on an S→X upgrade.
    await tx.$queryRawUnsafe(
      `SELECT "id" FROM "TenantMfaPending" WHERE "tenantId" = $1 AND "nonce" = $2 FOR UPDATE`,
      tenantId, nonce,
    );
    const row = await tx.tenantMfaPending.findUnique({ where: { tenantId_nonce: { tenantId, nonce } } });
    if (!row || row.consumedAt || row.expiresAt < new Date()) return { fail: 'MFA_RESTART' };
    const user = await tx.user.findUnique({ where: { id: row.userId, tenantId } });
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

  private async redeemTenantBackupCode(tx: any, tenantId: string, userId: string, code: string, usedFor: 'EMAIL' | 'TOTP'): Promise<boolean> {
    const candidates = await tx.tenantBackupCode.findMany({ where: { tenantId, userId, usedAt: null, pepperVersion: currentPepperVersion() } });
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
    const tenant = await this.globalPrisma.tenant.findUnique({ where: { id: claims.tid } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new UnauthorizedException({ code: 'MFA_RESTART' });
    const db = this.globalPrisma;
    const outcome = await db.$transaction(async (tx: any) => {
      const v = await this.loadTenantChainTx(tx, tenant.id, claims.nonce!, 'EMAIL');
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
        usedBackup = await this.redeemTenantBackupCode(tx, tenant.id, user.id, code, 'EMAIL');
        if (!usedBackup) {
          await tx.tenantMfaPending.update({ where: { id: row.id }, data: { chainAttempts: (row.chainAttempts ?? 0) + 1 } });
          await this.recordFailedLogin(tx, user);
          return { fail: 'INVALID_CODE' };
        }
      }
      if (user.mfaMethod === 'EMAIL') {
        await tx.tenantMfaPending.update({ where: { id: row.id }, data: { consumedAt: new Date(), backupCodeUsed: row.backupCodeUsed || usedBackup } });
        await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
        await tx.tenantMfaPending.deleteMany({ where: { tenantId: tenant.id, userId: user.id, consumedAt: null } });
        return { tokens: this.issueTokens(tenant.id, tenant.slug, user.id, user.role, user.email, user.tokenVersion) };
      }
      const newNonce = crypto.randomUUID();
      await tx.tenantMfaPending.update({ where: { id: row.id }, data: { stage: 'TOTP', nonce: newNonce, emailOtpHash: null, backupCodeUsed: row.backupCodeUsed || usedBackup } });
      const next = this.mfaTicket.sign(MFA_TICKET_PURPOSE.PENDING, { scope: 'tenant', sub: user.id, tid: tenant.id, nonce: newNonce, tv: user.tokenVersion }, 600);
      return { next };
    }, { isolationLevel: 'ReadCommitted' });
    if (outcome.fail) this.throwChainFailure(outcome);
    if (outcome.tokens) return outcome.tokens;
    return { code: 'TOTP_REQUIRED', ticket: outcome.next };
  }

  /** Step 3 of the tenant login chain (EMAIL_TOTP only): authenticator OR backup code. */
  async loginMfaTotp(ticket: string, code: string) {
    const claims = this.mfaTicket.verify(ticket, MFA_TICKET_PURPOSE.PENDING);
    if (claims.scope !== 'tenant' || !claims.nonce || !claims.tid) throw new UnauthorizedException({ code: 'MFA_RESTART' });
    const tenant = await this.globalPrisma.tenant.findUnique({ where: { id: claims.tid } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new UnauthorizedException({ code: 'MFA_RESTART' });
    const db = this.globalPrisma;
    const outcome = await db.$transaction(async (tx: any) => {
      const v = await this.loadTenantChainTx(tx, tenant.id, claims.nonce!, 'TOTP');
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
        usedBackup = await this.redeemTenantBackupCode(tx, tenant.id, user.id, code, 'TOTP');
        if (!usedBackup) {
          await tx.tenantMfaPending.update({ where: { id: row.id }, data: { chainAttempts: (row.chainAttempts ?? 0) + 1 } });
          await this.recordFailedLogin(tx, user);
          return { fail: 'INVALID_CODE' };
        }
      }
      await tx.tenantMfaPending.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, ...(acceptedStep != null ? { lastTotpStep: acceptedStep } : {}) } });
      await tx.tenantMfaPending.deleteMany({ where: { tenantId: tenant.id, userId: user.id, consumedAt: null } });
      return { tokens: this.issueTokens(tenant.id, tenant.slug, user.id, user.role, user.email, user.tokenVersion) };
    }, { isolationLevel: 'ReadCommitted' });
    if (outcome.fail) this.throwChainFailure(outcome);
    return outcome.tokens;
  }

  private async seedDefaults(db: any, tenantId: string) {
    const cats = [
      { name: 'Laptop', customFields: [{ name: 'RAM_GB', type: 'number' }, { name: 'OS', type: 'text' }] },
      { name: 'Monitor', customFields: [{ name: 'Size_inches', type: 'number' }, { name: 'Resolution', type: 'text' }] },
      { name: 'Phone', customFields: [{ name: 'IMEI', type: 'text' }] },
      { name: 'Peripheral', customFields: [] },
      { name: 'Furniture', customFields: [] },
    ];
    for (const c of cats) await db.category.create({ data: { ...c, tenantId } });

    const SYSTEM_STATUSES = ['PENDING', 'AVAILABLE', 'ASSIGNED', 'OUT_OF_SERVICE', 'OUT_FOR_REPAIR', 'LOST_STOLEN', 'ARCHIVED'] as const;
    const COLOR: Record<string, string> = {
      PENDING: 'amber', AVAILABLE: 'green', ASSIGNED: 'blue', OUT_OF_SERVICE: 'red', OUT_FOR_REPAIR: 'amber', LOST_STOLEN: 'red', ARCHIVED: 'gray',
    };
    const LABEL_OVERRIDE: Record<string, string> = { LOST_STOLEN: 'Lost/Stolen' };
    for (let i = 0; i < SYSTEM_STATUSES.length; i++) {
      const s = SYSTEM_STATUSES[i];
      const label = LABEL_OVERRIDE[s] || s.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      await db.assetStatusDef.create({
        data: { key: s, label, color: COLOR[s], mapsTo: s, isSystem: true, order: i, tenantId },
      }).catch(() => {});
    }

    // Genesis row for the tenant's audit chain. Deliberately NOT best-effort: every
    // audited action takes a FOR UPDATE on this row, so a workspace provisioned
    // without one cannot write audit entries at all. Failing here aborts signup and
    // triggers the caller's rollback, which is far better than a live workspace that
    // throws on its first audited write.
    await db.auditCounter.create({
      data: { tenantId, lastSeq: 0, lastHash: null },
    });
  }

  // Public so settings flows that bump tokenVersion (e.g. tenant MFA enable/
  // disable) can re-issue the CURRENT session — keeping the acting device signed
  // in while other sessions are invalidated by the version bump.
  issueTokens(tid: string, slug: string, sub: string, role: string, email: string, tv: number = 0) {
    const access = this.jwt.sign(
      { sub, tid, slug, role, email, tv },
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
