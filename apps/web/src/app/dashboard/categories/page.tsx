'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';

type CF = { name: string; type: 'text' | 'number' | 'date' | 'boolean'; required?: boolean };

export default function CategoriesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<{ name: string; description: string; customFields: CF[] }>({ name: '', description: '', customFields: [] });

  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, description: form.description, customFields: form.customFields };
      return editing
        ? api(`/categories/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/categories', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); setOpen(false); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });

  const addField = () => setForm({ ...form, customFields: [...form.customFields, { name: '', type: 'text' }] });
  const removeField = (i: number) => setForm({ ...form, customFields: form.customFields.filter((_, idx) => idx !== i) });
  const updateField = (i: number, patch: Partial<CF>) =>
    setForm({ ...form, customFields: form.customFields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Categories</h1>
        <button className={btnPrimary + ' sm:self-start'} onClick={() => { setEditing(null); setForm({ name: '', description: '', customFields: [] }); setOpen(true); }}>
          New category
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Description</th><th className="px-4 py-2">Custom fields</th><th></th></tr>
        </thead>
        <tbody>
          {list.data?.map((c: any) => (
            <tr key={c.id} className="border-t">
              <td className="px-4 py-2 font-medium">{c.name}</td>
              <td className="px-4 py-2 text-gray-500">{c.description || '—'}</td>
              <td className="px-4 py-2 text-gray-500">{(c.customFields || []).length}</td>
              <td className="px-4 py-2 text-right">
                <button className={btnSecondary + ' mr-2'} onClick={() => {
                  setEditing(c);
                  setForm({ name: c.name, description: c.description || '', customFields: c.customFields || [] });
                  setOpen(true);
                }}>Edit</button>
                <button className={btnDanger} onClick={() => confirm('Delete?') && del.mutate(c.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={4}>No categories yet.</td></tr>}
        </tbody>
      </table></div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit category' : 'New category'}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => save.mutate()} disabled={save.isPending}>Save</button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Description"><input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Custom fields</span>
              <button className={btnSecondary} onClick={addField}>+ Add field</button>
            </div>
            <div className="space-y-2">
              {form.customFields.map((f, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    className={inputClass + ' min-w-[140px] flex-1'}
                    placeholder="Field name"
                    value={f.name}
                    onChange={(e) => updateField(i, { name: e.target.value })}
                  />
                  <select className={inputClass + ' w-32'} value={f.type} onChange={(e) => updateField(i, { type: e.target.value as any })}>
                    <option value="text">text</option>
                    <option value="number">number</option>
                    <option value="date">date</option>
                    <option value="boolean">boolean</option>
                  </select>
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={!!f.required} onChange={(e) => updateField(i, { required: e.target.checked })} /> req
                  </label>
                  <button className={btnDanger} onClick={() => removeField(i)} aria-label="Remove field">×</button>
                </div>
              ))}
            </div>
          </div>
          {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}
