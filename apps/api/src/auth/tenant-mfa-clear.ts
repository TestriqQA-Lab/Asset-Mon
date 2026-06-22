/**
 * The exact column set that "fully clears MFA" for a TENANT user — used by the
 * company-admin "Reset this user's MFA" recovery action (users.service.ts §7 of
 * docs/tenant-mfa-plan.md). Kept in one dependency-free place so the reset path
 * can never drift from what it must clear, mirroring the platform's
 * platform-mfa-clear.ts.
 *
 * IMPORTANT — why this is BROADER than the user's own disable() (tenant-mfa.service.ts):
 *   - Self-disable deliberately KEEPS totpSecret/totpEnabled: a user turning off
 *     email-2FA may still want to keep their authenticator app.
 *   - An ADMIN reset is a RESCUE for a user who lost their email AND/OR device.
 *     If it left totpEnabled=true, the login chain's legacy single-call TOTP path
 *     (auth.service.ts: `if (user.totpEnabled) ... TOTP_REQUIRED`) would still wall
 *     the user out even after mfaMethod was set to NONE. So the reset MUST also
 *     null the authenticator (totpSecret/totpEnabled/lastTotpStep) — this is the
 *     same thing deletion already does (users.service.ts soft-delete) and what the
 *     platform clearMfaUserData() does. It closes the "only deletion clears 2FA" gap.
 *
 * Also lifts any lockout (this routine exists to rescue a stuck user; login checks
 * lockedUntil first) and bumps tokenVersion to kill the target's live sessions.
 */
export function clearTenantMfaUserData() {
  return {
    mfaMethod: 'NONE' as const,
    mfaEnabledAt: null,
    recoveryEmail: null,
    recoveryEmailVerifiedAt: null,
    totpSecret: null,
    totpEnabled: false,
    lastTotpStep: null,
    failedLoginCount: 0,
    lockedUntil: null,
    tokenVersion: { increment: 1 },
  };
}
