export const MODULE_KEYS = [
  'tickets',
  'maintenance',
  'reservations',
  'audits',
  'procurement',
  'depreciation',
  'software',
  'reports',
  'integrations',
] as const;
export type ModuleKey = typeof MODULE_KEYS[number];

// ---------------------------------------------------------------------------
// Role-based access control
//
// Three built-in roles:
//   ADMIN          - workspace owner; always full access (never customisable)
//   ASSET_MANAGER  - ops staff who run inventory + tickets + procurement
//   EMPLOYEE       - everyone else; self-service (their assignments + raise tickets)
//
// Customisation surface: per-tenant overrides for ASSET_MANAGER and EMPLOYEE.
// ADMIN entries are NOT stored — they are always implicitly `true`.
//
// Nav keys map 1:1 to a navigation menu item or a settings sub-page. Hiding a
// nav key both removes the menu item from the UI and 403s on the matching
// API surface (defence in depth via `@RequireNav`).
//
// Keep this list in sync with `apps/web/src/lib/permissions.ts` — the union is
// shared between layers by simple duplication (no internal package boundary).
// ---------------------------------------------------------------------------
export const ROLES = ['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE'] as const;
export type Role = typeof ROLES[number];

/** Roles whose permissions tenants can edit. ADMIN is always full and immutable. */
export const CUSTOMISABLE_ROLES = ['ASSET_MANAGER', 'EMPLOYEE'] as const;
export type CustomisableRole = typeof CUSTOMISABLE_ROLES[number];

export const NAV_KEYS = [
  // Overview
  'dashboard',
  'reports',
  // Inventory
  'assets',
  'categories',
  'locations',
  'departments',
  // Lifecycle
  'tickets',
  'maintenance',
  'reservations',
  'audit-sessions',
  'asset-requests',
  // Finance
  'purchase-requests',
  'purchase-orders',
  'depreciation',
  // Software
  'software',
  'licenses',
  // People
  'users',
  // Integrations
  'api-keys',
  'webhooks',
  'audit-log',
  // Support
  'get-help',
  // Governance
  'data-quality',
  // Admin home (ADMIN-only page; never granted to other roles, so not in any
  // DEFAULT_*_NAV — ADMIN sees everything via ALL_NAV)
  'admin-home',
  // Settings sub-pages
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

/**
 * Sensible defaults. Tenants may override either role's `nav` map; we always
 * union back to the full key set so newly-added nav items default to "off" for
 * non-admin roles (safe-by-default).
 */
export const DEFAULT_ASSET_MANAGER_NAV: NavMap = navOnly([
  'dashboard', 'reports',
  'assets', 'categories', 'locations', 'departments',
  'tickets', 'maintenance', 'reservations', 'audit-sessions',
  'asset-requests',
  'purchase-requests', 'purchase-orders', 'depreciation',
  'software', 'licenses',
  'users',
  'data-quality',
  'settings:security', 'settings:statuses',
]);

export const DEFAULT_EMPLOYEE_NAV: NavMap = navOnly([
  'dashboard',
  'assets',           // own assignments view
  'tickets',          // raise + view own
  'reservations',     // request + view own
  'asset-requests',   // request + view own
  'settings:security',
]);

export const DEFAULT_PERMISSIONS: TenantPermissions = {
  ASSET_MANAGER: { nav: DEFAULT_ASSET_MANAGER_NAV },
  EMPLOYEE:      { nav: DEFAULT_EMPLOYEE_NAV },
};

export function isCustomisableRole(r: unknown): r is CustomisableRole {
  return typeof r === 'string' && (CUSTOMISABLE_ROLES as readonly string[]).includes(r);
}

export function isNavKey(k: unknown): k is NavKey {
  return typeof k === 'string' && (NAV_KEYS as readonly string[]).includes(k);
}

/** Returns the effective nav map for a given role, applying ADMIN always-true. */
export function navForRole(role: Role | string, perms: TenantPermissions): NavMap {
  if (role === 'ADMIN') return ALL_NAV;
  if (isCustomisableRole(role)) return perms[role].nav;
  // Unknown role: treat as zero permissions.
  return navOnly([]);
}

/**
 * Strict role tiers (Phase 1 RBAC). ONLY these keys may be toggled per role via the
 * Permissions page. Everything not here and not ALWAYS_ON is admin-only and is forced
 * OFF for ASSET_MANAGER/EMPLOYEE by mergeRolePerm — so a stale or hand-crafted stored
 * matrix can never grant a lower role an admin-only page. Keep in sync with the web copy
 * `apps/web/src/lib/permissions.ts`.
 */
export const GRANTABLE_NAV_KEYS: ReadonlySet<NavKey> = new Set<NavKey>([
  'assets', 'categories', 'locations', 'departments',
  'tickets', 'maintenance', 'reservations', 'audit-sessions',
  'asset-requests',
  'purchase-requests', 'purchase-orders', 'depreciation',
  'software', 'licenses', 'reports', 'data-quality',
  'settings:statuses', 'users', // users = read-only page for lower roles (writes stay admin-only)
]);
/** Always visible to every role — forced ON regardless of the stored matrix. */
export const ALWAYS_ON_NAV_KEYS: ReadonlySet<NavKey> = new Set<NavKey>([
  'dashboard', 'settings:security',
]);

/** Defensive merge of stored permissions — keeps the matrix well-formed AND strictly tiered. */
function mergeRolePerm(stored: any, fallback: NavMap): RolePermissions {
  const nav: NavMap = { ...fallback };
  const raw = stored && stored.nav && typeof stored.nav === 'object' ? stored.nav : null;
  if (raw) {
    for (const k of NAV_KEYS) {
      if (typeof raw[k] === 'boolean') nav[k] = raw[k];
    }
  }
  // Strict tiers: always-on forced true (incl. settings:security = per-user 2FA);
  // any non-grantable (admin-only) key forced false for ASSET_MANAGER/EMPLOYEE.
  for (const k of NAV_KEYS) {
    if (ALWAYS_ON_NAV_KEYS.has(k)) nav[k] = true;
    else if (!GRANTABLE_NAV_KEYS.has(k)) nav[k] = false;
  }
  return { nav };
}

export function mergePermissions(stored: any): TenantPermissions {
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    ASSET_MANAGER: mergeRolePerm(s.ASSET_MANAGER, DEFAULT_ASSET_MANAGER_NAV),
    EMPLOYEE:      mergeRolePerm(s.EMPLOYEE,      DEFAULT_EMPLOYEE_NAV),
  };
}

