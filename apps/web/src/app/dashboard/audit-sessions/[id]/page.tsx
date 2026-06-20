'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { btnPrimary, btnSecondary, btnDanger, inputClass } from '@/components/Field';

export default function AuditSessionDetail() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ['audit-session', id], queryFn: () => api(`/audit-sessions/${id}`) });
  const discrepancies = useQuery({
    queryKey: ['audit-session-disc', id, session.data?.status, session.data?.scans?.length],
    queryFn: () => api(`/audit-sessions/${id}/discrepancies`),
    enabled: !!session.data && session.data.status !== 'PLANNED',
  });

  const start = useMutation<any, Error, void>({
    mutationFn: () => api(`/audit-sessions/${id}/start`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit-session', id] }),
  });
  const complete = useMutation<any, Error, void>({
    mutationFn: () => api(`/audit-sessions/${id}/complete`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit-session', id] }),
  });
  const cancel = useMutation<any, Error, void>({
    mutationFn: () => api(`/audit-sessions/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit-session', id] }),
  });
  const del = useMutation<any, Error, void>({
    mutationFn: () => api(`/audit-sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => router.push('/dashboard/audit-sessions'),
  });

  const [scanInput, setScanInput] = useState('');
  const [recent, setRecent] = useState<{ tag: string; matched: boolean }[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const scan = useMutation<any, Error, string>({
    mutationFn: (tag: string) => api(`/audit-sessions/${id}/scan`, { method: 'POST', body: JSON.stringify({ assetTag: tag }) }),
    onSuccess: (r: any, tag) => {
      setRecent((prev) => [{ tag: r.asset?.assetTag || tag, matched: !!r.asset }, ...prev].slice(0, 10));
      qc.invalidateQueries({ queryKey: ['audit-session', id] });
      setScanInput('');
      inputRef.current?.focus();
    },
    onError: (e, tag) => {
      setRecent((prev) => [{ tag: tag + ' · ' + e.message, matched: false }, ...prev].slice(0, 10));
      setScanInput('');
      inputRef.current?.focus();
    },
  });

  useEffect(() => { inputRef.current?.focus(); }, [session.data?.status]);

  if (!session.data) return <p>Loading…</p>;
  const s = session.data;
  const scope = (s.scope || {}) as any;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{s.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <AuditStatusBadge s={s.status} />
            {s.scheduledAt && <span className="text-sm text-gray-500">scheduled {new Date(s.scheduledAt).toLocaleDateString()}</span>}
          </div>
          {(scope.locationId || scope.departmentId || scope.categoryId) && (
            <div className="mt-1 text-xs text-gray-500">Scoped</div>
          )}
        </div>
        <div className="flex gap-2">
          {s.status === 'PLANNED' && <button className={btnPrimary} onClick={() => start.mutate()}>Start</button>}
          {s.status === 'IN_PROGRESS' && <button className={btnPrimary} onClick={() => complete.mutate()}>Complete</button>}
          {!['COMPLETED', 'CANCELLED'].includes(s.status) && <button className={btnSecondary} onClick={() => cancel.mutate()}>Cancel session</button>}
          <button className={btnDanger} onClick={() => confirm('Delete session?') && del.mutate()}>Delete</button>
        </div>
      </div>

      {s.status === 'IN_PROGRESS' && (
        <div className="rounded-lg border bg-white p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase text-gray-500">Scan to audit</h2>
          <p className="mb-3 text-xs text-gray-500">Scan a QR code with your reader (it types the payload) or type an asset tag (e.g. <code>AM-00001</code>) and press Enter.</p>
          <input
            ref={inputRef}
            className={inputClass + ' font-mono'}
            placeholder="Scan or type asset tag…"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && scanInput.trim()) scan.mutate(scanInput.trim()); }}
          />
          {recent.length > 0 && (
            <div className="mt-3 space-y-1">
              {recent.map((r, i) => (
                <div key={i} className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${r.matched ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  <span className="font-mono text-xs">{r.matched ? '✓' : '✗'}</span>
                  <span className="font-mono">{r.tag}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {discrepancies.data && (
        <div className="grid grid-cols-3 gap-4">
          <Tile label="Expected" value={discrepancies.data.expected} />
          <Tile label="Scanned" value={discrepancies.data.scanned} accent={discrepancies.data.scanned >= discrepancies.data.expected ? 'green' : 'amber'} />
          <Tile label="Missing" value={discrepancies.data.missing.length} accent={discrepancies.data.missing.length === 0 ? 'green' : 'red'} />
        </div>
      )}

      {discrepancies.data && (
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border bg-white p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">Missing ({discrepancies.data.missing.length})</h3>
            <ul className="space-y-1 text-sm">
              {discrepancies.data.missing.map((a: any) => (
                <li key={a.id}>
                  <a className="text-brand-600 hover:underline" href={`/dashboard/assets/${a.id}`}>{a.assetTag}</a>
                  <span className="ml-2">{a.name}</span>
                  <span className="ml-2 text-xs text-gray-500">{a.status}</span>
                </li>
              ))}
              {discrepancies.data.missing.length === 0 && <li className="text-gray-500">None — full coverage.</li>}
            </ul>
          </div>
          <div className="rounded-lg border bg-white p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">Unexpected / unmatched</h3>
            <div className="text-xs text-gray-500">Scanned but outside scope ({discrepancies.data.unexpected.length})</div>
            <ul className="mb-3 space-y-1 text-sm">
              {discrepancies.data.unexpected.map((sc: any) => (
                <li key={sc.id}>{sc.asset?.assetTag} · {sc.asset?.name}</li>
              ))}
              {discrepancies.data.unexpected.length === 0 && <li className="text-gray-500">None.</li>}
            </ul>
            <div className="text-xs text-gray-500">Unmatched tags ({discrepancies.data.unmatched.length})</div>
            <ul className="space-y-1 text-sm">
              {discrepancies.data.unmatched.map((sc: any) => (
                <li key={sc.id} className="font-mono text-xs text-red-600">{sc.rawTag}</li>
              ))}
              {discrepancies.data.unmatched.length === 0 && <li className="text-gray-500">None.</li>}
            </ul>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">All scans ({s.scans.length})</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-gray-500">
            <tr><th className="py-1">When</th><th>Asset</th><th>By</th></tr>
          </thead>
          <tbody>
            {s.scans.map((sc: any) => (
              <tr key={sc.id} className="border-t">
                <td className="py-2 text-xs text-gray-500">{new Date(sc.createdAt).toLocaleString()}</td>
                <td>{sc.asset ? <a className="text-brand-600 hover:underline" href={`/dashboard/assets/${sc.asset.id}`}>{sc.asset.assetTag} · {sc.asset.name}</a> : <span className="font-mono text-xs text-red-600">unmatched: {sc.rawTag}</span>}</td>
                <td className="text-gray-500">{sc.scannedBy ? `${sc.scannedBy.firstName} ${sc.scannedBy.lastName}` : '—'}</td>
              </tr>
            ))}
            {s.scans.length === 0 && <tr><td className="py-6 text-gray-500" colSpan={3}>No scans yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { AuditStatusPill as AuditStatusBadgeImpl } from '@/components/ui';
function AuditStatusBadge({ s }: { s: string }) { return <AuditStatusBadgeImpl s={s} />; }

function Tile({ label, value, accent }: { label: string; value: any; accent?: 'red' | 'green' | 'amber' }) {
  const c = accent === 'red' ? 'text-red-700' : accent === 'green' ? 'text-green-700' : accent === 'amber' ? 'text-amber-700' : 'text-gray-800';
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${c}`}>{value}</div>
    </div>
  );
}
