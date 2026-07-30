'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { papi } from '@/lib/platform-api';
import { Pill } from '@/components/ui';
import { ArrowLeft, LayoutDashboard, CreditCard, ToggleLeft, UsersRound, Link2, AlertTriangle } from 'lucide-react';
import { STATUS_TONES } from './_shared';

const SECTIONS = [
  { href: '', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
  { href: '/plan', label: 'Plan & billing', icon: <CreditCard className="h-4 w-4" /> },
  { href: '/features', label: 'Features', icon: <ToggleLeft className="h-4 w-4" /> },
  { href: '/users', label: 'Users', icon: <UsersRound className="h-4 w-4" /> },
  { href: '/access', label: 'Access', icon: <Link2 className="h-4 w-4" /> },
  { href: '/danger', label: 'Danger zone', icon: <AlertTriangle className="h-4 w-4" /> },
];

/**
 * Sub-navigation layout for the tenant detail area. Follows the same pattern
 * as `/dashboard/settings/layout.tsx`: a left rail with section links.
 */
export default function TenantDetailLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const id = params?.id as string;
  const path = usePathname() || '';
  const base = `/platform/tenants/${id}`;

  const tenant = useQuery({
    queryKey: ['platform-tenant', id],
    queryFn: () => papi<any>(`/platform/tenants/${id}`),
    enabled: !!id,
  });

  const t = tenant.data;

  return (
    <div className="space-y-4">
      <Link
        href="/platform/tenants"
        className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-700"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to tenants
      </Link>

      {/* Tenant header — shown on all sub-pages */}
      {t && (
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-ink-500">{t.slug}</div>
          <h1 className="truncate text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">{t.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Pill tone={STATUS_TONES[t.status] || 'gray'} dot>{t.status}</Pill>
            <Pill tone="brand">Plan: {t.plan}</Pill>
            <Pill tone="purple">{t.subscriptionStatus}</Pill>
          </div>
        </div>
      )}

      {/* Horizontal scrollable tab bar */}
      <nav className="sticky top-14 z-20 -mx-4 flex gap-4 overflow-x-auto border-b border-ink-200 bg-white/90 px-4 backdrop-blur sm:mx-0 sm:px-0" aria-label="Tenant sections">
        {SECTIONS.map((s) => {
          const href = base + s.href;
          const isActive = s.href === ''
            ? (path === base || path === base + '/')
            : (path === href || path.startsWith(href + '/'));
            
          let colorClasses = isActive
            ? 'border-violet-600 text-violet-700'
            : 'border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-700';
            
          if (s.href === '/danger' && !isActive) {
            colorClasses = 'border-transparent text-rose-500 hover:border-rose-300 hover:text-rose-700';
          } else if (s.href === '/danger' && isActive) {
            colorClasses = 'border-rose-600 text-rose-700';
          }
            
          return (
            <Link
              key={s.href}
              href={href}
              className={`whitespace-nowrap border-b-2 pb-2.5 pt-3 text-sm font-medium transition-colors ${colorClasses}`}
            >
              <div className="flex items-center gap-2">
                {s.icon}
                {s.label}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="min-w-0 pt-2">{children}</div>
    </div>
  );
}
