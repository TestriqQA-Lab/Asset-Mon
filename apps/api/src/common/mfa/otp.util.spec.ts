import { normalizeCode, hashCode, verifyCode, generateNumericOtp } from './otp.util';

describe('otp.util', () => {
  test('normalizeCode strips non-alphanumerics and upper-cases', () => {
    expect(normalizeCode('ab-cd ef')).toBe('ABCDEF');
    expect(normalizeCode(' 12 34-56 ')).toBe('123456');
    expect(normalizeCode('')).toBe('');
  });

  test('hashCode is a deterministic 64-hex HMAC, sensitive to the code', () => {
    const h = hashCode('123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode('123456')).toBe(h);
    expect(hashCode('654321')).not.toBe(h);
  });

  test('hashCode normalizes, so display formatting never changes the hash', () => {
    expect(hashCode('AB-CD-EF')).toBe(hashCode('abcdef'));
  });

  test('verifyCode matches the right code (in any format) and rejects others', () => {
    const h = hashCode('ab12cd34');
    expect(verifyCode('ab12cd34', h)).toBe(true);
    expect(verifyCode('AB-12-CD-34', h)).toBe(true);
    expect(verifyCode('00000000', h)).toBe(false);
    expect(verifyCode('whatever', '')).toBe(false);
  });

  test('generateNumericOtp returns exactly N digits', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateNumericOtp(6)).toMatch(/^[0-9]{6}$/);
    }
    expect(generateNumericOtp(8)).toMatch(/^[0-9]{8}$/);
  });
});
