import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { authenticator } from 'otplib';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import { MailerService } from '../events/events.module';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthService } from './platform-auth.service';
import { encryptSecret, decryptSecretStrict } from '../common/crypto';
import { generateNumericOtp, hashCode, verifyCode } from '../common/mfa/otp.util';
import { generateBackupCodes } from '../common/mfa/backup-codes.util';
import { mfaSetupComplete, maskEmail, sameRegistrableDomain } from './platform-mfa.util';
import { clearMfaUserData } from './platform-mfa-clear';

const OTP_TTL_MS = 5 * 60_000;
const PENDING_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_CODE_ATTEMPTS = 5;
const BACKUP_CODE_COUNT = 10;
const TOTP_ISSUER = 'AssetMon (Platform)';

type PlatformUserRow = {
  id: string;
  email: string;
  role: string;
  tokenVersion: number;
  firstName: string;
  lastName: string;
  passwordChangedAt: Date | null;
  totpSecret: string | null;
  totpEnabled: boolean;
  primaryEmailVerifiedAt: Date | null;
  recoveryEmail: string | null;
  recoveryEmailVerifiedAt: Date | null;
  backupCodesGeneratedAt: Date | null;
  mfaEnrolledAt: Date | null;
};

/**
 * Super-admin / operator MFA ENROLMENT (the setup wizard backend). Drives the
 * one-time walk from password-only to fully 3FA-enrolled, writing each verified
 * factor to PlatformUser as it completes (steps are independently committed and
 * resumable). The actual multi-step LOGIN chain is built in a later phase; this
 * service is reached only via the short-lived mfa_setup ticket.
 *
 * Email OTPs are minted with the shared kernel (6-digit, HMAC+pepper at rest)
 * and held in a PlatformMfaPending row; the OTP body is emailed but never stored
 * or logged. In non-production a `devCode` is returned so the flow can be tested
 * without a real mailbox; this is gated strictly on NODE_ENV.
 */
@Injectable()
export class PlatformMfaService {
  private readonly log = new Logger(PlatformMfaService.name);

  constructor(
    private readonly catalog: CatalogPrismaService,
    private readonly mailer: MailerService,
    private readonly audit: PlatformAuditService,
    private readonly auth: PlatformAuthService,
  ) {}

  private isDev(): boolean {
    return (process.env.NODE_ENV || 'development') !== 'production';
  }

  // ── Wizard state ─────────────────────────────────────────────────────────
  getState(user: PlatformUserRow) {
    return {
      primaryEmail: { email: maskEmail(user.email), verified: !!user.primaryEmailVerifiedAt },
      totp: { enabled: !!user.totpEnabled },
      recoveryEmail: {
        set: !!user.recoveryEmail,
        verified: !!user.recoveryEmailVerifiedAt,
        email: user.recoveryEmail ? maskEmail(user.recoveryEmail) : null,
      },
      backupCodes: { generated: !!user.backupCodesGeneratedAt },
      complete: mfaSetupComplete(user),
    };
  }

