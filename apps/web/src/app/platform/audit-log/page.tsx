'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { papi } from '@/lib/platform-api';
import { Card, Pill, QueryState, inputClass, selectClass } from '@/components/ui';

const ACTION_TONES: Record<string, 'green' | 'amber' | 'red' | 'brand' | 'gray' | 'purple' | 'blue'> = {
  'platform.bootstrap': 'brand',
  'tenant.suspend': 'amber',
  'tenant.activate': 'green',
  'tenant.delete': 'red',
  'tenant.updatePlan': 'blue',
  'tenant.updateSubscription': 'blue',
  'tenant.resetUserPassword': 'amber',
  'tenant.impersonate': 'purple',
  'platformUser.create': 'green',
  'platformUser.update': 'blue',
  'platformUser.resetPassword': 'amber',
  'platformUser.delete': 'red',
};

export default function AuditLogPage() {
  const [filter, setFilter] = useState({ action: '', targetType: '', limit: 200 });
  const log = useQuery({
    queryKey: ['platform-audit', filter],
    queryFn: () => papi<any[]>(`/platform/audit-log?action=${encodeURIComponent(filter.action)}&targetType=${encodeURIComponent(filter.targetType)}&limit=${filter.limit}`),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">Platform audit log</h1>
        <p className="text-sm text-ink-500">Every action your team has taken on this console.</p>
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-xl border border-ink-200 bg-white p-3 shadow-card sm:grid-cols-2 md:flex md:flex-wrap md:items-center">
        <input
          className={inputClass + ' sm:col-span-2 md:max-w-xs'}
          placeholder="Filter by action (substring)…"
          value={filter.action}
          onChange={(e) => setFilter({ ...filter, action: e.target.value })}
        />
        <select className={selectClass + ' md:w-44'} value={filter.targetType} onChange={(e) => setFilter({ ...filter, targetType: e.target.value })}>
          <option value="">Any target type</option>
          <option value="tenant">Tenant</option>
          <option value="tenantUser">Tenant user</option>
          <option value="platformUser">Platform user</option>
        </select>
        <select className={selectClass + ' md:w-32'} value={String(filter.limit)} onChange={(e) => setFilter({ ...filter, limit: Number(e.target.value) })}>
          <option value="50">Last 50</option>
          <option value="200">Last 200</option>
          <option value="500">Last 500</option>
        </select>
      </div>

      <QueryState query={log}>
        {(rows: any[]) => (
          <Card padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="px-4 py-2.5">When</th>
                    <th className="px-4 py-2.5">Actor</th>
                    <th className="px-4 py-2.5">Action</th>
                    <th className="px-4 py-2.5">Target</th>
                    <th className="px-4 py-2.5">Metadata</th>
                    <th className="px-4 py-2.5">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className="border-t border-ink-100 align-top">
                      <td className="px-4 py-2.5 text-xs text-ink-500">{new Date(e.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-ink-700">{e.actorEmail}</td>
                      <td className="px-4 py-2.5"><Pill tone={ACTION_TONES[e.action] || 'gray'}>{e.action}</Pill></td>
                      <td className="px-4 py-2.5 text-xs text-ink-600">
                        {e.targetType ? (
                          <>
                            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">{e.targetType}</span>
                            <span className="ml-1 font-mono">{e.targetId?.slice(0, 8) ?? ''}</span>
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-500">
                        {e.metadata && Object.keys(e.metadata).length
                          ? <code className="font-mono">{JSON.stringify(e.metadata)}</code>
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{e.ipAddress || '—'}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-ink-500">No audit entries match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </QueryState>
    </div>
  );
}
