'use client';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { btnPrimary, btnSecondary, btnDanger } from '@/components/Field';

export default function PRDetail() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const qc = useQueryClient();
  const pr = useQuery({ queryKey: ['pr', id], queryFn: () => api(`/purchase-requests/${id}`) });

  const action = (path: string) =>
    useMutation({
      mutationFn: () => api(`/purchase-requests/${id}/${path}`, { method: 'POST' }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['pr', id] }),
    });
  const submit = action('submit');
  const approve = action('approve');
  const reject = action('reject');
  const cancel = action('cancel');
  const toPo = useMutation({
    mutationFn: () => api(`/purchase-orders/from-pr/${id}`, { method: 'POST' }),
    onSuccess: (po: any) => router.push(`/dashboard/purchase-orders/${po.id}`),
  });

  if (!pr.data) return <p>Loading…</p>;
  const p = pr.data;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-xs text-gray-500">{p.number}</div>
          <h1 className="text-2xl font-semibold">{p.title}</h1>
          <div className="mt-1"><PRStatusBadge s={p.status} /></div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {p.status === 'DRAFT' && <button className={btnPrimary} onClick={() => submit.mutate()}>Submit</button>}
          {p.status === 'SUBMITTED' && <>
            <button className={btnPrimary} onClick={() => approve.mutate()}>Approve</button>
            <button className={btnDanger} onClick={() => reject.mutate()}>Reject</button>
          </>}
          {p.status === 'APPROVED' && <button className={btnPrimary} onClick={() => toPo.mutate()}>Create PO</button>}
          {!['CANCELLED', 'ORDERED', 'REJECTED'].includes(p.status) && (
            <button className={btnSecondary} onClick={() => cancel.mutate()}>Cancel</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 rounded-lg border bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Items</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500">
              <tr><th className="py-1">Description</th><th>Category</th><th>Qty</th><th>Est. unit</th><th>Subtotal</th></tr>
            </thead>
            <tbody>
              {p.items.map((it: any) => (
                <tr key={it.id} className="border-t">
                  <td className="py-2">{it.description}</td>
                  <td className="text-gray-500">{it.category?.name || '—'}</td>
                  <td>{it.quantity}</td>
                  <td>{it.unitPriceEstimate ?? '—'}</td>
                  <td>{it.unitPriceEstimate ? (Number(it.unitPriceEstimate) * it.quantity).toFixed(2) : '—'}</td>
                </tr>
              ))}
              <tr className="border-t font-semibold">
                <td className="py-2" colSpan={4}>Total</td>
                <td>{p.totalEstimate ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="space-y-2 rounded-lg border bg-white p-5">
          <Row k="Requested by" v={`${p.requestedBy.firstName} ${p.requestedBy.lastName}`} />
          <Row k="Department" v={p.department?.name || '—'} />
          {p.approvedBy && <>
            <Row k={p.status === 'REJECTED' ? 'Rejected by' : 'Approved by'} v={`${p.approvedBy.firstName} ${p.approvedBy.lastName}`} />
            <Row k="At" v={p.approvedAt ? new Date(p.approvedAt).toLocaleString() : '—'} />
          </>}
          <Row k="Created" v={new Date(p.createdAt).toLocaleString()} />
          {p.justification && <div className="mt-3"><div className="text-xs uppercase text-gray-500">Justification</div><div className="mt-1 text-sm">{p.justification}</div></div>}
          {p.notes && <div className="mt-3"><div className="text-xs uppercase text-gray-500">Notes</div><div className="mt-1 text-sm">{p.notes}</div></div>}
          {p.purchaseOrders?.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <div className="text-xs uppercase text-gray-500">Purchase orders</div>
              <ul>
                {p.purchaseOrders.map((po: any) => (
                  <li key={po.id}><Link className="text-brand-600 hover:underline" href={`/dashboard/purchase-orders/${po.id}`}>{po.poNumber}</Link> · {po.status}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return <div className="flex justify-between text-sm"><span className="text-gray-500">{k}</span><span>{v}</span></div>;
}

import { PRStatusPill as PRStatusBadgeImpl } from '@/components/ui';
function PRStatusBadge({ s }: { s: string }) { return <PRStatusBadgeImpl s={s} />; }
