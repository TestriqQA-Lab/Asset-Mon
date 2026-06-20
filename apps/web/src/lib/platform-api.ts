// Separate session + fetch helpers for the platform-admin app at /platform/*.
// Lives alongside the tenant-side `api.ts` so a logged-in tenant user and a
// logged-in platform admin can coexist on the same browser without tokens
// clobbering each other.

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export type PlatformSession = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; firstName: string; lastName: string; role: 'SUPER_ADMIN' | 'SUPPORT' };
};

const KEY = 'am.platform.session';

export function setPlatformSession(s: PlatformSession) {
  if (typeof window !== 'undefined') localStorage.setItem(KEY, JSON.stringify(s));
}
export function getPlatformSession(): PlatformSession | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}
export function clearPlatformSession() {
  if (typeof window !== 'undefined') localStorage.removeItem(KEY);
}

export async function platformLogout() {
  const s = getPlatformSession();
  try {
    if (s?.refreshToken) {
      await fetch(`${API_URL}/api/platform/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: s.refreshToken }),
        keepalive: true,
      }).catch(() => {});
    }
  } finally {
    clearPlatformSession();
  }
}

let inFlight: Promise<PlatformSession | null> | null = null;
async function refreshOnce(): Promise<PlatformSession | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const s = getPlatformSession();
      if (!s?.refreshToken) return null;
      const r = await fetch(`${API_URL}/api/platform/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: s.refreshToken }),
      });
      if (!r.ok) { clearPlatformSession(); return null; }
      const fresh: PlatformSession = await r.json();
      setPlatformSession(fresh);
      return fresh;
    } catch {
      clearPlatformSession();
      return null;
    } finally {
      setTimeout(() => { inFlight = null; }, 0);
    }
  })();
  return inFlight;
}

async function rawFetch(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.auth !== false) {
    const s = getPlatformSession();
    if (s?.accessToken) headers.set('Authorization', `Bearer ${s.accessToken}`);
  }
  return fetch(`${API_URL}/api${path}`, { ...init, headers });
}

export async function papi<T = any>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  let res = await rawFetch(path, init);
  if (res.status === 401 && init.auth !== false) {
    const fresh = await refreshOnce();
    if (fresh) {
      res = await rawFetch(path, init);
    } else if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/platform/login')) {
      clearPlatformSession();
      window.location.href = '/platform/login';
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message;
    const e: any = new Error(msg || `Request failed: ${res.status}`);
    e.status = res.status;
    e.payload = err;
    throw e;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
