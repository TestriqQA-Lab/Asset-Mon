// Client-side helpers for the MFA flows: which step to resume at, and what to
// say when a request fails.
//
// Both live here rather than inside the wizard component so they can be tested
// without a browser — the step logic in particular was wrong for a long time
// precisely because nothing exercised it.

/** Shape returned by GET /platform/mfa/setup/state (PlatformMfaService.getState). */
export type MfaSetupState = {
  primaryEmail?: { email?: string; verified?: boolean };
  totp?: { enabled?: boolean };
  recoveryEmail?: { set?: boolean; verified?: boolean; email?: string | null };
  backupCodes?: { generated?: boolean };
  complete?: boolean;
};

/**
 * The first step the operator still has to do, 1-4.
 *
 * Every factor is committed to PlatformUser as it completes, so the wizard is
 * meant to be resumable. It was not: it read flat fields (`primaryEmailVerifiedAt`,
 * `totpEnabled`, `recoveryEmailVerifiedAt`) that this object has never contained,
 * so all three were undefined and the answer was always 1. Restarting at step 1
 * is not merely repetitive — walking back through step 2 mints a new TOTP secret
 * and disables the one already in the operator's authenticator app.
 */
export function resumeStep(state: MfaSetupState | null | undefined): 1 | 2 | 3 | 4 {
  if (!state?.primaryEmail?.verified) return 1;
  if (!state?.totp?.enabled) return 2;
  if (!state?.recoveryEmail?.verified) return 3;
  return 4;
}

// Plain-language copy for the errors the MFA flows can return.
//
// Three unrelated failures used to reach the operator as one sentence — "Could
// not send the code, please try again" — when the real causes were a 60-second
// resend cooldown, an expired setup ticket, and an actual SMTP rejection. They
// need different actions from the user, so they need different words.
//
// Server `message` text is never surfaced: it is developer-facing (it names
// internal parameters, and the throttler emits "ThrottlerException: Too Many
// Requests"). Anything unrecognised returns null so the caller can fall back to
// copy that suits its own context.

/** Errors thrown by api/papi carry the HTTP status and the parsed JSON body. */
type ApiError = { status?: number; payload?: { code?: string; [k: string]: unknown } };

/** True when the failure means "your setup/login ticket is no longer valid". */
export function isExpiredSession(e: any): boolean {
  return e?.status === 401 || e?.payload?.code === 'MFA_RESTART';
}

/** Seconds the caller must wait before another code can be requested, if known. */
export function resendCooldown(e: any): number | null {
  if (e?.payload?.code === 'EMAIL_RATELIMIT' && typeof e.payload.resendIn === 'number') {
    return e.payload.resendIn;
  }
  // The hard throttler does not tell us how long, so assume its window.
  if (e?.status === 429) return 60;
  return null;
}

export function friendlyError(e: any): string | null {
  const err = e as ApiError;
  const code = err?.payload?.code;

  // App-level "wait before resending" cooldown — carries the seconds left.
  if (code === 'EMAIL_RATELIMIT') {
    const s = (err.payload as any)?.resendIn;
    return typeof s === 'number'
      ? `Please wait ${s}s before requesting another code.`
      : 'Please wait a moment before requesting another code.';
  }

  // The code itself was rejected. These are distinct on purpose: retyping the
  // same code helps for none of them, and the right next action differs.
  if (code === 'CODE_EXPIRED') return 'That code has expired — request a new one.';
  if (code === 'CODE_BURNED') return 'Too many incorrect attempts — request a new code.';
  if (code === 'INVALID_CODE') {
    const left = (err.payload as any)?.attemptsRemaining;
    return typeof left === 'number'
      ? `Incorrect code — ${left} ${left === 1 ? 'attempt' : 'attempts'} left before it is locked.`
      : 'Incorrect code.';
  }

  if (code === 'SETUP_INCOMPLETE') return 'Finish every step before completing setup.';

  // Hard rate limiter (too many attempts in a short window).
  if (err?.status === 429) return 'Too many attempts — please wait a minute and try again.';

  return null;
}
