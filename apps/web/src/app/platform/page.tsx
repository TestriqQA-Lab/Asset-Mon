'use client';
import { useQuery } from '@tanstack/react-query';
import { papi } from '@/lib/platform-api';
import { Card, Pill, QueryState } from '@/components/ui';
import { Building2, Users, Package, AlertTriangle, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

const STATUS_TONES: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  ACTIVE: 'green',
  PROVISIONING: 'amber',
  SUSPENDED: 'red',
  DELETED: 'gray',
};

export default function PlatformOverviewPage() {
  const router = useRouter();
  const metrics = useQuery({
    queryKey: ['platform-metrics'],
    queryFn: () => papi<any>('/platform/metrics'),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">Platform overview</h1>
        <p className="mt-0.5 text-sm text-ink-500">Cross-tenant snapshot of every workspace running on AssetMon.</p>
      </div>

      <QueryState query={metrics}>
        {(d: any) => {
          const cards: Array<{ label: string; value: string | number; icon: React.ReactNode; href?: string; tone?: 'brand' | 'green' | 'amber' | 'red' }> = [
            { label: 'Total tenants', value: d.tenants.total, icon: <Building2 className="h-5 w-5" />, href: '/platform/tenants', tone: 'brand' },
            { label: 'Active users', value: d.users, icon: <Users className="h-5 w-5" />, tone: 'green' },
            { label: 'Tracked assets', value: d.assets, icon: <Package className="h-5 w-5" />, tone: 'amber' },
            { label: 'Read errors', value: d.readErrors, icon: <AlertTriangle className="h-5 w-5" />, tone: d.readErrors ? 'red' : 'green' },
          ];
          return (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {cards.map((c) => (
                  <button
                    key={c.label}
                    onClick={() => c.href && router.push(c.href)}
                    className={'group flex items-start justify-between gap-3 rounded-xl border border-ink-200 bg-white p-5 text-left shadow-card transition hover:border-violet-300 ' + (c.href ? 'cursor-pointer' : 'cursor-default')}
                  >
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wider text-ink-500">{c.label}</div>
                      <div className="mt-2 text-3xl font-semibold tracking-tight text-ink-900">{c.value}</div>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50 text-violet-700 group-hover:bg-violet-100">
                      {c.icon}
                    </div>
                  </button>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Card>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-500">Tenants by status</h3>
                  <div className="space-y-2">
                    {Object.entries(d.tenants.byStatus || {}).map(([status, count]: any) => (
                      <div key={status} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2">
                        <Pill tone={STATUS_TONES[status] || 'gray'} dot>{status}</Pill>
                        <span className="font-mono text-sm text-ink-700">{count}</span>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-500">Tenants by plan</h3>
                  <div className="space-y-2">
                    {Object.entries(d.tenants.byPlan || {}).map(([plan, count]: any) => (
                      <div key={plan} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2">
                        <span className="text-sm capitalize text-ink-700">{plan}</span>
                        <span className="font-mono text-sm text-ink-700">{count}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Recent signups (7 days)</h3>
                  <a href="/platform/tenants" className="text-xs text-violet-700 hover:underline">View all →</a>
                </div>
                {d.recentTenants.length === 0 ? (
                  <p className="text-sm text-ink-500">No new signups in the last 7 days.</p>
                ) : (
                  <div className="divide-y divide-ink-100">
                    {d.recentTenants.map((t: any) => (
                      <a
                        key={t.id}
                        href={`/platform/tenants/${t.id}`}
                        className="flex items-center justify-between gap-3 py-2.5 hover:bg-ink-50/60"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-ink-900">{t.name}</div>
                          <div className="truncate text-xs text-ink-500">{t.slug} · {new Date(t.createdAt).toLocaleString()}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Pill tone={STATUS_TONES[t.status] || 'gray'}>{t.status}</Pill>
                          <Pill tone="brand">{t.plan}</Pill>
                          <ChevronRight className="hidden h-4 w-4 text-ink-400 sm:block" />
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </Card>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
