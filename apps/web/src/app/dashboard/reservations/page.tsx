'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, List, Calendar as CalIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary } from '@/components/Field';

const STATUSES = ['REQUESTED', 'CONFIRMED', 'CHECKED_OUT', 'COMPLETED', 'CANCELLED'];

type ViewMode = 'list' | 'calendar';

export default function ReservationsPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<ViewMode>('list');
  const [filter, setFilter] = useState({ upcoming: true, status: '' });
  // For calendar view we fetch the whole month, ignoring `upcoming`
  const params = new URLSearchParams();
  if (view === 'list' && filter.upcoming) params.set('upcoming', 'true');
  if (filter.status) params.set('status', filter.status);
  const list = useQuery({ queryKey: ['reservations', view, filter], queryFn: () => api(`/reservations?${params}`) });
  const assets = useQuery({ queryKey: ['assets-all'], queryFn: () => api('/assets?pageSize=300') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users') });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ assetId: '', userId: '', startAt: '', endAt: '', notes: '' });

  const create = useMutation({
    mutationFn: () => api('/reservations', {
      method: 'POST',
      body: JSON.stringify({
        assetId: form.assetId,
        userId: form.userId,
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        notes: form.notes || undefined,
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reservations'] }); setOpen(false); },
  });
  const useAction = (path: string) =>
    useMutation<any, Error, string>({
      mutationFn: (id: string) => api(`/reservations/${id}/${path}`, { method: 'POST' }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['reservations'] }),
    });
  const pickup = useAction('pickup');
  const returnRes = useAction('return');
  const cancel = useAction('cancel');

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Reservations</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5">
            <button
              onClick={() => setView('list')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${view === 'list' ? 'bg-ink-900 text-white' : 'text-ink-600'}`}
            ><List className="h-3.5 w-3.5" /> List</button>
            <button
              onClick={() => setView('calendar')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${view === 'calendar' ? 'bg-ink-900 text-white' : 'text-ink-600'}`}
            ><CalIcon className="h-3.5 w-3.5" /> Calendar</button>
          </div>
          <button className={btnPrimary} onClick={() => { setForm({ assetId: '', userId: '', startAt: '', endAt: '', notes: '' }); setOpen(true); }}>New reservation</button>
        </div>
      </div>

      {view === 'list' && (
        <>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={filter.upcoming} onChange={(e) => setFilter({ ...filter, upcoming: e.target.checked })} /> Upcoming only</label>
            <select className={inputClass + ' max-w-xs'} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Asset</th>
                <th className="px-4 py-2">For</th>
                <th className="px-4 py-2">Start</th>
                <th className="px-4 py-2">End</th>
                <th className="px-4 py-2">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.data?.map((r: any) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-2">
                    <a className="text-brand-600 hover:underline" href={`/dashboard/assets/${r.asset.id}`}>{r.asset.assetTag} · {r.asset.name}</a>
                  </td>
                  <td className="px-4 py-2">{r.user.firstName} {r.user.lastName}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">{new Date(r.startAt).toLocaleString()}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">{new Date(r.endAt).toLocaleString()}</td>
                  <td className="px-4 py-2"><ResStatusBadge s={r.status} /></td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {r.status === 'CONFIRMED' && <button className={btnPrimary + ' mr-1'} onClick={() => pickup.mutate(r.id)}>Pickup</button>}
                    {r.status === 'CHECKED_OUT' && <button className={btnPrimary + ' mr-1'} onClick={() => returnRes.mutate(r.id)}>Return</button>}
                    {!['COMPLETED', 'CANCELLED'].includes(r.status) && <button className={btnSecondary} onClick={() => cancel.mutate(r.id)}>Cancel</button>}
                  </td>
                </tr>
              ))}
              {list.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={6}>No reservations.</td></tr>}
            </tbody>
          </table></div>
        </>
      )}

      {view === 'calendar' && (
        <CalendarView reservations={list.data || []} />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New reservation"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => create.mutate()} disabled={create.isPending}>Create</button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Asset">
            <select className={inputClass} value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })}>
              <option value="">— Select —</option>
              {assets.data?.items?.map((a: any) => <option key={a.id} value={a.id}>{a.assetTag} · {a.name}</option>)}
            </select>
          </Field>
          <Field label="For user">
            <select className={inputClass} value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
              <option value="">— Select —</option>
              {users.data?.map((u: any) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start"><input className={inputClass} type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} /></Field>
            <Field label="End"><input className={inputClass} type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}

function CalendarView({ reservations }: { reservations: any[] }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const grid = useMemo(() => {
    // Start of month, then back up to the previous Sunday.
    const start = new Date(cursor); start.setDate(1);
    const lead = start.getDay(); // 0 (Sun) ... 6 (Sat)
    start.setDate(1 - lead);
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [cursor]);

  const monthIdx = cursor.getMonth();
  const todayStr = new Date().toDateString();

  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of reservations) {
      if (r.status === 'CANCELLED') continue;
      const s = new Date(r.startAt);
      const e = new Date(r.endAt);
      const cur = new Date(s); cur.setHours(0, 0, 0, 0);
      const last = new Date(e); last.setHours(0, 0, 0, 0);
      while (cur.getTime() <= last.getTime()) {
        const key = cur.toDateString();
        const arr = m.get(key) || [];
        arr.push(r);
        m.set(key, arr);
        cur.setDate(cur.getDate() + 1);
      }
    }
    return m;
  }, [reservations]);

  const STATUS_BAR: Record<string, string> = {
    REQUESTED: 'bg-slate-200 text-slate-800',
    CONFIRMED: 'bg-sky-100 text-sky-800',
    CHECKED_OUT: 'bg-amber-100 text-amber-800',
    COMPLETED: 'bg-emerald-100 text-emerald-800',
  };

  return (
    <div className="rounded-xl border border-ink-200 bg-white">
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2">
        <button onClick={() => { const d = new Date(cursor); d.setMonth(d.getMonth() - 1); setCursor(d); }} className="rounded p-1 text-ink-600 hover:bg-ink-100"><ChevronLeft className="h-4 w-4" /></button>
        <div className="text-sm font-semibold text-ink-900">{monthLabel}</div>
        <button onClick={() => { const d = new Date(cursor); d.setMonth(d.getMonth() + 1); setCursor(d); }} className="rounded p-1 text-ink-600 hover:bg-ink-100"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 border-b border-ink-100 bg-ink-50/60 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
          <div key={d} className="px-2 py-1.5 text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {grid.map((d, i) => {
          const inMonth = d.getMonth() === monthIdx;
          const isToday = d.toDateString() === todayStr;
          const items = byDay.get(d.toDateString()) || [];
          return (
            <div key={i} className={`min-h-[88px] border-b border-r border-ink-100 p-1 ${(i + 1) % 7 === 0 ? 'border-r-0' : ''} ${inMonth ? 'bg-white' : 'bg-ink-50/40'}`}>
              <div className={`mb-1 text-[11px] ${isToday ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 font-semibold text-white' : 'text-ink-500'}`}>
                {d.getDate()}
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((r: any) => (
                  <a
                    key={r.id}
                    href={`/dashboard/assets/${r.asset.id}`}
                    title={`${r.asset.assetTag} · ${r.user.firstName} ${r.user.lastName} (${r.status})`}
                    className={`block truncate rounded px-1 py-0.5 text-[10px] ${STATUS_BAR[r.status] || 'bg-ink-100 text-ink-700'}`}
                  >
                    {r.asset.assetTag} · {r.user.firstName}
                  </a>
                ))}
                {items.length > 3 && <div className="text-[10px] text-ink-500">+{items.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { ReservationStatusPill as ResStatusBadgeImpl } from '@/components/ui';
function ResStatusBadge({ s }: { s: string }) { return <ResStatusBadgeImpl s={s} />; }
