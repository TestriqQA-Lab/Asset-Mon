import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { authenticator } from 'otplib';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import { MailerService } from '../events/events.module';
import { PlatformAuditService } from './platform-audit.service';
import { MfaTicketService, MFA_TICKET_PURPOSE } from '../common/mfa/mfa-ticket.service';
import { mfaSetupComplete, maskEmail } from './platform-mfa.util';
import { generateNumericOtp, hashCode, verifyCode, normalizeCode } from '../common/mfa/otp.util';
import { currentPepperVersion } from '../common/mfa/backup-codes.util';
import { decryptSecretStrict } from '../common/crypto';

// Allow a TOTP at most ±1 time-step off the server clock; the lastTotpStep
// replay guard still prevents reusing an already-accepted code.
authenticator.options = { window: 1 };

const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuuC1jXrwzgQp1/Eu0XPLDC9D7K0qJ7lI2';
const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);
const LOCK_THRESHOLD = Number(process.env.LOGIN_LOCK_THRESHOLD || 5);
const LOCK_DURATION_MS = Number(process.env.LOGIN_LOCK_DURATION_MS || 15 * 60_000);
const OPERATOR_REFRESH_TTL = Number(process.env.PLATFORM_REFRESH_TTL || 8 * 3600); // 8h
const MFA_AT_MAX_AGE_S = Number(process.env.PLATFORM_MFA_MAX_AGE || 24 * 3600); // 24h re-MFA ceiling
const OTP_TTL_MS = 5 * 60_000;
const CHAIN_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5; // per emailed code, then it is burned
const MAX_CHAIN_ATTEMPTS = 5; // per login chain, then it restarts

// Public-facing password policy: ≥10 chars, contains a letter and a digit.
// Returns null on pass, an end-user-safe error string on fail.
function validatePasswordPolicy(pw: string): string | null {
  if (!pw || pw.length < 10) return 'New password must be at least 10 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'New password must contain at least one letter and one digit.';
  return null;
}

// Operator-driven password setters (createAdmin / resetAdminPassword) MUST follow the
// same policy as the self-service change-password flow. Without this, a super-admin
// could provision an account with `12345678` and the new user could re-use it
// indefinitely. We throw with a BadRequest so callers see a 400.
function assertOperatorPasswordPolicy(pw: string) {
  const err = validatePasswordPolicy(pw);
  if (err) throw new BadRequestException(err);
}

interface LoginDto {
  email: string;
  password: string;
}
interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}
interface CreateAdminDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: 'SUPER_ADMIN' | 'SUPPORT';
}

@Injectable()
export class PlatformAuthService {
  private readonly log = new Logger(PlatformAuthService.name);

  constructor(
    private readonly catalog: CatalogPrismaService,
    private readonly jwt: JwtService,
    private readonly audit: PlatformAuditService,
    private readonly mfaTicket: MfaTicketService,
    private readonly mailer: MailerService,
  ) {}

  // Provisioning of the very first platform admin (and any later one) is
  // handled exclusively by the `npm run platform:bootstrap-admin` CLI on the
  // API host. There is intentionally no HTTP bootstrap path: that means there
  // is also no public way to discover whether the platform has been
  // initialised — the login form behaves identically before and after.

