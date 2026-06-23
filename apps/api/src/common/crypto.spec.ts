import { encryptSecret, decryptSecret, decryptSecretStrict, timingSafeEqualStr } from './crypto';

describe('crypto (versioned AES-256-GCM)', () => {
  test('encryptSecret produces a v1 4-part blob that round-trips', () => {
    const blob = encryptSecret('my-totp-secret');
    expect(blob.startsWith('v1:')).toBe(true);
    expect(blob.split(':')).toHaveLength(4);
    expect(decryptSecret(blob)).toBe('my-totp-secret');
    expect(decryptSecretStrict(blob)).toBe('my-totp-secret');
  });

  test('two encryptions of the same plaintext differ (random IV) but both decrypt', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
    expect(decryptSecret(b)).toBe('same');
  });

  test('a tampered ciphertext fails closed', () => {
    const parts = encryptSecret('secret').split(':');
    parts[3] = Buffer.from('tampered-bytes-here').toString('base64');
    expect(() => decryptSecretStrict(parts.join(':'))).toThrow();
  });

  test('lenient decrypt passes through pre-encryption plaintext; strict rejects non-v1 shapes', () => {
    expect(decryptSecret('plain-no-colon')).toBe('plain-no-colon');
    expect(() => decryptSecretStrict('plain-no-colon')).toThrow();
    expect(() => decryptSecretStrict('only:three:parts')).toThrow();
  });

  test('timingSafeEqualStr compares by content and length', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
  });
});
