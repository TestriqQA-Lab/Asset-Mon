'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary } from '@/components/Field';

export default function AuditSessionsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['audit-sessions'], queryFn: () => api('/audit-sessions') });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api('/departments') });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: '', scheduledAt: '', departmentId: '', categoryId: '' });
  const create = useMutation({
    mutationFn: () => api('/audit-sessions', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name,
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
        scope: {
          departmentId: form.departmentId || undefined,
          categoryId: form.categoryId || undefined,
        },
      }),
    }),
    onSuccess: (s: any) => { qc.invalidateQueries({ queryKey: ['audit-sessions'] }); setOpen(false); router.push(`/dashboard/audit-sessions/${s.id}`); },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Physical audit sessions</h1>
        <button className={btnPrimary + ' sm:self-start'} onClick={() => { setForm({ name: '', scheduledAt: '', departmentId: '', categoryId: '' }); setOpen(true); }}>New session</button>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Scheduled</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Scans</th>
            <th className="px-4 py-2">Started by</th>
            <th className="px-4 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((s: any) => (
            <tr key={s.id} className="cursor-pointer border-t hover:bg-gray-50" onClick={() => router.push(`/dashboard/audit-sessions/${s.id}`)}>
              <td className="px-4 py-2 font-medium">{s.name}</td>
              <td className="px-4 py-2 text-gray-500">{s.scheduledAt ? new Date(s.scheduledAt).toLocaleDateString() : '—'}</td>
              <td className="px-4 py-2"><AuditStatusBadge s={s.status} /></td>
              <td className="px-4 py-2 text-gray-500">{s._count?.scans ?? 0}</td>
              <td className="px-4 py-2 text-gray-500">{s.startedBy ? `${s.startedBy.firstName} ${s.startedBy.lastName}` : '—'}</td>
              <td className="px-4 py-2 text-xs text-gray-500">{new Date(s.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
          {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={6}>No sessions yet.</td></tr>}
        </tbody>
      </table></div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New audit session"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => create.mutate()} disabled={create.isPending}>Create</button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Scheduled at"><input className={inputClass} type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} /></Field>
          <div className="rounded-md bg-gray-50 p-3">
            <div className="mb-2 text-xs uppercase text-gray-500">Scope (optional — filters expected assets)</div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Department">
                <select className={inputClass} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  <option value="">All</option>
                  {departments.data?.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Category">
                <select className={inputClass} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">All</option>
                  {categories.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>
          </div>
          {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}

import { AuditStatusPill as AuditStatusBadgeImpl } from '@/components/ui';
function AuditStatusBadge({ s }: { s: string }) { return <AuditStatusBadgeImpl s={s} />; }
