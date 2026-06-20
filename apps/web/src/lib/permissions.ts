/**
 * Role-based access — client side. Mirrors the backend's
 * `apps/api/src/tenant-settings/tenant-settings.types.ts` (keep in sync).
 *
 * Three built-in roles:
 *   - ADMIN          : workspace owner, always full access.
 *   - ASSET_MANAGER  : day-to-day ops (inventory, tickets, procurement, …).
 *   - EMPLOYEE       : self-service (own assignments, raise tickets).
 *
 * ADMIN entries are NOT customisable. Tenants override per-role nav visibility
 * via `Settings → Permissions`.
 *
 * Hiding a nav key:
 *   - removes the menu item from the dashboard chrome (and the user menu)
 *   - 403s on the matching API surface via `@RequireNav` (defence in depth)
 */

export const ROLES = ['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE'] as const;
export type Role = typeof ROLES[number];

export const CUSTOMISABLE_ROLES = ['ASSET_MANAGER', 'EMPLOYEE'] as const;
export type CustomisableRole = typeof CUSTOMISABLE_ROLES[number];

export const NAV_KEYS = [
  'dashboard',
  'reports',
  'assets',
  'categories',
  'locations',
  'departments',
  'tickets',
  'maintenance',
  'reservations',
  'audit-sessions',
  'purchase-requests',
  'purchase-orders',
  'depreciation',
  'software',
  'licenses',
  'users',
  'api-keys',
  'webhooks',
  'audit-log',
  'settings:branding',
  'settings:modules',
  'settings:statuses',
  'settings:security',
  'settings:billing',
  'settings:permissions',
] as const;
export type NavKey = typeof NAV_KEYS[number];

export type NavMap = Record<NavKey, boolean>;
export type RolePermissions = { nav: NavMap };
export type TenantPermissions = Record<CustomisableRole, RolePermissions>;

const ALL_NAV: NavMap = NAV_KEYS.reduce((m, k) => { m[k] = true; return m; }, {} as NavMap);

function navOnly(allowed: readonly NavKey[]): NavMap {
  const m = NAV_KEYS.reduce((acc, k) => { acc[k] = false; return acc; }, {} as NavMap);
  for (const k of allowed) m[k] = true;
  return m;
}

export const DEFAULT_ASSET_MANAGER_NAV: NavMap = navOnly([
  'dashboard', 'reports',
  'assets', 'categories', 'locations', 'departments',
  'tickets', 'maintenance', 'reservations', 'audit-sessions',
  'purchase-requests', 'purchase-orders', 'depreciation',
  'software', 'licenses',
  'users',
  'audit-log',
  'settings:security', 'settings:statuses',
]);

export const DEFAULT_EMPLOYEE_NAV: NavMap = navOnly([
  'dashboard',
  'assets',
  'tickets',
  'reservations',
  'settings:security',
]);

export const DEFAULT_PERMISSIONS: TenantPermissions = {
  ASSET_MANAGER: { nav: DEFAULT_ASSET_MANAGER_NAV },
  EMPLOYEE:      { nav: DEFAULT_EMPLOYEE_NAV },
};

export function isCustomisableRole(r: unknown): r is CustomisableRole {
  return typeof r === 'string' && (CUSTOMISABLE_ROLES as readonly string[]).includes(r);
}

export function navForRole(role: Role | string | undefined, perms: TenantPermissions | undefined): NavMap {
  if (role === 'ADMIN') return ALL_NAV;
  if (!perms) return navOnly([]); // safe default: no perms = nothing visible
  if (isCustomisableRole(role)) return perms[role].nav;
  return navOnly([]);
}

/** Defensive merge — drops unknown keys, ensures booleans, forces settings:security on. */
function mergeRolePerm(stored: any, fallback: NavMap): RolePermissions {
  const nav: NavMap = { ...fallback };
  const raw = stored && stored.nav && typeof stored.nav === 'object' ? stored.nav : null;
  if (raw) {
    for (const k of NAV_KEYS) {
      if (typeof raw[k] === 'boolean') nav[k] = raw[k];
    }
  }
  nav['settings:security'] = true;
  return { nav };
}

export function mergePermissions(stored: any): TenantPermissions {
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    ASSET_MANAGER: mergeRolePerm(s.ASSET_MANAGER, DEFAULT_ASSET_MANAGER_NAV),
    EMPLOYEE:      mergeRolePerm(s.EMPLOYEE,      DEFAULT_EMPLOYEE_NAV),
  };
}

/** Human-readable labels for the Permissions admin matrix. */
export const NAV_LABELS: Record<NavKey, string> = {
  'dashboard':            'Dashboard',
  'reports':              'Reports',
  'assets':               'Assets',
  'categories':           'Categories',
  'locations':            'Locations',
  'departments':          'Departments',
  'tickets':              'Service tickets',
  'maintenance':          'Maintenance',
  'reservations':         'Reservations',
  'audit-sessions':       'Physical audits',
  'purchase-requests':    'Purchase requests',
  'purchase-orders':      'Purchase orders',
  'depreciation':         'Depreciation',
  'software':             'Software',
  'licenses':             'Licenses',
  'users':                'Users & invites',
  'api-keys':             'API keys',
  'webhooks':             'Webhooks',
  'audit-log':            'Audit log',
  'settings:branding':    'Branding',
  'settings:modules':     'Modules',
  'settings:statuses':    'Asset statuses',
  'settings:security':    'Security (2FA)',
  'settings:billing':     'Billing',
  'settings:permissions': 'Permissions',
};

/** Grouping used in both the dashboard nav and the permissions matrix. */
export const NAV_GROUPS: Array<{ label: string; keys: NavKey[] }> = [
  { label: 'Overview',  keys: ['dashboard', 'reports'] },
  { label: 'Inventory', keys: ['assets', 'categories', 'locations', 'departments', 'software', 'licenses'] },
  { label: 'Lifecycle', keys: ['tickets', 'maintenance', 'reservations', 'audit-sessions'] },
  { label: 'Finance',   keys: ['purchase-requests', 'purchase-orders', 'depreciation'] },
  { label: 'Settings',  keys: [
    'users',
    'settings:branding', 'settings:modules', 'settings:statuses', 'settings:permissions',
    'settings:security', 'settings:billing',
    'api-keys', 'webhooks', 'audit-log',
  ] },
];

/**
 * Nav keys that are never editable per-role, regardless of who's looking.
 * `settings:security` hosts the per-user 2FA flow so it must always be reachable.
 * `settings:permissions` is the ADMIN-only RBAC manager itself.
 */
export const LOCKED_NAV_KEYS: ReadonlySet<NavKey> = new Set<NavKey>([
  'settings:security',
  'settings:permissions',
]);
