'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';
import { TicketStatusBadge as StatusBadge, TicketPriorityBadge as PriorityBadge } from '@/components/TicketBadges';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR', 'RESOLVED', 'CLOSED', 'CANCELLED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export default function TicketDetail() {
  const { id } = useParams() as { id: string };
  const r = useRouter();
  const qc = useQueryClient();
  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: () => api(`/tickets/${id}`) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users') });
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => api('/vendors') });

  const [form, setForm] = useState<any>(null);
  useEffect(() => {
    if (ticket.data && !form) {
      setForm({
        title: ticket.data.title,
        description: ticket.data.description || '',
        status: ticket.data.status,
        priority: ticket.data.priority,
        assignedToId: ticket.data.assignedToId || '',
        vendorId: ticket.data.vendorId || '',
        cost: ticket.data.cost || '',
        resolution: ticket.data.resolution || '',
      });
    }
  }, [ticket.data, form]);

  const update = useMutation({
    mutationFn: () => {
      const body: any = { ...form };
      if (!body.assignedToId) body.assignedToId = null;
      if (!body.vendorId) body.vendorId = null;
      if (body.cost === '') body.cost = null;
      else if (body.cost) body.cost = Number(body.cost);
      return api(`/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ticket', id] }); },
  });

  const del = useMutation({
    mutationFn: () => api(`/tickets/${id}`, { method: 'DELETE' }),
    onSuccess: () => r.push('/dashboard/tickets'),
  });

  if (!ticket.data || !form) return <p>Loading…</p>;
  const t = ticket.data;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-xs text-gray-500">{t.ticketNumber}</div>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <div className="mt-1 flex gap-2"><StatusBadge s={t.status} /><PriorityBadge p={t.priority} /></div>
        </div>
        <div className="flex gap-2">
          <Link className={btnSecondary} href={`/dashboard/assets/${t.asset.id}`}>View asset</Link>
          <button className={btnPrimary} onClick={() => update.mutate()}>Save</button>
          <button className={btnDanger} onClick={() => confirm('Delete?') && del.mutate()}>Delete</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-3 rounded-lg border bg-white p-5">
          <Field label="Title"><input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Description"><textarea className={inputClass} rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Resolution"><textarea className={inputClass} rows={3} value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} /></Field>
        </div>
        <div className="space-y-3 rounded-lg border bg-white p-5">
          <Field label="Status">
            <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className={inputClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Assignee">
            <select className={inputClass} value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}>
              <option value="">— None —</option>
              {users.data?.map((u: any) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
            </select>
          </Field>
          <Field label="Vendor">
            <select className={inputClass} value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
              <option value="">— None —</option>
              {vendors.data?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Cost"><input className={inputClass} type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
          <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-500">
            Opened {new Date(t.openedAt).toLocaleString()}<br />
            {t.openedBy && <>by {t.openedBy.firstName} {t.openedBy.lastName}<br /></>}
            {t.resolvedAt && <>Resolved {new Date(t.resolvedAt).toLocaleString()}</>}
          </div>
        </div>
      </div>
    </div>
  );
}
