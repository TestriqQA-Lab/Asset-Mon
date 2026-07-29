import { GET } from '../lib/client.mjs';

// The read-access matrix, discovered against the live API and then reviewed
// against the role model rather than simply recorded. Each group below is an
// intent ("who is this for?"), not just an observation — so if the upgrade
// changes who can read what, the failure names the intent that broke.
//
// Employees deliberately keep /assets, /categories and /asset-status-defs:
// their own asset rows need the category NAME to render, so a hard block there
// would break the employee list view. See the trimming in categories.service.

export const EVERYONE = [
  '/announcements',
  '/asset-requests',
  '/asset-requests/stats',
  '/assets',
  '/asset-status-defs',
  '/billing',
  '/categories',
  '/dashboard/stats',
  '/health',
  '/me',
  '/me/2fa',
  '/me/mfa',
  '/notifications',
  '/notifications/count',
  '/reservations',
  '/saved-views',
  '/tenant-settings',
  '/tickets',
];

export const MANAGER_UP = [
  '/asset-requests/demand',
  '/assets/export.csv',
  '/audit-sessions',
  '/dashboard/alerts',
  '/data-quality',
  '/departments',
  '/depreciation/fleet',
  '/licenses',
  '/licenses/compliance',
  '/locations',
  '/locations/tree',
  '/maintenance',
  '/purchase-orders',
  '/purchase-requests',
  '/reports',
  '/search',
  '/software',
  '/users',
  '/vendors',
];

export const ADMIN_ONLY = [
  '/audit',
  '/audit/verify',
  '/metrics',
  '/support',
  '/support/unread-count',
  '/workspace-invite',
];

// Gated by the `integrations` module, which is OFF in this workspace. A 403 for
// *every* role including admin is the correct answer here — the module guard
// runs before the role guard.
export const MODULE_GATED_OFF = ['/api-keys', '/webhooks'];

export async function run(report, t) {
  report.suite('RBAC — reads every role may make');
  for (const path of EVERYONE) {
    for (const role of ['admin', 'manager', 'employee']) {
      report.status(`${role} GET ${path}`, await GET(path, { token: t[role].token }), 200);
    }
  }

  report.suite('RBAC — manager and above only');
  for (const path of MANAGER_UP) {
    report.status(`admin GET ${path}`, await GET(path, { token: t.admin.token }), 200);
    report.status(`manager GET ${path}`, await GET(path, { token: t.manager.token }), 200);
    report.status(`employee GET ${path} refused`, await GET(path, { token: t.employee.token }), 403);
  }

  report.suite('RBAC — admin only');
  for (const path of ADMIN_ONLY) {
    report.status(`admin GET ${path}`, await GET(path, { token: t.admin.token }), 200);
    report.status(`manager GET ${path} refused`, await GET(path, { token: t.manager.token }), 403);
    report.status(`employee GET ${path} refused`, await GET(path, { token: t.employee.token }), 403);
  }

  report.suite('RBAC — disabled module blocks everyone');
  for (const path of MODULE_GATED_OFF) {
    for (const role of ['admin', 'manager', 'employee']) {
      report.status(`${role} GET ${path} blocked by module gate`, await GET(path, { token: t[role].token }), 403);
    }
  }
}
