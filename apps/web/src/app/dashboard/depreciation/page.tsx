'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { inputClass } from '@/components/Field';

export default function DepreciationPage() {
  const [asOf, setAsOf] = useState<string>(new Date().toISOString().slice(0, 10));
  const fleet = useQuery({
    queryKey: ['dep-fleet', asOf],
    queryFn: () => api(`/depreciation/fleet?asOf=${asOf}T00:00:00Z`),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Depreciation report</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">As of</span>
          <input type="date" className={inputClass + ' sm:w-44'} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Tile label="Total acquisition cost" value={fleet.data?.totalCost} />
        <Tile label="Accumulated depreciation" value={fleet.data?.totalDepreciation} />
        <Tile label="Net book value" value={fleet.data?.totalBookValue} accent="brand" />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">Tag</th>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Category</th>
            <th className="px-4 py-2">Method</th>
            <th className="px-4 py-2">Cost</th>
            <th className="px-4 py-2">Months</th>
            <th className="px-4 py-2">Depreciation</th>
            <th className="px-4 py-2">Book value</th>
          </tr>
        </thead>
        <tbody>
          {fleet.data?.items?.map((it: any) => (
            <tr key={it.id} className="border-t">
              <td className="px-4 py-2 font-mono text-xs"><a className="text-brand-600 hover:underline" href={`/dashboard/assets/${it.id}`}>{it.assetTag}</a></td>
              <td className="px-4 py-2">{it.name}</td>
              <td className="px-4 py-2 text-gray-500">{it.category?.name || '—'}</td>
              <td className="px-4 py-2 text-xs">{it.depreciation.method}</td>
              <td className="px-4 py-2">{it.depreciation.cost.toFixed(2)}</td>
              <td className="px-4 py-2 text-gray-500">{it.depreciation.monthsElapsed} / {it.depreciation.usefulLifeMonths}</td>
              <td className="px-4 py-2 text-red-600">−{it.depreciation.accumulated.toFixed(2)}</td>
              <td className="px-4 py-2 font-semibold">{it.depreciation.bookValue.toFixed(2)}</td>
            </tr>
          ))}
          {fleet.data?.items?.length === 0 && <tr><td className="px-4 py-6 text-gray-500" colSpan={8}>No depreciating assets yet. Set a depreciation method, salvage value, and useful life on an asset to start.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accent === 'brand' ? 'text-brand-700' : ''}`}>{value != null ? Number(value).toFixed(2) : '—'}</div>
    </div>
  );
}
