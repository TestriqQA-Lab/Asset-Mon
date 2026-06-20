'use client';
// NOTE: mobile responsiveness for `apps/web/src/app/platform/login/page.tsx`
// is being handled in a separate worker pass — leave that file alone.
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getPlatformSession, platformLogout } from '@/lib/platform-api';
import {
  ShieldCheck, LayoutDashboard, Building2, Users, ScrollText, ChevronDown, LogOut, KeyRound,
  Menu, X,
} from 'lucide-react';
import { THEME_PRESETS, themeToRootCss } from '@/lib/themes';
import { applyThemeTokens, resetThemeTokens } from '@/lib/theme';

const NAV = [
  { href: '/platform', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
  { href: '/platform/tenants', label: 'Tenants', icon: <Building2 className="h-4 w-4" /> },
  { href: '/platform/admins', label: 'Platform team', icon: <Users className="h-4 w-4" /> },
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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (path.startsWith('/platform/login')) { setReady(true); return; }
    if (!getPlatformSession()) { r.replace('/platform/login'); return; }
    setReady(true);
  }, [path, r]);

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
            <a href="/platform" className="flex items-center gap-2.5">
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
            </a>

            <nav className="ml-3 hidden flex-1 items-center gap-1 md:flex" aria-label="Platform">
              {NAV.map((item) => {
                const isActive = isActiveItem(item);
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={
                      'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ' +
                      (isActive ? 'bg-violet-900 text-white' : 'text-am-text hover:bg-violet-100')
                    }
                  >
                    {item.icon}
                    {item.label}
                  </a>
                );
              })}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <a href="/dashboard" className="hidden rounded-lg border border-am-border bg-am-surface px-3 py-1.5 text-xs text-am-text-muted hover:bg-am-surface-muted lg:block">
                Tenant view →
              </a>
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
                    <a
                      href="/platform/account"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-am-text hover:bg-am-surface-muted"
                      onClick={() => setMenuOpen(false)}
                    >
                      <KeyRound className="h-4 w-4" /> Change password
                    </a>
                    <a
                      href="/dashboard"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-am-text hover:bg-am-surface-muted lg:hidden"
                    >
                      Tenant view →
                    </a>
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
                className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-violet-200 bg-am-surface text-am-text hover:bg-violet-50 md:hidden"
                onClick={() => setDrawerOpen((v) => !v)}
                aria-label="Toggle navigation"
                aria-expanded={drawerOpen}
              >
                {drawerOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </header>

        {/* Mobile drawer (md:hidden). */}
        <div
          className={
            'fixed inset-0 z-50 md:hidden ' +
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
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={
                      'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ' +
                      (isActive ? 'bg-violet-900 text-white' : 'text-am-text hover:bg-violet-50')
                    }
                  >
                    {item.icon}
                    {item.label}
                  </a>
                );
              })}
              <div className="mt-3 border-t border-am-border pt-3">
                <a
                  href="/dashboard"
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-am-text hover:bg-am-surface-muted"
                >
                  Tenant view →
                </a>
              </div>
            </nav>
            <div className="shrink-0 border-t border-violet-100 px-3 py-2 text-[11px] text-am-text-muted">
              Signed in as <span className="font-medium text-am-text">{session?.user.email}</span>
            </div>
          </aside>
        </div>

        <main className="flex-1 px-4 py-5 sm:py-6 lg:px-6">{children}</main>
      </div>
    </>
  );
}
