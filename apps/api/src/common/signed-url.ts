import * as crypto from 'crypto';

function secret(): string {
  return (
    process.env.SIGNED_URL_SECRET ||
    process.env.JWT_ACCESS_SECRET ||
    'dev_signed_url_secret_change_me'
  );
}

function b64url(buf: Buffer | string) {
  return Buffer.from(buf).toString('base64url');
}
function fromB64Url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

/**
 * Sign a tuple (filename, tenantId, ttlSec) → token.
 * Verified by `verifySignedFileToken` against the same fields.
 */
export function signFileToken(filename: string, tenantId: string, ttlSec = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${b64url(filename)}.${b64url(tenantId)}.${exp}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest();
  return `${payload}.${b64url(sig)}`;
}

export function verifySignedFileToken(token: string, expectedFilename: string): { tenantId: string } | null {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [b64Name, b64Tid, expStr, b64Sig] = parts;
  const payload = `${b64Name}.${b64Tid}.${expStr}`;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest();
  let actual: Buffer;
  try { actual = fromB64Url(b64Sig); } catch { return null; }
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;

  let name: string, tid: string;
  try { name = fromB64Url(b64Name).toString('utf8'); tid = fromB64Url(b64Tid).toString('utf8'); }
  catch { return null; }
  if (name !== expectedFilename) return null;
  return { tenantId: tid };
}
