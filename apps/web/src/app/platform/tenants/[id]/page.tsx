'use client';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { papi } from '@/lib/platform-api';
import { Card, Pill, QueryState } from '@/components/ui';
import { StatCard, Row, useCopy } from './_shared';

/**
 * Overview section — stats, workspace info, tenant admins.
 * This was the top portion of the original 703-line monolithic page.
 */
export default function TenantOverviewPage() {
  const params = useParams();
  const id = params?.id as string;
  const { copied, copy } = useCopy();

  const tenant = useQuery({
    queryKey: ['platform-tenant', id],
    queryFn: () => papi<any>(`/platform/tenants/${id}`),
    enabled: !!id,
  });

  return (
    <QueryState query={tenant}>
      {(t: any) => (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Users" value={t.stats.userCount} />
            <StatCard label="Assets" value={t.stats.assetCount} />
            <StatCard label="Tickets" value={t.stats.ticketCount} />
            <StatCard label="Last activity" value={t.stats.lastActivityAt ? new Date(t.stats.lastActivityAt).toLocaleDateString() : '—'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Workspace</h3>
              <Row label="ID" value={t.id} mono onCopy={() => copy(t.id)} copied={copied} />
              <Row label="Slug" value={t.slug} mono />
              <Row label="DB" value={t.dbName} mono />
              <Row label="Created" value={new Date(t.createdAt).toLocaleString()} />
            </Card>

            <Card>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Tenant admins</h3>
              {t.admins.length === 0 ? (
                <p className="text-sm text-ink-500">No admin users.</p>
              ) : (
                <div className="space-y-1.5">
                  {t.admins.map((a: any) => (
                    <div key={a.id} className="rounded-lg border border-ink-100 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium text-ink-900">{a.firstName} {a.lastName}</div>
                          <div className="text-xs text-ink-500">{a.email}</div>
                        </div>
                        {a.totpEnabled && <Pill tone="green">2FA</Pill>}
                        {!a.active && <Pill tone="red">Disabled</Pill>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </QueryState>
  );
}
