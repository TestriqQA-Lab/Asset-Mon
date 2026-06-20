'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';

export default function MaintenancePage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['maintenance'], queryFn: () => api('/maintenance') });
  const assets = useQuery({ queryKey: ['assets-all'], queryFn: () => api('/assets?pageSize=200') });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ assetId: '', title: '', description: '', intervalDays: 90, nextDueAt: '' });

  const create = useMutation({
    mutationFn: () =>
      api('/maintenance', {
        method: 'POST',
        body: JSON.stringify({ ...form, intervalDays: Number(form.intervalDays), nextDueAt: new Date(form.nextDueAt).toISOString() }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['maintenance'] }); setOpen(false); },
  });
  const markDone = useMutation({
    mutationFn: (id: string) => api(`/maintenance/${id}/done`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maintenance'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/maintenance/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maintenance'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Maintenance schedules</h1>
        <button className={btnPrimary + ' sm:self-start'} onClick={() => { setForm({ assetId: '', title: '', description: '', intervalDays: 90, nextDueAt: '' }); setOpen(true); }}>
          New schedule
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">Asset</th>
            <th className="px-4 py-2">Title</th>
            <th className="px-4 py-2">Every</th>
            <th className="px-4 py-2">Next due</th>
            <th className="px-4 py-2">Last run</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((m: any) => {
            const overdue = new Date(m.nextDueAt) < new Date();
            return (
              <tr key={m.id} className="border-t">
                <td className="px-4 py-2 text-xs text-gray-500">{m.asset?.assetTag} · {m.asset?.name}</td>
                <td className="px-4 py-2 font-medium">{m.title}</td>
                <td className="px-4 py-2 text-gray-500">{m.intervalDays}d</td>
                <td className={`px-4 py-2 ${overdue ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                  {new Date(m.nextDueAt).toLocaleDateString()}{overdue && ' · overdue'}
                </td>
                <td className="px-4 py-2 text-gray-500">{m.lastRunAt ? new Date(m.lastRunAt).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-2 text-right">
                  <button className={btnSecondary + ' mr-2'} onClick={() => markDone.mutate(m.id)}>Mark done</button>
                  <button className={btnDanger} onClick={() => confirm('Delete?') && remove.mutate(m.id)}>Delete</button>
                </td>
              </tr>
            );
          })}
          {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={6}>No schedules yet.</td></tr>}
        </tbody>
      </table></div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New maintenance schedule"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => create.mutate()} disabled={create.isPending}>Create</button>
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
          <Field label="Description"><input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Interval (days)"><input className={inputClass} type="number" min={1} value={form.intervalDays} onChange={(e) => setForm({ ...form, intervalDays: e.target.value })} /></Field>
            <Field label="Next due date"><input className={inputClass} type="date" value={form.nextDueAt} onChange={(e) => setForm({ ...form, nextDueAt: e.target.value })} /></Field>
          </div>
          {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}
