/**
 * The exact column set that "clears MFA" for a platform operator. Shared by the
 * service-side clearMfa (peer reset) AND the CLI break-glass --reset-mfa so the
 * two can never drift (R8/B8): every reset path nulls the same columns, deletes
 * backup codes + pending chains, and bumps tokenVersion (kills live sessions).
 *
 * This file is intentionally dependency-free so the standalone CLI script can
 * require the compiled output without pulling in NestJS.
 */
export function clearMfaUserData() {
  return {
    primaryEmailVerifiedAt: null,
    totpSecret: null,
    totpEnabled: false,
    recoveryEmail: null,
    recoveryEmailVerifiedAt: null,
    backupCodesGeneratedAt: null,
    mfaEnrolledAt: null,
    lastTotpStep: null,
    // Also lift any lockout: this routine exists to RESCUE a locked-out operator,
    // and login checks lockedUntil before the setup-gate. Mirrors complete() and
    // the CLI password-reset, which already clear these.
    failedLoginCount: 0,
    lockedUntil: null,
    tokenVersion: { increment: 1 },
  };
}
