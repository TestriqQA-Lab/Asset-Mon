'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function AuditPage() {
  const log = useQuery({ queryKey: ['audit'], queryFn: () => api('/audit?limit=200') });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">Audit log</h1>
      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">When</th>
            <th className="px-4 py-2">Who</th>
            <th className="px-4 py-2">Action</th>
            <th className="px-4 py-2">Asset</th>
            <th className="px-4 py-2">Detail</th>
          </tr>
        </thead>
        <tbody>
          {log.data?.map((e: any) => (
            <tr key={e.id} className="border-t align-top">
              <td className="px-4 py-2 text-gray-500">{new Date(e.createdAt).toLocaleString()}</td>
              <td className="px-4 py-2">{e.performedBy ? `${e.performedBy.firstName} ${e.performedBy.lastName}` : '—'}</td>
              <td className="px-4 py-2"><code>{e.action}</code></td>
              <td className="px-4 py-2 font-mono text-xs">{e.asset?.assetTag || e.assetId?.slice(0, 8)}</td>
              <td className="px-4 py-2 text-xs text-gray-500">{e.detail ? JSON.stringify(e.detail) : ''}</td>
            </tr>
          ))}
          {log.data?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={5}>No events yet.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
