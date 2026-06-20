'use client';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, getSession } from './api';
import { applyThemeTokens } from './theme';
import {
  type ThemeConfig, type ThemeToken, type ThemeTokens, type ThemePreset,
  resolveTheme, THEME_TOKENS, THEME_PRESET_MODE, DEFAULT_PRESET,
} from './themes';
import {
  type TenantPermissions, type NavKey, type Role,
  DEFAULT_PERMISSIONS, mergePermissions, navForRole,
} from './permissions';

export const MODULE_KEYS = [
  'tickets', 'maintenance', 'reservations', 'audits', 'procurement',
  'depreciation', 'software', 'reports', 'integrations',
] as const;
export type ModuleKey = typeof MODULE_KEYS[number];

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

const DEFAULT_THEME: ThemeConfig = { preset: DEFAULT_PRESET, overrides: {} };

const DEFAULTS: TenantSettings = {
  modules: {
    tickets: true, maintenance: true, reservations: true, audits: true,
    procurement: true, depreciation: true, software: true, reports: true, integrations: true,
  },
  branding: {
    logoUrl: null,
    brandColor: '#a855f7',
    appName: 'AssetMon',
    theme: DEFAULT_THEME,
  },
  permissions: DEFAULT_PERMISSIONS,
};

const Ctx = createContext<TenantSettings>(DEFAULTS);

export function useSettings() { return useContext(Ctx); }
export function useModuleEnabled(m: ModuleKey) { return useSettings().modules[m]; }

/** Returns 'light' or 'dark' for the currently active preset. Pages that
 *  conditionally render dark-mode-only styling can read this. */
export function useThemeMode(): 'light' | 'dark' {
  const s = useSettings();
  return THEME_PRESET_MODE[s.branding.theme.preset] ?? 'light';
}

/** Returns the resolved (preset + overrides) ThemeTokens for the active settings. */
export function useResolvedTheme(): ThemeTokens {
  const s = useSettings();
  return useMemo(
    () => resolveTheme(s.branding.theme?.preset, s.branding.theme?.overrides),
    [s.branding.theme],
  );
}

const CACHE_KEY = 'am.theme.v1';

export function readCachedTheme(): ThemeConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ThemeConfig;
  } catch { return null; }
}

function writeCachedTheme(theme: ThemeConfig) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(theme)); } catch {}
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const q = useQuery<TenantSettings>({
    queryKey: ['tenant-settings'],
    queryFn: () => api('/tenant-settings'),
    staleTime: 30_000,
  });

  // Normalise to the shape `useSettings()` consumers expect. Older payloads
  // (pre-theme, pre-permissions) may not include those fields — defensively backfill.
  const value: TenantSettings = useMemo(() => {
    const d = q.data;
    if (!d) return DEFAULTS;
    return {
      modules: { ...DEFAULTS.modules, ...(d.modules || {}) },
      branding: {
        logoUrl: d.branding?.logoUrl ?? null,
        brandColor: d.branding?.brandColor ?? DEFAULTS.branding.brandColor,
        appName: d.branding?.appName ?? DEFAULTS.branding.appName,
        theme: d.branding?.theme && typeof d.branding.theme === 'object'
          ? {
              preset: (d.branding.theme.preset as ThemePreset) || DEFAULT_PRESET,
              overrides: d.branding.theme.overrides || {},
            }
          : DEFAULT_THEME,
      },
      permissions: mergePermissions(d.permissions),
    };
  }, [q.data]);

  // Push resolved tokens onto `:root` whenever they change, and cache for FOUC
  // prevention on the next paint (read by ThemeBootstrap).
  useEffect(() => {
    const tokens = resolveTheme(value.branding.theme.preset, value.branding.theme.overrides);
    applyThemeTokens(tokens);
    writeCachedTheme(value.branding.theme);
  }, [value.branding.theme]);

  useEffect(() => {
    if (typeof document !== 'undefined') document.title = value.branding.appName;
  }, [value.branding.appName]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export type { ThemeConfig, ThemeToken, ThemeTokens, ThemePreset };
export { THEME_TOKENS };

// ---------------------------------------------------------------------------
// Permissions
//
// `usePermissions()` returns the current user's effective nav map (which
// menu items + settings sub-pages they can see). ADMIN gets everything;
// other roles are filtered by the per-tenant matrix stored alongside other
// branding/modules settings.
// ---------------------------------------------------------------------------
export function useTenantPermissions(): TenantPermissions {
  return useSettings().permissions;
}

export type Permissions = {
  role: Role | undefined;
  isAdmin: boolean;
  canSee: (key: NavKey) => boolean;
  navMap: ReturnType<typeof navForRole>;
};

export function usePermissions(): Permissions {
  const perms = useTenantPermissions();
  const role = (getSession()?.user.role as Role | undefined);
  const navMap = useMemo(() => navForRole(role, perms), [role, perms]);
  return {
    role,
    isAdmin: role === 'ADMIN',
    canSee: (k: NavKey) => !!navMap[k],
    navMap,
  };
}