/**
 * Canonical theme tokens — keep in sync with `apps/web/src/lib/themes.ts`.
 *
 * These short identifiers are the JSON-serialised form. When the web layer
 * emits them to the DOM, they become `--am-color-<token>` CSS custom
 * properties; the user spec talks about the tokens in that full CSS-variable
 * form, but the wire format stays compact.
 */
export const THEME_TOKENS = [
  'bg',
  'surface',
  'surface-muted',
  'border',
  'text',
  'text-muted',
  'heading',
  'link',
  'primary',
  'primary-fg',
  'accent',
  'success',
  'warning',
  'danger',
  'info',
  'data',
] as const;
export type ThemeToken = typeof THEME_TOKENS[number];

export const PRESET_IDS = [
  'default',
  'slate',
  'emerald',
  'azure',
  'violet',
  'amber',
  'rose',
  'teal',
  'midnight',
  'monochrome',
] as const;
export type PresetId = typeof PRESET_IDS[number];
// Alias kept for older callers — same union, prettier name.
export type ThemePreset = PresetId;
export const THEME_PRESET_NAMES = PRESET_IDS;

export type ThemeConfig = {
  preset: PresetId;
  overrides: Partial<Record<ThemeToken, string>>;
};
export type TenantTheme = ThemeConfig;

export type TenantSettings = {
  modules: Record<ModuleKey, boolean>;
  branding: {
    logoUrl: string | null;
    brandColor: string;
    appName: string;
    theme: ThemeConfig;
  };
  permissions: TenantPermissions;
};

export const DEFAULT_THEME: ThemeConfig = {
  preset: 'default',
  overrides: {},
};

export const DEFAULT_SETTINGS: TenantSettings = {
  modules: {
    tickets: true,
    maintenance: true,
    reservations: true,
    audits: true,
    procurement: true,
    depreciation: true,
    software: true,
    reports: true,
    integrations: true,
  },
  branding: {
    logoUrl: null,
    brandColor: '#4f46e5',
    appName: 'AssetMon',
    theme: DEFAULT_THEME,
  },
  permissions: DEFAULT_PERMISSIONS,
};

const HEX_RE = /^#[0-9a-f]{6}$/i;
export function isHex(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v);
}

/** Defensive merge — keeps theme well-formed regardless of stored shape. */
function mergeTheme(stored: any): ThemeConfig {
  const preset: PresetId =
    stored && (PRESET_IDS as readonly string[]).includes(stored.preset) ? stored.preset : DEFAULT_THEME.preset;
  const rawOverrides =
    stored && stored.overrides && typeof stored.overrides === 'object' ? stored.overrides : {};
  const overrides: Partial<Record<ThemeToken, string>> = {};
  for (const k of THEME_TOKENS) {
    const v = rawOverrides[k];
    if (typeof v === 'string' && HEX_RE.test(v)) overrides[k] = v.toLowerCase();
  }
  return { preset, overrides };
}

export function mergeSettings(stored: any): TenantSettings {
  const s = stored && typeof stored === 'object' ? stored : {};
  const b = s.branding && typeof s.branding === 'object' ? s.branding : {};
  return {
    modules: { ...DEFAULT_SETTINGS.modules, ...(s.modules || {}) },
    branding: {
      logoUrl: typeof b.logoUrl === 'string' ? b.logoUrl : null,
      brandColor:
        typeof b.brandColor === 'string' && /^#[0-9a-f]{3,8}$/i.test(b.brandColor)
          ? b.brandColor
          : DEFAULT_SETTINGS.branding.brandColor,
      appName:
        typeof b.appName === 'string' && b.appName.length > 0 ? b.appName : DEFAULT_SETTINGS.branding.appName,
      theme: mergeTheme(b.theme),
    },
    permissions: mergePermissions(s.permissions),
  };
}
