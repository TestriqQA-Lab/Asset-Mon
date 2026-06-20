'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, getSession } from '@/lib/api';
import { btnPrimary, btnSecondary, inputClass } from '@/components/Field';

const REPORTS = [
  { key: 'assets', label: 'All assets' },
  { key: 'assets-by-category', label: 'Asset count by category' },
  { key: 'assets-by-status', label: 'Asset count by status' },
  { key: 'tickets', label: 'All tickets' },
  { key: 'open-tickets', label: 'Open tickets' },
  { key: 'maintenance-due', label: 'Maintenance schedules' },
  { key: 'license-compliance', label: 'License compliance' },
  { key: 'depreciation', label: 'Depreciation schedule' },
];

export default function ReportsPage() {
  const [key, setKey] = useState('assets');
  const report = useQuery({ queryKey: ['report', key], queryFn: () => api(`/reports/${key}`) });

  const exportCsv = async () => {
    const s = getSession();
    const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/reports/${key}?format=csv`, {
      headers: { Authorization: `Bearer ${s?.accessToken}` },
    });
    const b = await r.blob();
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url; a.download = `${key}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const rows = report.data?.rows ?? [];
  const headers = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Reports</h1>
        <div className="flex flex-wrap gap-2">
          <select className={inputClass + ' flex-1 sm:flex-initial sm:w-72'} value={key} onChange={(e) => setKey(e.target.value)}>
            {REPORTS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <button className={btnPrimary} onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      <div className="rounded-lg border bg-white">
        <div className="border-b px-4 py-2 text-xs text-gray-500">
          {report.isLoading ? 'Loading…' : `${report.data?.rowCount ?? 0} rows`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>{headers.map((h) => <th key={h} className="px-4 py-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={i} className="border-t">
                  {headers.map((h) => (
                    <td key={h} className="px-4 py-2 text-gray-700">
                      {typeof r[h] === 'object' ? JSON.stringify(r[h]) : (r[h] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={Math.max(headers.length, 1)}>No rows.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
