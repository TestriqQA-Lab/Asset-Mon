'use client';
// NOTE: mobile responsiveness for `apps/web/src/app/platform/login/page.tsx`
// is being handled in a separate worker pass — leave that file alone.
import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getPlatformSession, platformLogout, papi } from '@/lib/platform-api';
import {
  ShieldCheck, LayoutDashboard, Building2, Users, ScrollText, ChevronDown, LogOut, KeyRound,
  Menu, X, LifeBuoy, Megaphone, PanelLeftClose,
} from 'lucide-react';
import { THEME_PRESETS, themeToRootCss } from '@/lib/themes';
import { applyThemeTokens, resetThemeTokens } from '@/lib/theme';

const NAV = [
  { href: '/platform', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
  { href: '/platform/tenants', label: 'Tenants', icon: <Building2 className="h-4 w-4" /> },
  { href: '/platform/admins', label: 'Platform team', icon: <Users className="h-4 w-4" /> },
  { href: '/platform/support', label: 'Support', icon: <LifeBuoy className="h-4 w-4" /> },
  { href: '/platform/announcements', label: 'Announcements', icon: <Megaphone className="h-4 w-4" /> },
  { href: '/platform/audit-log', label: 'Audit log', icon: <ScrollText className="h-4 w-4" /> },
];

// Platform console is cross-tenant — it never reads a tenant's branding, so it
// always renders with the default landing-aligned palette + its own violet
// accent + "Platform" badge. We still emit the SSR <style> block so the
// chrome is right on first paint.
const SSR_DEFAULT_THEME_CSS = themeToRootCss(THEME_PRESETS.default, 'light');

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const r = useRouter();
  const path = usePathname() || '';
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  // Badge counts
  const [supportUnread, setSupportUnread] = useState(0);
  const [pendingResets, setPendingResets] = useState(0);
  const [tenantsAttention, setTenantsAttention] = useState(0);
  
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (path.startsWith('/platform/login')) { setReady(true); return; }
    if (!getPlatformSession()) { r.replace('/platform/login'); return; }
    setReady(true);
  }, [path, r]);

  // Poll for sidebar badge counts.
  useEffect(() => {
    if (path.startsWith('/platform/login') || !getPlatformSession()) return;
    let alive = true;
    const load = () => {
      papi<{ count: number }>('/platform/support/unread-count')
        .then((d) => { if (alive) setSupportUnread(d.count || 0); }).catch(() => {});
      papi<any[]>('/platform/admins/reset-mfa/pending')
        .then((d) => { if (alive) setPendingResets(d.length || 0); }).catch(() => {});
      papi<{ count: number }>('/platform/tenants/attention-count')
        .then((d) => { if (alive) setTenantsAttention(d.count || 0); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [path]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // The platform console is cross-tenant by definition — it must never borrow
  // whatever theme a tenant happens to have picked. Wipe any tenant-side inline
  // `--am-*` overrides on mount and pin to the `default` preset. When the
  // operator navigates back to `/dashboard`, the tenant SettingsProvider will
  // re-apply that tenant's theme.
  useEffect(() => {
    resetThemeTokens();
    applyThemeTokens(THEME_PRESETS.default);
  }, []);

  // Close drawer on navigation.
  useEffect(() => { setDrawerOpen(false); }, [path]);

  // Lock background scroll while drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [drawerOpen]);

  // Sidebar collapse. Persisted so the choice survives navigation and reloads.
  // Separate key from the dashboard's `am.navCollapsed`.
  const [navCollapsed, setNavCollapsed] = useState(false);
  useEffect(() => {
    try { setNavCollapsed(localStorage.getItem('am.platformNavCollapsed') === '1'); } catch {}
  }, []);
  const toggleNav = useCallback(() => {
    setNavCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem('am.platformNavCollapsed', next ? '1' : '0'); } catch {}
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

  if (path.startsWith('/platform/login')) return <>{children}</>;
  if (!ready) return null;
  const session = getPlatformSession();
  const initials = ((session?.user.email || '?').charAt(0)).toUpperCase();

  const isActiveItem = (item: typeof NAV[number]) => {
    const isOverview = item.href === '/platform';
    const matchesOverview = isOverview && (path === '/platform' || path === '/platform/');
    return isOverview ? matchesOverview : (path === item.href || path.startsWith(item.href + '/'));
  };

  return (
    <>
      <style id="am-theme-ssr-platform" dangerouslySetInnerHTML={{ __html: SSR_DEFAULT_THEME_CSS }} />
      <div
        data-themed
        data-app-shell="platform"
        className="am-themed am-mode-light relative flex min-h-screen flex-col bg-am-bg text-am-text"
      >
        <header className="sticky top-0 z-40 border-b border-violet-200/60 bg-gradient-to-r from-violet-50 via-am-surface to-violet-50 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
            <Link href="/platform" className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-700 text-white shadow-sm">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="hidden flex-col leading-tight sm:flex">
                <span className="text-sm font-semibold tracking-tight text-am-heading">AssetMon Platform</span>
                <span className="text-[10px] uppercase tracking-wider text-violet-600">Operator console</span>
              </div>
              {/* Platform badge so operators always know they're not inside a single tenant */}
              <span className="ml-2 hidden rounded-full border border-violet-300/70 bg-violet-100/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-800 sm:inline-flex">
                Platform
              </span>
            </Link>

            <div className="ml-auto flex items-center gap-2">
              <Link href="/dashboard" className="hidden rounded-lg border border-am-border bg-am-surface px-3 py-1.5 text-xs text-am-text-muted hover:bg-am-surface-muted lg:block">
                Tenant view →
              </Link>
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:border-violet-200 hover:bg-violet-50"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-700 to-indigo-900 text-xs font-semibold text-white">
                    {initials}
                  </div>
                  <div className="hidden text-left leading-tight md:block">
                    <div className="text-sm font-medium text-am-text">{session?.user.email}</div>
                    <div className="text-[11px] text-violet-600">{session?.user.role}</div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-am-text-muted" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-am-border bg-am-surface p-1 shadow-pop">
                    <div className="px-3 py-2 text-xs text-am-text-muted">
                      Signed in as
                      <div className="truncate font-medium text-am-text">{session?.user.email}</div>
                    </div>
                    <div className="my-1 border-t border-am-border" />
                    <Link
                      href="/platform/account"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-am-text hover:bg-am-surface-muted"
                      onClick={() => setMenuOpen(false)}
                    >
                      <KeyRound className="h-4 w-4" /> Change password
                    </Link>
                    <Link
                      href="/dashboard"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-am-text hover:bg-am-surface-muted lg:hidden"
                    >
                      Tenant view →
                    </Link>
                    <div className="my-1 border-t border-am-border" />
                    <button
                      onClick={async () => { await platformLogout(); r.replace('/platform/login'); }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-am-text hover:bg-am-surface-muted"
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </button>
                  </div>
                )}
              </div>
              <button
                className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-violet-200 bg-am-surface text-am-text hover:bg-violet-50 lg:hidden"
                onClick={() => setDrawerOpen((v) => !v)}
                aria-label="Toggle navigation"
                aria-expanded={drawerOpen}
              >
                {drawerOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </header>

        {/* Mobile drawer (lg:hidden). */}
        <div
          className={
            'fixed inset-0 z-50 lg:hidden ' +
            (drawerOpen ? 'pointer-events-auto' : 'pointer-events-none')
          }
          aria-hidden={!drawerOpen}
        >
          <div
            onClick={() => setDrawerOpen(false)}
            className={
              'absolute inset-0 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200 ' +
              (drawerOpen ? 'opacity-100' : 'opacity-0')
            }
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Platform navigation"
            className={
              'absolute right-0 top-0 flex h-full w-[85%] max-w-sm flex-col bg-am-surface shadow-pop transition-transform duration-200 ease-out ' +
              (drawerOpen ? 'translate-x-0' : 'translate-x-full')
            }
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-violet-100 bg-violet-50/40 px-4">
              <span className="text-sm font-semibold text-am-heading">Platform</span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-am-text-muted hover:bg-am-surface-muted hover:text-am-text"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3" aria-label="Mobile">
              {NAV.map((item) => {
                const isActive = isActiveItem(item);
                let badge = 0;
                if (item.href === '/platform/support') badge = supportUnread;
                else if (item.href === '/platform/admins') badge = pendingResets;
                else if (item.href === '/platform/tenants') badge = tenantsAttention;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ' +
                      (isActive ? 'bg-violet-900 text-white' : 'text-am-text hover:bg-violet-50')
                    }
                  >
                    {item.icon}
                    {item.label}
                    {badge > 0 && (
                      <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white">{badge > 9 ? '9+' : badge}</span>
                    )}
                  </Link>
                );
              })}
              <div className="mt-3 border-t border-am-border pt-3">
                <Link
                  href="/dashboard"
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-am-text hover:bg-am-surface-muted"
                >
                  Tenant view →
                </Link>
              </div>
            </nav>
            <div className="shrink-0 border-t border-violet-100 px-3 py-2 text-[11px] text-am-text-muted">
              Signed in as <span className="font-medium text-am-text">{session?.user.email}</span>
            </div>
          </aside>
        </div>

        <div className="relative z-10 flex flex-1">
          {/* Persistent sidebar. Matches the dashboard pattern: collapsible,
              flat list (no nested dropdowns — every destination is a single page),
              violet accent to distinguish from the tenant dashboard. */}
          <aside
            className="sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 overflow-hidden border-r border-violet-200/60 bg-violet-50/30 px-2 py-3 lg:block"
            style={{ width: navCollapsed ? '4rem' : '14rem' }}
            aria-label="Primary"
          >
            <div className="flex h-full flex-col">
              {/* Toggle sits at the top so it is visible without scrolling. */}
              <div
                className={
                  'mb-2 flex shrink-0 items-center ' +
                  (navCollapsed ? 'justify-center' : 'justify-between pl-3')
                }
              >
                {!navCollapsed && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-500">Menu</span>
                )}
                <button
                  onClick={toggleNav}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-violet-400 transition hover:bg-violet-100/70 hover:text-violet-800"
                  aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
                  title={`${navCollapsed ? 'Expand' : 'Collapse'} sidebar  (${shortcutHint}B)`}
                  aria-expanded={!navCollapsed}
                  aria-controls="platform-nav-list"
                >
                  <PanelLeftClose
                    className={'h-4 w-4 transition-transform duration-200' + (navCollapsed ? ' rotate-180' : '')}
                  />
                </button>
              </div>
              <div id="platform-nav-list" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden">
                {NAV.map((item) => {
                  const isActive = isActiveItem(item);
                  let badge = 0;
                  if (item.href === '/platform/support') badge = supportUnread;
                  else if (item.href === '/platform/admins') badge = pendingResets;
                  else if (item.href === '/platform/tenants') badge = tenantsAttention;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? 'page' : undefined}
                      title={navCollapsed ? (badge > 0 ? `${item.label} (${badge})` : item.label) : undefined}
                      aria-label={navCollapsed ? item.label : undefined}
                      className={
                        'group relative flex items-center rounded-lg transition-colors ' +
                        (navCollapsed ? 'justify-center px-0 py-2.5 text-sm' : 'gap-2.5 px-3 py-2 text-sm') + ' ' +
                        (isActive
                          ? 'bg-violet-900 font-medium text-white'
                          : 'text-am-text hover:bg-violet-100/70 hover:text-violet-900')
                      }
                    >
                      {isActive && navCollapsed && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-violet-500" aria-hidden />
                      )}
                      <span className={isActive ? 'text-white' : 'text-violet-500 transition-colors group-hover:text-violet-700'}>
                        {item.icon}
                      </span>
                      {!navCollapsed && <span className="truncate">{item.label}</span>}
                      {badge > 0 && (navCollapsed ? (
                        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-violet-50/30" />
                      ) : (
                        <span
                          className={
                            'ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-none ' +
                            (isActive ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-700')
                          }
                        >
                          {badge > 99 ? '99+' : badge}
                        </span>
                      ))}
                    </Link>
                  );
                })}
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1 px-4 py-5 sm:py-6 lg:px-6">{children}</main>
        </div>
      </div>
    </>
  );
}
