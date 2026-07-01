'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { papi, getPlatformSession } from '@/lib/platform-api';
import { Card, Pill, QueryState, Button, EmptyState, inputClass, textareaClass, selectClass, Field, MobileCard, MobileCardRow } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { Plus, Pencil, Trash2, Megaphone } from 'lucide-react';

type Announcement = {
  id: string;
  title: string;
  body: string;
  severity: string;
  audienceType: string;
  audiencePlans: string[];
  audienceTenantIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  version: number;
  createdByEmail: string;
  createdAt: string;
};

type FormState = {
  id?: string;
  title: string;
  body: string;
  severity: string;
  audienceType: string;
  audiencePlans: string[];
  audienceTenantIds: string[];
  startsAt: string; // datetime-local value ('' = none)
  endsAt: string;
  active: boolean;
};

const EMPTY: FormState = {
  title: '', body: '', severity: 'info', audienceType: 'ALL',
  audiencePlans: [], audienceTenantIds: [], startsAt: '', endsAt: '', active: true,
};

const SEVERITY_TONE: Record<string, 'blue' | 'amber' | 'red'> = { info: 'blue', warning: 'amber', critical: 'red' };

// ISO <-> <input type="datetime-local"> (which is local, zoneless).
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}
function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function PlatformAnnouncementsPage() {
  const qc = useQueryClient();
  const isSuper = getPlatformSession()?.user.role === 'SUPER_ADMIN';

  const list = useQuery({ queryKey: ['platform-announcements'], queryFn: () => papi<Announcement[]>('/platform/announcements') });
  const plansQ = useQuery({ queryKey: ['platform-plans'], queryFn: () => papi<any[]>('/platform/plans') });
  const tenantsQ = useQuery({ queryKey: ['platform-tenants-min'], queryFn: () => papi<any>('/platform/tenants') });
  const tenants: any[] = Array.isArray(tenantsQ.data) ? tenantsQ.data : tenantsQ.data?.rows ?? [];
  const plans: any[] = plansQ.data ?? [];
  const tenantById = useMemo(() => Object.fromEntries(tenants.map((t) => [t.id, t])), [tenants]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [tenantSearch, setTenantSearch] = useState('');

  const openNew = () => { setForm(EMPTY); setTenantSearch(''); setOpen(true); };
  const openEdit = (a: Announcement) => {
    setForm({
      id: a.id, title: a.title, body: a.body, severity: a.severity, audienceType: a.audienceType,
      audiencePlans: a.audiencePlans ?? [], audienceTenantIds: a.audienceTenantIds ?? [],
      startsAt: isoToLocalInput(a.startsAt), endsAt: isoToLocalInput(a.endsAt), active: a.active,
    });
    setTenantSearch('');
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim(),
        severity: form.severity,
        audienceType: form.audienceType,
        audiencePlans: form.audienceType === 'PLAN' ? form.audiencePlans : [],
        audienceTenantIds: form.audienceType === 'TENANTS' ? form.audienceTenantIds : [],
        startsAt: localInputToIso(form.startsAt),
        endsAt: localInputToIso(form.endsAt),
        active: form.active,
      };
      return form.id
        ? papi(`/platform/announcements/${form.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : papi('/platform/announcements', { method: 'POST', body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      toast.success(form.id ? 'Announcement updated' : 'Announcement posted');
      setOpen(false);
      setForm(EMPTY);
      qc.invalidateQueries({ queryKey: ['platform-announcements'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Save failed'),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      papi(`/platform/announcements/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-announcements'] }),
    onError: (e: any) => toast.error(e?.message || 'Update failed'),
  });

  const del = useMutation({
    mutationFn: (id: string) => papi(`/platform/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('Announcement deleted'); qc.invalidateQueries({ queryKey: ['platform-announcements'] }); },
    onError: (e: any) => toast.error(e?.message || 'Delete failed'),
  });

  const submit = () => {
    if (!form.title.trim()) return toast.error('Title is required');
    if (!form.body.trim()) return toast.error('Message is required');
    if (form.audienceType === 'PLAN' && form.audiencePlans.length === 0) return toast.error('Pick at least one plan tier');
    if (form.audienceType === 'TENANTS' && form.audienceTenantIds.length === 0) return toast.error('Pick at least one company');
    save.mutate();
  };

  const audienceLabel = (a: Announcement) => {
    if (a.audienceType === 'ALL') return 'All companies';
    if (a.audienceType === 'PLAN') return `Plan: ${(a.audiencePlans ?? []).join(', ') || '—'}`;
    if (a.audienceType === 'TENANTS') return `${(a.audienceTenantIds ?? []).length} compan${(a.audienceTenantIds ?? []).length === 1 ? 'y' : 'ies'}`;
    return a.audienceType;
  };
  const windowLabel = (a: Announcement) => {
    if (!a.startsAt && !a.endsAt) return 'Always on';
    const fmt = (s: string | null) => (s ? new Date(s).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—');
    return `${fmt(a.startsAt)} → ${fmt(a.endsAt)}`;
  };

  const filteredTenants = tenants.filter((t) => {
    const q = tenantSearch.trim().toLowerCase();
    if (!q) return true;
    return (t.slug || '').toLowerCase().includes(q) || (t.name || '').toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">Announcements</h1>
          <p className="text-sm text-ink-500">Post a notice that shows as a banner in targeted companies&rsquo; dashboards.</p>
        </div>
        {isSuper && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={openNew} className="self-start">New announcement</Button>
        )}
      </div>

      <QueryState query={list} empty={<EmptyState icon={<Megaphone className="h-5 w-5" />} title="No announcements yet" description={isSuper ? 'Create one to show a banner in company dashboards.' : 'Nothing has been posted yet.'} />}>
        {(rows: Announcement[]) => (
          <>
            <Card padded={false} className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-ink-50 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                    <tr>
                      <th className="px-4 py-2.5">Title</th>
                      <th className="px-4 py-2.5">Severity</th>
                      <th className="px-4 py-2.5">Audience</th>
                      <th className="px-4 py-2.5">Window</th>
                      <th className="px-4 py-2.5">Active</th>
                      {isSuper && <th className="px-4 py-2.5 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.id} className="border-t border-ink-100">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-ink-900">{a.title}</div>
                          <div className="max-w-[24rem] truncate text-xs text-ink-500">{a.body}</div>
                        </td>
                        <td className="px-4 py-2.5"><Pill tone={SEVERITY_TONE[a.severity] ?? 'neutral'}>{a.severity}</Pill></td>
                        <td className="px-4 py-2.5 text-xs text-ink-700">{audienceLabel(a)}</td>
                        <td className="px-4 py-2.5 text-xs text-ink-500">{windowLabel(a)}</td>
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => isSuper && patch.mutate({ id: a.id, body: { active: !a.active } })}
                            disabled={!isSuper}
                            className={'rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' + (a.active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200') + (isSuper ? '' : ' cursor-default')}
                          >
                            {a.active ? 'Active' : 'Off'}
                          </button>
                        </td>
                        {isSuper && (
                          <td className="px-4 py-2.5 text-right">
                            <div className="inline-flex gap-1.5">
                              <Button variant="secondary" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(a)}>Edit</Button>
                              <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { if (confirm(`Delete "${a.title}"?`)) del.mutate(a.id); }}>Delete</Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Mobile cards */}
            <ul className="space-y-2 md:hidden">
              {rows.map((a) => (
                <li key={a.id}>
                  <MobileCard>
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink-900">{a.title}</div>
                        <div className="truncate text-xs text-ink-500">{a.body}</div>
                      </div>
                      <Pill tone={SEVERITY_TONE[a.severity] ?? 'neutral'}>{a.severity}</Pill>
                    </div>
                    <MobileCardRow label="Audience" value={audienceLabel(a)} />
                    <MobileCardRow label="Window" value={windowLabel(a)} />
                    <MobileCardRow label="Status" value={a.active ? 'Active' : 'Off'} />
                    {isSuper && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" onClick={() => patch.mutate({ id: a.id, body: { active: !a.active } })}>{a.active ? 'Turn off' : 'Turn on'}</Button>
                        <Button variant="secondary" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(a)}>Edit</Button>
                        <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { if (confirm(`Delete "${a.title}"?`)) del.mutate(a.id); }}>Delete</Button>
                      </div>
                    )}
                  </MobileCard>
                </li>
              ))}
            </ul>
          </>
        )}
      </QueryState>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={form.id ? 'Edit announcement' : 'New announcement'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} loading={save.isPending}>{form.id ? 'Save changes' : 'Post announcement'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Title" hint="Up to 140 characters">
            <input className={inputClass} maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Message" hint="Plain text, up to 2000 characters">
            <textarea className={textareaClass} rows={3} maxLength={2000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Severity">
              <select className={selectClass} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                <option value="info">Info (blue)</option>
                <option value="warning">Warning (amber)</option>
                <option value="critical">Critical (red)</option>
              </select>
            </Field>
            <Field label="Audience">
              <select className={selectClass} value={form.audienceType} onChange={(e) => setForm({ ...form, audienceType: e.target.value })}>
                <option value="ALL">All companies</option>
                <option value="PLAN">Specific plan tiers</option>
                <option value="TENANTS">Specific companies</option>
              </select>
            </Field>
          </div>

          {form.audienceType === 'PLAN' && (
            <Field label="Plan tiers">
              <div className="flex flex-wrap gap-2">
                {plans.map((p) => {
                  const on = form.audiencePlans.includes(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setForm({ ...form, audiencePlans: toggle(form.audiencePlans, p.key) })}
                      className={'rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ' + (on ? 'bg-brand-50 text-brand-700 ring-brand-300' : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-50')}
                    >
                      {p.name || p.key}
                    </button>
                  );
                })}
                {plans.length === 0 && <span className="text-xs text-ink-400">Loading plans…</span>}
              </div>
            </Field>
          )}

          {form.audienceType === 'TENANTS' && (
            <Field label={`Companies (${form.audienceTenantIds.length} selected)`}>
              <input className={inputClass + ' mb-2'} placeholder="Search companies…" value={tenantSearch} onChange={(e) => setTenantSearch(e.target.value)} />
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-ink-200 p-1">
                {filteredTenants.map((t) => {
                  const on = form.audienceTenantIds.includes(t.id);
                  return (
                    <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-ink-50">
                      <input type="checkbox" checked={on} onChange={() => setForm({ ...form, audienceTenantIds: toggle(form.audienceTenantIds, t.id) })} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-ink-800">{t.name || t.slug}</span>
                        <span className="ml-1 text-xs text-ink-400">{t.slug}</span>
                      </span>
                      {t.plan && <Pill tone="gray">{t.plan}</Pill>}
                    </label>
                  );
                })}
                {filteredTenants.length === 0 && <div className="px-2 py-3 text-center text-xs text-ink-400">No companies match.</div>}
              </div>
            </Field>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Show from" hint="Leave empty to show immediately">
              <input type="datetime-local" className={inputClass} value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
            </Field>
            <Field label="Show until" hint="Leave empty to show until turned off">
              <input type="datetime-local" className={inputClass} value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active (companies see it while within the time window)
          </label>
        </div>
      </Modal>
    </div>
  );
}
