import { assertSuperAdmin, mfaSetupComplete, maskEmail, sameRegistrableDomain } from './platform-mfa.util';

describe('platform-mfa.util', () => {
  test('assertSuperAdmin allows SUPER_ADMIN, blocks everyone else', () => {
    expect(() => assertSuperAdmin({ role: 'SUPER_ADMIN' })).not.toThrow();
    expect(() => assertSuperAdmin({ role: 'SUPPORT' })).toThrow();
    expect(() => assertSuperAdmin({})).toThrow();
    expect(() => assertSuperAdmin(null)).toThrow();
    expect(() => assertSuperAdmin(undefined)).toThrow();
  });

  test('maskEmail hides the local part but keeps the domain', () => {
    expect(maskEmail('alice@example.com')).toBe('al***@example.com');
    expect(maskEmail('ab@x.io')).toBe('ab*@x.io');
    expect(maskEmail('a@x.io')).toBe('a*@x.io');
    expect(maskEmail('not-an-email')).toBe('***');
  });

  test('sameRegistrableDomain compares domains case-insensitively', () => {
    expect(sameRegistrableDomain('a@gmail.com', 'b@gmail.com')).toBe(true);
    expect(sameRegistrableDomain('a@Gmail.com', 'b@gmail.COM')).toBe(true);
    expect(sameRegistrableDomain('a@gmail.com', 'b@outlook.com')).toBe(false);
    expect(sameRegistrableDomain('no-domain', 'x@y.com')).toBe(false);
  });

  test('mfaSetupComplete is true only when every factor AND the gate column are set', () => {
    const full = {
      primaryEmailVerifiedAt: new Date(),
      totpEnabled: true,
      totpSecret: 'v1:iv:tag:ct',
      recoveryEmail: 'r@other.io',
      recoveryEmailVerifiedAt: new Date(),
      backupCodesGeneratedAt: new Date(),
      mfaEnrolledAt: new Date(),
    };
    expect(mfaSetupComplete(full)).toBe(true);
    expect(mfaSetupComplete({ ...full, mfaEnrolledAt: null })).toBe(false);
    expect(mfaSetupComplete({ ...full, totpEnabled: false })).toBe(false);
    expect(mfaSetupComplete({ ...full, recoveryEmailVerifiedAt: null })).toBe(false);
    expect(mfaSetupComplete({})).toBe(false);
  });
});
