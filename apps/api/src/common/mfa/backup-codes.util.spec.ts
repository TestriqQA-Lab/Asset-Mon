import { generateBackupCodes, currentPepperVersion } from './backup-codes.util';
import { verifyCode } from './otp.util';

describe('backup-codes.util', () => {
  test('generates the requested count of unique codes', () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes.map((c) => c.plain)).size).toBe(10);
  });

  test('each code is >=128-bit and verifies against its stored hash (any format)', () => {
    for (const c of generateBackupCodes(10)) {
      expect(c.plain.replace(/-/g, '')).toMatch(/^[0-9a-f]{32,}$/); // >= 32 hex chars = >= 128 bit
      expect(verifyCode(c.plain, c.hash)).toBe(true);
      expect(verifyCode(c.plain.replace(/-/g, ''), c.hash)).toBe(true);
      expect(c.pepperVersion).toBe(currentPepperVersion());
    }
  });

  test('the stored value is a hash, never the plaintext', () => {
    for (const c of generateBackupCodes(3)) {
      expect(c.hash).not.toBe(c.plain);
      expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
