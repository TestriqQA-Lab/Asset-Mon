import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { MailerService } from '../events/events.module';
import { generateNumericOtp, hashCode, verifyCode } from '../common/mfa/otp.util';
import { generateBackupCodes } from '../common/mfa/backup-codes.util';
import { maskEmail, sameRegistrableDomain } from '../platform/platform-mfa.util';

const OTP_TTL_MS = 5 * 60_000;
const PENDING_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_CODE_ATTEMPTS = 5;
const BACKUP_CODE_COUNT = 10;

/**
 * Tenant-user MFA enable/disable (the dashboard "security settings" backend).
 * OPTIONAL + disable-able (unlike the mandatory platform side). Reuses the shared
 * MFA kernel (otp.util / backup-codes.util) but stores state in the per-tenant
 * DB (TenantMfaPending / TenantBackupCode / User MFA columns).
 *
 * Methods take the tenant Prisma client explicitly (the controller resolves it
 * from the request's tenant context) so this stays a plain singleton.
 *
 * 7b covers the EMAIL method (2FA = password + email code). The EMAIL_TOTP (3FA)
 * level and the actual login enforcement land in later sub-phases.
 */
@Injectable()
export class TenantMfaService {
  constructor(private readonly mailer: MailerService) {}

  private isDev(): boolean {
    return (process.env.NODE_ENV || 'development') !== 'production';
  }

  async status(db: any, userId: string) {
    const u = await db.user.findUnique({
      where: { id: userId },
      select: { mfaMethod: true, mfaEnabledAt: true, recoveryEmail: true, recoveryEmailVerifiedAt: true, totpEnabled: true },
    });
    if (!u) throw new NotFoundException();
    const backupCodesRemaining = await db.tenantBackupCode.count({ where: { userId, usedAt: null } });
    return {
      mfaMethod: u.mfaMethod,
      enabled: u.mfaMethod !== 'NONE',
      recoveryEmail: u.recoveryEmail ? maskEmail(u.recoveryEmail) : null,
      recoveryVerified: !!u.recoveryEmailVerifiedAt,
      totpEnabled: !!u.totpEnabled,
      backupCodesRemaining,
    };
  }

