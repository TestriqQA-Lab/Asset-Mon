'use client';
import { useQuery } from '@tanstack/react-query';
import { api, getSession } from '@/lib/api';
import { Card, Pill, QueryState, EmptyState, SectionHeader } from '@/components/ui';
import { MODULE_KEYS, type ModuleKey, type TenantSettings } from '@/lib/settings';
import {
  Shield, Users, KeyRound, Sliders, LifeBuoy, ListChecks, ScrollText,
  ArrowRight, CheckCircle2,
} from 'lucide-react';

// Same names the Modules settings page shows, so the two pages never disagree.
const MODULE_NAMES: Record<ModuleKey, string> = {
  tickets: 'Service tickets', maintenance: 'Maintenance', reservations: 'Reservations',
  audits: 'Physical audits', procurement: 'Procurement', depreciation: 'Depreciation',
  software: 'Software & licenses', reports: 'Reports', integrations: 'Integrations',
};

const ROLE_ROWS: Array<[string, string]> = [
  ['ADMIN', 'Admins'],
  ['ASSET_MANAGER', 'Asset managers'],
  ['EMPLOYEE', 'Employees'],
];

const QUICK_ACTIONS = [
  { href: '/dashboard/users', label: 'Users & invites' },
  { href: '/dashboard/settings/modules', label: 'Modules' },
  { href: '/dashboard/data-quality', label: 'Data quality' },
  { href: '/dashboard/audit', label: 'Audit log' },
  { href: '/dashboard/get-help', label: 'Get help' },
];

type DqCheck = { key: string; label: string; count: number; href: string };
type AuditEntry = {
  id: string;
  createdAt: string;
  action: string;
  performedBy?: { firstName: string; lastName: string; email: string } | null;
};

function CardTitle({ icon, title, right }: { icon: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
        <span className="text-ink-400">{icon}</span> {title}
      </h2>
      {right}
    </div>
  );
}

function GoLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
      {children} <ArrowRight className="h-3.5 w-3.5" />
    </a>
  );
}