  async login(dto: LoginDto, _req?: any) {
    // TODO(security): enforce TOTP/2FA for SUPER_ADMIN before go-live.
    const email = dto.email.toLowerCase();
    const user = await this.catalog.platformUser.findUnique({ where: { email } });

    if (!user) {
      // Constant-time wrong-credentials path.
      await bcrypt.compare(dto.password || '', DUMMY_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.active) throw new UnauthorizedException('Account disabled');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.recordFailed(user);
      throw new UnauthorizedException('Invalid credentials');
    }

    // NOTE: failedLoginCount / lockedUntil are cleared only on a SUCCESSFUL FULL
    // login (end of the MFA chain) or setup `complete`, NOT on a correct password
    // alone — otherwise the lockout window would slide open on every
    // correct-password-but-failed-MFA attempt (BF-1).

    // Operators must be fully MFA-enrolled. If not, force the setup wizard by
    // handing back a short-lived setup ticket instead of access tokens.
    if ((user.role === 'SUPER_ADMIN' || user.role === 'SUPPORT') && !mfaSetupComplete(user)) {
      const setupTicket = this.mfaTicket.sign(
        MFA_TICKET_PURPOSE.SETUP,
        { scope: 'platform', sub: user.id, tv: user.tokenVersion },
        600,
      );
      return { code: 'MFA_SETUP_REQUIRED', setupTicket };
    }

    // Enrolled operator → start the multi-step MFA login chain (email then TOTP).
    return this.beginLoginChain(user, _req);
  }

  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwt.verify(refreshToken, { secret: process.env.JWT_REFRESH_SECRET, algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!payload?.platform || !payload?.jti) throw new UnauthorizedException('Invalid refresh token');

    const seen = await this.catalog.platformRefreshTokenJti.findUnique({ where: { jti: payload.jti } }).catch(() => null);
    if (seen) {
      if (seen.reason !== 'logout') {
        // Theft → invalidate every outstanding session for this platform user.
        await this.catalog.platformUser.update({
          where: { id: payload.sub },
          data: { tokenVersion: { increment: 1 } },
        }).catch(() => {});
      }
      throw new UnauthorizedException('Refresh token reused');
    }

    const user = await this.catalog.platformUser.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw new UnauthorizedException();

    // A tokenVersion bump (enrolment complete, password change, logout-all,
    // reuse detection) invalidates outstanding refresh tokens.
    if (typeof payload.tv === 'number' && user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('Session expired');
    }
    // Refresh is NOT a 1FA backdoor: operators must be fully enrolled, and a
    // refresh older than the 24h mfaAt ceiling forces a fresh full MFA login.
    if ((user.role === 'SUPER_ADMIN' || user.role === 'SUPPORT') && !mfaSetupComplete(user)) {
      throw new UnauthorizedException({ code: 'MFA_SETUP_REQUIRED' });
    }
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.mfaAt !== 'number' || now - payload.mfaAt > MFA_AT_MAX_AGE_S) {
      throw new UnauthorizedException({ code: 'MFA_REQUIRED', message: 'Re-authenticate with MFA.' });
    }

    await this.catalog.platformRefreshTokenJti.create({
      data: {
        jti: payload.jti,
        userId: payload.sub,
        reason: 'refresh',
        expiresAt: new Date((payload.exp || 0) * 1000),
      },
    }).catch(() => {});

