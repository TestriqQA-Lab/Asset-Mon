'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary } from '@/components/Field';
import { TicketStatusBadge as StatusBadge, TicketPriorityBadge as PriorityBadge } from '@/components/TicketBadges';
import { MobileCard, MobileCardRow } from '@/components/ui';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR', 'RESOLVED', 'CLOSED', 'CANCELLED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export default function TicketsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState({
    status: searchParams?.get('status') || '',
    mine: searchParams?.get('mine') === 'true',
  });
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.mine) params.set('mine', 'true');
  const list = useQuery({ queryKey: ['tickets', filter], queryFn: () => api(`/tickets?${params}`) });
  const assets = useQuery({ queryKey: ['assets-all'], queryFn: () => api('/assets?pageSize=200') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users') });
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => api('/vendors') });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ assetId: '', title: '', description: '', priority: 'MEDIUM', assignedToId: '', vendorId: '' });

  const create = useMutation({
    mutationFn: () => {
      const body: any = { ...form };
      ['assignedToId', 'vendorId'].forEach((k) => { if (!body[k]) delete body[k]; });
      if (!body.assetId) throw new Error('Pick an asset for this ticket');
      if (!body.title?.trim()) throw new Error('Title is required');
      return api('/tickets', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets'] }); setOpen(false); },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Service tickets</h1>
        <button className={btnPrimary + ' sm:self-start'} onClick={() => { setForm({ assetId: '', title: '', description: '', priority: 'MEDIUM', assignedToId: '', vendorId: '' }); setOpen(true); }}>
          New ticket
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={inputClass + ' sm:max-w-xs'} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={filter.mine} onChange={(e) => setFilter({ ...filter, mine: e.target.checked })} />
          My tickets
        </label>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">#</th>
            <th className="px-4 py-2">Title</th>
            <th className="px-4 py-2">Asset</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Priority</th>
            <th className="px-4 py-2">Assignee</th>
            <th className="px-4 py-2">Opened</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((t: any) => (
            <tr key={t.id} className="cursor-pointer border-t hover:bg-gray-50" onClick={() => router.push(`/dashboard/tickets/${t.id}`)}>
              <td className="px-4 py-2 font-mono text-xs">{t.ticketNumber}</td>
              <td className="px-4 py-2 font-medium">{t.title}</td>
              <td className="px-4 py-2 text-xs text-gray-500">{t.asset?.assetTag} · {t.asset?.name}</td>
              <td className="px-4 py-2"><StatusBadge s={t.status} /></td>
              <td className="px-4 py-2"><PriorityBadge p={t.priority} /></td>
              <td className="px-4 py-2 text-gray-500">{t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : '—'}</td>
              <td className="px-4 py-2 text-xs text-gray-500">{new Date(t.openedAt).toLocaleDateString()}</td>
            </tr>
          ))}
          {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={7}>No tickets.</td></tr>}
        </tbody>
      </table></div>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden">
        {list.data?.map((t: any) => (
          <li key={t.id}>
            <MobileCard onClick={() => router.push(`/dashboard/tickets/${t.id}`)}>
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink-500">{t.ticketNumber}</div>
                  <div className="truncate font-medium text-ink-900">{t.title}</div>
                </div>
                <PriorityBadge p={t.priority} />
              </div>
              <MobileCardRow label="Status" value={<StatusBadge s={t.status} />} />
              <MobileCardRow label="Asset" value={`${t.asset?.assetTag || ''} · ${t.asset?.name || ''}`} />
              <MobileCardRow label="Assignee" value={t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : '—'} />
              <MobileCardRow label="Opened" value={new Date(t.openedAt).toLocaleDateString()} />
            </MobileCard>
          </li>
        ))}
        {list.data?.length === 0 && (
          <li className="rounded-lg border border-dashed border-ink-200 bg-white/60 p-6 text-center text-sm text-ink-500">
            No tickets.
          </li>
        )}
      </ul>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New service ticket"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => create.mutate()} disabled={create.isPending}>Open ticket</button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Asset">
            <select className={inputClass} value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })}>
              <option value="">— Select —</option>
              {assets.data?.items?.map((a: any) => <option key={a.id} value={a.id}>{a.assetTag} · {a.name}</option>)}
            </select>
          </Field>
          <Field label="Title"><input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Description"><textarea className={inputClass} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Priority">
              <select className={inputClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Assign to">
              <select className={inputClass} value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}>
                <option value="">— None —</option>
                {users.data?.map((u: any) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Vendor (optional)">
            <select className={inputClass} value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
              <option value="">— None —</option>
              {vendors.data?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}