  // ── recovery-email OTP (required before enabling) ─────────────────────────
  async sendRecovery(db: any, userId: string, email: string, acknowledgeRisk: boolean) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    const recovery = (email || '').toLowerCase().trim();
    if (!/.+@.+\..+/.test(recovery)) throw new BadRequestException('Enter a valid recovery email address.');
    if (recovery === user.email.toLowerCase()) throw new BadRequestException('Recovery email must differ from your account email.');
    if (sameRegistrableDomain(recovery, user.email) && !acknowledgeRisk) {
      return { needsAck: true, warning: 'same_domain', message: 'A different email provider is recommended for recovery. Re-submit with acknowledgeRisk to proceed.' };
    }
    return this.issueOtp(db, user, recovery);
  }

  async verifyRecovery(db: any, userId: string, code: string) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    const target = await this.consumeOtp(db, userId, code);
    if (target.toLowerCase() === user.email.toLowerCase()) throw new BadRequestException('Verification target mismatch — restart.');
    await db.user.update({ where: { id: userId }, data: { recoveryEmail: target, recoveryEmailVerifiedAt: new Date() } });
    return { ok: true };
  }

  // ── enable / disable ──────────────────────────────────────────────────────
  async enable(db: any, userId: string, method: 'EMAIL' | 'EMAIL_TOTP') {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    if (!user.recoveryEmailVerifiedAt) throw new BadRequestException('Verify a recovery email first.');
    if (method === 'EMAIL_TOTP' && !user.totpEnabled) throw new BadRequestException('Enroll an authenticator app first.');

    const codes = generateBackupCodes(BACKUP_CODE_COUNT);
    await db.$transaction(async (tx: any) => {
      await tx.tenantBackupCode.deleteMany({ where: { userId } });
      await tx.tenantBackupCode.createMany({ data: codes.map((c) => ({ userId, codeHash: c.hash, pepperVersion: c.pepperVersion })) });
      await tx.tenantMfaPending.deleteMany({ where: { userId } });
      await tx.user.update({ where: { id: userId }, data: { mfaMethod: method, mfaEnabledAt: new Date(), tokenVersion: { increment: 1 } } });
    });
    return { ok: true, method, codes: codes.map((c) => c.plain) };
  }

  async disable(db: any, userId: string, password: string) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    if (user.mfaMethod === 'NONE') return { ok: true };
    // Step-up: re-assert a current factor (the password) before turning MFA off.
    const ok = await bcrypt.compare(password || '', user.passwordHash);
    if (!ok) throw new UnauthorizedException('Incorrect password.');
    await db.$transaction(async (tx: any) => {
      await tx.tenantBackupCode.deleteMany({ where: { userId } });
      await tx.tenantMfaPending.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: { mfaMethod: 'NONE', mfaEnabledAt: null, recoveryEmail: null, recoveryEmailVerifiedAt: null, tokenVersion: { increment: 1 } },
      });
    });
    return { ok: true };
  }

  // ── shared OTP helpers (TenantMfaPending) ─────────────────────────────────
  private async issueOtp(db: any, user: any, target: string) {
    const active = await db.tenantMfaPending.findFirst({ where: { userId: user.id, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (active?.emailLastSentAt) {
      const elapsed = Date.now() - active.emailLastSentAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        throw new HttpException({ code: 'EMAIL_RATELIMIT', resendIn: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000) }, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    await db.tenantMfaPending.deleteMany({ where: { userId: user.id, consumedAt: null } });
    const code = generateNumericOtp(6);
    await db.tenantMfaPending.create({
      data: {
        userId: user.id, nonce: crypto.randomUUID(), stage: 'EMAIL',
        tvSnapshot: user.tokenVersion, pwdAtSnapshot: user.passwordChangedAt ?? null,
        emailOtpHash: hashCode(code), emailTarget: target,
        emailExpiresAt: new Date(Date.now() + OTP_TTL_MS), emailLastSentAt: new Date(),
        emailSendCount: 1, emailCodeAttempts: 0, expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      },
    });
    await this.sendOtpEmail(db, target, code);
    return { resendIn: 60, maskedEmail: maskEmail(target), ...(this.isDev() ? { devCode: code } : {}) };
  }

  private async consumeOtp(db: any, userId: string, code: string): Promise<string> {
    const row = await db.tenantMfaPending.findFirst({ where: { userId, consumedAt: null, stage: 'EMAIL' }, orderBy: { createdAt: 'desc' } });
    if (!row || !row.emailOtpHash || !row.emailExpiresAt || row.emailExpiresAt < new Date()) {
      throw new BadRequestException({ code: 'CODE_EXPIRED', message: 'Code expired — request a new one.' });
    }
    if ((row.emailCodeAttempts ?? 0) >= MAX_CODE_ATTEMPTS) {
      await db.tenantMfaPending.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      throw new BadRequestException({ code: 'CODE_BURNED', message: 'Too many attempts — request a new code.' });
    }
    if (!verifyCode(code, row.emailOtpHash)) {
      const attempts = (row.emailCodeAttempts ?? 0) + 1;
      await db.tenantMfaPending.update({ where: { id: row.id }, data: { emailCodeAttempts: attempts, consumedAt: attempts >= MAX_CODE_ATTEMPTS ? new Date() : null } });
      throw new BadRequestException({ code: 'INVALID_CODE', attemptsRemaining: Math.max(0, MAX_CODE_ATTEMPTS - attempts) });
    }
    await db.tenantMfaPending.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    return row.emailTarget;
  }

  private async sendOtpEmail(db: any, to: string, code: string) {
    const subject = 'Your AssetMon verification code';
    const body = `Your AssetMon verification code is ${code}\n\nIt expires in 5 minutes. If you did not request this, ignore this email.`;
    const res = await this.mailer.send(to, subject, body);
    // Reuse the tenant EmailLog, but NEVER store the code in the body.
    await db.emailLog.create({
      data: { toEmail: to, subject, body: '[verification code omitted]', sent: res.ok, error: res.ok ? null : (res as any).error || 'send failed' },
    }).catch(() => {});
  }
}
