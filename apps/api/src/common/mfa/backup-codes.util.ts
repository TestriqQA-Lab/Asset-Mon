import * as crypto from 'crypto';
import { hashCode } from './otp.util';

/**
 * Single-use backup codes, shared by platform + tenant. Each code is >=128-bit,
 * shown to the user exactly once, and stored ONLY as its HMAC+pepper hash
 * (see otp.util.hashCode), stamped with the pepper version that produced it.
 *
 * pepperVersion lets an OTP_PEPPER rotation self-heal: rotating the pepper
 * changes every future hash, so old codes can never match again — and because a
 * stored code's pepperVersion no longer equals the current one, the system can
 * DETECT that (and force regeneration) without keeping old peppers around.
 */

/** Current pepper version. Bump OTP_PEPPER_VERSION whenever you rotate OTP_PEPPER. */
export function currentPepperVersion(): number {
  const v = Number(process.env.OTP_PEPPER_VERSION || 1);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 1;
}

export interface GeneratedBackupCode {
  /** Shown to the user ONCE; never stored. */
  plain: string;
  /** HMAC+pepper hash, stored at rest. */
  hash: string;
  /** Pepper version that produced `hash`. */
  pepperVersion: number;
}

/** 16 random bytes (128 bits) as four dash-separated lowercase-hex groups. */
function formatCode(bytes: Buffer): string {
  return bytes.toString('hex').replace(/(.{8})(.{8})(.{8})(.{8})/, '$1-$2-$3-$4');
}

/** Generate `count` single-use backup codes (>=128-bit each) with stored hashes. */
export function generateBackupCodes(count = 10): GeneratedBackupCode[] {
  const version = currentPepperVersion();
  const out: GeneratedBackupCode[] = [];
  for (let i = 0; i < count; i++) {
    const plain = formatCode(crypto.randomBytes(16));
    out.push({ plain, hash: hashCode(plain), pepperVersion: version });
  }
  return out;
}
