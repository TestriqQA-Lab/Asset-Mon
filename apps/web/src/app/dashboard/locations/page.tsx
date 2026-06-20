'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';

const TYPES = ['BUILDING', 'FLOOR', 'ROOM', 'DESK'];

export default function LocationsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['locations'], queryFn: () => api('/locations') });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', type: 'BUILDING', parentId: '' });

  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, type: form.type, parentId: form.parentId || null };
      return editing
        ? api(`/locations/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/locations', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] });
      setOpen(false);
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/locations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
  });

  const lookup = (id: string | null) => list.data?.find((l: any) => l.id === id);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Locations</h1>
        <button className={btnPrimary + ' sm:self-start'} onClick={() => { setEditing(null); setForm({ name: '', type: 'BUILDING', parentId: '' }); setOpen(true); }}>New location</button>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Parent</th><th></th></tr>
        </thead>
        <tbody>
          {list.data?.map((l: any) => (
            <tr key={l.id} className="border-t">
              <td className="px-4 py-2">{l.name}</td>
              <td className="px-4 py-2 text-gray-500">{l.type}</td>
              <td className="px-4 py-2 text-gray-500">{lookup(l.parentId)?.name || '—'}</td>
              <td className="px-4 py-2 text-right">
                <button className={btnSecondary + ' mr-2'} onClick={() => { setEditing(l); setForm({ name: l.name, type: l.type, parentId: l.parentId || '' }); setOpen(true); }}>Edit</button>
                <button className={btnDanger} onClick={() => confirm('Delete?') && del.mutate(l.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={4}>No locations yet.</td></tr>}
        </tbody>
      </table></div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit location' : 'New location'}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => save.mutate()} disabled={save.isPending}>Save</button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Type">
            <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Parent (optional)">
            <select className={inputClass} value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">— None —</option>
              {list.data?.filter((l: any) => l.id !== editing?.id).map((l: any) => (
                <option key={l.id} value={l.id}>{l.name} ({l.type})</option>
              ))}
            </select>
          </Field>
          {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}
