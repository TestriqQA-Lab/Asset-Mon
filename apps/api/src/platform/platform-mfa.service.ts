import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { mfaSetupComplete, maskEmail, sameRegistrableDomain, assertSuperAdmin } from './platform-mfa.util';
import { clearMfaUserData } from './platform-mfa-clear';
import { hashPlatformEntry } from './platform-audit-hash';

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

  // ── Governed 4-eyes peer reset (Phase 6b) ────────────────────────────────
  private async mfaCompleteSuperAdmins() {
    const admins = await this.catalog.platformUser.findMany({ where: { role: 'SUPER_ADMIN', active: true } });
    return admins.filter((a) => mfaSetupComplete(a));
  }

  /** A super-admin requests a peer reset of another operator's MFA. */
  async requestPeerReset(actor: { id: string; email: string; role?: string }, targetId: string, incidentRef: string, req?: any) {
    assertSuperAdmin(actor);
    if (!incidentRef || !incidentRef.trim()) throw new BadRequestException('An incidentRef (ticket/incident id) is required.');
    if (targetId === actor.id) throw new BadRequestException('Use self-service recovery or the CLI for your own account, not peer reset.');
    const target = await this.catalog.platformUser.findUnique({ where: { id: targetId } });
    if (!target || (target.role !== 'SUPER_ADMIN' && target.role !== 'SUPPORT')) throw new NotFoundException('Operator not found');

    const activeSuperAdmins = await this.catalog.platformUser.count({ where: { role: 'SUPER_ADMIN', active: true } });
    if (activeSuperAdmins < 3) {
      throw new ConflictException('Online peer reset needs >=3 active super-admins (a neutral approver). With fewer, use the CLI break-glass.');
    }
    const complete = await this.mfaCompleteSuperAdmins();
    const completeAfter = complete.length - (complete.some((a) => a.id === targetId) ? 1 : 0);
    if (completeAfter < 2) throw new ConflictException('Refusing: this reset would leave fewer than 2 MFA-complete super-admins.');

    const reqRow = await this.catalog.platformMfaResetRequest.create({
      data: { requesterId: actor.id, targetId, status: 'PENDING', incidentRef: incidentRef.trim(), expiresAt: new Date(Date.now() + 15 * 60_000) },
    });
    await this.audit.record(actor, 'platform.mfa.reset_requested', { type: 'platformUser', id: targetId }, { requestId: reqRow.id, incidentRef: incidentRef.trim() }, req);
    return { requestId: reqRow.id, expiresAt: reqRow.expiresAt };
  }

  /** A NEUTRAL second super-admin approves + executes the reset, with a step-up. */
  async approvePeerReset(approver: { id: string; email: string; role?: string }, requestId: string, totpCode: string, req?: any) {
    assertSuperAdmin(approver);
    // Fast-fail + 4-eyes on the request's IMMUTABLE fields (requester/target).
    const reqPre = await this.catalog.platformMfaResetRequest.findUnique({ where: { id: requestId } });
    if (!reqPre || reqPre.status !== 'PENDING') throw new NotFoundException('No pending reset request');
    if (approver.id === reqPre.requesterId) throw new ForbiddenException('The approver must be different from the requester (4-eyes).');
    if (approver.id === reqPre.targetId) throw new ForbiddenException('You cannot approve a reset of your own MFA.');
    const approverPre = await this.catalog.platformUser.findUnique({ where: { id: approver.id } });
    if (!approverPre || !mfaSetupComplete(approverPre) || !approverPre.totpSecret) throw new ForbiddenException('Approver is not MFA-enrolled.');
    let secret: string;
    try { secret = decryptSecretStrict(approverPre.totpSecret); } catch { throw new UnauthorizedException('Step-up unavailable.'); }

    const ip = (req?.headers?.['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() || req?.ip || null;
    const ua = (req?.headers?.['user-agent'] as string | undefined) || null;

    // EVERYTHING that must be atomic lives in ONE serializable tx. A Postgres
    // advisory xact lock serializes all peer-reset executions against each other
    // so two concurrent resets (even on different targets) can't both pass the
    // availability floor. The guarded single-use claim, the step-up replay
    // check+set, the availability re-check, the target clear, and the blocking
    // chained audit are then all consistent and all-or-nothing.
    await this.catalog.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(742042042042)');

      // Single-use claim: only the FIRST approval (and only before expiry) flips
      // PENDING -> APPROVED. 0 rows => already consumed or expired => abort.
      const claim = await tx.platformMfaResetRequest.updateMany({
        where: { id: requestId, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'APPROVED', approverId: approver.id, approvedAt: new Date() },
      });
      if (claim.count !== 1) throw new ConflictException('Reset request is no longer pending (consumed or expired).');

      // Step-up replay guard — load + compare + set atomically inside the tx, so
      // a step-up code is truly single-use and rolls back with the reset.
      const approverNow = await tx.platformUser.findUnique({ where: { id: approver.id } });
      const delta = authenticator.checkDelta(totpCode || '', secret);
      if (delta === null || delta === undefined) throw new UnauthorizedException({ code: 'INVALID_CODE', message: 'Invalid step-up code.' });
      const step = BigInt(Math.floor(Date.now() / 1000 / 30) + delta);
      if (approverNow?.lastTotpStep != null && step <= approverNow.lastTotpStep) throw new UnauthorizedException({ code: 'INVALID_CODE', message: 'Step-up code already used.' });
      await tx.platformUser.update({ where: { id: approver.id }, data: { lastTotpStep: step } });

      // Availability floor, re-evaluated inside the locked tx against fresh state
      // (reading the super-admin set also lets SSI catch a racing demotion).
      const activeSuperAdmins = await tx.platformUser.count({ where: { role: 'SUPER_ADMIN', active: true } });
      if (activeSuperAdmins < 3) throw new ConflictException('Online peer reset needs >=3 active super-admins.');
      const admins = await tx.platformUser.findMany({ where: { role: 'SUPER_ADMIN', active: true } });
      const complete = admins.filter((a) => mfaSetupComplete(a));
      const completeAfter = complete.length - (complete.some((a) => a.id === reqPre.targetId) ? 1 : 0);
      if (completeAfter < 2) throw new ConflictException('Refusing: this reset would leave fewer than 2 MFA-complete super-admins.');

      // Clear the target's MFA.
      await tx.platformBackupCode.deleteMany({ where: { userId: reqPre.targetId } });
      await tx.platformMfaPending.deleteMany({ where: { userId: reqPre.targetId } });
      const updated = await tx.platformUser.update({ where: { id: reqPre.targetId }, data: clearMfaUserData() });
      if (updated.mfaEnrolledAt !== null) throw new Error('post-condition failed: mfaEnrolledAt is not null');

      // Blocking chained audit (a failed write rolls the whole reset back).
      const last = await tx.platformAuditLog.findFirst({ orderBy: { seq: 'desc' }, select: { entryHash: true } });
      const createdAt = new Date();
      const metadata = { requestId, requesterId: reqPre.requesterId, approverId: approver.id, incidentRef: reqPre.incidentRef };
      const entryHash = hashPlatformEntry({
        prevHash: last?.entryHash ?? null,
        actorId: approver.id, actorEmail: approver.email,
        action: 'platform.mfa.admin_reset', targetType: 'platformUser', targetId: reqPre.targetId,
        metadata, ipAddress: ip, userAgent: ua, createdAt,
      });
      await tx.platformAuditLog.create({
        data: { actorId: approver.id, actorEmail: approver.email, action: 'platform.mfa.admin_reset', targetType: 'platformUser', targetId: reqPre.targetId, metadata, ipAddress: ip, userAgent: ua, prevHash: last?.entryHash ?? null, entryHash, createdAt },
      });
    }, { isolationLevel: 'Serializable' });

    // Notify ALL active super-admins + the target (primary + recovery) — the
    // target's mailbox may be compromised, so we never rely on it alone.
    await this.notifyPeerReset(reqPre.targetId, reqPre.incidentRef).catch(() => {});
    return { ok: true };
  }

  private async notifyPeerReset(targetId: string, incidentRef: string) {
    const superAdmins = await this.catalog.platformUser.findMany({ where: { role: 'SUPER_ADMIN', active: true }, select: { email: true } });
    const target = await this.catalog.platformUser.findUnique({ where: { id: targetId }, select: { email: true, recoveryEmail: true } });
    const recipients = new Set<string>();
    superAdmins.forEach((a) => recipients.add(a.email));
    if (target?.email) recipients.add(target.email);
    if (target?.recoveryEmail) recipients.add(target.recoveryEmail);
    const subject = 'AssetMon security notice: an operator MFA was reset';
    const body = `An operator's MFA was reset via governed peer reset (incident ${incidentRef}). If this was unexpected, investigate immediately.`;
    for (const to of recipients) {
      const res = await this.mailer.send(to, subject, body);
      await this.catalog.platformOperatorEmailLog.create({ data: { userId: targetId, toEmail: to, purpose: 'PEER_RESET_NOTICE', subject, sent: res.ok, error: res.ok ? null : (res as any).error || 'send failed' } }).catch(() => {});
    }
  }
}
