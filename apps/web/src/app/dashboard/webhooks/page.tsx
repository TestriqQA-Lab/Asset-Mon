'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';

const EVENTS = [
  'asset.created', 'asset.updated', 'asset.deleted',
  'ticket.opened', 'ticket.status_changed',
  'license.assigned', 'license.unassigned',
  'po.received', 'pr.approved',
];

export default function WebhooksPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['webhooks'], queryFn: () => api('/webhooks') });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ url: '', events: [] as string[], active: true });
  const [deliveriesId, setDeliveriesId] = useState<string | null>(null);
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', deliveriesId],
    queryFn: () => api(`/webhooks/${deliveriesId}/deliveries`),
    enabled: !!deliveriesId,
  });

  const create = useMutation({
    mutationFn: () => api('/webhooks', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['webhooks'] }); setOpen(false); },
  });
  const del = useMutation<any, Error, string>({
    mutationFn: (id: string) => api(`/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
  const toggle = useMutation<any, Error, { id: string; active: boolean }>({
    mutationFn: (v: { id: string; active: boolean }) => api(`/webhooks/${v.id}`, { method: 'PATCH', body: JSON.stringify({ active: v.active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });

  const toggleEvent = (e: string) => {
    setForm({ ...form, events: form.events.includes(e) ? form.events.filter((x: string) => x !== e) : [...form.events, e] });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Webhooks</h1>
        <button className={btnPrimary + ' sm:self-start'} onClick={() => { setForm({ url: '', events: [], active: true }); setOpen(true); }}>New webhook</button>
      </div>
      <p className="text-sm text-gray-500">Deliveries are signed with HMAC-SHA256 (header <code className="rounded bg-gray-100 px-1">X-AssetMon-Signature</code>); secrets are generated automatically per webhook.</p>

      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">URL</th>
            <th className="px-4 py-2">Events</th>
            <th className="px-4 py-2">Active</th>
            <th className="px-4 py-2">Deliveries</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((w: any) => (
            <tr key={w.id} className="border-t">
              <td className="px-4 py-2 font-mono text-xs">{w.url}</td>
              <td className="px-4 py-2 text-xs text-gray-500">{w.events.join(', ')}</td>
              <td className="px-4 py-2">
                <label><input type="checkbox" checked={w.active} onChange={(e) => toggle.mutate({ id: w.id, active: e.target.checked })} /></label>
              </td>
              <td className="px-4 py-2">
                <button className={btnSecondary} onClick={() => setDeliveriesId(w.id)}>{w._count.deliveries} view</button>
              </td>
              <td className="px-4 py-2 text-right">
                <button className={btnDanger} onClick={() => confirm('Delete?') && del.mutate(w.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={5}>No webhooks yet.</td></tr>}
        </tbody>
      </table></div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New webhook"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => create.mutate()} disabled={create.isPending}>Create</button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Endpoint URL"><input className={inputClass} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://hooks.example.com/path" /></Field>
          <div>
            <div className="mb-1 text-sm font-medium">Events</div>
            <div className="grid grid-cols-2 gap-1 text-sm">
              {EVENTS.map((e) => (
                <label key={e} className="flex items-center gap-2">
                  <input type="checkbox" checked={form.events.includes(e)} onChange={() => toggleEvent(e)} />
                  <code className="text-xs">{e}</code>
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active
          </label>
          {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        </div>
      </Modal>

      <Modal
        open={!!deliveriesId}
        onClose={() => setDeliveriesId(null)}
        title="Recent deliveries"
        footer={<button className={btnSecondary} onClick={() => setDeliveriesId(null)}>Close</button>}
      >
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-gray-500">
            <tr><th className="py-1">When</th><th>Event</th><th>Status</th><th>Attempts</th></tr>
          </thead>
          <tbody>
            {deliveries.data?.map((d: any) => (
              <tr key={d.id} className="border-t">
                <td className="py-1 text-xs text-gray-500">{new Date(d.createdAt).toLocaleString()}</td>
                <td className="font-mono text-xs">{d.event}</td>
                <td className={d.succeededAt ? 'text-green-700' : 'text-red-600'}>
                  {d.succeededAt ? '✓ ' + (d.status || '') : (d.status || d.lastError || 'failed')}
                </td>
                <td className="text-xs text-gray-500">{d.attempts}</td>
              </tr>
            ))}
            {deliveries.data?.length === 0 && <tr><td className="py-4 text-gray-500" colSpan={4}>No deliveries yet.</td></tr>}
          </tbody>
        </table>
      </Modal>
    </div>
  );
}
