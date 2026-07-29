// Thin HTTP client for the harness. Deliberately dependency-free so the
// harness can run with nothing installed but Node.

export const API = process.env.AM_API || 'http://localhost:4000/api';
export const WORKSPACE = process.env.AM_WS || 's4demo10679';

export const ACCOUNTS = {
  admin: { email: 'admin@s4demo10679.test', password: 'DemoPass123', role: 'ADMIN' },
  manager: { email: 'rbac.mgr@s4demo10679.test', password: 'MgrPass12345', role: 'ASSET_MANAGER' },
  employee: { email: 'rbac.emp@s4demo10679.test', password: 'EmpPass12345', role: 'EMPLOYEE' },
};

export const ROLES = ['admin', 'manager', 'employee'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One request. Never throws on a non-2xx — the status IS the assertion in most
 * checks, so callers always get { status, body } back.
 *
 * Retries on 429. The API allows 20 requests a second globally, and a run of
 * ~300 checks fires faster than that, so without this the harness invents
 * failures that have nothing to do with the code under test. Worse, a throttled
 * *setup* call (say, putting an asset back to AVAILABLE) makes the NEXT check
 * fail for a reason that looks real. A gate that cries wolf is worse than none.
 */
export async function req(method, path, { token, body, headers = {} } = {}, attempt = 0) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof FormData)) h['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch (e) {
    // A connection failure is a harness-level problem, not a check failure —
    // surface it as status 0 so the caller can tell the two apart.
    return { status: 0, body: { error: String(e.message || e) }, ok: false };
  }

  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  // The per-second window is 1s wide, so one wait clears it. Login has a much
  // wider window and is handled separately with an explicit message.
  if (res.status === 429 && attempt < 3 && !path.startsWith('/auth/login')) {
    await sleep(1200 * (attempt + 1));
    return req(method, path, { token, body, headers }, attempt + 1);
  }

  return { status: res.status, body: parsed, ok: res.ok, headers: res.headers };
}

export const GET = (p, o) => req('GET', p, o);
export const POST = (p, body, o) => req('POST', p, { ...o, body });
export const PATCH = (p, body, o) => req('PATCH', p, { ...o, body });
export const PUT = (p, body, o) => req('PUT', p, { ...o, body });
export const DEL = (p, o) => req('DELETE', p, o);

export async function login(email, password, workspaceSlug = WORKSPACE) {
  return POST('/auth/login', { email, password, workspaceSlug });
}

/**
 * Log in as all three tenant roles. Returns { admin: {token, user}, ... }.
 * Throws if any role cannot authenticate — every later suite depends on this,
 * so failing fast here is clearer than 180 cascading failures.
 */
export async function loginAll() {
  const out = {};
  for (const role of ROLES) {
    const { email, password } = ACCOUNTS[role];
    const r = await login(email, password);

    // /auth/login allows 30 attempts a minute per IP. One run spends about ten
    // of those, so two or three runs back to back will trip it. That looks like
    // a broken harness if the message is not explicit.
    if (r.status === 429) {
      throw new Error(
        `Rate limited logging in as ${role}.\n` +
        `/auth/login allows 30 requests a minute and a single run uses roughly ten.\n` +
        `Wait a minute before running again.`,
      );
    }

    if (r.status !== 201 || !r.body?.accessToken) {
      throw new Error(
        `Cannot log in as ${role} (${email}): status ${r.status} ${JSON.stringify(r.body)}\n` +
        `Is the stack up? Try: wsl.exe --cd <root> -- bash check-stack.sh`,
      );
    }
    out[role] = { token: r.body.accessToken, refresh: r.body.refreshToken, user: r.body.user };
  }
  return out;
}
