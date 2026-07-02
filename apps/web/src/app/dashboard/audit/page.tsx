'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, Pill, QueryState, EmptyState, Button, Field, inputClass, selectClass } from '@/components/ui';
import { ShieldCheck, Download } from 'lucide-react';

type Entry = {
  id: string;
  createdAt: string;
  action: string;
  assetId?: string | null;
  detail?: any;
  performedBy?: { firstName: string; lastName: string; email: string } | null;
  asset?: { assetTag: string; name: string } | null;
};

// CSV-injection-safe: quote every field and neutralise a leading = + - @ so a
// spreadsheet never executes a cell as a formula.
function csvCell(v: any): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function downloadCsv(rows: Entry[]) {
  const header = ['When', 'Who', 'Email', 'Action', 'Asset', 'Detail'];
  const lines = [header.map(csvCell).join(',')];
  for (const e of rows) {
    lines.push([
      new Date(e.createdAt).toISOString(),
      e.performedBy ? `${e.performedBy.firstName} ${e.performedBy.lastName}` : '',
      e.performedBy?.email || '',
      e.action,
      e.asset?.assetTag || e.assetId || '',
      e.detail ? JSON.stringify(e.detail) : '',
    ].map(csvCell).join(','));
  }
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditPage() {
  const [limit, setLimit] = useState(200);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const log = useQuery({ queryKey: ['audit', limit], queryFn: () => api<Entry[]>(`/audit?limit=${limit}`) });
  const verify = useMutation({
    mutationFn: () => api<{ scanned: number; intact: boolean; broken: any[] }>('/audit/verify'),
    onError: (e: any) => toast.error(e?.message || 'Verify failed'),
  });

  const rows = log.data || [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fromT = from ? new Date(from + 'T00:00:00').getTime() : null;
    const toT = to ? new Date(to + 'T23:59:59.999').getTime() : null;
    return rows.filter((e) => {
      const t = new Date(e.createdAt).getTime();
      if (fromT != null && t < fromT) return false;
      if (toT != null && t > toT) return false;
      if (needle) {
        const hay = `${e.action} ${e.performedBy?.firstName || ''} ${e.performedBy?.lastName || ''} ${e.performedBy?.email || ''} ${e.asset?.assetTag || ''} ${e.detail ? JSON.stringify(e.detail) : ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, from, to]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">Audit log</h1>
          <p className="text-sm text-ink-500">Every workspace change, in a tamper-evident chain.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<ShieldCheck className="h-4 w-4" />} loading={verify.isPending} onClick={() => verify.mutate()}>Verify chain</Button>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} disabled={filtered.length === 0} onClick={() => downloadCsv(filtered)}>Export CSV</Button>
        </div>
      </div>

      {verify.data && (
        <div className={'rounded-lg border px-3 py-2 text-sm ' + (verify.data.intact ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800')}>
          {verify.data.intact
            ? <>✓ Chain intact — {verify.data.scanned} {verify.data.scanned === 1 ? 'entry' : 'entries'} verified.</>
            : <>⚠ {verify.data.broken.length} broken {verify.data.broken.length === 1 ? 'entry' : 'entries'} of {verify.data.scanned} — seq {verify.data.broken.slice(0, 10).map((b: any) => b.seq).join(', ')}{verify.data.broken.length > 10 ? '…' : ''}.</>}
        </div>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-ink-100 p-3">
          <div className="min-w-[12rem] flex-1"><Field label="Search"><input className={inputClass} placeholder="action, person, detail…" value={q} onChange={(e) => setQ(e.target.value)} /></Field></div>
          <Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Load">
            <select className={selectClass} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
          </Field>
        </div>

        <QueryState query={log}>
          {(data: Entry[]) => (
            <>
              <div className="px-3 py-2 text-xs text-ink-500">
                Showing {filtered.length} of {data.length}{data.length >= limit ? ` (latest ${limit})` : ''}
              </div>
              {filtered.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title={data.length === 0 ? 'No events yet' : 'No events match your filters'}
                    description={data.length === 0 ? 'Workspace changes will appear here.' : 'Try widening the date range or clearing the search.'}
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-ink-50 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                      <tr>
                        <th className="px-4 py-2.5">When</th>
                        <th className="px-4 py-2.5">Who</th>
                        <th className="px-4 py-2.5">Action</th>
                        <th className="px-4 py-2.5">Asset</th>
                        <th className="px-4 py-2.5">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((e) => (
                        <tr key={e.id} className="border-t border-ink-100 align-top">
                          <td className="whitespace-nowrap px-4 py-2 text-ink-500">{new Date(e.createdAt).toLocaleString()}</td>
                          <td className="px-4 py-2 text-ink-700">{e.performedBy ? `${e.performedBy.firstName} ${e.performedBy.lastName}` : '—'}</td>
                          <td className="px-4 py-2"><Pill tone="neutral">{e.action}</Pill></td>
                          <td className="px-4 py-2 font-mono text-xs text-ink-600">{e.asset?.assetTag || (e.assetId ? e.assetId.slice(0, 8) : '—')}</td>
                          <td className="max-w-[28rem] truncate px-4 py-2 text-xs text-ink-500" title={e.detail ? JSON.stringify(e.detail) : ''}>{e.detail ? JSON.stringify(e.detail) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