    return this.issueTokens(user, payload.mfaAt); // carry mfaAt from the real MFA
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return { ok: true };
    let payload: any;
    try { payload = this.jwt.verify(refreshToken, { secret: process.env.JWT_REFRESH_SECRET }); } catch { return { ok: true }; }
    if (!payload?.platform || !payload?.jti) return { ok: true };
    await this.catalog.platformRefreshTokenJti.upsert({
      where: { jti: payload.jti },
      update: { reason: 'logout' },
      create: {
        jti: payload.jti,
        userId: payload.sub,
        reason: 'logout',
        expiresAt: new Date((payload.exp || 0) * 1000),
      },
    }).catch(() => {});
    return { ok: true };
  }

  async logoutAll(userId: string) {
    await this.catalog.platformUser.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    }).catch(() => {});
    return { ok: true };
  }

  // ── MFA login chain (enrolled operators) ─────────────────────────────────
  /**
   * A correct password starts the chain: persist a PlatformMfaPending row (all
   * attempt/send state lives there, not in the ticket), email a 6-digit code
   * (fire-and-forget so SMTP latency is not a password oracle), and return a
   * signed mfa_pending ticket pointing at the row by nonce.
   */
  private async beginLoginChain(user: any, req?: any) {
    const code = generateNumericOtp(6);
    const nonce = crypto.randomUUID();
    await this.catalog.platformMfaPending.create({
      data: {
        userId: user.id,
        nonce,
        stage: 'EMAIL',
        tvSnapshot: user.tokenVersion,
        pwdAtSnapshot: user.passwordChangedAt ?? null,
        emailOtpHash: hashCode(code),
        emailTarget: user.email,
        emailExpiresAt: new Date(Date.now() + OTP_TTL_MS),
        emailLastSentAt: new Date(),
        emailSendCount: 1,
        emailCodeAttempts: 0,
        chainAttempts: 0,
        expiresAt: new Date(Date.now() + CHAIN_TTL_MS),
      },
    });
    const ticket = this.mfaTicket.sign(
      MFA_TICKET_PURPOSE.PENDING,
      { scope: 'platform', sub: user.id, nonce, tv: user.tokenVersion },
      600,
    );
    void this.sendLoginEmail(user, code); // fire-and-forget; respond first
    const dev = (process.env.NODE_ENV || 'development') !== 'production';
    return {
      code: 'EMAIL_OTP_REQUIRED',
      ticket,
      resendIn: 60,
      maskedEmail: maskEmail(user.email),
      ...(dev ? { devCode: code } : {}),
    };
  }

  private async sendLoginEmail(user: any, code: string) {
    const subject = 'Your AssetMon sign-in code';
    const body = `Your AssetMon sign-in code is ${code}\n\nIt expires in 5 minutes. If this was not you, change your password immediately.`;
    const res = await this.mailer.send(user.email, subject, body);
    await this.catalog.platformOperatorEmailLog
      .create({ data: { userId: user.id, toEmail: user.email, purpose: 'LOGIN_OTP', subject, sent: res.ok, error: res.ok ? null : (res as any).error || 'send failed' } })
      .catch(() => {});
  }

  private sameInstant(a: Date | null, b: Date | null): boolean {
    return (a ? a.getTime() : null) === (b ? b.getTime() : null);
  }

  /** Load + re-validate the pending chain row for a ticket nonce (per-step, in tx). */
  private async loadChain(tx: any, nonce: string, expectStage: 'EMAIL' | 'TOTP') {
    const row = await tx.platformMfaPending.findUnique({ where: { nonce } });
    if (!row || row.consumedAt || row.expiresAt < new Date()) throw new UnauthorizedException({ code: 'MFA_RESTART' });
    const user = await tx.platformUser.findUnique({ where: { id: row.userId } });
    if (!user || !user.active) throw new UnauthorizedException({ code: 'MFA_RESTART' });
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException({ code: 'LOCKED', message: 'Account temporarily locked.' }, 423); // 423 Locked
    }
    if (row.tvSnapshot !== user.tokenVersion || !this.sameInstant(row.pwdAtSnapshot, user.passwordChangedAt)) {
      throw new UnauthorizedException({ code: 'MFA_RESTART' });
    }
    if (!mfaSetupComplete(user)) throw new UnauthorizedException({ code: 'MFA_SETUP_REQUIRED' });
    if (row.stage !== expectStage) throw new UnauthorizedException({ code: 'MFA_RESTART' });
    if ((row.chainAttempts ?? 0) >= MAX_CHAIN_ATTEMPTS) {
      await tx.platformMfaPending.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      throw new UnauthorizedException({ code: 'MFA_RESTART' });
    }
    return { row, user };
  }

  /** Step 2: verify the emailed code OR a backup code; advance EMAIL -> TOTP. */
  async loginMfaEmail(ticket: string, code: string, req?: any) {
    const claims = this.mfaTicket.verify(ticket, MFA_TICKET_PURPOSE.PENDING);
    if (claims.scope !== 'platform' || !claims.nonce) throw new UnauthorizedException({ code: 'MFA_RESTART' });
    return this.catalog.$transaction(async (tx) => {
      const { row, user } = await this.loadChain(tx, claims.nonce!, 'EMAIL');
      const isNumeric = /^[0-9]{6}$/.test(normalizeCode(code));
      let advanced = false;
      let usedBackup = false;

      if (isNumeric) {
        if (!row.emailOtpHash || !row.emailExpiresAt || row.emailExpiresAt < new Date() || (row.emailCodeAttempts ?? 0) >= MAX_CODE_ATTEMPTS) {
          await tx.platformMfaPending.update({ where: { id: row.id }, data: { chainAttempts: (row.chainAttempts ?? 0) + 1 } });
          throw new BadRequestException({ code: 'CODE_EXPIRED', message: 'Code expired — restart sign-in.' });
        }
        if (!verifyCode(code, row.emailOtpHash)) {
          const attempts = (row.emailCodeAttempts ?? 0) + 1;
          await tx.platformMfaPending.update({ where: { id: row.id }, data: { emailCodeAttempts: attempts, chainAttempts: (row.chainAttempts ?? 0) + 1 } });
          await this.recordFailedTx(tx, user);
          throw new UnauthorizedException({ code: 'INVALID_CODE', attemptsRemaining: Math.max(0, MAX_CODE_ATTEMPTS - attempts) });
        }
        advanced = true;
      } else {
        if (row.backupCodeUsed) throw new BadRequestException({ code: 'INVALID_CODE', message: 'A backup code cannot replace both steps.' });
        usedBackup = await this.redeemBackupCode(tx, user, code, 'EMAIL');
        if (!usedBackup) {
          await tx.platformMfaPending.update({ where: { id: row.id }, data: { chainAttempts: (row.chainAttempts ?? 0) + 1 } });
          await this.recordFailedTx(tx, user);
          throw new UnauthorizedException({ code: 'INVALID_CODE' });
        }
        advanced = true;
      }

      if (!advanced) throw new UnauthorizedException({ code: 'INVALID_CODE' });
      const newNonce = crypto.randomUUID();
      await tx.platformMfaPending.update({
        where: { id: row.id },
        data: { stage: 'TOTP', nonce: newNonce, emailOtpHash: null, backupCodeUsed: row.backupCodeUsed || usedBackup },
      });
      const next = this.mfaTicket.sign(MFA_TICKET_PURPOSE.PENDING, { scope: 'platform', sub: user.id, nonce: newNonce, tv: user.tokenVersion }, 600);
      return { code: 'TOTP_REQUIRED', ticket: next };
    }, { isolationLevel: 'Serializable' });
  }

  /** Step 3: verify TOTP (with replay guard) OR a backup code; issue tokens. */
  async loginMfaTotp(ticket: string, code: string, req?: any) {
    const claims = this.mfaTicket.verify(ticket, MFA_TICKET_PURPOSE.PENDING);
    if (claims.scope !== 'platform' || !claims.nonce) throw new UnauthorizedException({ code: 'MFA_RESTART' });
    return this.catalog.$transaction(async (tx) => {
      const { row, user } = await this.loadChain(tx, claims.nonce!, 'TOTP');
      const isNumeric = /^[0-9]{6}$/.test(normalizeCode(code));
      let ok = false;
      let usedBackup = false;
      let acceptedStep: bigint | null = null;

      if (isNumeric) {
        if (!user.totpSecret) throw new UnauthorizedException({ code: 'MFA_RESTART' });
        let secret: string;
        try { secret = decryptSecretStrict(user.totpSecret); } catch { throw new UnauthorizedException({ code: 'MFA_RESTART' }); }
        const delta = authenticator.checkDelta(code, secret);
        if (delta !== null && delta !== undefined) {
          const step = BigInt(Math.floor(Date.now() / 1000 / 30) + delta);
          if (user.lastTotpStep == null || step > user.lastTotpStep) {
            ok = true;
            acceptedStep = step;
          }
        }
        if (!ok) {
          await tx.platformMfaPending.update({ where: { id: row.id }, data: { chainAttempts: (row.chainAttempts ?? 0) + 1 } });
          await this.recordFailedTx(tx, user);
          throw new UnauthorizedException({ code: 'INVALID_CODE' });
        }
      } else {
        if (row.backupCodeUsed) throw new BadRequestException({ code: 'INVALID_CODE', message: 'A backup code cannot replace both steps.' });
        usedBackup = await this.redeemBackupCode(tx, user, code, 'TOTP');
        if (!usedBackup) {
          await tx.platformMfaPending.update({ where: { id: row.id }, data: { chainAttempts: (row.chainAttempts ?? 0) + 1 } });
          await this.recordFailedTx(tx, user);
          throw new UnauthorizedException({ code: 'INVALID_CODE' });
        }
      }

      // Success: consume the chain, clear lockout, advance the replay step.
      await tx.platformMfaPending.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      await tx.platformUser.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, ...(acceptedStep != null ? { lastTotpStep: acceptedStep } : {}) },
      });
      await tx.platformMfaPending.deleteMany({ where: { userId: user.id, consumedAt: null } });
      await this.audit.record({ id: user.id, email: user.email }, 'platform.auth.login', { type: 'platformUser', id: user.id }, { backupCodeUsed: row.backupCodeUsed || usedBackup }, req);
      return this.issueTokens(user, Math.floor(Date.now() / 1000));
    }, { isolationLevel: 'Serializable' });
  }

  /** Redeem ONE unused, current-pepper backup code (guarded single-use UPDATE). */
  private async redeemBackupCode(tx: any, user: any, code: string, usedFor: 'EMAIL' | 'TOTP'): Promise<boolean> {
    const candidates = await tx.platformBackupCode.findMany({
      where: { userId: user.id, usedAt: null, pepperVersion: currentPepperVersion() },
    });
    for (const c of candidates) {
      if (verifyCode(code, c.codeHash)) {
        const res = await tx.platformBackupCode.updateMany({ where: { id: c.id, usedAt: null }, data: { usedAt: new Date(), usedFor } });
        if (res.count === 1) return true;
      }
    }
    return false;
  }

  /** recordFailed inside an existing transaction (chain steps). */
  private async recordFailedTx(tx: any, user: any) {
    const newCount = (user.failedLoginCount || 0) + 1;
    const shouldLock = newCount >= LOCK_THRESHOLD;
    await tx.platformUser.update({
      where: { id: user.id },
      data: {
        failedLoginCount: newCount,
        lockedUntil: shouldLock ? new Date(Date.now() + this.escalatingLockMs(newCount)) : user.lockedUntil,
      },
    });
  }

  /** Escalating lockout: 15m, then 1h, then 24h as failures accumulate. */
  private escalatingLockMs(count: number): number {
    if (count >= 3 * LOCK_THRESHOLD) return 24 * 3600_000;
    if (count >= 2 * LOCK_THRESHOLD) return 3600_000;
    return LOCK_DURATION_MS;
  }

  // ── Team management ─────────────────────────────────────────────────────
  // We intentionally hard-cap the team list at 500 rows. The platform team is
  // expected to stay below this for the foreseeable future, and the cap stops
  // a poisoned `?limit=` from being used to slowly dump the whole admin table
  // in a single request.
  async listAdmins(limit?: number) {
    const take = Math.max(1, Math.min(Number.isFinite(limit) ? Number(limit) : 100, 500));
    return this.catalog.platformUser.findMany({
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true,
        active: true, totpEnabled: true, lockedUntil: true, createdAt: true, updatedAt: true,
      },
    });
  }

  async createAdmin(actor: { id: string; email: string }, dto: CreateAdminDto, req?: any) {
    const email = dto.email.toLowerCase();
    assertOperatorPasswordPolicy(dto.password || '');
    if (await this.catalog.platformUser.findUnique({ where: { email } })) {
      throw new ConflictException('A platform user with that email already exists');
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const user = await this.catalog.platformUser.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role || 'SUPPORT',
        passwordChangedAt: new Date(),
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, active: true, createdAt: true },
    });
    await this.audit.record(actor, 'platformUser.create', { type: 'platformUser', id: user.id }, { email }, req);
    return user;
  }

  async updateAdmin(actor: { id: string; email: string }, id: string, patch: Partial<{ firstName: string; lastName: string; role: 'SUPER_ADMIN' | 'SUPPORT'; active: boolean }>, req?: any) {
    const user = await this.catalog.platformUser.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();

    // Prevent leaving the platform with zero active super-admins.
    if (patch.role && patch.role !== 'SUPER_ADMIN' && user.role === 'SUPER_ADMIN') {
      const others = await this.catalog.platformUser.count({ where: { role: 'SUPER_ADMIN', active: true, NOT: { id } } });
      if (others === 0) throw new ConflictException('Cannot demote the only active super-admin');
    }
    if (patch.active === false && user.role === 'SUPER_ADMIN') {
      const others = await this.catalog.platformUser.count({ where: { role: 'SUPER_ADMIN', active: true, NOT: { id } } });
      if (others === 0) throw new ConflictException('Cannot disable the only active super-admin');
    }

    // A role change or deactivation immediately invalidates outstanding tokens.
    const tvBump = (patch.role && patch.role !== user.role) || patch.active === false ? 1 : 0;
    const updated = await this.catalog.platformUser.update({
      where: { id },
      data: {
        firstName: patch.firstName ?? user.firstName,
        lastName: patch.lastName ?? user.lastName,
        role: patch.role ?? user.role,
        active: patch.active ?? user.active,
        tokenVersion: tvBump ? { increment: 1 } : undefined,
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, active: true, updatedAt: true },
    });
    await this.audit.record(actor, 'platformUser.update', { type: 'platformUser', id }, patch, req);
    return updated;
  }

  async resetAdminPassword(actor: { id: string; email: string }, id: string, newPassword: string, req?: any) {
    assertOperatorPasswordPolicy(newPassword || '');
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.catalog.platformUser.update({
      where: { id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        tokenVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.audit.record(actor, 'platformUser.resetPassword', { type: 'platformUser', id }, {}, req);
    return { ok: true };
  }

  async deleteAdmin(actor: { id: string; email: string }, id: string, req?: any) {
    const user = await this.catalog.platformUser.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();
    if (user.id === actor.id) throw new ConflictException('Refusing to delete yourself');
    if (user.role === 'SUPER_ADMIN') {
      const others = await this.catalog.platformUser.count({ where: { role: 'SUPER_ADMIN', active: true, NOT: { id } } });
      if (others === 0) throw new ConflictException('Cannot delete the only active super-admin');
    }
    await this.catalog.platformUser.delete({ where: { id } });
    await this.audit.record(actor, 'platformUser.delete', { type: 'platformUser', id: user.id }, { email: user.email }, req);
    return { ok: true };
  }

  // ── Self-service password change ────────────────────────────────────────
  /**
   * Authenticated platform user changes their own password. Wrong-current-
   * password attempts increment the same lockout counters that login uses, so
   * an attacker who has briefly captured an access token can't brute-force the
   * password. On success we bump tokenVersion; the caller's tab is told to
   * re-login so all other open sessions die immediately.
   */
  async changePassword(actor: { id: string; email: string }, dto: ChangePasswordDto, req?: any) {
    const user = await this.catalog.platformUser.findUnique({ where: { id: actor.id } });
    if (!user || !user.active) throw new UnauthorizedException();
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      // Generic — don't reveal lockout state vs bad password.
      throw new UnauthorizedException();
    }

    const ok = await bcrypt.compare(dto.currentPassword || '', user.passwordHash);
    if (!ok) {
      await this.recordFailed(user);
      throw new UnauthorizedException();
    }

    const policyError = validatePasswordPolicy(dto.newPassword);
    if (policyError) throw new BadRequestException(policyError);

    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException('New password must be different from the current password.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_COST);
    await this.catalog.platformUser.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        tokenVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.audit.record(actor, 'platform.account.password_changed', { type: 'platformUser', id: user.id }, {}, req);
    return { ok: true };
  }

  // ── Internals ───────────────────────────────────────────────────────────
  private async recordFailed(user: any) {
    const newCount = (user.failedLoginCount || 0) + 1;
    const shouldLock = newCount >= LOCK_THRESHOLD;
    await this.catalog.platformUser.update({
      where: { id: user.id },
      data: {
        // BF-1 fix: keep accumulating (do NOT zero on lock); cleared only on a
        // successful full login / setup-complete. Escalating lock duration.
        failedLoginCount: newCount,
        lockedUntil: shouldLock ? new Date(Date.now() + this.escalatingLockMs(newCount)) : user.lockedUntil,
      },
    }).catch(() => {});
  }

  /** Public token issuance for the MFA setup `complete` step (PlatformMfaService). */
  issueTokensForUser(user: { id: string; email: string; role: string; tokenVersion: number; firstName: string; lastName: string }) {
    return this.issueTokens(user);
  }

  private issueTokens(
    user: { id: string; email: string; role: string; tokenVersion: number; firstName: string; lastName: string },
    mfaAt?: number,
  ) {
    // mfaAt = unix seconds of the LAST full MFA. Fresh login/enrolment passes
    // `now`; refresh() carries the prior value so the 24h re-MFA ceiling counts
    // from the real MFA, not from the last token refresh.
    const at = mfaAt ?? Math.floor(Date.now() / 1000);
    const base = { sub: user.id, email: user.email, role: user.role, platform: true, purpose: 'access', tv: user.tokenVersion, mfaAt: at };
    const access = this.jwt.sign(base, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: Number(process.env.JWT_ACCESS_TTL || 900),
      algorithm: 'HS256',
    });
    const jti = crypto.randomUUID();
    const refresh = this.jwt.sign(
      { sub: user.id, jti, platform: true, tv: user.tokenVersion, mfaAt: at },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: OPERATOR_REFRESH_TTL, algorithm: 'HS256' },
    );
    return {
      accessToken: access,
      refreshToken: refresh,
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
    };
  }
}
