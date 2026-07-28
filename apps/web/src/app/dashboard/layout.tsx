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
import { EmptyState, cn } from '@/components/ui';
import {
  LayoutDashboard, Package, Tag, Building2,
  Wrench, CalendarClock, ShoppingCart, FileText, TrendingDown,
  AppWindow, KeyRound, ClipboardCheck, BarChart3, ListChecks,
  Settings, LogOut, ChevronDown, Search,
  Palette, ShieldCheck, Menu, X, Lock, LifeBuoy,
  HandHelping,
} from 'lucide-react';

type NavItem = { href: string; label: string; icon: React.ReactNode; navKey: NavKey; module?: ModuleKey };
type NavGroup = { label: string; icon: React.ReactNode; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    label: 'Overview',
    icon: <LayoutDashboard className="h-3.5 w-3.5" />,
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, navKey: 'dashboard' },
      { href: '/dashboard/reports', label: 'Reports', icon: <BarChart3 className="h-4 w-4" />, navKey: 'reports', module: 'reports' },
      { href: '/dashboard/data-quality', label: 'Data quality', icon: <ListChecks className="h-4 w-4" />, navKey: 'data-quality' },
    ],
  },
  {
    label: 'Inventory',
    icon: <Package className="h-3.5 w-3.5" />,
    items: [
      { href: '/dashboard/assets', label: 'Assets', icon: <Package className="h-4 w-4" />, navKey: 'assets' },
      { href: '/dashboard/categories', label: 'Categories', icon: <Tag className="h-4 w-4" />, navKey: 'categories' },
      // Locations is hidden from the Inventory menu. The page + API still exist and
      // assets keep their location field — restore the nav item to re-expose it.
      { href: '/dashboard/departments', label: 'Departments', icon: <Building2 className="h-4 w-4" />, navKey: 'departments' },
      { href: '/dashboard/software', label: 'Software', icon: <AppWindow className="h-4 w-4" />, navKey: 'software', module: 'software' },
      { href: '/dashboard/licenses', label: 'Licenses', icon: <KeyRound className="h-4 w-4" />, navKey: 'licenses', module: 'software' },
    ],
  },
  {
    label: 'Lifecycle',
    icon: <Wrench className="h-3.5 w-3.5" />,
    items: [
      { href: '/dashboard/tickets', label: 'Service tickets', icon: <Wrench className="h-4 w-4" />, navKey: 'tickets', module: 'tickets' },
      { href: '/dashboard/maintenance', label: 'Maintenance', icon: <CalendarClock className="h-4 w-4" />, navKey: 'maintenance', module: 'maintenance' },
      { href: '/dashboard/reservations', label: 'Reservations', icon: <CalendarClock className="h-4 w-4" />, navKey: 'reservations', module: 'reservations' },
      { href: '/dashboard/audit-sessions', label: 'Physical audits', icon: <ClipboardCheck className="h-4 w-4" />, navKey: 'audit-sessions', module: 'audits' },
      { href: '/dashboard/asset-requests', label: 'Asset requests', icon: <HandHelping className="h-4 w-4" />, navKey: 'asset-requests' },
    ],
  },
  {
    label: 'Finance',
    icon: <ShoppingCart className="h-3.5 w-3.5" />,
    items: [
      { href: '/dashboard/purchase-requests', label: 'Purchase requests', icon: <FileText className="h-4 w-4" />, navKey: 'purchase-requests', module: 'procurement' },
      { href: '/dashboard/purchase-orders', label: 'Purchase orders', icon: <ShoppingCart className="h-4 w-4" />, navKey: 'purchase-orders', module: 'procurement' },
      { href: '/dashboard/depreciation', label: 'Depreciation', icon: <TrendingDown className="h-4 w-4" />, navKey: 'depreciation', module: 'depreciation' },
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

  // Page-level gate: block direct-URL access to any page the role can't see.
  // Match the current path to its nav item (longest href prefix wins) and, if the
  // role's permission for that key is off, render "Not available" instead of the page.
  // Server endpoints enforce this too (Phase 1A) — this is the UI half.
  const activeNavKey = useMemo<NavKey | undefined>(() => {
    const p = path || '';
    let best: { href: string; navKey: NavKey } | undefined;
    // Settings items are no longer part of NAV, but they must still be gated — omitting
    // them here would leave every settings page ungated on a direct URL visit.
    const candidates = [...NAV.flatMap((g) => g.items), ...SETTINGS_ITEMS];
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

          <nav className="ml-2 hidden flex-1 items-center gap-0.5 lg:flex" aria-label="Primary">
            {visibleNav.map((group) => (
              <NavMenu key={group.label} group={group} currentPath={path || ''} badge={0} />
            ))}
          </nav>

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
            {visibleNav.map((group) => (
              <div key={group.label} className="mb-3">
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">{group.label}</div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = path === item.href || (item.href !== '/dashboard' && path?.startsWith(item.href + '/'));
                    return (
                      <a
                        key={item.href}
                        href={item.href}
                        className={
                          'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ' +
                          (active ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-50')
                        }
                      >
                        {item.icon}
                        {item.label}
                        {item.navKey === 'get-help' && supportUnread > 0 && (
                          <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white">{supportUnread > 9 ? '9+' : supportUnread}</span>
                        )}
                      </a>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="shrink-0 border-t border-ink-100 px-3 py-2 text-[11px] text-ink-500">
            Signed in as <span className="font-medium text-ink-700">{session?.user.email}</span>
          </div>
        </aside>
      </div>

      <AnnouncementBanner />
      <TrialBanner isAdmin={isAdmin} />
      <main id="main-content" className="relative z-10 flex-1 px-4 py-5 sm:py-6 lg:px-6">
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
  );
}

function NavMenu({ group, currentPath, badge = 0 }: { group: NavGroup; currentPath: string; badge?: number }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const groupActive = group.items.some((it) =>
    currentPath === it.href || (it.href !== '/dashboard' && currentPath.startsWith(it.href + '/')),
  );

  const onEnter = () => {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  };
  const onLeave = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  return (
    <div ref={wrapRef} className="relative" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={
          'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ' +
          (groupActive ? 'bg-ink-100 text-ink-900' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900')
        }
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className={groupActive ? 'text-ink-700' : 'text-ink-400'}>{group.icon}</span>
        {group.label}
        {badge > 0 && <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white">{badge > 9 ? '9+' : badge}</span>}
        <ChevronDown className={'h-3.5 w-3.5 text-ink-400 transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 animate-slide-up rounded-xl border border-ink-200 bg-white p-1 shadow-pop">
          {group.items.map((item) => {
            const active = currentPath === item.href || (item.href !== '/dashboard' && currentPath.startsWith(item.href + '/'));
            return (
              <a
                key={item.href}
                href={item.href}
                className={
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ' +
                  (active ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-50')
                }
                onClick={() => setOpen(false)}
              >
                <span className={active ? 'text-white' : 'text-ink-400'}>{item.icon}</span>
                {item.label}
              </a>
            );
          })}
        </div>
      )}
    </div>
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
