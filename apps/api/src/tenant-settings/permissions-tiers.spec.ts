import {
  mergePermissions, navForRole, GRANTABLE_NAV_KEYS, ALWAYS_ON_NAV_KEYS, NAV_KEYS,
} from './tenant-settings.types';

// Guard-rail for the strict-RBAC tiers (Phase 1). If someone adds a key to the
// admin-only set or fat-fingers the merge, these fail loudly.
describe('permission tiers (strict RBAC)', () => {
  it('forces admin-only keys OFF for lower roles even when the stored matrix says true', () => {
    const p = mergePermissions({
      ASSET_MANAGER: { nav: { 'settings:billing': true, 'api-keys': true, 'admin-home': true, 'audit-log': true } },
      EMPLOYEE: { nav: { 'settings:billing': true, 'webhooks': true } },
    });
    expect(p.ASSET_MANAGER.nav['settings:billing']).toBe(false);
    expect(p.ASSET_MANAGER.nav['api-keys']).toBe(false);
    expect(p.ASSET_MANAGER.nav['admin-home']).toBe(false);
    expect(p.ASSET_MANAGER.nav['audit-log']).toBe(false);
    expect(p.EMPLOYEE.nav['settings:billing']).toBe(false);
    expect(p.EMPLOYEE.nav['webhooks']).toBe(false);
  });

  it('forces always-on keys ON even when the stored matrix says false', () => {
    const p = mergePermissions({
      ASSET_MANAGER: { nav: { 'settings:security': false, dashboard: false } },
      EMPLOYEE: { nav: { 'settings:security': false, dashboard: false } },
    });
    for (const role of ['ASSET_MANAGER', 'EMPLOYEE'] as const) {
      for (const k of ALWAYS_ON_NAV_KEYS) expect(p[role].nav[k]).toBe(true);
    }
  });

  it('respects stored toggles for grantable keys', () => {
    const on = mergePermissions({ ASSET_MANAGER: { nav: { software: true } } });
    const off = mergePermissions({ ASSET_MANAGER: { nav: { software: false } } });
    expect(on.ASSET_MANAGER.nav.software).toBe(true);
    expect(off.ASSET_MANAGER.nav.software).toBe(false);
  });

  it('ADMIN always sees every nav key', () => {
    const nav = navForRole('ADMIN', mergePermissions({}));
    for (const k of NAV_KEYS) expect(nav[k]).toBe(true);
  });

  it('every grantable/always-on key is a real nav key (no typos)', () => {
    for (const k of GRANTABLE_NAV_KEYS) expect(NAV_KEYS).toContain(k);
    for (const k of ALWAYS_ON_NAV_KEYS) expect(NAV_KEYS).toContain(k);
  });
});
