import * as dns from 'dns';
import { BadRequestException } from '@nestjs/common';

const lookup = (host: string) =>
  new Promise<dns.LookupAddress[]>((resolve, reject) => {
    dns.lookup(host, { all: true, verbatim: true }, (err, addrs) => {
      if (err) reject(err);
      else resolve(addrs);
    });
  });

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return -1;
  return (parts[0] << 24 >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n < 0) return true;
  const inRange = (start: string, end: string) => n >= ipv4ToInt(start) && n <= ipv4ToInt(end);
  return (
    inRange('0.0.0.0', '0.255.255.255') ||
    inRange('10.0.0.0', '10.255.255.255') ||
    inRange('100.64.0.0', '100.127.255.255') ||
    inRange('127.0.0.0', '127.255.255.255') ||
    inRange('169.254.0.0', '169.254.255.255') ||
    inRange('172.16.0.0', '172.31.255.255') ||
    inRange('192.0.0.0', '192.0.0.255') ||
    inRange('192.0.2.0', '192.0.2.255') ||
    inRange('192.168.0.0', '192.168.255.255') ||
    inRange('198.18.0.0', '198.19.255.255') ||
    inRange('198.51.100.0', '198.51.100.255') ||
    inRange('203.0.113.0', '203.0.113.255') ||
    inRange('224.0.0.0', '255.255.255.255')
  );
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;       // ULA fc00::/7
  if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
      lower.startsWith('fea') || lower.startsWith('feb')) return true;     // link-local fe80::/10
  if (lower.startsWith('ff')) return true;                                  // multicast ff00::/8
  if (lower.startsWith('::ffff:')) {                                        // IPv4-mapped
    const v4 = lower.slice(7);
    return isPrivateIPv4(v4);
  }
  return false;
}

export type SsrfCheckOptions = {
  allowedSchemes?: string[];
  allowLoopback?: boolean;
};

/**
 * Validate that `urlStr` is a safe outbound URL — i.e. the scheme is allowed and the
 * resolved host is NOT a private, loopback, link-local, broadcast or multicast address.
 *
 * Throws BadRequestException with a generic message on failure (does not leak internal addresses).
 *
 * Set `WEBHOOK_ALLOW_LOOPBACK=1` in env to permit 127.0.0.1 / ::1 for local dev only.
 */
export async function assertSafeOutboundUrl(urlStr: string, opts: SsrfCheckOptions = {}): Promise<URL> {
  let u: URL;
  try { u = new URL(urlStr); } catch { throw new BadRequestException('Invalid URL'); }

  const schemes = opts.allowedSchemes ?? ['http:', 'https:'];
  if (!schemes.includes(u.protocol)) {
    throw new BadRequestException(`URL scheme must be one of: ${schemes.map((s) => s.replace(':', '')).join(', ')}`);
  }
  if (u.username || u.password) throw new BadRequestException('URL must not contain credentials');

  const allowLoopback = opts.allowLoopback ?? (process.env.WEBHOOK_ALLOW_LOOPBACK === '1');

  const hostname = u.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (!hostname) throw new BadRequestException('Invalid URL host');

  // Reject hostnames that obviously refer to loopback unless explicitly allowed
  if (!allowLoopback && /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home)$/i.test(hostname)) {
    throw new BadRequestException('URL host is not reachable');
  }

  // Resolve all addresses for the hostname; reject if ANY is private/loopback (avoids dual-stack bypass)
  let addrs: dns.LookupAddress[];
  try { addrs = await lookup(hostname); } catch { throw new BadRequestException('URL host is not resolvable'); }

  for (const a of addrs) {
    const isPriv = a.family === 6 ? isPrivateIPv6(a.address) : isPrivateIPv4(a.address);
    if (isPriv) {
      const isLoopback = a.family === 6 ? a.address === '::1' : a.address.startsWith('127.');
      if (isLoopback && allowLoopback) continue;
      throw new BadRequestException('URL host is not reachable');
    }
  }

  return u;
}
