'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary, btnDanger } from '@/components/Field';

const STATUSES = ['DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED'];

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState({ status: '' });
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  const list = useQuery({ queryKey: ['pos', filter], queryFn: () => api(`/purchase-orders?${params}`) });
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => api('/vendors') });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ vendorId: '', notes: '', items: [{ description: '', quantity: 1, unitCost: '', categoryId: '' }] });

  const create = useMutation({
    mutationFn: () => api('/purchase-orders', {
      method: 'POST',
      body: JSON.stringify({
        vendorId: form.vendorId || undefined,
        notes: form.notes,
        items: form.items.map((i: any) => ({
          description: i.description,
          quantity: Number(i.quantity),
          unitCost: Number(i.unitCost || 0),
          categoryId: i.categoryId || undefined,
        })),
      }),
    }),
    onSuccess: (po: any) => { qc.invalidateQueries({ queryKey: ['pos'] }); setOpen(false); router.push(`/dashboard/purchase-orders/${po.id}`); },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Purchase orders</h1>
        <button className={btnPrimary + ' sm:self-start'} onClick={() => { setForm({ vendorId: '', notes: '', items: [{ description: '', quantity: 1, unitCost: '', categoryId: '' }] }); setOpen(true); }}>New PO</button>
      </div>

      <select className={inputClass + ' max-w-xs'} value={filter.status} onChange={(e) => setFilter({ status: e.target.value })}>
        <option value="">All statuses</option>
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">PO #</th>
            <th className="px-4 py-2">Vendor</th>
            <th className="px-4 py-2">From PR</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Items</th>
            <th className="px-4 py-2">Total</th>
            <th className="px-4 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((p: any) => (
            <tr key={p.id} className="cursor-pointer border-t hover:bg-gray-50" onClick={() => router.push(`/dashboard/purchase-orders/${p.id}`)}>
              <td className="px-4 py-2 font-mono text-xs">{p.poNumber}</td>
              <td className="px-4 py-2">{p.vendor?.name || '—'}</td>
              <td className="px-4 py-2 text-xs text-gray-500">{p.pr?.number || '—'}</td>
              <td className="px-4 py-2"><POStatusBadge s={p.status} /></td>
              <td className="px-4 py-2 text-gray-500">{p.items.length}</td>
              <td className="px-4 py-2 text-gray-500">{p.totalCost ?? '—'}</td>
              <td className="px-4 py-2 text-xs text-gray-500">{new Date(p.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
          {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={7}>No POs yet.</td></tr>}
        </tbody>
      </table></div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New purchase order"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => create.mutate()} disabled={create.isPending}>Create (DRAFT)</button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Vendor">
            <select className={inputClass} value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
              <option value="">— None —</option>
              {vendors.data?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Items</span>
              <button className={btnSecondary} onClick={() => setForm({ ...form, items: [...form.items, { description: '', quantity: 1, unitCost: '', categoryId: '' }] })}>+ Add item</button>
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
                    <input className={inputClass + ' sm:col-span-3'} type="number" step="0.01" placeholder="Unit cost" value={it.unitCost} onChange={(e) => updateItem(form, setForm, i, { unitCost: e.target.value })} />
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

import { POStatusPill as POStatusBadgeImpl } from '@/components/ui';
function POStatusBadge({ s }: { s: string }) { return <POStatusBadgeImpl s={s} />; }
