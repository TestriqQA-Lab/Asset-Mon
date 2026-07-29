'use client';
import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, getSession, logout } from '@/lib/api';
import { SettingsProvider, useSettings, usePermissions, type ModuleKey } from '@/lib/settings';
import { CommandPalette } from '@/components/CommandPalette';
import { NotificationsBell } from '@/components/NotificationsBell';
import { AnnouncementBanner } from '@/components/AnnouncementBanner';
import { THEME_PRESETS, tokensToCss } from '@/lib/themes';
import type { NavKey } from '@/lib/permissions';
import { SETTINGS_ITEMS } from '@/lib/settings-nav';
import { EmptyState, cn } from '@/components/ui';
import {
  LayoutDashboard, Package,
  Wrench, CalendarClock, ShoppingCart, FileText, TrendingDown,
  ClipboardCheck, BarChart3, ListChecks,
  Settings, LogOut, ChevronDown, Search,
  Palette, ShieldCheck, Menu, X, Lock, LifeBuoy, PanelLeftClose,
  HandHelping,
} from 'lucide-react';

/** A page. Leaf of the nav tree. */
type NavLeaf = {
  href: string;
  label: string;
  navKey: NavKey;
  module?: ModuleKey;
  /** Shown to employees instead of `label` — they meet this app rarely and think in
   *  plain words, not system nouns ("Get help", not "Service tickets"). */
  employeeLabel?: string;
  /** Rendered only for employees (e.g. "My assets", which managers don't need). */
  employeeOnly?: boolean;
};

/**
 * A function. Either a direct link (no children) or a parent that expands to reveal
 * its pages. A parent left with a single visible child after permission filtering is
 * rendered as a direct link — a dropdown that opens to show one item is just friction.
 */
type NavFunction = {
  id: string;
  label: string;
  icon: React.ReactNode;
  employeeLabel?: string;
  children: NavLeaf[];
};

/**
 * Sidebar navigation as functions with their pages beneath them, ordered by how often
 * something is needed rather than by how the data is modelled. Workspace settings are
 * not here — they live behind the gear icon.
 */
