import * as crypto from 'crypto';

/**
 * Derives a 32-byte AES key from the configured ENCRYPTION_KEY (or falls back
 * to the JWT access secret in dev). In production set ENCRYPTION_KEY to a
 * cryptographically random 64-hex-char value.
 */
function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || process.env.JWT_ACCESS_SECRET || 'dev-fallback-rotate-me';
  return crypto.createHash('sha256').update(raw).digest();
}

/** AES-256-GCM. Output format: <iv(12)>:<tag(16)>:<ciphertext> all base64. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  // Legacy unprefixed values are treated as plaintext (pre-encryption) and
  // returned as-is so 2FA still works for already-enrolled accounts during the
  // migration window.
  if (!payload.includes(':')) return payload;
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) return payload;
  try {
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // Tampered or wrong key — fail closed.
    throw new Error('Decryption failed');
  }
}

export function timingSafeEqualStr(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
