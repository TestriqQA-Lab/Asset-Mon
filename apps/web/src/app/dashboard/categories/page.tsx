'use client';
import { useState, useRef, type ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';

const TYPES = ['ASSET', 'ACCESSORY', 'LICENSE'] as const;
const TYPE_LABEL: Record<string, string> = { ASSET: 'Asset', ACCESSORY: 'Accessory', LICENSE: 'License' };
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type Form = { name: string; type: string; imageUrl: string | null };

export default function CategoriesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<Form>({ name: '', type: 'ASSET', imageUrl: null });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Both mutations refresh the dashboard's stats too (the "Asset Categories" card).
  const refresh = () => { qc.invalidateQueries({ queryKey: ['categories'] }); qc.invalidateQueries({ queryKey: ['stats'] }); };

  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name.trim(), type: form.type, imageUrl: form.imageUrl };
      return editing
        ? api(`/categories/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/categories', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { refresh(); setOpen(false); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  });

  const openNew = () => { setEditing(null); setForm({ name: '', type: 'ASSET', imageUrl: null }); setOpen(true); };
  const openEdit = (c: any) => { setEditing(c); setForm({ name: c.name, type: c.type || 'ASSET', imageUrl: c.imageUrl ?? null }); setOpen(true); };

  const onPickImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api<{ url: string }>('/categories/image', { method: 'POST', body: fd });
      setForm((f) => ({ ...f, imageUrl: res.url }));
    } catch (err) {
      toast.error((err as Error).message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Categories</h1>
        <button className={btnPrimary + ' sm:self-start'} onClick={openNew}>New category</button>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">Image</th>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2">Quantity</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((c: any) => (
            <tr key={c.id} className="border-t">
              <td className="px-4 py-2">
                {c.imageUrl ? (
                  <img src={API_URL + c.imageUrl} alt={c.name} className="h-10 w-10 rounded object-cover border border-gray-200" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded bg-gray-100 text-xs font-semibold text-gray-400">
                    {(c.name || '?').charAt(0).toUpperCase()}
                  </span>
                )}
              </td>
              <td className="px-4 py-2 font-medium">{c.name}</td>
              <td className="px-4 py-2">
                <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{TYPE_LABEL[c.type] || 'Asset'}</span>
              </td>
              <td className="px-4 py-2 font-mono text-xs text-gray-600" title="Assets currently in this category">{c.assetCount ?? 0}</td>
              <td className="px-4 py-2 text-right whitespace-nowrap">
                <button className={btnSecondary + ' mr-2'} onClick={() => openEdit(c)}>Edit</button>
                <button className={btnDanger} onClick={() => confirm(`Delete category "${c.name}"?`) && del.mutate(c.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={5}>No categories yet.</td></tr>}
        </tbody>
      </table></div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit category' : 'New category'}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => save.mutate()} disabled={save.isPending || uploading || !form.name.trim()}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Laptops" />
          </Field>

          <Field label="Type">
            <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </Field>

          <Field label="Image">
            <div className="flex items-center gap-3">
              {form.imageUrl ? (
                <img src={API_URL + form.imageUrl} alt="" className="h-16 w-16 rounded object-cover border border-gray-200" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-gray-300 text-[10px] text-gray-400">No image</div>
              )}
              <div className="flex flex-col items-start gap-1.5">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onPickImage} className="hidden" />
                <button type="button" className={btnSecondary} onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : form.imageUrl ? 'Replace image' : 'Upload image'}
                </button>
                {form.imageUrl && (
                  <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setForm({ ...form, imageUrl: null })}>Remove image</button>
                )}
              </div>
            </div>
            <p className="mt-1 text-xs text-gray-400">PNG, JPEG or WebP · up to 2 MB</p>
          </Field>

          {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}
