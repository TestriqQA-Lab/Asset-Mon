'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { papi } from '@/lib/platform-api';
import { Pill, QueryState, inputClass, selectClass, MobileCard, MobileCardRow } from '@/components/ui';
import { Search, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

const STATUS_TONES: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  ACTIVE: 'green', PROVISIONING: 'amber', SUSPENDED: 'red', DELETED: 'gray',
};

export default function TenantsPage() {
  const r = useRouter();
  const [filter, setFilter] = useState({ search: '', status: 'all', plan: 'all' });
  const tenants = useQuery({
    queryKey: ['platform-tenants', filter],
    queryFn: () => papi<any[]>(`/platform/tenants?search=${encodeURIComponent(filter.search)}&status=${filter.status}&plan=${filter.plan}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Tenants</h1>
          <p className="text-sm text-ink-500">Every workspace on the platform.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-xl border border-ink-200 bg-white p-3 shadow-card sm:grid-cols-2 md:flex md:flex-wrap md:items-center">
        <div className="relative sm:col-span-2 md:flex-1 md:min-w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            className={inputClass + ' pl-8'}
            placeholder="Search by name or slug…"
            value={filter.search}
            onChange={(e) => setFilter({ ...filter, search: e.target.value })}
          />
        </div>
        <select className={selectClass + ' md:w-44'} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="all">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="PROVISIONING">Provisioning</option>
          <option value="DELETED">Deleted</option>
        </select>
        <select className={selectClass + ' md:w-44'} value={filter.plan} onChange={(e) => setFilter({ ...filter, plan: e.target.value })}>
          <option value="all">All plans</option>
          <option value="starter">Starter</option>
          <option value="business">Business</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>

      <QueryState query={tenants}>
        {(rows: any[]) => (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-card">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="px-4 py-2.5">Workspace</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Plan</th>
                    <th className="px-4 py-2.5">Subscription</th>
                    <th className="px-4 py-2.5 text-right">Users</th>
                    <th className="px-4 py-2.5 text-right">Assets</th>
                    <th className="px-4 py-2.5">Created</th>
                    <th className="px-4 py-2.5 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t: any) => (
                    <tr
                      key={t.id}
                      onClick={() => r.push(`/platform/tenants/${t.id}`)}
                      className="cursor-pointer border-t border-ink-100 hover:bg-violet-50/40"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink-900">{t.name}</div>
                        <div className="text-xs text-ink-500">{t.slug}</div>
                      </td>
                      <td className="px-4 py-3"><Pill tone={STATUS_TONES[t.status] || 'gray'} dot>{t.status}</Pill></td>
                      <td className="px-4 py-3"><Pill tone="brand">{t.plan}</Pill></td>
                      <td className="px-4 py-3 text-xs text-ink-600">{t.subscriptionStatus}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{t.userCount}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{t.assetCount}</td>
                      <td className="px-4 py-3 text-xs text-ink-500">{new Date(t.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-ink-300"><ChevronRight className="h-4 w-4" /></td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-ink-500">No tenants match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="space-y-2 md:hidden">
              {rows.map((t: any) => (
                <li key={t.id}>
                  <MobileCard onClick={() => r.push(`/platform/tenants/${t.id}`)}>
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink-900">{t.name}</div>
                        <div className="truncate text-xs text-ink-500">{t.slug}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Pill tone={STATUS_TONES[t.status] || 'gray'} dot>{t.status}</Pill>
                      </div>
                    </div>
                    <MobileCardRow label="Plan" value={<Pill tone="brand">{t.plan}</Pill>} />
                    <MobileCardRow label="Subscription" value={t.subscriptionStatus} />
                    <MobileCardRow label="Users" value={t.userCount} mono />
                    <MobileCardRow label="Assets" value={t.assetCount} mono />
                    <MobileCardRow label="Created" value={new Date(t.createdAt).toLocaleDateString()} />
                  </MobileCard>
                </li>
              ))}
              {rows.length === 0 && (
                <li className="rounded-lg border border-dashed border-ink-200 bg-white/60 p-6 text-center text-sm text-ink-500">
                  No tenants match.
                </li>
              )}
            </ul>
          </>
        )}
      </QueryState>
    </div>
  );
}
