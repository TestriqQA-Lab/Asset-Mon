import * as fs from 'fs';
import * as path from 'path';

/**
 * Every HTTP route must be behind an authenticating guard, or be listed below with a
 * reason.
 *
 * JwtAuthGuard and PlatformAuthGuard are applied per-controller — they are not
 * APP_GUARDs, so nothing forces them on. A controller that omits @UseGuards is simply
 * public, and nothing fails: not the typechecker, not the tests, not the build. The
 * tenant-scoping equivalent of this mistake is caught by scoped-client.spec.ts; this is
 * the same check for the authentication boundary.
 */

const SRC = path.resolve(__dirname, '..');

/** Guards that actually establish an identity. RolesGuard and friends only refine one. */
const AUTH_GUARDS = ['JwtAuthGuard', 'PlatformAuthGuard', 'PlatformSetupTicketGuard'];

/**
 * Routes that are deliberately reachable without authentication. Each needs a reason,
 * because "it has always been like that" is how an accidental hole survives review.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  'GET /api/health': 'liveness probe; returns only {ok, time}',

  // ── Tenant auth: the endpoints you use to obtain a session ──────────────────
  'POST /api/auth/signup': 'creates a workspace; rate-limited',
  'POST /api/auth/login': 'password → MFA chain entry point',
  'POST /api/auth/mfa/email': 'step 2 of login; gated by the mfa_pending ticket',
  'POST /api/auth/mfa/totp': 'step 3 of login; gated by the mfa_pending ticket',
  'POST /api/auth/refresh': 'presents a refresh token, which is the credential',
  'POST /api/auth/logout': 'revokes a presented refresh token; nothing to authorise',
  'GET /api/auth/invite/:token': 'the invite token is the credential; read-only preview',
  'POST /api/auth/invite/:token': 'the invite token is the credential; accepting it creates the session',

  // ── Platform operator auth: same shape, separate realm ──────────────────────
  'POST /api/platform/auth/login': 'password → 3FA chain entry point',
  'POST /api/platform/auth/mfa/email': 'step 2 of the operator chain; ticket-gated',
  'POST /api/platform/auth/mfa/totp': 'step 3 of the operator chain; ticket-gated',
  'POST /api/platform/auth/refresh': 'presents a refresh token, which is the credential',
  'POST /api/platform/auth/logout': 'revokes a presented refresh token',

  // ── Files served to unauthenticated browsers (<img src>) ────────────────────
  'GET /api/assets/file-public/:name':
    'HMAC-signed URL with an expiry, and the asset must reference the file in the signed tenant',
  'GET /api/tenant-settings/logo/:name':
    'filename is 24 random hex; served only if a tenant publishes it as its logo',
  'GET /api/categories/image/:name':
    'filename is 24 random hex; path-contained and served with nosniff + a sandbox CSP',

  // ── Third-party callback ────────────────────────────────────────────────────
  'POST /api/billing/razorpay/webhook':
    'Razorpay cannot present a token; authenticated by HMAC over the raw body',
};

const HTTP_METHOD = /^@(Get|Post|Put|Patch|Delete|Head|Options)\(\s*(?:'([^']*)'|"([^"]*)")?/;
const CONTROLLER = /^@Controller\(\s*(?:'([^']*)'|"([^"]*)")?/;

type Route = { key: string; file: string; line: number; guarded: boolean };

/** Files are walked rather than imported: this must see what is written, not what runs. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

function hasAuthGuard(decorators: string[]): boolean {
  return decorators.some((d) => d.startsWith('@UseGuards') && AUTH_GUARDS.some((g) => d.includes(g)));
}

/**
 * Collect the decorator block that precedes each member, then decide.
 *
 * The whole block is read before deciding, because @UseGuards may sit either side of
 * the @Post — an earlier version of this check looked only at decorators seen before
 * the route and got two routes wrong in opposite directions.
 */
function routesIn(file: string): Route[] {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const found: Route[] = [];

  let block: string[] = [];          // decorators awaiting their member
  let blockStart = 0;
  let depth = 0;                     // bracket depth, for decorators spanning lines
  let buf = '';
  let base: string | null = null;    // current @Controller prefix
  let classGuarded = false;

  const flush = () => { block = []; buf = ''; depth = 0; };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();

    if (buf === '' && !t.startsWith('@')) {
      if (t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;

      // A non-decorator line: whatever decorators we collected belong to it.
      if (/^(export\s+)?(abstract\s+)?class\s/.test(t)) {
        classGuarded = hasAuthGuard(block);
        flush();
        continue;
      }
      const route = block.map((d) => d.match(HTTP_METHOD)).find(Boolean);
      if (route && base !== null) {
        const sub = route[2] ?? route[3] ?? '';
        const p = ('/api/' + base + (sub ? '/' + sub : '')).replace(/\/{2,}/g, '/').replace(/\/$/, '');
        found.push({
          key: `${route[1].toUpperCase()} ${p}`,
          file: path.relative(SRC, file).replace(/\\/g, '/'),
          line: blockStart,
          guarded: classGuarded || hasAuthGuard(block),
        });
      }
      flush();
      continue;
    }

    if (buf === '') blockStart = i + 1;
    buf += (buf ? ' ' : '') + t;
    depth += (t.match(/[([{]/g) || []).length - (t.match(/[)\]}]/g) || []).length;
    if (depth > 0) continue;         // decorator continues on the next line

    const ctrl = buf.match(CONTROLLER);
    if (ctrl) {
      base = ctrl[1] ?? ctrl[2] ?? '';
      // A guard above @Controller is class-level; keep it in the block for the class line.
      block.push(buf);
      buf = '';
      continue;
    }
    block.push(buf);
    buf = '';
  }
  return found;
}

const ROUTES: Route[] = sourceFiles(SRC).flatMap(routesIn);

describe('every HTTP route is authenticated, or excused in writing', () => {
  test('the API actually exposes routes (the parser found something)', () => {
    // Guards the check itself: a parser that silently matches nothing would make every
    // other assertion here pass forever.
    expect(ROUTES.length).toBeGreaterThan(200);
  });

  test('no route is reachable without an authenticating guard', () => {
    const holes = ROUTES.filter((r) => !r.guarded && !(r.key in PUBLIC_ROUTES))
      .map((r) => `${r.key}  (${r.file}:${r.line})`);
    expect(holes).toEqual([]);
  });

  test('the public list does not name routes that no longer exist', () => {
    const live = new Set(ROUTES.map((r) => r.key));
    expect(Object.keys(PUBLIC_ROUTES).filter((k) => !live.has(k))).toEqual([]);
  });

  test('nothing is excused that is already guarded', () => {
    // A route that gained a guard should leave the list, or the list stops meaning
    // "these are the ways in".
    const guarded = new Set(ROUTES.filter((r) => r.guarded).map((r) => r.key));
    expect(Object.keys(PUBLIC_ROUTES).filter((k) => guarded.has(k))).toEqual([]);
  });
});
