'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { btnPrimary, btnSecondary, btnDanger, inputClass, Field } from '@/components/Field';
import { Modal } from '@/components/Modal';

export default function PODetail() {
  const { id } = useParams() as { id: string };
  const qc = useQueryClient();
  const po = useQuery({ queryKey: ['po', id], queryFn: () => api(`/purchase-orders/${id}`) });

  const send = useMutation({
    mutationFn: () => api(`/purchase-orders/${id}/send`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['po', id] }),
  });
  const cancel = useMutation({
    mutationFn: () => api(`/purchase-orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['po', id] }),
  });
  const [recOpen, setRecOpen] = useState(false);
  const [namePrefix, setNamePrefix] = useState('');
  const receive = useMutation({
    mutationFn: () => api(`/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify({ namePrefix: namePrefix || undefined }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['po', id] }); setRecOpen(false); },
  });

  if (!po.data) return <p>Loading…</p>;
  const p = po.data;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-xs text-gray-500">{p.poNumber}</div>
          <h1 className="text-2xl font-semibold">{p.vendor?.name || 'No vendor'}</h1>
          <div className="mt-1"><POStatusBadge s={p.status} /></div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {p.status === 'DRAFT' && <button className={btnPrimary} onClick={() => send.mutate()}>Send to vendor</button>}
          {(p.status === 'SENT' || p.status === 'PARTIAL') && <button className={btnPrimary} onClick={() => setRecOpen(true)}>Receive (create assets)</button>}
          {!['RECEIVED', 'CANCELLED'].includes(p.status) && <button className={btnDanger} onClick={() => cancel.mutate()}>Cancel</button>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 rounded-lg border bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Items</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500">
              <tr><th className="py-1">Description</th><th>Category</th><th>Qty</th><th>Received</th><th>Unit</th><th>Subtotal</th></tr>
            </thead>
            <tbody>
              {p.items.map((it: any) => (
                <tr key={it.id} className="border-t">
                  <td className="py-2">{it.description}</td>
                  <td className="text-gray-500">{it.category?.name || '—'}</td>
                  <td>{it.quantity}</td>
                  <td>{it.receivedQty}</td>
                  <td>{Number(it.unitCost).toFixed(2)}</td>
                  <td>{(Number(it.unitCost) * it.quantity).toFixed(2)}</td>
                </tr>
              ))}
              <tr className="border-t font-semibold">
                <td className="py-2" colSpan={5}>Total</td>
                <td>{p.totalCost ?? '—'}</td>
              </tr>
            </tbody>
          </table>
          {p.assets?.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Assets created</h2>
              <ul className="text-sm">
                {p.assets.map((a: any) => (
                  <li key={a.id}>
                    <a className="text-brand-600 hover:underline" href={`/dashboard/assets/${a.id}`}>{a.assetTag}</a> · {a.name} · <span className="text-gray-500">{a.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="space-y-2 rounded-lg border bg-white p-5 text-sm">
          <Row k="Vendor" v={p.vendor?.name || '—'} />
          <Row k="From PR" v={p.pr ? <a className="text-brand-600 hover:underline" href={`/dashboard/purchase-requests/${p.pr.id}`}>{p.pr.number}</a> : '—'} />
          <Row k="Ordered at" v={p.orderedAt ? new Date(p.orderedAt).toLocaleString() : '—'} />
          <Row k="Received at" v={p.receivedAt ? new Date(p.receivedAt).toLocaleString() : '—'} />
          {p.notes && <div className="mt-2 border-t pt-2"><div className="text-xs uppercase text-gray-500">Notes</div><div>{p.notes}</div></div>}
        </div>
      </div>

      <Modal
        open={recOpen}
        onClose={() => setRecOpen(false)}
        title="Receive purchase order"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setRecOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => receive.mutate()} disabled={receive.isPending}>Receive & create assets</button>
          </>
        }
      >
        <p className="text-sm">This will create one Asset for each unit ordered, using the item's category and unit cost. Items without a category will block receipt.</p>
        <Field label="Asset name prefix (optional)"><input className={inputClass} value={namePrefix} onChange={(e) => setNamePrefix(e.target.value)} placeholder="e.g. Q2-Onboarding" /></Field>
        {receive.error && <p className="mt-2 text-sm text-red-600">{(receive.error as Error).message}</p>}
      </Modal>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return <div className="flex justify-between"><span className="text-gray-500">{k}</span><span>{v}</span></div>;
}

import { POStatusPill as POStatusBadgeImpl } from '@/components/ui';
function POStatusBadge({ s }: { s: string }) { return <POStatusBadgeImpl s={s} />; }
