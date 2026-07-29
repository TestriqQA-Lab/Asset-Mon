'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Package, Wrench, Users as UsersIcon, LayoutDashboard, FileText, ShoppingCart, KeyRound, BarChart3, Webhook, Sliders, Palette, ScrollText, CalendarClock, ClipboardCheck, AppWindow } from 'lucide-react';
import { api } from '@/lib/api';

type Result = {
  assets?: { id: string; assetTag: string; name: string; status: string }[];
  tickets?: { id: string; ticketNumber: string; title: string; status: string }[];
  users?: { id: string; firstName: string; lastName: string; email: string; role: string }[];
};

const QUICK_LINKS: { href: string; label: string; icon: React.ReactNode; keywords: string[] }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, keywords: ['home', 'overview'] },
  { href: '/dashboard/assets', label: 'Assets', icon: <Package className="h-4 w-4" />, keywords: ['inventory', 'device', 'laptop'] },
  { href: '/dashboard/tickets', label: 'Service tickets', icon: <Wrench className="h-4 w-4" />, keywords: ['support', 'repair'] },
  { href: '/dashboard/maintenance', label: 'Maintenance', icon: <CalendarClock className="h-4 w-4" />, keywords: ['pm', 'schedule'] },
  { href: '/dashboard/reservations', label: 'Reservations', icon: <CalendarClock className="h-4 w-4" />, keywords: ['booking'] },
  { href: '/dashboard/audit-sessions', label: 'Physical audits', icon: <ClipboardCheck className="h-4 w-4" />, keywords: ['inventory', 'scan'] },
  { href: '/dashboard/purchase-requests', label: 'Purchase requests', icon: <FileText className="h-4 w-4" />, keywords: ['procurement', 'pr'] },
  { href: '/dashboard/purchase-orders', label: 'Purchase orders', icon: <ShoppingCart className="h-4 w-4" />, keywords: ['procurement', 'po'] },
  { href: '/dashboard/software', label: 'Software', icon: <AppWindow className="h-4 w-4" />, keywords: ['licenses'] },
  { href: '/dashboard/licenses', label: 'Licenses', icon: <KeyRound className="h-4 w-4" />, keywords: ['compliance', 'seats'] },
  { href: '/dashboard/depreciation', label: 'Depreciation', icon: <BarChart3 className="h-4 w-4" />, keywords: ['finance', 'book value'] },
  { href: '/dashboard/reports', label: 'Reports', icon: <BarChart3 className="h-4 w-4" />, keywords: ['csv', 'analytics'] },
  { href: '/dashboard/users', label: 'Users', icon: <UsersIcon className="h-4 w-4" />, keywords: ['people', 'rbac'] },
  { href: '/dashboard/api-keys', label: 'API keys', icon: <KeyRound className="h-4 w-4" />, keywords: ['integration'] },
  { href: '/dashboard/webhooks', label: 'Webhooks', icon: <Webhook className="h-4 w-4" />, keywords: ['integration'] },
  { href: '/dashboard/audit', label: 'Audit log', icon: <ScrollText className="h-4 w-4" />, keywords: ['compliance'] },
  { href: '/dashboard/settings/modules', label: 'Settings · Modules', icon: <Sliders className="h-4 w-4" />, keywords: ['enable', 'disable'] },
  { href: '/dashboard/settings/branding', label: 'Settings · Branding', icon: <Palette className="h-4 w-4" />, keywords: ['logo', 'color', 'theme'] },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [data, setData] = useState<Result>({});
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) { setQ(''); setData({}); setActiveIdx(0); return; }
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    if (!q || q.length < 2) { setData({}); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      // Don't discard failures. Swallowing them made a rejected search look identical
      // to a search that genuinely found nothing.
      api<Result>(`/search?q=${encodeURIComponent(q)}`)
        .then((r) => { setData(r); setSearchError(null); })
        .catch((e: any) => { setData({}); setSearchError(e?.message || 'Search is unavailable right now.'); });
    }, 150);
    return () => { ctl.abort(); clearTimeout(t); };
  }, [q]);

  if (!open) return null;

  const ql = q.toLowerCase();
  const matchedLinks = QUICK_LINKS.filter((l) =>
    !ql || l.label.toLowerCase().includes(ql) || l.keywords.some((k) => k.includes(ql))
  ).slice(0, 8);

  const items: Array<{ href: string; label: string; sub?: string; group: string; icon?: React.ReactNode }> = [];
  if (data.assets) data.assets.forEach((a) => items.push({ href: `/dashboard/assets/${a.id}`, label: `${a.assetTag} · ${a.name}`, sub: a.status, group: 'Assets', icon: <Package className="h-4 w-4" /> }));
  if (data.tickets) data.tickets.forEach((t) => items.push({ href: `/dashboard/tickets/${t.id}`, label: `${t.ticketNumber} · ${t.title}`, sub: t.status, group: 'Tickets', icon: <Wrench className="h-4 w-4" /> }));
  if (data.users) data.users.forEach((u) => items.push({ href: `/dashboard/users`, label: `${u.firstName} ${u.lastName}`, sub: u.email + ' · ' + u.role, group: 'People', icon: <UsersIcon className="h-4 w-4" /> }));
  matchedLinks.forEach((l) => items.push({ href: l.href, label: l.label, group: 'Navigate', icon: l.icon }));

  const safeIdx = items.length === 0 ? 0 : Math.min(activeIdx, items.length - 1);
  const go = (href: string) => { router.push(href); setOpen(false); };

  return (
    <div role="dialog" aria-modal="true" aria-label="Command palette"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-ink-900/40 p-4 pt-24 backdrop-blur-sm animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-pop animate-slide-up">
        <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3">
          <Search className="h-4 w-4 text-ink-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setActiveIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(items.length - 1, i + 1)); }
              if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); }
              if (e.key === 'Enter' && items[safeIdx]) { e.preventDefault(); go(items[safeIdx].href); }
            }}
            placeholder="Search assets, tickets, users, pages…"
            className="flex-1 bg-transparent text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          <kbd className="rounded border border-ink-200 px-1.5 py-0.5 text-[10px] text-ink-500">esc</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {items.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-ink-500">
              {searchError
                ? <span className="text-red-600">{searchError}</span>
                : q.length >= 2 ? 'No matches yet.' : 'Type at least 2 characters, or jump to a page.'}
            </div>
          )}
          {(['Assets', 'Tickets', 'People', 'Navigate'] as const).map((group) => {
            const rows = items.map((it, i) => ({ it, i })).filter(({ it }) => it.group === group);
            if (!rows.length) return null;
            return (
              <div key={group} className="px-2 pb-1.5">
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">{group}</div>
                {rows.map(({ it, i }) => (
                  <button
                    key={it.href + i}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => go(it.href)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === safeIdx ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-50'}`}
                  >
                    <span className={i === safeIdx ? 'text-white' : 'text-ink-400'}>{it.icon || <Search className="h-4 w-4" />}</span>
                    <span className="flex-1 truncate">{it.label}</span>
                    {it.sub && <span className={`truncate text-xs ${i === safeIdx ? 'text-white/70' : 'text-ink-400'}`}>{it.sub}</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-ink-100 bg-ink-50/50 px-4 py-2 text-[10px] text-ink-500">
          <span>↑ ↓ to navigate · ↵ to select</span>
          <span>⌘K / Ctrl+K to toggle</span>
        </div>
      </div>
    </div>
  );
}