  // ── Email OTP (shared by primary + recovery) ─────────────────────────────
  private async issueEmailOtp(user: PlatformUserRow, target: string, purpose: string) {
    const active = await this.catalog.platformMfaPending.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (active?.emailLastSentAt) {
      const elapsed = Date.now() - active.emailLastSentAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const resendIn = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        throw new HttpException({ code: 'EMAIL_RATELIMIT', resendIn }, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    // Keep a single active pending row per user during setup.
    await this.catalog.platformMfaPending.deleteMany({ where: { userId: user.id, consumedAt: null } });

    const code = generateNumericOtp(6);
    await this.catalog.platformMfaPending.create({
      data: {
        userId: user.id,
        nonce: crypto.randomUUID(),
        stage: 'EMAIL',
        tvSnapshot: user.tokenVersion,
        pwdAtSnapshot: user.passwordChangedAt ?? null,
        emailOtpHash: hashCode(code),
        emailTarget: target,
        emailExpiresAt: new Date(Date.now() + OTP_TTL_MS),
        emailLastSentAt: new Date(),
        emailSendCount: 1,
        emailCodeAttempts: 0,
        expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      },
    });

    const subject = 'Your AssetMon verification code';
    const body = `Your AssetMon verification code is ${code}\n\nIt expires in 5 minutes. If you did not request this, ignore this email.`;
    const res = await this.mailer.send(target, subject, body);
    await this.catalog.platformOperatorEmailLog
      .create({
        data: {
          userId: user.id,
          toEmail: target,
          purpose,
          subject,
          sent: res.ok,
          error: res.ok ? null : (res as any).error || 'send failed',
        },
      })
      .catch(() => {});

    return { resendIn: 60, maskedEmail: maskEmail(target), ...(this.isDev() ? { devCode: code } : {}) };
  }

  /** Validate a presented OTP against the active pending row; returns the target it was sent to. */
  private async consumeEmailOtp(user: PlatformUserRow, code: string): Promise<string> {
    const row = await this.catalog.platformMfaPending.findFirst({
      where: { userId: user.id, consumedAt: null, stage: 'EMAIL' },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || !row.emailOtpHash || !row.emailExpiresAt || row.emailExpiresAt < new Date()) {
      throw new BadRequestException({ code: 'CODE_EXPIRED', message: 'Code expired — request a new one.' });
    }
    if ((row.emailCodeAttempts ?? 0) >= MAX_CODE_ATTEMPTS) {
      await this.catalog.platformMfaPending.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      throw new BadRequestException({ code: 'CODE_BURNED', message: 'Too many attempts — request a new code.' });
    }
    if (!verifyCode(code, row.emailOtpHash)) {
      const attempts = (row.emailCodeAttempts ?? 0) + 1;
      await this.catalog.platformMfaPending.update({
        where: { id: row.id },
        data: { emailCodeAttempts: attempts, consumedAt: attempts >= MAX_CODE_ATTEMPTS ? new Date() : null },
      });
      throw new BadRequestException({ code: 'INVALID_CODE', attemptsRemaining: Math.max(0, MAX_CODE_ATTEMPTS - attempts) });
    }
    await this.catalog.platformMfaPending.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    return row.emailTarget!;
  }

  // ── Step: primary email ──────────────────────────────────────────────────
  async sendPrimaryEmail(user: PlatformUserRow) {
    return this.issueEmailOtp(user, user.email, 'SETUP_PRIMARY');
  }

  async verifyPrimaryEmail(user: PlatformUserRow, code: string, req?: any) {
    const target = await this.consumeEmailOtp(user, code);
    if (target.toLowerCase() !== user.email.toLowerCase()) {
      throw new BadRequestException('Verification target mismatch — restart this step.');
    }
    await this.catalog.platformUser.update({ where: { id: user.id }, data: { primaryEmailVerifiedAt: new Date() } });
    await this.audit.record({ id: user.id, email: user.email }, 'platform.mfa.primary_email_verified', { type: 'platformUser', id: user.id }, {}, req);
    return { ok: true };
  }

  // ── Step: TOTP ───────────────────────────────────────────────────────────
  async startTotp(user: PlatformUserRow) {
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, TOTP_ISSUER, secret);
    // Persist the pending secret AES-encrypted with totpEnabled=false so it is
    // not yet an active factor (mfaSetupComplete requires totpEnabled).
    await this.catalog.platformUser.update({
      where: { id: user.id },
      data: { totpSecret: encryptSecret(secret), totpEnabled: false },
    });
    return { secret, otpauth };
  }

  async verifyTotp(user: PlatformUserRow, token: string, req?: any) {
    const fresh = await this.catalog.platformUser.findUnique({ where: { id: user.id } });
    if (!fresh?.totpSecret) throw new BadRequestException('Start authenticator setup first.');
    let secret: string;
    try {
      secret = decryptSecretStrict(fresh.totpSecret);
    } catch {
      throw new BadRequestException('Authenticator setup is corrupted — start it again.');
    }
    if (!authenticator.check(token, secret)) throw new UnauthorizedException({ code: 'INVALID_CODE', message: 'Invalid authenticator code.' });
    const step = BigInt(Math.floor(Date.now() / 1000 / 30));
    await this.catalog.platformUser.update({ where: { id: user.id }, data: { totpEnabled: true, lastTotpStep: step } });
    await this.audit.record({ id: user.id, email: user.email }, 'platform.mfa.totp_enrolled', { type: 'platformUser', id: user.id }, {}, req);
    return { ok: true };
  }

  // ── Step: recovery email ─────────────────────────────────────────────────
  async sendRecoveryEmail(user: PlatformUserRow, email: string, acknowledgeRisk: boolean, req?: any) {
    const recovery = (email || '').toLowerCase().trim();
    if (!/.+@.+\..+/.test(recovery)) throw new BadRequestException('Enter a valid recovery email address.');
    if (recovery === user.email.toLowerCase()) throw new BadRequestException('Recovery email must be different from your primary email.');

    if (sameRegistrableDomain(recovery, user.email)) {
      if (!acknowledgeRisk) {
        return {
          needsAck: true,
          warning: 'same_domain',
          message: 'Your recovery email is on the same domain as your primary email. A different provider is strongly recommended. Re-submit with acknowledgeRisk to proceed anyway.',
        };
      }
      await this.audit.record({ id: user.id, email: user.email }, 'platform.mfa.recovery_samedomain_override', { type: 'platformUser', id: user.id }, { recovery }, req);
    }
    return this.issueEmailOtp(user, recovery, 'SETUP_RECOVERY');
  }

  async verifyRecoveryEmail(user: PlatformUserRow, code: string, req?: any) {
    const target = await this.consumeEmailOtp(user, code);
    if (target.toLowerCase() === user.email.toLowerCase()) {
      throw new BadRequestException('Verification target mismatch — restart this step.');
    }
    await this.catalog.platformUser.update({
      where: { id: user.id },
      data: { recoveryEmail: target, recoveryEmailVerifiedAt: new Date() },
    });
    await this.audit.record({ id: user.id, email: user.email }, 'platform.mfa.recovery_email_verified', { type: 'platformUser', id: user.id }, {}, req);
    return { ok: true };
  }

  // ── Step: backup codes ───────────────────────────────────────────────────
  async generateBackupCodes(user: PlatformUserRow, req?: any) {
    const codes = generateBackupCodes(BACKUP_CODE_COUNT);
    await this.catalog.$transaction(async (tx) => {
      await tx.platformBackupCode.deleteMany({ where: { userId: user.id } });
      await tx.platformBackupCode.createMany({
        data: codes.map((c) => ({ userId: user.id, codeHash: c.hash, pepperVersion: c.pepperVersion })),
      });
      await tx.platformUser.update({ where: { id: user.id }, data: { backupCodesGeneratedAt: new Date() } });
    });
    await this.audit.record({ id: user.id, email: user.email }, 'platform.mfa.backup_codes_generated', { type: 'platformUser', id: user.id }, { count: codes.length }, req);
    // Shown to the user exactly once.
    return { codes: codes.map((c) => c.plain) };
  }

  // ── Finalize ─────────────────────────────────────────────────────────────
  async complete(user: PlatformUserRow, req?: any) {
    const fresh = await this.catalog.platformUser.findUnique({ where: { id: user.id } });
    if (!fresh) throw new NotFoundException();
    const ready =
      fresh.primaryEmailVerifiedAt &&
      fresh.totpEnabled &&
      fresh.totpSecret &&
      fresh.recoveryEmail &&
      fresh.recoveryEmailVerifiedAt &&
      fresh.backupCodesGeneratedAt;
    if (!ready) throw new BadRequestException({ code: 'SETUP_INCOMPLETE', message: 'Finish every setup step before completing.' });

    // The ONLY place mfaEnrolledAt is set; the tokenVersion bump invalidates the
    // setup ticket and any pre-enrolment sessions. Atomic gate flip.
    const updated = await this.catalog.platformUser.update({
      where: { id: user.id },
      // Clear any lockout here too: login no longer resets it on a correct
      // password alone (it clears only on a successful full login / complete).
      data: { mfaEnrolledAt: new Date(), tokenVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null },
    });
    await this.catalog.platformMfaPending.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await this.audit.record({ id: user.id, email: user.email }, 'platform.mfa.enrolled', { type: 'platformUser', id: user.id }, {}, req);

    return this.auth.issueTokensForUser(updated);
  }

  /**
   * Shared MFA reset (used by the peer-reset path). Nulls every MFA column,
   * deletes backup codes + pending chains, bumps tokenVersion (kills sessions),
   * and asserts the gate column ends NULL so no path can leave a half-cleared,
   * still-usable MFA state (R8/B8). Uses the same clearMfaUserData() column set
   * as the CLI break-glass so the two never drift.
   */
  async clearMfa(userId: string): Promise<void> {
    await this.catalog.$transaction(async (tx) => {
      await tx.platformBackupCode.deleteMany({ where: { userId } });
      await tx.platformMfaPending.deleteMany({ where: { userId } });
      const updated = await tx.platformUser.update({ where: { id: userId }, data: clearMfaUserData() });
      if (updated.mfaEnrolledAt !== null) throw new Error('clearMfa post-condition failed: mfaEnrolledAt is not null');
    });
  }
}
