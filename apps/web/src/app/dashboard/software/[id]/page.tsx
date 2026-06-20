'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';

const LICENSE_TYPES = ['PERPETUAL', 'SUBSCRIPTION', 'TRIAL', 'OPEN_SOURCE'];

export default function SoftwareDetail() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const qc = useQueryClient();
  const sw = useQuery({ queryKey: ['software', id], queryFn: () => api(`/software/${id}`) });
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => api('/vendors') });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ type: 'SUBSCRIPTION', seats: 1, licenseKey: '', expiresAt: '', purchaseDate: '', cost: '', vendorId: '', notes: '' });

  const create = useMutation({
    mutationFn: () => api('/licenses', {
      method: 'POST',
      body: JSON.stringify({
        softwareId: id,
        type: form.type,
        seats: Number(form.seats),
        licenseKey: form.licenseKey || undefined,
        purchaseDate: form.purchaseDate || undefined,
        expiresAt: form.expiresAt || undefined,
        cost: form.cost ? Number(form.cost) : undefined,
        vendorId: form.vendorId || undefined,
        notes: form.notes || undefined,
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['software', id] }); setOpen(false); },
  });

  const delSw = useMutation({
    mutationFn: () => api(`/software/${id}`, { method: 'DELETE' }),
    onSuccess: () => router.push('/dashboard/software'),
  });

  if (!sw.data) return <p>Loading…</p>;
  const s = sw.data;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{s.name}</h1>
          <div className="text-sm text-gray-500">{s.publisher || ''}</div>
          {s.description && <p className="mt-1 max-w-2xl text-sm text-gray-600">{s.description}</p>}
        </div>
        <div className="flex gap-2">
          <button className={btnPrimary} onClick={() => setOpen(true)}>Add license</button>
          <button className={btnDanger} onClick={() => confirm('Delete software and all its licenses?') && delSw.mutate()}>Delete</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2">Key</th>
            <th className="px-4 py-2">Seats</th>
            <th className="px-4 py-2">Used</th>
            <th className="px-4 py-2">Vendor</th>
            <th className="px-4 py-2">Expires</th>
            <th className="px-4 py-2">Cost</th>
          </tr>
        </thead>
        <tbody>
          {s.licenses.map((l: any) => {
            const used = l.assignments.length;
            const exp = l.expiresAt ? new Date(l.expiresAt) : null;
            const expired = exp && exp < new Date();
            const soon = exp && !expired && exp < new Date(Date.now() + 30 * 86_400_000);
            return (
              <tr key={l.id} className="cursor-pointer border-t hover:bg-gray-50" onClick={() => router.push(`/dashboard/licenses/${l.id}`)}>
                <td className="px-4 py-2"><span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{l.type}</span></td>
                <td className="px-4 py-2 font-mono text-xs text-gray-500">{l.licenseKey ? l.licenseKey.slice(0, 14) + (l.licenseKey.length > 14 ? '…' : '') : '—'}</td>
                <td className="px-4 py-2">{l.seats}</td>
                <td className={`px-4 py-2 ${used > l.seats ? 'text-red-600 font-semibold' : ''}`}>{used}{used > l.seats ? ' (over)' : ''}</td>
                <td className="px-4 py-2 text-gray-500">{l.vendor?.name || '—'}</td>
                <td className={`px-4 py-2 ${expired ? 'text-red-600 font-semibold' : soon ? 'text-amber-700' : 'text-gray-700'}`}>
                  {exp ? new Date(exp).toLocaleDateString() : '—'}{expired && ' · expired'}
                </td>
                <td className="px-4 py-2 text-gray-500">{l.cost ?? '—'}</td>
              </tr>
            );
          })}
          {s.licenses.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={7}>No licenses yet.</td></tr>}
        </tbody>
      </table></div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`New license for ${s.name}`}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => create.mutate()} disabled={create.isPending}>Create</button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {LICENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Seats"><input className={inputClass} type="number" min={1} value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} /></Field>
          </div>
          <Field label="License key"><input className={inputClass} value={form.licenseKey} onChange={(e) => setForm({ ...form, licenseKey: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Purchase date"><input className={inputClass} type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></Field>
            <Field label="Expires at"><input className={inputClass} type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cost"><input className={inputClass} type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
            <Field label="Vendor">
              <select className={inputClass} value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
                <option value="">— None —</option>
                {vendors.data?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}
