'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';
import { MobileCard, MobileCardRow } from '@/components/ui';

const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'CANCELLED'];

export default function PurchaseRequestsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState({ status: '' });
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  const list = useQuery({ queryKey: ['prs', filter], queryFn: () => api(`/purchase-requests?${params}`) });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api('/departments') });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ title: '', justification: '', departmentId: '', notes: '', items: [{ description: '', quantity: 1, unitPriceEstimate: '', categoryId: '' }] });

  const create = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        departmentId: form.departmentId || null,
        items: form.items.map((i: any) => ({
          description: i.description,
          quantity: Number(i.quantity),
          unitPriceEstimate: i.unitPriceEstimate ? Number(i.unitPriceEstimate) : undefined,
          categoryId: i.categoryId || undefined,
        })),
      };
      return api('/purchase-requests', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prs'] }); setOpen(false); },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Purchase requests</h1>
        <button className={btnPrimary + ' sm:self-start'} onClick={() => { setForm({ title: '', justification: '', departmentId: '', notes: '', items: [{ description: '', quantity: 1, unitPriceEstimate: '', categoryId: '' }] }); setOpen(true); }}>New request</button>
      </div>

      <select className={inputClass + ' sm:max-w-xs'} value={filter.status} onChange={(e) => setFilter({ status: e.target.value })}>
        <option value="">All statuses</option>
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">#</th>
            <th className="px-4 py-2">Title</th>
            <th className="px-4 py-2">Requested by</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Items</th>
            <th className="px-4 py-2">Estimate</th>
            <th className="px-4 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((p: any) => (
            <tr key={p.id} className="cursor-pointer border-t hover:bg-gray-50" onClick={() => router.push(`/dashboard/purchase-requests/${p.id}`)}>
              <td className="px-4 py-2 font-mono text-xs">{p.number}</td>
              <td className="px-4 py-2 font-medium">{p.title}</td>
              <td className="px-4 py-2 text-gray-500">{p.requestedBy.firstName} {p.requestedBy.lastName}</td>
              <td className="px-4 py-2"><PRStatusBadge s={p.status} /></td>
              <td className="px-4 py-2 text-gray-500">{p.items.length}</td>
              <td className="px-4 py-2 text-gray-500">{p.totalEstimate ?? '—'}</td>
              <td className="px-4 py-2 text-xs text-gray-500">{new Date(p.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
          {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={7}>No requests yet.</td></tr>}
        </tbody>
      </table></div>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden">
        {list.data?.map((p: any) => (
          <li key={p.id}>
            <MobileCard onClick={() => router.push(`/dashboard/purchase-requests/${p.id}`)}>
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink-500">{p.number}</div>
                  <div className="truncate font-medium text-ink-900">{p.title}</div>
                </div>
                <PRStatusBadge s={p.status} />
              </div>
              <MobileCardRow label="Requested by" value={`${p.requestedBy.firstName} ${p.requestedBy.lastName}`} />
              <MobileCardRow label="Items" value={p.items.length} />
              <MobileCardRow label="Estimate" value={p.totalEstimate ?? '—'} />
              <MobileCardRow label="Created" value={new Date(p.createdAt).toLocaleDateString()} />
            </MobileCard>
          </li>
        ))}
        {list.data?.length === 0 && (
          <li className="rounded-lg border border-dashed border-ink-200 bg-white/60 p-6 text-center text-sm text-ink-500">
            No requests yet.
          </li>
        )}
      </ul>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New purchase request"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => create.mutate()} disabled={create.isPending}>Create (DRAFT)</button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Title"><input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Justification"><textarea className={inputClass} rows={2} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} /></Field>
          <Field label="Department">
            <select className={inputClass} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
              <option value="">— None —</option>
              {departments.data?.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Items</span>
              <button className={btnSecondary} onClick={() => setForm({ ...form, items: [...form.items, { description: '', quantity: 1, unitPriceEstimate: '', categoryId: '' }] })}>+ Add item</button>
            </div>
            <div className="space-y-3">
              {form.items.map((it: any, i: number) => (
                <div key={i} className="space-y-2 rounded-lg border border-ink-200 bg-ink-50/40 p-2.5 sm:space-y-0 sm:border-0 sm:bg-transparent sm:p-0">
                  <input className={inputClass} placeholder="Description" value={it.description} onChange={(e) => updateItem(form, setForm, i, { description: e.target.value })} />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                    <select className={inputClass + ' col-span-2 sm:col-span-5'} value={it.categoryId} onChange={(e) => updateItem(form, setForm, i, { categoryId: e.target.value })}>
                      <option value="">Category</option>
                      {categories.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input className={inputClass + ' sm:col-span-2'} type="number" placeholder="Qty" value={it.quantity} onChange={(e) => updateItem(form, setForm, i, { quantity: e.target.value })} />
                    <input className={inputClass + ' sm:col-span-3'} type="number" step="0.01" placeholder="Est. unit" value={it.unitPriceEstimate} onChange={(e) => updateItem(form, setForm, i, { unitPriceEstimate: e.target.value })} />
                    <button className={btnDanger + ' col-span-2 sm:col-span-2'} onClick={() => setForm({ ...form, items: form.items.filter((_: any, idx: number) => idx !== i) })} aria-label="Remove item">Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}

function updateItem(form: any, setForm: any, idx: number, patch: any) {
  setForm({ ...form, items: form.items.map((it: any, i: number) => i === idx ? { ...it, ...patch } : it) });
}

import { PRStatusPill as PRStatusBadgeImpl } from '@/components/ui';
function PRStatusBadge({ s }: { s: string }) { return <PRStatusBadgeImpl s={s} />; }
