import * as crypto from 'crypto';

/**
 * At-rest encryption for TOTP secrets (tenant + platform), AES-256-GCM.
 *
 * Stored format is VERSIONED:  "<version>:<iv(12)>:<tag(16)>:<ciphertext>"  (all
 * base64), e.g. "v1:<iv>:<tag>:<ct>". The version selects the key from a small
 * keyring, so a future key rotation is a non-event: add "v2" alongside "v1",
 * encrypt new values with v2, and old "v1:" blobs keep decrypting. Without
 * versioning, rotating ENCRYPTION_KEY would force a platform-wide TOTP
 * re-enrollment (it encrypts every tenant 2FA secret too).
 *
 * Backward compatibility: values written before versioning are unversioned
 * "<iv>:<tag>:<ct>" (3 parts) and still decrypt with the v1 key; pre-encryption
 * plaintext (no ":") is returned as-is. `decryptSecretStrict` rejects both of
 * those legacy shapes — platform secrets must always be a current versioned blob.
 */

const CURRENT_VERSION = 'v1';

/** Derive a 32-byte AES key from a raw secret string. */
function deriveKey(raw: string): Buffer {
  return crypto.createHash('sha256').update(raw).digest();
}

/**
 * Version -> key resolver. Day one has a single entry; `v1` is ENCRYPTION_KEY
 * (with the historical dev fallback to JWT_ACCESS_SECRET so local dev without
 * ENCRYPTION_KEY keeps working — production requires ENCRYPTION_KEY, enforced at
 * startup in main.ts). To rotate later:
 *   v2: () => deriveKey(process.env.ENCRYPTION_KEY_V2!)
 * then set CURRENT_VERSION = 'v2'. Old v1 blobs keep decrypting.
 */
const KEYRING: Record<string, () => Buffer> = {
  v1: () => deriveKey(process.env.ENCRYPTION_KEY || process.env.JWT_ACCESS_SECRET || 'dev-fallback-rotate-me'),
};

function gcmEncrypt(key: Buffer, plain: string): { iv: string; tag: string; ct: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), ct: enc.toString('base64') };
}

function gcmDecrypt(key: Buffer, ivB64: string, tagB64: string, ctB64: string): string {
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** AES-256-GCM, versioned. Output: "v1:<iv>:<tag>:<ct>" (base64). */
export function encryptSecret(plain: string): string {
  const { iv, tag, ct } = gcmEncrypt(KEYRING[CURRENT_VERSION](), plain);
  return [CURRENT_VERSION, iv, tag, ct].join(':');
}

/**
 * Lenient decrypt for TENANT secrets (handles the migration window):
 *   "v1:<iv>:<tag>:<ct>"  -> keyring decrypt (current path)
 *   "<iv>:<tag>:<ct>"     -> legacy unversioned, decrypt with the v1 key
 *   no ":"                -> pre-encryption plaintext, returned as-is
 */
export function decryptSecret(payload: string): string {
  if (!payload.includes(':')) return payload;
  const parts = payload.split(':');
  try {
    if (parts.length === 4 && KEYRING[parts[0]]) {
      return gcmDecrypt(KEYRING[parts[0]](), parts[1], parts[2], parts[3]);
    }
    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      return gcmDecrypt(KEYRING[CURRENT_VERSION](), parts[0], parts[1], parts[2]);
    }
  } catch {
    // Tampered or wrong key — fail closed.
    throw new Error('Decryption failed');
  }
  // Unrecognised shape that still contained ":" — treat as plaintext (matches
  // the prior lenient behaviour rather than throwing).
  return payload;
}

/**
 * Strict decrypt for PLATFORM secrets: ONLY a current versioned blob is
 * accepted. Legacy unversioned / plaintext are rejected (fail closed -> the
 * operator goes through break-glass rather than silently trusting a bad blob).
 */
export function decryptSecretStrict(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || !KEYRING[parts[0]] || !parts[1] || !parts[2] || !parts[3]) {
    throw new Error('Invalid encrypted secret format');
  }
  try {
    return gcmDecrypt(KEYRING[parts[0]](), parts[1], parts[2], parts[3]);
  } catch {
    throw new Error('Decryption failed');
  }
}

export function timingSafeEqualStr(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
