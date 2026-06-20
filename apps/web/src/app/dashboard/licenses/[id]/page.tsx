'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';

export default function LicenseDetail() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const qc = useQueryClient();
  const lic = useQuery({ queryKey: ['license', id], queryFn: () => api(`/licenses/${id}`) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users') });
  const assets = useQuery({ queryKey: ['assets-all'], queryFn: () => api('/assets?pageSize=300') });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ target: 'user', userId: '', assetId: '', notes: '' });
  const assign = useMutation<any, Error, void>({
    mutationFn: () => api(`/licenses/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({
        userId: form.target === 'user' ? form.userId : undefined,
        assetId: form.target === 'asset' ? form.assetId : undefined,
        notes: form.notes || undefined,
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['license', id] }); setOpen(false); },
  });
  const unassign = useMutation({
    mutationFn: (aid: string) => api(`/licenses/${id}/unassign/${aid}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['license', id] }),
  });
  const del = useMutation<any, Error, void>({
    mutationFn: () => api(`/licenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => router.push('/dashboard/licenses'),
  });

  if (!lic.data) return <p>Loading…</p>;
  const l = lic.data;
  const used = l.assignments.filter((a: any) => !a.returnedAt).length;
  const exp = l.expiresAt ? new Date(l.expiresAt) : null;
  const expired = exp && exp < new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            <a className="text-brand-600 hover:underline" href={`/dashboard/software/${l.software.id}`}>{l.software.name}</a>
            <span className="ml-3 rounded bg-gray-100 px-2 py-0.5 text-xs">{l.type}</span>
          </h1>
          <div className="mt-1 text-sm text-gray-500">
            {l.licenseKey ? <span className="font-mono">{l.licenseKey}</span> : 'No key'}
            {l.vendor && <> · {l.vendor.name}</>}
            {expired && <span className="ml-3 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">EXPIRED</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button className={btnPrimary} disabled={used >= l.seats} onClick={() => { setForm({ target: 'user', userId: '', assetId: '', notes: '' }); setOpen(true); }}>Assign seat</button>
          <button className={btnDanger} onClick={() => { if (confirm('Delete license?')) del.mutate(); }}>Delete</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Tile label="Seats" value={l.seats} />
        <Tile label="Used" value={used} accent={used > l.seats ? 'red' : 'default'} />
        <Tile label="Free" value={Math.max(0, l.seats - used)} />
        <Tile label="Expires" value={exp ? new Date(exp).toLocaleDateString() : '—'} accent={expired ? 'red' : 'default'} />
      </div>

      <div className="rounded-lg border bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Assignments</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-gray-500">
            <tr><th className="py-1">Assignee</th><th>Type</th><th>Assigned</th><th>Returned</th><th></th></tr>
          </thead>
          <tbody>
            {l.assignments.map((a: any) => (
              <tr key={a.id} className="border-t">
                <td className="py-2">
                  {a.user ? `${a.user.firstName} ${a.user.lastName} (${a.user.email})` :
                   a.asset ? <a className="text-brand-600 hover:underline" href={`/dashboard/assets/${a.asset.id}`}>{a.asset.assetTag} · {a.asset.name}</a> : '—'}
                </td>
                <td className="text-gray-500">{a.user ? 'user' : 'asset'}</td>
                <td className="text-gray-500">{new Date(a.assignedAt).toLocaleDateString()}</td>
                <td className="text-gray-500">{a.returnedAt ? new Date(a.returnedAt).toLocaleDateString() : '—'}</td>
                <td className="text-right">
                  {!a.returnedAt && <button className={btnSecondary} onClick={() => unassign.mutate(a.id)}>Unassign</button>}
                </td>
              </tr>
            ))}
            {l.assignments.length === 0 && <tr><td className="py-6 text-gray-500" colSpan={5}>No assignments yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Assign license seat"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => assign.mutate()} disabled={assign.isPending}>Assign</button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Assign to">
            <div className="flex gap-3 text-sm">
              <label><input type="radio" checked={form.target === 'user'} onChange={() => setForm({ ...form, target: 'user' })} /> User</label>
              <label><input type="radio" checked={form.target === 'asset'} onChange={() => setForm({ ...form, target: 'asset' })} /> Asset (device)</label>
            </div>
          </Field>
          {form.target === 'user' ? (
            <Field label="User">
              <select className={inputClass} value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                <option value="">— Select —</option>
                {users.data?.map((u: any) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.email})</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Asset">
              <select className={inputClass} value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })}>
                <option value="">— Select —</option>
                {assets.data?.items?.map((a: any) => <option key={a.id} value={a.id}>{a.assetTag} · {a.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Notes"><input className={inputClass} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          {assign.error && <p className="text-sm text-red-600">{(assign.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: any; accent?: 'red' | 'default' }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accent === 'red' ? 'text-red-700' : ''}`}>{value}</div>
    </div>
  );
}