const NAV: NavFunction[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: <LayoutDashboard className="h-4 w-4" />,
    employeeLabel: 'Home',
    children: [
      { href: '/dashboard', label: 'Dashboard', navKey: 'dashboard', employeeLabel: 'Home' },
    ],
  },
  {
    id: 'requests',
    label: 'Requests',
    icon: <HandHelping className="h-4 w-4" />,
    employeeLabel: 'Ask for something',
    children: [
      { href: '/dashboard/asset-requests', label: 'Asset requests', navKey: 'asset-requests', employeeLabel: 'Ask for something' },
      { href: '/dashboard/purchase-requests', label: 'Purchase requests', navKey: 'purchase-requests', module: 'procurement' },
    ],
  },
  {
    id: 'servicing',
    label: 'Servicing',
    icon: <Wrench className="h-4 w-4" />,
    employeeLabel: 'Help & bookings',
    children: [
      { href: '/dashboard/tickets', label: 'Service tickets', navKey: 'tickets', module: 'tickets', employeeLabel: 'Get help' },
      { href: '/dashboard/maintenance', label: 'Maintenance', navKey: 'maintenance', module: 'maintenance' },
      { href: '/dashboard/reservations', label: 'Reservations', navKey: 'reservations', module: 'reservations', employeeLabel: 'Bookings' },
      { href: '/dashboard/audit-sessions', label: 'Physical audits', navKey: 'audit-sessions', module: 'audits' },
    ],
  },
  {
    id: 'assets',
    label: 'Assets',
    icon: <Package className="h-4 w-4" />,
    children: [
      // Categories, departments, statuses, software and licences classify or configure
      // assets, so they are pages *within* the Assets function rather than peers of it.
      // Locations was removed from the product UI entirely.
      { href: '/dashboard/assets', label: 'All assets', navKey: 'assets' },
      // Employee-only: the same page filtered to what they hold. Managers already have
      // richer filtering, so this would be noise for them.
      { href: '/dashboard/assets?assignedToMe=1', label: 'My assets', navKey: 'assets', employeeOnly: true },
      { href: '/dashboard/categories', label: 'Categories', navKey: 'categories' },
      { href: '/dashboard/departments', label: 'Departments', navKey: 'departments' },
      { href: '/dashboard/settings/statuses', label: 'Statuses', navKey: 'settings:statuses' },
      { href: '/dashboard/software', label: 'Software', navKey: 'software', module: 'software' },
      { href: '/dashboard/licenses', label: 'Licences', navKey: 'licenses', module: 'software' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: <ShoppingCart className="h-4 w-4" />,
    children: [
      { href: '/dashboard/purchase-orders', label: 'Purchase orders', navKey: 'purchase-orders', module: 'procurement' },
      { href: '/dashboard/depreciation', label: 'Depreciation', navKey: 'depreciation', module: 'depreciation' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: <BarChart3 className="h-4 w-4" />,
    children: [
      { href: '/dashboard/reports', label: 'Reports', navKey: 'reports', module: 'reports' },
      { href: '/dashboard/data-quality', label: 'Data quality', navKey: 'data-quality' },
    ],
  },
  // NOTE: neither 'Get help' nor 'Settings' is a nav function.
  //   - Get help is a help icon in the top-right utility area.
  //   - Workspace configuration lives at /dashboard/settings behind the gear icon;
  //     those items are in SETTINGS_GROUPS (lib/settings-nav) and are still folded into
  //     the page-level access gate below via SETTINGS_ITEMS.
];

// Server-render the `default` preset's CSS variables on `:root` so the first
// paint already has a sensible palette (no flash of unstyled content). The
// SettingsProvider re-applies the resolved tenant theme as soon as the
// `/tenant-settings` query lands. We can't SSR the *tenant's* theme here
// because auth is held in localStorage, not in a cookie the server can read.
//
// `tokensToCss` already wraps with `:root { … }`, so don't double-wrap.
const SSR_DEFAULT_THEME_CSS = tokensToCss(THEME_PRESETS.default, 'light');

export default function DashboardLayoutOuter({ children }: { children: React.ReactNode }) {
  const r = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!getSession()) r.replace('/login'); else setReady(true);
  }, [r]);
  if (!ready) return null;
  return (
    <>
      <style id="am-theme-ssr" dangerouslySetInnerHTML={{ __html: SSR_DEFAULT_THEME_CSS }} />
      <SettingsProvider>
        <Shell>{children}</Shell>
      </SettingsProvider>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const r = useRouter();
  const path = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams?.toString() || '';
  const session = getSession();
  const settings = useSettings();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [path]);

  // Lock background scroll while the mobile drawer is open so iOS doesn't keep
  // bouncing the page underneath.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobileOpen]);

  const initials = ((session?.user.email || '?').charAt(0)).toUpperCase();
  const isAdmin = session?.user.role === 'ADMIN';
  const supportUnread = useQuery({
    queryKey: ['support-unread'],
    queryFn: () => api<{ count: number }>('/support/unread-count'),
    enabled: isAdmin,
    refetchInterval: 30_000,
  }).data?.count || 0;
  const logoUrl = settings.branding.logoUrl
    ? `${process.env.NEXT_PUBLIC_API_URL}${settings.branding.logoUrl}`
    : null;

  // Sidebar collapse. Persisted so the choice survives navigation and reloads, and
  // read in an effect rather than during render to avoid a hydration mismatch.
  const [navCollapsed, setNavCollapsed] = useState(false);
  useEffect(() => {
    try { setNavCollapsed(localStorage.getItem('am.navCollapsed') === '1'); } catch {}
  }, []);
  const toggleNav = useCallback(() => {
    setNavCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem('am.navCollapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  // Cmd/Ctrl+B — the shortcut people already know from VS Code and Slack.
  const [shortcutHint, setShortcutHint] = useState('Ctrl+');
  useEffect(() => {
    const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
    setShortcutHint(mac ? '⌘' : 'Ctrl+');
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleNav();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleNav]);

  const perms = usePermissions();
  // Role-based nav filter:
  //   - drop pages the user's role can't see (per the tenant permissions matrix)
  //   - drop pages whose backing module is disabled
  //   - drop functions left with no pages
  const visibleNav = useMemo(() => {
    return NAV
      .map((fn) => ({
        ...fn,
        children: fn.children.filter((c) => {
          if (c.module && !settings.modules[c.module]) return false;
          if (c.employeeOnly && perms.role !== 'EMPLOYEE') return false;
          return perms.canSee(c.navKey);
        }),
      }))
      .filter((fn) => fn.children.length > 0);
  }, [perms, settings.modules]);

  // The gear only appears if the role can actually open something in there.
  const canSeeAnySetting = useMemo(
    () => SETTINGS_ITEMS.some((i) => (!i.module || settings.modules[i.module]) && perms.canSee(i.navKey)),
    [perms, settings.modules],
  );

  // Queue counts on the sidebar. Both endpoints already existed, so this needs no new
  // backend. A manager sees the workspace queue; an employee sees only their own
  // tickets, and gets no approval badge because they are not the approver.
  const isEmployee = perms.role === 'EMPLOYEE';
  const navStats = useQuery({
    queryKey: ['nav-stats'],
    queryFn: () => api<any>('/dashboard/stats'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const navRequestStats = useQuery({
    queryKey: ['nav-request-stats'],
    queryFn: () => api<any>('/asset-requests/stats'),
    enabled: !isEmployee && perms.canSee('asset-requests'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const navBadges = useMemo<Partial<Record<NavKey, number>>>(() => ({
    tickets: (isEmployee ? navStats.data?.myOpenTickets : navStats.data?.openTickets) || 0,
    maintenance: isEmployee ? 0 : (navStats.data?.dueMaintenance || 0),
    'asset-requests': navRequestStats.data?.pending || 0,
  }), [isEmployee, navStats.data, navRequestStats.data]);

  // Page-level gate: block direct-URL access to any page the role can't see.
  // Match the current path to its nav item (longest href prefix wins) and, if the
  // role's permission for that key is off, render "Not available" instead of the page.
  // Server endpoints enforce this too (Phase 1A) — this is the UI half.
  const activeNavKey = useMemo<NavKey | undefined>(() => {
    const p = path || '';
    let best: { href: string; navKey: NavKey } | undefined;
    // Settings items are no longer part of NAV, but they must still be gated — omitting
    // them here would leave every settings page ungated on a direct URL visit.
    const candidates = [...NAV.flatMap((fn) => fn.children), ...SETTINGS_ITEMS];
    for (const item of candidates) {
      if (p === item.href || p.startsWith(item.href + '/')) {
        if (!best || item.href.length > best.href.length) best = item;
      }
    }
    return best?.navKey;
  }, [path]);
  const pageBlocked = !!activeNavKey && !perms.canSee(activeNavKey);

  return (
    <div data-themed data-app-shell="dashboard" className="relative flex min-h-screen flex-col bg-ink-50">
      {/* A subtle aurora wash that echoes the landing hero — pointer-events
          ignore clicks; -z-0 sits beneath the header / content. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[360px] overflow-hidden opacity-70">
        <div
          className="absolute -left-32 -top-24 h-[28rem] w-[28rem] rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(circle, rgb(var(--am-color-primary-rgb) / 0.55), transparent 70%)' }}
        />
        <div
          className="absolute -top-24 right-0 h-[26rem] w-[26rem] rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(circle, rgb(var(--am-color-accent-rgb) / 0.55), transparent 70%)' }}
        />
      </div>

      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-ink-900 focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-white">Skip to main content</a>
      <CommandPalette />

      <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/85 backdrop-blur-md">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
          <a href="/dashboard" className="flex items-center gap-2.5">
            {logoUrl ? (
              <img src={logoUrl} alt="logo" className="h-7 max-w-[120px] object-contain" />
            ) : (
              <>
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold shadow-glow"
                  style={{
                    background: 'linear-gradient(135deg, rgb(var(--am-color-primary-rgb)), rgb(var(--am-color-accent-rgb)))',
                    color: 'rgb(var(--am-color-primary-fg-rgb))',
                  }}
                >
                  {settings.branding.appName.charAt(0)}
                </div>
                <div className="hidden flex-col leading-tight sm:flex">
                  <span className="text-sm font-semibold tracking-tight text-ink-900">{settings.branding.appName}</span>
                  <span className="text-[10px] text-ink-500">{session?.tenant.slug}</span>
                </div>
              </>
            )}
          </a>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => { const ev = new KeyboardEvent('keydown', { key: 'k', metaKey: true }); window.dispatchEvent(ev); }}
              className="hidden items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-400 transition hover:border-ink-300 hover:bg-ink-50 md:flex"
              aria-label="Open command palette"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search…</span>
              <span className="ml-2 rounded border border-ink-200 px-1.5 py-0.5 text-[10px] text-ink-500">⌘K</span>
            </button>
            {/* Settings — an icon, not a nav group. Only rendered when the role can
                actually open at least one settings page. */}
            {canSeeAnySetting && (
              <a
                href="/dashboard/settings"
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg border border-transparent transition hover:border-ink-200 hover:bg-ink-50',
                  (path || '').startsWith('/dashboard/settings') ? 'text-brand-600' : 'text-ink-500 hover:text-ink-700',
                )}
                aria-label="Settings"
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </a>
            )}
            {/* Get help — an icon, not a nav group. Visible on mobile too, since the
                mobile drawer no longer carries a Support section. */}
            {perms.canSee('get-help') && (
              <a
                href="/dashboard/get-help"
                className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-ink-500 transition hover:border-ink-200 hover:bg-ink-50 hover:text-ink-700"
                aria-label={supportUnread > 0 ? `Get help (${supportUnread} unread)` : 'Get help'}
                title="Get help"
              >
                <LifeBuoy className="h-4 w-4" />
                {supportUnread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white">
                    {supportUnread > 9 ? '9+' : supportUnread}
                  </span>
                )}
              </a>
            )}
            <NotificationsBell />
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:border-ink-200 hover:bg-ink-50"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-ink-700 to-ink-900 text-xs font-semibold text-white">
                  {initials}
                </div>
                <div className="hidden text-left leading-tight md:block">
                  <div className="text-sm font-medium text-ink-900">{session?.user.email}</div>
                  <div className="text-[11px] text-ink-500">{session?.user.role}</div>
                </div>
                <ChevronDown className="h-4 w-4 text-ink-500" />
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 origin-top-right animate-slide-up rounded-xl border border-ink-200 bg-white p-1 shadow-pop">
                  <div className="px-3 py-2 text-xs text-ink-500">
                    Signed in as <div className="truncate font-medium text-ink-700">{session?.user.email}</div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ink-400">{session?.user.role}</div>
                  </div>
                  {perms.canSee('settings:security') && (
                    <a href="/dashboard/settings/security" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                      <ShieldCheck className="h-4 w-4" /> Security (2FA)
                    </a>
                  )}
                  {perms.canSee('settings:branding') && (
                    <a href="/dashboard/settings/branding" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                      <Palette className="h-4 w-4" /> Branding
                    </a>
                  )}
                  {perms.canSee('settings:permissions') && (
                    <a href="/dashboard/settings/permissions" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                      <Lock className="h-4 w-4" /> Permissions
                    </a>
                  )}
                  {perms.canSee('api-keys') && (
                    <a href={`${process.env.NEXT_PUBLIC_API_URL}/docs`} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                      <Settings className="h-4 w-4" /> API docs
                    </a>
                  )}
                  <div className="my-1 border-t border-ink-100" />
                  <button
                    onClick={async () => { await logout(); r.replace('/login'); }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
            <button
              className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-700 hover:bg-ink-50 lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle navigation"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

      </header>

      {/* Mobile slide-in drawer (categorised nav). Hidden at lg+. */}
      <div
        className={
          'fixed inset-0 z-50 lg:hidden ' +
          (mobileOpen ? 'pointer-events-auto' : 'pointer-events-none')
        }
        aria-hidden={!mobileOpen}
      >
        {/* Backdrop */}
        <div
          onClick={() => setMobileOpen(false)}
          className={
            'absolute inset-0 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200 ' +
            (mobileOpen ? 'opacity-100' : 'opacity-0')
          }
        />
        {/* Panel */}
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          className={
            'absolute right-0 top-0 flex h-full w-[85%] max-w-sm flex-col bg-white shadow-pop transition-transform duration-200 ease-out ' +
            (mobileOpen ? 'translate-x-0' : 'translate-x-full')
          }
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-ink-100 px-4">
            <span className="text-sm font-semibold text-ink-900">Menu</span>
            <button
              onClick={() => setMobileOpen(false)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-700"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Mobile">
            <NavList
              functions={visibleNav}
              currentPath={path || ''}
              currentQuery={currentQuery}
              isEmployee={perms.role === 'EMPLOYEE'}
              badges={navBadges}
              onNavigate={() => setMobileOpen(false)}
            />
          </nav>
          <div className="shrink-0 border-t border-ink-100 px-3 py-2 text-[11px] text-ink-500">
            Signed in as <span className="font-medium text-ink-700">{session?.user.email}</span>
          </div>
        </aside>
      </div>

      <AnnouncementBanner />
      <TrialBanner isAdmin={isAdmin} />
      <div className="relative z-10 flex flex-1">
        {/* Persistent sidebar. Data-dense tools need to show where you are while you
            work — hover dropdowns cannot. Mobile keeps the existing drawer. */}
        <aside
          className="sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 overflow-hidden border-r border-ink-200 bg-white/60 px-2 py-3 lg:block"
          // Width is set inline rather than via a utility class so the collapse cannot be
          // defeated by class ordering or a stale stylesheet. Deliberately NOT animated:
          // transitioning width reflows the whole page on every frame, and the animation
          // did not settle reliably — the toggle is instant instead.
          style={{ width: navCollapsed ? '4rem' : '14rem' }}
          aria-label="Primary"
        >
          <div className="flex h-full flex-col">
            {/* Toggle sits at the top so it is visible without scrolling. */}
            <div
              className={cn(
                'mb-2 flex shrink-0 items-center',
                navCollapsed ? 'justify-center' : 'justify-between pl-3',
              )}
            >
              {!navCollapsed && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Menu</span>
              )}
              <button
                onClick={toggleNav}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 transition hover:bg-ink-100/70 hover:text-ink-800"
                aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
                title={`${navCollapsed ? 'Expand' : 'Collapse'} sidebar  (${shortcutHint}B)`}
                aria-expanded={!navCollapsed}
                aria-controls="primary-nav-list"
              >
                <PanelLeftClose
                  className={cn('h-4 w-4 transition-transform duration-200', navCollapsed && 'rotate-180')}
                />
              </button>
            </div>
            <div id="primary-nav-list" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              <NavList
                functions={visibleNav}
                currentPath={path || ''}
                currentQuery={currentQuery}
                isEmployee={perms.role === 'EMPLOYEE'}
                badges={navBadges}
                collapsed={navCollapsed}
                onExpandRail={() => { setNavCollapsed(false); try { localStorage.setItem('am.navCollapsed', '0'); } catch {} }}
              />
            </div>
          </div>
        </aside>

      <main id="main-content" className="min-w-0 flex-1 px-4 py-5 sm:py-6 lg:px-6">
        {pageBlocked ? (
          <div className="mx-auto max-w-md pt-6">
            <EmptyState
              icon={<Lock className="h-5 w-5" />}
              title="Not available"
              description="Your role doesn't have access to this page. Ask a workspace admin if you need it."
            />
          </div>
        ) : children}
      </main>
      </div>
    </div>
  );
}

/**
 * The nav list. Shared by the desktop sidebar and the mobile drawer so the two can
 * never drift apart. Counts come from `badges`, keyed by navKey.
 */
function NavList({
  functions, currentPath, currentQuery, isEmployee, badges, onNavigate, collapsed = false, onExpandRail,
}: {
  functions: NavFunction[];
  currentPath: string;
  /** Raw query string, used to tell same-path siblings apart. */
  currentQuery?: string;
  isEmployee: boolean;
  badges?: Partial<Record<NavKey, number>>;
  onNavigate?: () => void;
  /** Icon-only rail. Labels become tooltips and counts shrink to a dot. */
  collapsed?: boolean;
  /** Called when a parent is clicked while the rail is collapsed — there is no room to
   *  show children, so the rail opens rather than doing nothing. */
  onExpandRail?: () => void;
}) {
  // Two children can share a path and differ only by query string ("All assets" vs
  // "My assets"), so the query is part of the comparison.
  const isActive = (href: string) => {
    const [hrefPath, hrefQuery] = href.split('?');
    const pathMatches = currentPath === hrefPath
      || (hrefPath !== '/dashboard' && currentPath.startsWith(hrefPath + '/'));
    if (!pathMatches) return false;
    const sameHrefPathSiblings = functions.some((fn) =>
      fn.children.filter((c) => c.href.split('?')[0] === hrefPath).length > 1);
    if (!sameHrefPathSiblings) return true;
    return (hrefQuery || '') === (currentQuery || '');
  };

  // Which parents are open. Seeded from the route so the section containing the current
  // page is expanded on arrival, and thereafter driven by the user's clicks.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const owner = functions.find((fn) => fn.children.some((c) => isActive(c.href)));
    if (owner) setOpen((o) => (o[owner.id] ? o : { ...o, [owner.id]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, functions.length]);

  return (
    <div className="space-y-0.5">
      {functions.map((fn) => {
        const label = (isEmployee && fn.employeeLabel) || fn.label;
        const childCount = fn.children.reduce((n, c) => n + (badges?.[c.navKey] || 0), 0);
        const anyChildActive = fn.children.some((c) => isActive(c.href));

        // One page left after filtering → a direct link. A dropdown revealing a single
        // item is pure friction, so the function collapses into its only page.
        if (fn.children.length === 1) {
          const only = fn.children[0];
          const leafLabel = (isEmployee && (only.employeeLabel || fn.employeeLabel)) || fn.label;
          return (
            <NavRow
              key={fn.id}
              href={only.href}
              label={leafLabel}
              icon={fn.icon}
              active={isActive(only.href)}
              count={badges?.[only.navKey] || 0}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          );
        }

        const isOpen = !collapsed && !!open[fn.id];
        return (
          <div key={fn.id}>
            <button
              type="button"
              onClick={() => {
                if (collapsed) { onExpandRail?.(); setOpen((o) => ({ ...o, [fn.id]: true })); return; }
                setOpen((o) => ({ ...o, [fn.id]: !o[fn.id] }));
              }}
              aria-expanded={isOpen}
              title={collapsed ? (childCount > 0 ? `${label} (${childCount})` : label) : undefined}
              className={cn(
                'group relative flex w-full items-center rounded-lg text-sm transition-colors',
                collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-3 py-2',
                anyChildActive && !isOpen
                  ? 'bg-ink-100 font-medium text-ink-900'
                  : 'text-ink-700 hover:bg-ink-100/70 hover:text-ink-900',
              )}
            >
              {anyChildActive && collapsed && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-brand-500" aria-hidden />
              )}
              <span className={cn('text-ink-400 transition-colors group-hover:text-ink-600', anyChildActive && 'text-ink-700')}>
                {fn.icon}
              </span>
              {!collapsed && <span className="truncate">{label}</span>}
              {!collapsed && (
                <ChevronDown className={cn('ml-auto h-3.5 w-3.5 text-ink-400 transition-transform', isOpen && 'rotate-180')} />
              )}
              {collapsed && childCount > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />
              )}
              {!collapsed && !isOpen && childCount > 0 && (
                <span className="mr-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold leading-none text-amber-800">
                  {childCount > 99 ? '99+' : childCount}
                </span>
              )}
            </button>

            {isOpen && (
              // Indented, with a rule tying the pages to their parent.
              <div className="ml-[1.4rem] mt-0.5 space-y-0.5 border-l border-ink-200 pl-2">
                {fn.children.map((c) => (
                  <NavRow
                    key={c.href}
                    href={c.href}
                    label={(isEmployee && c.employeeLabel) || c.label}
                    active={isActive(c.href)}
                    count={badges?.[c.navKey] || 0}
                    collapsed={false}
                    onNavigate={onNavigate}
                    child
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A single navigable row — a function with no children, or a page under one. */
function NavRow({
  href, label, icon, active, count, collapsed, onNavigate, child = false,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  count: number;
  collapsed: boolean;
  onNavigate?: () => void;
  child?: boolean;
}) {
  return (
    <a
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? (count > 0 ? `${label} (${count})` : label) : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'group relative flex items-center rounded-lg transition-colors',
        collapsed ? 'justify-center px-0 py-2.5 text-sm' : 'gap-2.5 px-3 py-2',
        child ? 'text-[13px]' : 'text-sm',
        active
          ? 'bg-ink-900 font-medium text-white'
          : 'text-ink-700 hover:bg-ink-100/70 hover:text-ink-900',
      )}
    >
      {active && collapsed && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-brand-500" aria-hidden />
      )}
      {icon && (
        <span className={cn(active ? 'text-white' : 'text-ink-400 transition-colors group-hover:text-ink-600')}>{icon}</span>
      )}
      {!collapsed && <span className="truncate">{label}</span>}
      {count > 0 && (collapsed ? (
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />
      ) : (
        <span
          className={cn(
            'ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-none',
            active ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800',
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      ))}
    </a>
  );
}

function TrialBanner({ isAdmin }: { isAdmin: boolean }) {
  const billing = useQuery({
    queryKey: ['billing-summary'],
    queryFn: () => api<any>('/billing'),
    staleTime: 60_000,
  });
  if (!billing.data?.inTrial) return null;
  const days = billing.data.daysRemainingInTrial;
  const tone = days <= 7 ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-brand-50 text-brand-800 border-brand-200';
  return (
    <div className={`relative z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2 text-xs sm:px-6 ${tone}`}>
      <p>
        You're on a free trial. <b>{days} {days === 1 ? 'day' : 'days'} remaining.</b> No credit card on file —
        upgrade any time to keep your workspace active.
      </p>
      {isAdmin && <a href="/dashboard/settings/billing" className="font-semibold underline">Manage plan →</a>}
    </div>
  );
}
