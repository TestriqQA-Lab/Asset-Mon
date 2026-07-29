import { req } from '../lib/client.mjs';

// Write-permission probes.
//
// These deliberately send an EMPTY body. NestJS runs guards before validation
// pipes, so a properly guarded route answers 403 before it ever looks at the
// payload — which means these probes prove the guard without creating,
// modifying or deleting anything. A 400 here is itself a finding: it means the
// request got past the guard and was rejected by validation instead.

const NOWHERE = '00000000-0000-4000-8000-000000000000';

// [method, path, lowest role allowed]
const WRITES = [
  ['POST', '/assets', 'manager'],
  ['PATCH', `/assets/${NOWHERE}`, 'manager'],
  ['DELETE', `/assets/${NOWHERE}`, 'manager'],
  ['POST', '/categories', 'manager'],
  ['PATCH', `/categories/${NOWHERE}`, 'manager'],
  ['DELETE', `/categories/${NOWHERE}`, 'manager'],
  ['POST', '/departments', 'manager'],
  ['DELETE', `/departments/${NOWHERE}`, 'manager'],
  ['POST', '/locations', 'manager'],
  ['POST', '/vendors', 'manager'],
  ['POST', '/licenses', 'manager'],
  ['POST', '/software', 'manager'],
  ['POST', '/maintenance', 'manager'],
  ['POST', '/purchase-requests', 'manager'],
  ['POST', '/purchase-orders', 'manager'],
  ['POST', '/audit-sessions', 'manager'],
  ['POST', '/asset-status-defs', 'manager'],
  ['PATCH', `/asset-status-defs/${NOWHERE}`, 'manager'],
  ['DELETE', `/asset-status-defs/${NOWHERE}`, 'admin'],
  ['POST', '/users', 'admin'],
  ['DELETE', `/users/${NOWHERE}`, 'admin'],
  ['PATCH', '/tenant-settings/modules', 'admin'],
  ['PATCH', '/tenant-settings/branding', 'admin'],
  ['PATCH', '/tenant-settings/permissions', 'admin'],
  ['POST', '/audit/rebuild', 'admin'],
  ['POST', '/workspace-invite/rotate', 'admin'],
  ['POST', '/workspace-invite/disable', 'admin'],
];

const RANK = { employee: 0, manager: 1, admin: 2 };

export async function run(report, t) {
  report.suite('Write permissions — refused for roles below the bar');

  for (const [method, path, lowest] of WRITES) {
    for (const role of ['employee', 'manager']) {
      if (RANK[role] >= RANK[lowest]) continue; // allowed — covered by the lifecycle suite
      const res = await req(method, path, { token: t[role].token, body: {} });
      const label = `${role} ${method} ${path.replace(NOWHERE, ':id')} refused`;
      if (res.status === 400) {
        report.fail(label, `got 400 — the guard let this through and validation stopped it instead`);
      } else {
        report.status(label, res, 403);
      }
    }
  }

  report.suite('Write permissions — unauthenticated writes refused');
  for (const [method, path] of WRITES.slice(0, 8)) {
    report.status(`anon ${method} ${path.replace(NOWHERE, ':id')} refused`, await req(method, path, { body: {} }), 401);
  }
}
