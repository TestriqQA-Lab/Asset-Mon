'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';

export default function ApiKeysPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['api-keys'], queryFn: () => api('/api-keys') });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: '', scope: 'read_write', role: 'ASSET_MANAGER', expiresAt: '' });
  const [issued, setIssued] = useState<any>(null);

  const create = useMutation({
    mutationFn: () => api('/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name: form.name, scope: form.scope, role: form.role, expiresAt: form.expiresAt || undefined }),
    }),
    onSuccess: (k: any) => { qc.invalidateQueries({ queryKey: ['api-keys'] }); setOpen(false); setIssued(k); },
  });
  const revoke = useMutation<any, Error, string>({
    mutationFn: (id: string) => api(`/api-keys/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
  const del = useMutation<any, Error, string>({
    mutationFn: (id: string) => api(`/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">API keys</h1>
        <button className={btnPrimary + ' sm:self-start'} onClick={() => { setForm({ name: '', scope: 'read_write', role: 'ASSET_MANAGER', expiresAt: '' }); setOpen(true); }}>New key</button>
      </div>
      <p className="text-sm text-gray-500">Use with header <code className="rounded bg-gray-100 px-1">X-API-Key: am_…</code> and <code className="rounded bg-gray-100 px-1">X-Tenant-Slug: &lt;your-slug&gt;</code>.</p>

      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Prefix</th>
            <th className="px-4 py-2">Scope</th>
            <th className="px-4 py-2">Role</th>
            <th className="px-4 py-2">Last used</th>
            <th className="px-4 py-2">Expires</th>
            <th className="px-4 py-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((k: any) => (
            <tr key={k.id} className="border-t">
              <td className="px-4 py-2">{k.name}</td>
              <td className="px-4 py-2 font-mono text-xs">{k.prefix}…</td>
              <td className="px-4 py-2"><span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{k.scope}</span></td>
              <td className="px-4 py-2"><span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{k.role || 'ADMIN'}</span></td>
              <td className="px-4 py-2 text-xs text-gray-500">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}</td>
              <td className="px-4 py-2 text-xs text-gray-500">{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : '—'}</td>
              <td className="px-4 py-2">{k.revokedAt ? <span className="text-red-600">REVOKED</span> : <span className="text-green-700">ACTIVE</span>}</td>
              <td className="px-4 py-2 text-right">
                {!k.revokedAt && <button className={btnSecondary + ' mr-2'} onClick={() => revoke.mutate(k.id)}>Revoke</button>}
                <button className={btnDanger} onClick={() => confirm('Delete?') && del.mutate(k.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={8}>No API keys yet.</td></tr>}
        </tbody>
      </table></div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New API key"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => create.mutate()} disabled={create.isPending}>Create</button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name (for your reference)"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Scope">
            <select className={inputClass} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
              <option value="read_write">read_write (read + write)</option>
              <option value="read_only">read_only (GET only)</option>
            </select>
          </Field>
          <Field label="Role (what this key can act as)">
            <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="ASSET_MANAGER">Asset Manager — manage assets/tickets (no delete, users, or billing)</option>
              <option value="ADMIN">Admin — full access</option>
            </select>
          </Field>
          <Field label="Expires (optional)"><input className={inputClass} type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field>
          {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        </div>
      </Modal>

      <Modal
        open={!!issued}
        onClose={() => setIssued(null)}
        title="Copy your API key now"
        footer={<button className={btnPrimary} onClick={() => setIssued(null)}>Done</button>}
      >
        <p className="mb-3 text-sm text-amber-700">This token is only shown once — store it somewhere safe.</p>
        <code className="block break-all rounded border bg-gray-50 p-3 font-mono text-sm">{issued?.token}</code>
      </Modal>
    </div>
  );
}
