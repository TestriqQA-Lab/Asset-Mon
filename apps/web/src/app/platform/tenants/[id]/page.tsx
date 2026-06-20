'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { papi } from '@/lib/platform-api';
import { Card, Pill, QueryState, Button, inputClass, selectClass, Field, MobileCard, MobileCardRow } from '@/components/ui';
import { Modal } from '@/components/Modal';
import {
  ArrowLeft, Pause, Play, Trash2, KeyRound, UserCog, ExternalLink, Copy, Check,
} from 'lucide-react';

const STATUS_TONES: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  ACTIVE: 'green', PROVISIONING: 'amber', SUSPENDED: 'red', DELETED: 'gray',
};

export default function TenantDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const r = useRouter();
  const qc = useQueryClient();

  const tenant = useQuery({
    queryKey: ['platform-tenant', id],
    queryFn: () => papi<any>(`/platform/tenants/${id}`),
    enabled: !!id,
  });

  const tenantUsers = useQuery({
    queryKey: ['platform-tenant-users', id],
    queryFn: () => papi<any[]>(`/platform/tenants/${id}/users`),
    enabled: !!id,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['platform-tenant', id] });
    qc.invalidateQueries({ queryKey: ['platform-tenant-users', id] });
    qc.invalidateQueries({ queryKey: ['platform-tenants'] });
  };

  const suspend = useMutation({
    mutationFn: () => papi(`/platform/tenants/${id}/suspend`, { method: 'POST' }),
    onSuccess: () => { toast.success('Workspace suspended'); refresh(); },
  });
  const activate = useMutation({
    mutationFn: () => papi(`/platform/tenants/${id}/activate`, { method: 'POST' }),
    onSuccess: () => { toast.success('Workspace activated'); refresh(); },
  });
  const setPlan = useMutation({
    mutationFn: (plan: string) => papi(`/platform/tenants/${id}/plan`, { method: 'PATCH', body: JSON.stringify({ plan }) }),
    onSuccess: () => { toast.success('Plan updated'); refresh(); },
  });

  const [delConfirm, setDelConfirm] = useState(false);
  const [delSlug, setDelSlug] = useState('');
  const remove = useMutation({
    mutationFn: () => papi(`/platform/tenants/${id}?confirmSlug=${encodeURIComponent(delSlug)}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Workspace deleted');
      setDelConfirm(false);
      r.push('/platform/tenants');
    },
  });

  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [tempPwd, setTempPwd] = useState<string | null>(null);
  const resetUser = useMutation({
    mutationFn: (userId: string) => papi<any>(`/platform/tenants/${id}/users/${userId}/reset-password`, { method: 'POST' }),
    onSuccess: (d) => {
      setTempPwd(d.tempPassword);
      toast.success('Password reset — share the temporary password with the user securely.');
    },
  });

  const impersonate = useMutation({
    mutationFn: (userId: string) => papi<any>(`/platform/tenants/${id}/users/${userId}/impersonate`, { method: 'POST' }),
    onSuccess: (d) => {
      // Switch to a tenant session and open the dashboard. We mark it impersonated
      // for clarity; the main app reads `am.session` so we have to write that key.
      const tenantSession = {
        accessToken: d.accessToken,
        refreshToken: '',
        tenant: d.tenant,
        user: d.user,
      };
      localStorage.setItem('am.session', JSON.stringify(tenantSession));
      toast.success(`Impersonating ${d.user.email} — opening dashboard…`);
      // `noopener,noreferrer` prevents the popup from getting a window.opener
      // back to the platform console (window.opener.location = … is the
      // classic reverse-tabnabbing attack). It also strips the Referer header
      // so the impersonation URL is not leaked into tenant-side analytics or
      // any 3rd-party script the tenant dashboard might load.
      window.open('/dashboard', '_blank', 'noopener,noreferrer');
    },
  });

  const [copied, setCopied] = useState(false);
  const copy = async (s: string) => {
    try { await navigator.clipboard.writeText(s); }
    catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-5">
      <button onClick={() => r.push('/platform/tenants')} className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-700">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to tenants
      </button>

      <QueryState query={tenant}>
        {(t: any) => (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wider text-ink-500">{t.slug}</div>
                <h1 className="truncate text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">{t.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Pill tone={STATUS_TONES[t.status] || 'gray'} dot>{t.status}</Pill>
                  <Pill tone="brand">Plan: {t.plan}</Pill>
                  <Pill tone="purple">{t.subscriptionStatus}</Pill>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {t.status === 'SUSPENDED' ? (
                  <Button variant="secondary" icon={<Play className="h-4 w-4" />} loading={activate.isPending} onClick={() => activate.mutate()}>
                    Activate
                  </Button>
                ) : t.status === 'ACTIVE' ? (
                  <Button variant="secondary" icon={<Pause className="h-4 w-4" />} loading={suspend.isPending} onClick={() => suspend.mutate()}>
                    Suspend
                  </Button>
                ) : null}
                <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDelConfirm(true)} disabled={t.status === 'DELETED'}>
                  Delete tenant
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Users" value={t.stats.userCount} />
              <StatCard label="Assets" value={t.stats.assetCount} />
              <StatCard label="Tickets" value={t.stats.ticketCount} />
              <StatCard label="Last activity" value={t.stats.lastActivityAt ? new Date(t.stats.lastActivityAt).toLocaleDateString() : '—'} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Workspace</h3>
                <Row label="ID" value={t.id} mono onCopy={() => copy(t.id)} copied={copied} />
                <Row label="Slug" value={t.slug} mono />
                <Row label="DB" value={t.dbName} mono />
                <Row label="Created" value={new Date(t.createdAt).toLocaleString()} />
              </Card>

              <Card>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Plan</h3>
                <Field label="Plan">
                  <select className={selectClass} value={t.plan} onChange={(e) => setPlan.mutate(e.target.value)} disabled={setPlan.isPending}>
                    <option value="starter">Starter</option>
                    <option value="business">Business</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </Field>
                <div className="mt-3 text-xs text-ink-500">
                  Subscription: <span className="font-medium text-ink-700">{t.subscriptionStatus}</span>
                </div>
                {t.trialEndsAt && (
                  <div className="text-xs text-ink-500">
                    Trial ends: <span className="font-medium text-ink-700">{new Date(t.trialEndsAt).toLocaleDateString()}</span>
                  </div>
                )}
                {t.currentPeriodEnd && (
                  <div className="text-xs text-ink-500">
                    Current period ends: <span className="font-medium text-ink-700">{new Date(t.currentPeriodEnd).toLocaleDateString()}</span>
                  </div>
                )}
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

            <Card padded={false}>
              <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-500">All tenant users</h3>
              </div>
              <QueryState query={tenantUsers}>
                {(rows: any[]) => (
                  <>
                    {/* Desktop table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-ink-50 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                          <tr>
                            <th className="px-4 py-2.5">User</th>
                            <th className="px-4 py-2.5">Role</th>
                            <th className="px-4 py-2.5">2FA</th>
                            <th className="px-4 py-2.5">Active</th>
                            <th className="px-4 py-2.5">Locked?</th>
                            <th className="px-4 py-2.5">Created</th>
                            <th className="px-4 py-2.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((u: any) => (
                            <tr key={u.id} className="border-t border-ink-100">
                              <td className="px-4 py-2.5">
                                <div className="font-medium text-ink-900">{u.firstName} {u.lastName}</div>
                                <div className="text-xs text-ink-500">{u.email}</div>
                              </td>
                              <td className="px-4 py-2.5"><Pill tone={u.role === 'ADMIN' ? 'brand' : 'gray'}>{u.role}</Pill></td>
                              <td className="px-4 py-2.5 text-xs">{u.totpEnabled ? '✓' : '—'}</td>
                              <td className="px-4 py-2.5 text-xs">{u.active ? '✓' : '—'}</td>
                              <td className="px-4 py-2.5 text-xs">{u.lockedUntil ? new Date(u.lockedUntil).toLocaleString() : '—'}</td>
                              <td className="px-4 py-2.5 text-xs text-ink-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                              <td className="px-4 py-2.5 text-right">
                                <div className="inline-flex flex-wrap justify-end gap-1.5">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    icon={<KeyRound className="h-3.5 w-3.5" />}
                                    onClick={() => { setResetUserId(u.id); setTempPwd(null); resetUser.mutate(u.id); }}
                                    loading={resetUser.isPending && resetUserId === u.id}
                                  >
                                    Reset password
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    icon={<UserCog className="h-3.5 w-3.5" />}
                                    onClick={() => impersonate.mutate(u.id)}
                                    loading={impersonate.isPending}
                                  >
                                    Impersonate
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile cards */}
                    <ul className="space-y-2 p-3 md:hidden">
                      {rows.map((u: any) => (
                        <li key={u.id}>
                          <MobileCard>
                            <div className="mb-1.5 flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate font-medium text-ink-900">{u.firstName} {u.lastName}</div>
                                <div className="truncate text-xs text-ink-500">{u.email}</div>
                              </div>
                              <Pill tone={u.role === 'ADMIN' ? 'brand' : 'gray'}>{u.role}</Pill>
                            </div>
                            <MobileCardRow label="2FA" value={u.totpEnabled ? '✓' : '—'} />
                            <MobileCardRow label="Active" value={u.active ? '✓' : '—'} />
                            <MobileCardRow label="Locked" value={u.lockedUntil ? new Date(u.lockedUntil).toLocaleString() : '—'} />
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                icon={<KeyRound className="h-3.5 w-3.5" />}
                                onClick={() => { setResetUserId(u.id); setTempPwd(null); resetUser.mutate(u.id); }}
                                loading={resetUser.isPending && resetUserId === u.id}
                              >
                                Reset password
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                icon={<UserCog className="h-3.5 w-3.5" />}
                                onClick={() => impersonate.mutate(u.id)}
                                loading={impersonate.isPending}
                              >
                                Impersonate
                              </Button>
                            </div>
                          </MobileCard>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </QueryState>
            </Card>

            {/* Delete confirmation */}
            <Modal
              open={delConfirm}
              onClose={() => { setDelConfirm(false); setDelSlug(''); }}
              title={`Delete workspace "${t.name}"`}
              footer={
                <>
                  <Button variant="secondary" onClick={() => { setDelConfirm(false); setDelSlug(''); }}>Cancel</Button>
                  <Button
                    variant="danger"
                    icon={<Trash2 className="h-4 w-4" />}
                    disabled={delSlug !== t.slug || remove.isPending}
                    loading={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    Permanently delete
                  </Button>
                </>
              }
            >
              <div className="space-y-3 text-sm">
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">
                  <p className="font-semibold">This will drop the tenant database.</p>
                  <p className="mt-1">All users, assets, attachments, and history for <strong>{t.name}</strong> will be lost. This cannot be undone.</p>
                </div>
                <Field label={`Type "${t.slug}" to confirm`}>
                  <input className={inputClass} value={delSlug} onChange={(e) => setDelSlug(e.target.value)} placeholder={t.slug} autoFocus />
                </Field>
              </div>
            </Modal>

            {/* Temp password reveal */}
            <Modal
              open={!!tempPwd}
              onClose={() => { setTempPwd(null); setResetUserId(null); }}
              title="Temporary password generated"
              footer={
                <Button variant="secondary" onClick={() => { setTempPwd(null); setResetUserId(null); }}>Done</Button>
              }
            >
              <div className="space-y-3 text-sm">
                <p>Share this with the user over a secure channel. They can sign in and change it from <em>Account → Security</em>.</p>
                <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-sm">
                  <span className="flex-1 break-all">{tempPwd}</span>
                  <button onClick={() => tempPwd && copy(tempPwd)} className="rounded p-1 hover:bg-white">
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-ink-500" />}
                  </button>
                </div>
                <p className="text-xs text-ink-500">All of this user's existing sessions have been invalidated.</p>
              </div>
            </Modal>
          </>
        )}
      </QueryState>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-card">
      <div className="text-xs font-medium uppercase tracking-wider text-ink-500">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function Row({ label, value, mono, onCopy, copied }: { label: string; value: string; mono?: boolean; onCopy?: () => void; copied?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink-100 py-1.5 last:border-0">
      <span className="text-xs text-ink-500">{label}</span>
      <span className={'text-xs ' + (mono ? 'font-mono text-ink-800' : 'text-ink-700')}>
        {value}
        {onCopy && (
          <button onClick={onCopy} className="ml-1 inline-flex rounded p-0.5 align-text-bottom text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </span>
    </div>
  );
}
