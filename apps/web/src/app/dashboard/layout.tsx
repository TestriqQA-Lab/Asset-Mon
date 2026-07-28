'use client';
import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, getSession, logout } from '@/lib/api';
import { SettingsProvider, useSettings, usePermissions, type ModuleKey } from '@/lib/settings';
import { CommandPalette } from '@/components/CommandPalette';
import { NotificationsBell } from '@/components/NotificationsBell';
import { AnnouncementBanner } from '@/components/AnnouncementBanner';
import { THEME_PRESETS, tokensToCss } from '@/lib/themes';
import type { NavKey } from '@/lib/permissions';
import { SETTINGS_ITEMS } from '@/lib/settings-nav';
import { isAssetsAreaPath, ASSETS_TABS } from '@/lib/assets-nav';
import { AssetsTabs } from '@/components/AssetsTabs';
import { EmptyState, cn } from '@/components/ui';
import {
  LayoutDashboard, Package,
  Wrench, CalendarClock, ShoppingCart, FileText, TrendingDown,
  ClipboardCheck, BarChart3, ListChecks,
  Settings, LogOut, ChevronDown, Search,
  Palette, ShieldCheck, Menu, X, Lock, LifeBuoy, PanelLeftClose,
  HandHelping,
} from 'lucide-react';

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  navKey: NavKey;
  module?: ModuleKey;
  /** Shown to employees instead of `label` — they meet this app rarely and think in
   *  plain words, not system nouns ("Get help", not "Service tickets"). */
  employeeLabel?: string;
};
/** An empty `label` renders the items with no section heading (used for Dashboard). */
type NavGroup = { label: string; items: NavItem[] };

/**
 * Sidebar navigation, ordered by how often a person actually needs each thing rather
 * than by how the data is modelled. Work queues sit at the top; records and insights
 * below. Assets is a single entry because its sub-pages are tabs (see lib/assets-nav),
 * and workspace settings are not here at all — they live behind the gear icon.
 */
