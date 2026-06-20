'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';

export default function DepartmentsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['departments'], queryFn: () => api('/departments') });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', costCenter: '' });

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api(`/departments/${editing.id}`, { method: 'PATCH', body: JSON.stringify(form) })
        : api('/departments', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      setOpen(false);
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/departments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Departments</h1>
        <button className={btnPrimary + ' sm:self-start'} onClick={() => { setEditing(null); setForm({ name: '', costCenter: '' }); setOpen(true); }}>
          New department
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Cost center</th><th></th></tr>
        </thead>
        <tbody>
          {list.data?.map((d: any) => (
            <tr key={d.id} className="border-t">
              <td className="px-4 py-2">{d.name}</td>
              <td className="px-4 py-2 text-gray-500">{d.costCenter || '—'}</td>
              <td className="px-4 py-2 text-right">
                <button className={btnSecondary + ' mr-2'} onClick={() => { setEditing(d); setForm({ name: d.name, costCenter: d.costCenter || '' }); setOpen(true); }}>Edit</button>
                <button className={btnDanger} onClick={() => confirm('Delete?') && del.mutate(d.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={3}>No departments yet.</td></tr>}
        </tbody>
      </table></div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit department' : 'New department'}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => save.mutate()} disabled={save.isPending}>Save</button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Cost center"><input className={inputClass} value={form.costCenter} onChange={(e) => setForm({ ...form, costCenter: e.target.value })} /></Field>
          {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}
