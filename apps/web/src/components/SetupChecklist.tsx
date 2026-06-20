'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { CheckCircle2, Circle, X, ArrowRight, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const STORAGE = 'am.checklist.dismissed';

export function SetupChecklist() {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(typeof window !== 'undefined' && !!localStorage.getItem(STORAGE)); }, []);

  const stats = useQuery({ queryKey: ['checklist-stats'], queryFn: () => api<any>('/dashboard/stats') });
  const users = useQuery({ queryKey: ['checklist-users'], queryFn: () => api<any[]>('/users') });
  const settings = useQuery({ queryKey: ['tenant-settings'], queryFn: () => api<any>('/tenant-settings') });

  if (dismissed) return null;

  const hasAsset = (stats.data?.total ?? 0) > 0;
  const hasUsers = (users.data?.length ?? 0) > 1;
  const hasBranding = !!settings.data?.branding?.logoUrl || (settings.data?.branding?.appName && settings.data.branding.appName !== 'AssetMon');
  const hasTicketOrAudit = (stats.data?.openTickets ?? 0) > 0 || (stats.data?.recentActivity || []).some((e: any) => e.action.includes('CHECKED'));

  const steps = [
    { done: hasAsset,    label: 'Add or import your first asset',    href: '/dashboard/assets' },
    { done: hasUsers,    label: 'Invite a teammate',                  href: '/dashboard/users' },
    { done: hasBranding, label: 'Brand your workspace (logo + colour)', href: '/dashboard/settings/branding' },
    { done: hasTicketOrAudit, label: 'Check out an asset, or open a ticket', href: '/dashboard/assets' },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  if (doneCount === steps.length) return null;

  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-ink-200 bg-gradient-to-br from-brand-50 via-white to-cyan-50 p-5 shadow-card">
      <button
        aria-label="Dismiss"
        onClick={() => { localStorage.setItem(STORAGE, '1'); setDismissed(true); }}
        className="absolute right-3 top-3 rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-700">
        <Sparkles className="h-3.5 w-3.5" /> Get started
      </div>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink-900">You're {pct}% set up</h2>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white">
        <div className="h-full bg-gradient-to-r from-brand-500 to-brand-700" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((s) => (
          <li key={s.label}>
            <Link href={s.href} className="flex items-center gap-2.5 rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition hover:border-ink-300 hover:bg-white">
              {s.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-ink-300" />}
              <span className={s.done ? 'text-ink-400 line-through' : ''}>{s.label}</span>
              {!s.done && <ArrowRight className="ml-auto h-3.5 w-3.5 text-ink-400" />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