const NAV: NavGroup[] = [
  {
    label: '',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, navKey: 'dashboard', employeeLabel: 'Home' },
    ],
  },
  {
    label: 'Work',
    items: [
      { href: '/dashboard/asset-requests', label: 'Asset requests', icon: <HandHelping className="h-4 w-4" />, navKey: 'asset-requests', employeeLabel: 'Ask for something' },
      { href: '/dashboard/purchase-requests', label: 'Purchase requests', icon: <FileText className="h-4 w-4" />, navKey: 'purchase-requests', module: 'procurement' },
      { href: '/dashboard/tickets', label: 'Service tickets', icon: <Wrench className="h-4 w-4" />, navKey: 'tickets', module: 'tickets', employeeLabel: 'Get help' },
      { href: '/dashboard/maintenance', label: 'Maintenance', icon: <CalendarClock className="h-4 w-4" />, navKey: 'maintenance', module: 'maintenance' },
      { href: '/dashboard/reservations', label: 'Reservations', icon: <CalendarClock className="h-4 w-4" />, navKey: 'reservations', module: 'reservations', employeeLabel: 'Bookings' },
      { href: '/dashboard/audit-sessions', label: 'Physical audits', icon: <ClipboardCheck className="h-4 w-4" />, navKey: 'audit-sessions', module: 'audits' },
    ],
  },
  {
    label: 'Records',
    items: [
      // Assets is one destination with a tab strip (ASSETS_TABS): categories,
      // departments, statuses, software and licences classify or configure assets
      // rather than sitting beside them. They are still fed into the page-level access
      // gate below. Locations was removed from the product UI entirely.
      { href: '/dashboard/assets', label: 'Assets', icon: <Package className="h-4 w-4" />, navKey: 'assets', employeeLabel: 'My equipment' },
      { href: '/dashboard/purchase-orders', label: 'Purchase orders', icon: <ShoppingCart className="h-4 w-4" />, navKey: 'purchase-orders', module: 'procurement' },
      { href: '/dashboard/depreciation', label: 'Depreciation', icon: <TrendingDown className="h-4 w-4" />, navKey: 'depreciation', module: 'depreciation' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/dashboard/reports', label: 'Reports', icon: <BarChart3 className="h-4 w-4" />, navKey: 'reports', module: 'reports' },
      { href: '/dashboard/data-quality', label: 'Data quality', icon: <ListChecks className="h-4 w-4" />, navKey: 'data-quality' },
    ],
  },
  // NOTE: neither 'Get help' nor 'Settings' is a nav group.
  //   - Get help is a help icon in the top-right utility area (a dropdown holding a
  //     single link is pure friction).
  //   - Workspace configuration moved to its own area at /dashboard/settings, reached
  //     from the gear icon. It was a nine-item catch-all competing with daily work.
  //     Those items live in `SETTINGS_GROUPS` (lib/settings-nav) and are still folded
  //     into the page-level access gate below via SETTINGS_ITEMS.
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
  const toggleNav = () => {
    setNavCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem('am.navCollapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  };

  const perms = usePermissions();
  // Role-based nav filter:
  //   - drop items the user's role can't see (per the tenant permissions matrix)
  //   - drop items whose backing module is disabled
  //   - drop empty groups
  const visibleNav = useMemo(() => {
    return NAV
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (item.module && !settings.modules[item.module]) return false;
          return perms.canSee(item.navKey);
        }),
      }))
      .filter((group) => group.items.length > 0);
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
    const candidates = [...NAV.flatMap((g) => g.items), ...SETTINGS_ITEMS, ...ASSETS_TABS];
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
              groups={visibleNav}
              currentPath={path || ''}
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
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              <NavList
                groups={visibleNav}
                currentPath={path || ''}
                isEmployee={perms.role === 'EMPLOYEE'}
                badges={navBadges}
                collapsed={navCollapsed}
              />
            </div>
            <button
              onClick={toggleNav}
              className={cn(
                'mt-2 flex shrink-0 items-center gap-2 rounded-lg py-2 text-xs text-ink-500 transition hover:bg-ink-100/70 hover:text-ink-800',
                navCollapsed ? 'justify-center px-0' : 'px-3',
              )}
              aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              title={navCollapsed ? 'Expand' : 'Collapse'}
              aria-expanded={!navCollapsed}
            >
              <PanelLeftClose
                className={cn('h-4 w-4 transition-transform duration-200', navCollapsed && 'rotate-180')}
              />
              {!navCollapsed && <span>Collapse</span>}
            </button>
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
        ) : (
          <>
            {/* Rendered here rather than in each page so every route in the Assets
                area gets the same strip without repeating markup. */}
            {isAssetsAreaPath(path || '') && <AssetsTabs />}
            {children}
          </>
        )}
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
  groups, currentPath, isEmployee, badges, onNavigate, collapsed = false,
}: {
  groups: NavGroup[];
  currentPath: string;
  isEmployee: boolean;
  badges?: Partial<Record<NavKey, number>>;
  onNavigate?: () => void;
  /** Icon-only rail. Labels become tooltips and counts shrink to a dot. */
  collapsed?: boolean;
}) {
  return (
    <>
      {groups.map((group, gi) => (
        <div key={group.label || `g${gi}`} className={gi === 0 ? 'mb-1' : 'mb-1 mt-4'}>
          {group.label && (collapsed ? (
            // A rule keeps the grouping legible once the headings are gone.
            <div className="mx-2 mb-1 border-t border-ink-200" aria-hidden />
          ) : (
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
              {group.label}
            </div>
          ))}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = currentPath === item.href
                || (item.href !== '/dashboard' && currentPath.startsWith(item.href + '/'));
              const count = badges?.[item.navKey] || 0;
              const label = (isEmployee && item.employeeLabel) || item.label;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? (count > 0 ? `${label} (${count})` : label) : undefined}
                  aria-label={collapsed ? label : undefined}
                  className={cn(
                    'relative flex items-center rounded-lg text-sm transition-colors',
                    collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-3 py-2',
                    active ? 'bg-ink-900 font-medium text-white' : 'text-ink-700 hover:bg-ink-100/70',
                  )}
                >
                  <span className={active ? 'text-white' : 'text-ink-400'}>{item.icon}</span>
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
            })}
          </div>
        </div>
      ))}
    </>
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
