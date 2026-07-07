'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Package, CheckCircle2, UserCheck, Wrench, Archive,
  AlertTriangle, CalendarClock, KeyRound, FileWarning, Activity, HandHelping,
} from 'lucide-react';
import { Card, StatCard, Pill, SectionHeader, EmptyState, Skeleton } from '@/components/ui';
import { SetupChecklist } from '@/components/SetupChecklist';
import { usePermissions } from '@/lib/settings';

export default function DashboardHome() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api('/me') });
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api('/dashboard/stats') });
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api('/dashboard/alerts') });
  const perms = usePermissions();
  const isEmployee = perms.role === 'EMPLOYEE';
  // Employee-specific: count pending asset requests
  const myRequests = useQuery({
    queryKey: ['my-asset-requests-pending'],
    queryFn: () => api('/asset-requests?status=PENDING'),
    enabled: isEmployee,
  });
  const s = stats.data;

  return (
    <div className="space-y-6">
      <SectionHeader
        title={`Welcome back${me.data?.user ? ', ' + me.data.user.firstName : ''}`}
        subtitle="Here's what's happening across your workspace today."
      />

      <SetupChecklist />

      {!s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <StatCard label="Total assets" value={s.total} accent="brand" icon={<Package className="h-4 w-4" />} href="/dashboard/assets" />
          <StatCard label="In stock" value={s.byStatus?.IN_STOCK || 0} accent="green" icon={<CheckCircle2 className="h-4 w-4" />} href="/dashboard/assets?status=IN_STOCK" />
          <StatCard label="Assigned" value={s.byStatus?.ASSIGNED || 0} accent="brand" icon={<UserCheck className="h-4 w-4" />} href="/dashboard/assets?status=ASSIGNED" />
          <StatCard label="In repair" value={s.byStatus?.IN_REPAIR || 0} accent="amber" icon={<Wrench className="h-4 w-4" />} href="/dashboard/assets?status=IN_REPAIR" />
          <StatCard label="Retired" value={s.byStatus?.RETIRED || 0} icon={<Archive className="h-4 w-4" />} href="/dashboard/assets?status=RETIRED" />
          <StatCard label="Open tickets" value={s.openTickets || 0} accent="amber" icon={<AlertTriangle className="h-4 w-4" />} href="/dashboard/tickets?status=open" />
          <StatCard label="Licenses expiring" value={s.licensesExpiringSoon || 0} accent="red" icon={<KeyRound className="h-4 w-4" />} href="/dashboard/licenses?expiringInDays=30" />
        </div>
      )}

      {/* Employee-specific cards */}
      {isEmployee && s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatCard label="My pending requests" value={myRequests.data?.length || 0} accent="amber" icon={<HandHelping className="h-4 w-4" />} href="/dashboard/asset-requests" />
          <StatCard label="My open tickets" value={s.myOpenTickets ?? 0} accent="amber" icon={<AlertTriangle className="h-4 w-4" />} href="/dashboard/tickets?mine=true" />
          <StatCard label="My assets" value={s.myAssignedAssets ?? 0} accent="brand" icon={<UserCheck className="h-4 w-4" />} href="/dashboard/assets" />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left: by-category + recent activity */}
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">By category</h2>
              <a href="/dashboard/assets" className="text-xs text-brand-600 hover:underline">View all</a>
            </div>
            {!s ? (
              <Skeleton className="h-32" />
            ) : (s.byCategory || []).length === 0 ? (
              <EmptyState icon={<Package className="h-4 w-4" />} title="No assets yet" description="Add a category and your first asset to get started." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {(s.byCategory || []).map((c: any) => {
                  const pct = Math.round((c.count / Math.max(1, s.total)) * 100);
                  return (
                    <li key={c.id} className="flex items-center gap-3 py-2.5">
                      <span className="w-28 truncate text-sm font-medium text-ink-900">{c.name}</span>
                      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-500 to-brand-700" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-14 text-right font-mono text-xs text-ink-500">{c.count}</span>
                      <span className="w-12 text-right text-xs text-ink-400">{pct}%</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-ink-500" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Recent activity</h2>
            </div>
            {!s ? <Skeleton className="h-40" /> : (s.recentActivity || []).length === 0 ? (
              <EmptyState title="No activity yet" description="Asset, ticket and maintenance events will show up here." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {s.recentActivity.map((e: any) => (
                  <li key={e.id} className="flex items-center justify-between py-2.5 text-sm">
                    <div className="flex min-w-0 items-center gap-3">
                      <Pill tone="neutral">{e.action.replace(/_/g, ' ').toLowerCase()}</Pill>
                      {e.asset && (
                        <a className="truncate font-mono text-xs text-ink-700 hover:text-brand-600" href={`/dashboard/assets/${e.asset.id}`}>
                          {e.asset.assetTag} · <span className="font-sans text-ink-500">{e.asset.name}</span>
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-ink-400">
                      {e.performedBy && <span>{e.performedBy.firstName}</span>}
                      <span>{new Date(e.createdAt).toLocaleString()}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Right: Alerts */}
        <div className="space-y-4">
          <AlertGroup
            icon={<FileWarning className="h-4 w-4" />}
            tone="amber"
            title="Warranty expiring soon"
            empty="Nothing in the next 30 days."
            items={(alerts.data?.warranty || []).map((a: any) => ({
              href: `/dashboard/assets/${a.id}`,
              primary: `${a.assetTag} · ${a.name}`,
              secondary: new Date(a.warrantyEnd).toLocaleDateString(),
            }))}
          />
          <AlertGroup
            icon={<AlertTriangle className="h-4 w-4" />}
            tone="red"
            title="Overdue check-outs"
            empty="None right now."
            items={(alerts.data?.overdue || []).map((o: any) => ({
              href: `/dashboard/assets/${o.asset.id}`,
              primary: `${o.asset.assetTag}`,
              secondary: `${o.user ? `${o.user.firstName} ${o.user.lastName}` : 'Unknown user'} · due ${new Date(o.dueAt).toLocaleDateString()}`,
            }))}
          />
          <AlertGroup
            icon={<CalendarClock className="h-4 w-4" />}
            tone="brand"
            title="Maintenance due (7d)"
            empty="No upcoming maintenance."
            items={(alerts.data?.dueMaintenance || []).map((m: any) => ({
              href: `/dashboard/assets/${m.asset.id}`,
              primary: `${m.asset.assetTag} · ${m.title}`,
              secondary: new Date(m.nextDueAt).toLocaleDateString(),
            }))}
          />
          <AlertGroup
            icon={<Wrench className="h-4 w-4" />}
            tone="amber"
            title="Open service tickets"
            empty="All clear."
            items={(alerts.data?.openTickets || []).map((t: any) => ({
              href: `/dashboard/tickets/${t.id}`,
              primary: `${t.ticketNumber} · ${t.title}`,
              secondary: `${t.priority} · ${t.status}`,
            }))}
          />
          <AlertGroup
            icon={<KeyRound className="h-4 w-4" />}
            tone="red"
            title="Licenses expiring (30d)"
            empty="Nothing soon."
            items={(alerts.data?.expiringLicenses || []).map((l: any) => ({
              href: `/dashboard/licenses/${l.id}`,
              primary: l.software.name,
              secondary: new Date(l.expiresAt).toLocaleDateString(),
            }))}
          />
        </div>
      </div>
    </div>
  );
}

function AlertGroup({
  title, icon, tone, items, empty,
}: { title: string; icon: React.ReactNode; tone: 'brand' | 'amber' | 'red'; items: { href: string; primary: string; secondary: string }[]; empty: string }) {
  const toneClasses = {
    brand: 'bg-brand-50 text-brand-700 ring-brand-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    red: 'bg-rose-50 text-rose-700 ring-rose-200',
  }[tone];
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-inset ${toneClasses}`}>{icon}</span>
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        </div>
        <span className="text-xs text-ink-400">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="border-t border-ink-100 px-4 py-4 text-xs text-ink-500">{empty}</div>
      ) : (
        <ul className="divide-y divide-ink-100 border-t border-ink-100">
          {items.slice(0, 4).map((it, i) => (
            <li key={i}>
              <a href={it.href} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-ink-50">
                <span className="truncate text-ink-700">{it.primary}</span>
                <span className="ml-3 shrink-0 text-xs text-ink-400">{it.secondary}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
