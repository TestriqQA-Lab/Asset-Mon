import * as crypto from 'crypto';
import { timingSafeEqualStr } from '../crypto';

/**
 * Shared OTP / backup-code hashing used by BOTH the platform and tenant MFA
 * flows. One scheme: HMAC-SHA256(normalizedCode, OTP_PEPPER) -> hex, compared in
 * constant time. The pepper is a dedicated env secret (distinct from the JWT /
 * encryption keys, enforced at startup); we never store or compare raw codes.
 */

function pepper(): string {
  const p = process.env.OTP_PEPPER;
  if (!p) throw new Error('OTP_PEPPER is not set');
  return p;
}

/** Strip spaces/dashes and upper-case so display formatting never affects the hash. */
export function normalizeCode(code: string): string {
  return (code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** HMAC-SHA256(normalizedCode, OTP_PEPPER) -> hex. One scheme for OTPs AND backup codes. */
export function hashCode(code: string): string {
  return crypto.createHmac('sha256', pepper()).update(normalizeCode(code)).digest('hex');
}

/** Constant-time check of a presented code against a stored hash. */
export function verifyCode(code: string, storedHash: string): boolean {
  if (!storedHash) return false;
  return timingSafeEqualStr(hashCode(code), storedHash);
}

/** Cryptographically-random numeric OTP, zero-padded to `digits` (default 6). */
export function generateNumericOtp(digits = 6): string {
  const max = 10 ** digits;
  return crypto.randomInt(0, max).toString().padStart(digits, '0');
}
