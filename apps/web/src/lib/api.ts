const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type Tokens = { accessToken: string; refreshToken: string; tenant: { id: string; slug: string }; user: { id: string; email: string; role: string } };

export function setSession(t: Tokens) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('am.session', JSON.stringify(t));
}
export function getSession(): Tokens | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('am.session');
  return raw ? JSON.parse(raw) : null;
}
export function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('am.session');
}

/**
 * Best-effort logout: tells the server to consume the current refresh JTI, then
 * clears local session. Callers should redirect to /login afterwards.
 */
export async function logout(): Promise<void> {
  if (typeof window === 'undefined') return;
  const s = getSession();
  try {
    if (s?.refreshToken) {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: s.refreshToken }),
        keepalive: true,
      }).catch(() => {});
    }
  } finally {
    clearSession();
  }
}

async function rawFetch(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.auth !== false) {
    const s = getSession();
    if (s?.accessToken) headers.set('Authorization', `Bearer ${s.accessToken}`);
  }
  return fetch(`${API_URL}/api${path}`, { ...init, headers });
}

// Coalesce concurrent 401s into a single refresh call. Without this, every parallel
// dashboard query fires its own /auth/refresh; the server consumes the refresh JTI
// on the first call and rejects the rest as "Refresh token reused", which logs the
// user out unexpectedly.
let inFlightRefresh: Promise<Tokens | null> | null = null;

async function refreshOnce(): Promise<Tokens | null> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    try {
      const s = getSession();
      if (!s?.refreshToken) return null;
      const r = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: s.refreshToken }),
      });
      if (!r.ok) { clearSession(); return null; }
      const fresh: Tokens = await r.json();
      setSession(fresh);
      return fresh;
    } catch {
      clearSession();
      return null;
    } finally {
      // Release the lock after a microtask so simultaneous callers still attach to the
      // same promise; subsequent fresh 401s (next expiry cycle) start a new refresh.
      setTimeout(() => { inFlightRefresh = null; }, 0);
    }
  })();
  return inFlightRefresh;
}

export async function api<T = any>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  let res = await rawFetch(path, init);
  if (res.status === 401 && init.auth !== false) {
    const fresh = await refreshOnce();
    if (fresh) {
      res = await rawFetch(path, init);
    } else if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/signup')) {
      // Refresh failed → session is gone. Bounce to login so the user isn't stranded
      // with broken-looking "Failed to load" cards everywhere.
      clearSession();
      window.location.href = '/login';
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message;
    // Preserve structured server payload for callers that need it (e.g. WORKSPACE_REQUIRED).
    const e: any = new Error(msg || `Request failed: ${res.status}`);
    e.status = res.status;
    e.payload = err;
    throw e;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
