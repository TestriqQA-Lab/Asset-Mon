import { resumeStep, friendlyError, isExpiredSession, resendCooldown } from './mfa';

/**
 * These cover the two failures that actually reached production, so they are
 * written as the behaviour an operator sees rather than as line coverage.
 */

describe('resumeStep', () => {
  // The exact object PlatformMfaService.getState() builds.
  const state = (p: boolean, t: boolean, r: boolean, b = false) => ({
    primaryEmail: { email: 'o***@example.com', verified: p },
    totp: { enabled: t },
    recoveryEmail: { set: r, verified: r, email: r ? 'r***@example.com' : null },
    backupCodes: { generated: b },
    complete: p && t && r && b,
  });

  it('starts at the beginning when nothing is enrolled', () => {
    expect(resumeStep(state(false, false, false))).toBe(1);
  });

  it('resumes past factors that are already enrolled', () => {
    expect(resumeStep(state(true, false, false))).toBe(2);
    expect(resumeStep(state(true, true, false))).toBe(3);
    expect(resumeStep(state(true, true, true))).toBe(4);
  });

  it('never sends an operator with TOTP enrolled back through step 2', () => {
    // Regression: the wizard read flat fields this object has never had, so every
    // answer was 1. Re-entering step 2 mints a new secret and disables the one in
    // the authenticator app, which is how a working factor got destroyed twice.
    for (const s of [state(true, true, false), state(true, true, true), state(true, true, true, true)]) {
      expect(resumeStep(s)).toBeGreaterThan(2);
    }
  });

  it('does not treat the old flat field names as progress', () => {
    // If someone reintroduces the flat shape, this fails instead of silently
    // resetting everyone to step 1.
    const flat: any = {
      primaryEmailVerifiedAt: new Date().toISOString(),
      totpEnabled: true,
      recoveryEmailVerifiedAt: new Date().toISOString(),
    };
    expect(resumeStep(flat)).toBe(1);
  });

  it('is safe on a missing or partial response', () => {
    expect(resumeStep(null)).toBe(1);
    expect(resumeStep(undefined)).toBe(1);
    expect(resumeStep({})).toBe(1);
    expect(resumeStep({ primaryEmail: { verified: true } })).toBe(2);
  });
});

describe('isExpiredSession', () => {
  it('recognises an expired ticket so the wizard can send the operator to sign in', () => {
    expect(isExpiredSession({ status: 401 })).toBe(true);
    expect(isExpiredSession({ payload: { code: 'MFA_RESTART' } })).toBe(true);
  });

  it('does not mistake other failures for an expired session', () => {
    expect(isExpiredSession({ status: 429, payload: { code: 'EMAIL_RATELIMIT' } })).toBe(false);
    expect(isExpiredSession({ status: 500 })).toBe(false);
    expect(isExpiredSession(new Error('network'))).toBe(false);
  });
});

describe('resendCooldown', () => {
  it('reports the seconds the API asked us to wait', () => {
    expect(resendCooldown({ status: 429, payload: { code: 'EMAIL_RATELIMIT', resendIn: 45 } })).toBe(45);
  });

  it('falls back to the throttler window when no figure is given', () => {
    expect(resendCooldown({ status: 429 })).toBe(60);
  });

  it('returns null when waiting is not the problem', () => {
    expect(resendCooldown({ status: 401 })).toBeNull();
    expect(resendCooldown({ payload: { code: 'INVALID_CODE' } })).toBeNull();
  });
});

describe('friendlyError', () => {
  it('tells the operator how long to wait instead of "could not send"', () => {
    expect(friendlyError({ status: 429, payload: { code: 'EMAIL_RATELIMIT', resendIn: 45 } }))
      .toBe('Please wait 45s before requesting another code.');
  });

  it('distinguishes the ways a code can be rejected', () => {
    expect(friendlyError({ payload: { code: 'CODE_EXPIRED' } })).toMatch(/expired/i);
    expect(friendlyError({ payload: { code: 'CODE_BURNED' } })).toMatch(/too many/i);
    expect(friendlyError({ payload: { code: 'INVALID_CODE', attemptsRemaining: 2 } })).toMatch(/2 attempts left/);
    expect(friendlyError({ payload: { code: 'INVALID_CODE', attemptsRemaining: 1 } })).toMatch(/1 attempt left/);
  });

  it('never leaks server text, and defers to the caller when it has nothing useful', () => {
    // The throttler's own message is "ThrottlerException: Too Many Requests".
    expect(friendlyError({ status: 429 })).not.toMatch(/ThrottlerException/);
    expect(friendlyError({ status: 500, message: 'Prisma P2002 unique constraint' })).toBeNull();
    expect(friendlyError({})).toBeNull();
  });
});