export default function AdminHomePage() {
  const session = getSession();
  const isAdmin = session?.user.role === 'ADMIN';

  const users = useQuery({ queryKey: ['users'], queryFn: () => api<any[]>('/users'), enabled: isAdmin });
  const invite = useQuery({
    queryKey: ['workspace-invite'],
    queryFn: () => api<{ token: string | null; enabled: boolean; disabled?: boolean }>('/workspace-invite'),
    enabled: isAdmin,
  });
  const settings = useQuery({ queryKey: ['tenant-settings'], queryFn: () => api<TenantSettings>('/tenant-settings'), enabled: isAdmin });
  const support = useQuery({ queryKey: ['support'], queryFn: () => api<any[]>('/support'), enabled: isAdmin });
  const unread = useQuery({ queryKey: ['support-unread'], queryFn: () => api<{ count: number }>('/support/unread-count'), enabled: isAdmin });
  const dq = useQuery({ queryKey: ['data-quality'], queryFn: () => api<{ checks: DqCheck[] }>('/data-quality'), enabled: isAdmin });
  const audit = useQuery({ queryKey: ['audit', 25], queryFn: () => api<AuditEntry[]>('/audit?limit=25'), enabled: isAdmin });

  if (!isAdmin) {
    return (
      <EmptyState
        icon={<Shield className="h-5 w-5" />}
        title="Admins only"
        description="This page is for workspace admins. Ask an admin if you need something changed."
      />
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader title="Admin home" subtitle="Everything you manage as an admin, in one place." />

      <div className="flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((a) => (
          <a
            key={a.href}
            href={a.href}
            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 shadow-card transition hover:border-ink-300"
          >
            {a.label}
          </a>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardTitle icon={<Users className="h-4 w-4" />} title="People & roles" />
          <QueryState query={users}>
            {(rows: any[]) => {
              const active = rows.filter((u) => u.active);
              const inactive = rows.length - active.length;
              const mfaOn = active.filter((u) => u.mfaMethod && u.mfaMethod !== 'NONE').length;
              return (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-ink-900">{active.length}</span>
                    <span className="text-xs text-ink-500">active {active.length === 1 ? 'user' : 'users'}</span>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-ink-600">
                    {ROLE_ROWS.map(([role, label]) => (
                      <li key={role} className="flex justify-between">
                        <span>{label}</span>
                        <span className="font-medium text-ink-800">{active.filter((u) => u.role === role).length}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Pill tone={mfaOn > 0 ? 'green' : 'gray'}>{mfaOn} MFA on</Pill>
                    {inactive > 0 && <Pill tone="gray">{inactive} deactivated</Pill>}
                  </div>
                  <GoLink href="/dashboard/users">Manage users</GoLink>
                </>
              );
            }}
          </QueryState>
        </Card>

        <Card>
          <CardTitle icon={<KeyRound className="h-4 w-4" />} title="Workspace invite" />
          <QueryState query={invite}>
            {(inv: { token: string | null; enabled: boolean; disabled?: boolean }) => (
              <>
                <div>
                  {inv.disabled ? (
                    <Pill tone="amber" dot>Invite link disabled</Pill>
                  ) : inv.enabled ? (
                    // enabled without plaintext (needsRotation) is still an ACTIVE link —
                    // the server only shows the text right after issuing it.
                    <Pill tone="green" dot>Active</Pill>
                  ) : (
                    <Pill tone="gray" dot>No link</Pill>
                  )}
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  {inv.disabled
                    ? 'New teammates cannot join via the link until it is re-enabled with Regenerate.'
                    : 'Anyone with the link can join this workspace as an employee.'}
                </p>
                <GoLink href="/dashboard/users">Manage invite link</GoLink>
              </>
            )}
          </QueryState>
        </Card>

        <Card>
          <CardTitle icon={<Sliders className="h-4 w-4" />} title="Features" />
          <QueryState query={settings}>
            {(s: TenantSettings) => {
              const off = MODULE_KEYS.filter((k) => !s.modules[k]);
              return (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-ink-900">{MODULE_KEYS.length - off.length}</span>
                    <span className="text-xs text-ink-500">of {MODULE_KEYS.length} modules enabled</span>
                  </div>
                  {off.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {off.map((k) => <Pill key={k} tone="gray">{MODULE_NAMES[k]} off</Pill>)}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-ink-400">Everything is switched on.</p>
                  )}
                  <GoLink href="/dashboard/settings/modules">Manage modules</GoLink>
                </>
              );
            }}
          </QueryState>
        </Card>

        <Card>
          <CardTitle
            icon={<LifeBuoy className="h-4 w-4" />}
            title="Support"
            right={(unread.data?.count ?? 0) > 0 ? <Pill tone="red" dot>{unread.data!.count} unread</Pill> : undefined}
          />
          <QueryState query={support}>
            {(rows: any[]) => {
              const open = rows.filter((r) => r.status !== 'RESOLVED').length;
              return (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-ink-900">{open}</span>
                    <span className="text-xs text-ink-500">open {open === 1 ? 'request' : 'requests'}</span>
                  </div>
                  <p className="mt-2 text-xs text-ink-500">
                    {rows.length === 0
                      ? 'No help requests yet — open one if you get stuck.'
                      : `${rows.length} total ${rows.length === 1 ? 'request' : 'requests'} with the AssetMon team.`}
                  </p>
                  <GoLink href="/dashboard/get-help">Open Get help</GoLink>
                </>
              );
            }}
          </QueryState>
        </Card>

        <Card>
          <CardTitle icon={<ListChecks className="h-4 w-4" />} title="Data quality" />
          <QueryState query={dq}>
            {(data: { checks: DqCheck[] }) => {
              const issues = data.checks.filter((c) => c.count > 0);
              const total = issues.reduce((n, c) => n + c.count, 0);
              if (total === 0) {
                return (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> All clear — no hygiene issues found.
                  </p>
                );
              }
              return (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-ink-900">{total}</span>
                    <span className="text-xs text-ink-500">{total === 1 ? 'issue' : 'issues'} worth a look</span>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-ink-600">
                    {issues.map((c) => (
                      <li key={c.key} className="flex justify-between gap-2">
                        <a href={c.href} className="truncate hover:underline">{c.label}</a>
                        <span className="font-medium text-ink-800">{c.count}</span>
                      </li>
                    ))}
                  </ul>
                  <GoLink href="/dashboard/data-quality">Open Data quality</GoLink>
                </>
              );
            }}
          </QueryState>
        </Card>

        <Card>
          <CardTitle icon={<ScrollText className="h-4 w-4" />} title="Recent activity" />
          <QueryState query={audit}>
            {(rows: AuditEntry[]) => rows.length === 0 ? (
              <p className="text-xs text-ink-400">Nothing logged yet.</p>
            ) : (
              <>
                <ul className="space-y-1 text-xs text-ink-600">
                  {rows.slice(0, 8).map((e) => (
                    <li key={e.id} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-ink-800">{e.action}</span>
                        {e.performedBy && (
                          <span className="text-ink-400"> · {e.performedBy.firstName} {e.performedBy.lastName}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-400">{new Date(e.createdAt).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
                <GoLink href="/dashboard/audit">Open Audit log</GoLink>
              </>
            )}
          </QueryState>
        </Card>
      </div>
    </div>
  );
}
