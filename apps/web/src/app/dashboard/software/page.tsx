'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary } from '@/components/Field';
import Link from 'next/link';

export default function SoftwarePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['software'], queryFn: () => api('/software') });
  const compliance = useQuery({ queryKey: ['license-compliance'], queryFn: () => api('/licenses/compliance') });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', publisher: '', description: '' });
  const create = useMutation({
    mutationFn: () => api('/software', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['software'] }); setOpen(false); },
  });

  const totalSeats = compliance.data?.reduce((s: number, c: any) => s + c.seats, 0) || 0;
  const usedSeats = compliance.data?.reduce((s: number, c: any) => s + c.used, 0) || 0;
  const overDeployed = compliance.data?.filter((c: any) => c.overDeployed).length || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Software</h1>
        <div className="flex flex-wrap gap-2">
          <Link className={btnSecondary} href="/dashboard/licenses">All licenses</Link>
          <button className={btnPrimary} onClick={() => { setForm({ name: '', publisher: '', description: '' }); setOpen(true); }}>New software</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Tile label="Software products" value={list.data?.length ?? '—'} />
        <Tile label="Seats used / total" value={`${usedSeats} / ${totalSeats}`} />
        <Tile label="Over-deployed licenses" value={overDeployed} accent={overDeployed > 0 ? 'red' : 'green'} />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Publisher</th>
            <th className="px-4 py-2">Licenses</th>
            <th className="px-4 py-2">Total seats</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((s: any) => {
            const totalSeats = s.licenses.reduce((a: number, l: any) => a + l.seats, 0);
            return (
              <tr key={s.id} className="cursor-pointer border-t hover:bg-gray-50" onClick={() => router.push(`/dashboard/software/${s.id}`)}>
                <td className="px-4 py-2 font-medium">{s.name}</td>
                <td className="px-4 py-2 text-gray-500">{s.publisher || '—'}</td>
                <td className="px-4 py-2 text-gray-500">{s.licenses.length}</td>
                <td className="px-4 py-2 text-gray-500">{totalSeats}</td>
              </tr>
            );
          })}
          {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={4}>No software yet.</td></tr>}
        </tbody>
      </table></div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New software product"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => create.mutate()} disabled={create.isPending}>Create</button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Publisher"><input className={inputClass} value={form.publisher} onChange={(e) => setForm({ ...form, publisher: e.target.value })} /></Field>
          <Field label="Description"><textarea className={inputClass} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: any; accent?: 'red' | 'green' }) {
  const color = accent === 'red' ? 'text-red-700' : accent === 'green' ? 'text-green-700' : 'text-gray-800';
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
