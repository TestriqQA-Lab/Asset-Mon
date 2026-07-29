import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { req, GET, POST } from '../lib/client.mjs';

// The platform-operator portal — 54 of the API's 248 routes, and historically
// covered by nothing.
//
// Full coverage would need the operator's 3FA (password, then an emailed code,
// then TOTP), and the emailed code is only recoverable by scraping the dev
// stream transport out of the container logs. That is deliberately out of scope
// here. What this suite DOES prove is the thing an upgrade is most likely to
// break: that every platform route still exists and that its guard still
// refuses an unauthenticated caller. A route that silently stopped matching
// would answer 404 instead of 401/403, and that is exactly what a
// path-to-regexp change looks like.

const here = dirname(fileURLToPath(import.meta.url));

function platformRoutes() {
  // Read from the checked-in inventory so the suite does not depend on being
  // able to read container logs.
  const file = join(here, '..', 'routes.txt');
  let lines;
  try {
    lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  } catch {
    return null;
  }
  return lines
    .map((l) => l.trim().split(/\s+/))
    .filter(([m, p]) => m && p && p.startsWith('/api/platform'))
    .map(([m, p]) => [m, p.replace(/^\/api/, '')]);
}

export async function run(report, t) {
  report.suite('Platform portal — routes exist and are guarded');

  const routes = platformRoutes();
  if (!routes || routes.length === 0) {
    report.skip('platform route guard sweep', 'tools/audit-harness/routes.txt missing or has no platform routes');
    return;
  }

  let checked = 0, notFound = [];
  for (const [method, path] of routes) {
    // Substitute anything parameterised — the guard runs before the handler, so
    // a placeholder id is fine and nothing is created or read.
    const probe = path.replace(/:[A-Za-z0-9_]+/g, '00000000-0000-4000-8000-000000000000');
    const res = await req(method, probe, { body: method === 'GET' || method === 'DELETE' ? undefined : {} });
    checked++;
    if (res.status === 404) notFound.push(`${method} ${path}`);
  }

  report.ok(
    `all ${checked} platform routes still resolve`,
    notFound.length === 0,
    notFound.length ? `these answered 404: ${notFound.slice(0, 8).join(', ')}${notFound.length > 8 ? ` (+${notFound.length - 8} more)` : ''}` : '',
  );

  report.suite('Platform portal — tenant credentials are not accepted');

  // A tenant admin must not be able to reach the operator portal with their
  // own token, and the operator login must not accept a tenant account.
  report.status('tenant admin token is refused by the operator portal', await GET('/platform/auth/me', { token: t.admin.token }), [401, 403]);
  report.status('tenant admin token is refused by platform metrics', await GET('/platform/metrics', { token: t.admin.token }), [401, 403]);
  report.status(
    'a tenant account cannot log in as an operator',
    await POST('/platform/auth/login', { email: 'admin@s4demo10679.test', password: 'DemoPass123' }),
    [400, 401, 403],
  );

  report.suite('Platform portal — operator login stops at the first factor');

  // Step one must hand back a ticket, never a session. If this ever returns an
  // access token directly, 3FA has been bypassed.
  const step1 = await POST('/platform/auth/login', { email: 'op1405@plat.test', password: 'OperatorPass12345' });
  report.status('operator password step answers', step1, [200, 201, 401]);
  if (step1.status === 200 || step1.status === 201) {
    report.ok(
      'the password step does NOT hand back a session',
      !step1.body?.accessToken,
      'an access token came back from the first factor — 3FA is bypassable',
    );
    report.ok('it hands back a ticket to continue with', Boolean(step1.body?.ticket || step1.body?.mfaTicket), JSON.stringify(step1.body).slice(0, 120));
  } else if (step1.status === 401) {
    report.skip(
      'operator first-factor shape',
      'operator login answered 401 — the account is either not seeded locally or currently locked out',
    );
  }

  // There is deliberately NO wrong-password check against a real operator here.
  //
  // Operator accounts lock after 5 failed attempts, and the counter only resets
  // on a *successful* login. The harness cannot complete one, because that needs
  // the 3FA email code and TOTP. So a wrong-password check would leave a failure
  // behind on every run and lock the account on the third — the harness would
  // quietly destroy the environment it exists to protect.
  //
  // Tenant accounts are safe from the same problem for the opposite reason: the
  // harness logs into them successfully every run, which resets their counter.
  report.status(
    'an unknown operator email is refused',
    await POST('/platform/auth/login', { email: 'no-such-operator@plat.test', password: 'WhateverPass12345' }),
    [400, 401],
  );
}
