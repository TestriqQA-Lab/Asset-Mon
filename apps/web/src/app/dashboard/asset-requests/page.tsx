'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { usePermissions } from '@/lib/settings';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary } from '@/components/Field';
import { SectionHeader, EmptyState, QueryState, Button } from '@/components/ui';
import { FilePlus, HandHelping, ChevronRight, ChevronDown, RefreshCw, Search, X, Plus } from 'lucide-react';
import { RequestStatusPill, RequestUrgencyPill, AgeBadge, RequestStatBar, DemandChart } from './_components';

const URGENCIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending', APPROVED: 'Approved', DECLINED: 'Declined',
  FULFILLED: 'Fulfilled', CANCELLED: 'Cancelled',
};

export default function AssetRequestsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const perms = usePermissions();
  const isEmployee = perms.role === 'EMPLOYEE';
  const isManager = perms.role === 'ASSET_MANAGER' || perms.role === 'ADMIN';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [statusFilter, setStatusFilter] = useState('');
  const [tab, setTab] = useState<'mine' | 'all'>('mine'); // For managers
  const [showPast, setShowPast] = useState(false); // For employees
  
  // Modal state
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'CATEGORY' | 'SPECIFIC'>('CATEGORY');
  const [form, setForm] = useState({ title: '', categoryId: '', urgency: 'NORMAL', reason: '', neededBy: '', isTemporary: false, returnBy: '' });
  const [picked, setPicked] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  const statsQuery = useQuery({
    queryKey: ['asset-requests', 'stats'],
    queryFn: () => api('/asset-requests/stats'),
  });

  const demandQuery = useQuery({
    queryKey: ['asset-requests', 'demand'],
    queryFn: () => api('/asset-requests/demand'),
    enabled: isManager,
  });

  const listParams = new URLSearchParams();
  if (statusFilter) listParams.set('status', statusFilter);
  if (isManager && tab === 'all') listParams.set('all', 'true');

  const listQuery = useQuery({
    queryKey: ['asset-requests', 'list', statusFilter, tab],
    queryFn: () => api(`/asset-requests?${listParams}`),
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api('/categories'),
  });

  // Device search for SPECIFIC mode — matches tag / name / serial.
  const deviceSearch = useQuery({
    queryKey: ['asset-search', search],
    queryFn: () => api(`/assets?pageSize=25&q=${encodeURIComponent(search.trim())}`),
    enabled: open && mode === 'SPECIFIC' && search.trim().length > 0,
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  const create = useMutation({
    mutationFn: () => {
      const body: any = { mode, urgency: form.urgency };
      if (form.reason) body.reason = form.reason;
      if (form.neededBy) body.neededBy = new Date(form.neededBy).toISOString();
      if (form.isTemporary) {
        body.isTemporary = true;
        if (form.returnBy) body.returnBy = new Date(form.returnBy).toISOString();
      }
      if (mode === 'SPECIFIC') {
        if (picked.length === 0) throw new Error('Pick at least one device');
        body.assetIds = picked.map((p) => p.id);
        if (form.title.trim()) body.title = form.title.trim();
      } else {
        if (!form.title.trim()) throw new Error('Please say what you need');
        body.title = form.title.trim();
        if (form.categoryId) body.categoryId = form.categoryId;
      }
      return api('/asset-requests', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-requests'] });
      setOpen(false);
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/asset-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset-requests'] }),
  });

  // ---------------------------------------------------------------------------
  // View Helpers
  // ---------------------------------------------------------------------------
  const openModal = (initialForm?: any) => {
    setMode('CATEGORY');
    setPicked([]);
    setSearch('');
    setForm({ title: '', categoryId: '', urgency: 'NORMAL', reason: '', neededBy: '', isTemporary: false, returnBy: '', ...(initialForm || {}) });
    setOpen(true);
  };

  const deviceAvailable = (a: any) => a.status === 'IN_STOCK';
  const addDevice = (a: any) => {
    if (!picked.some((p) => p.id === a.id)) setPicked([...picked, a]);
    setSearch('');
  };
  const removeDevice = (aid: string) => setPicked(picked.filter((p) => p.id !== aid));

  const renderCreateModal = () => (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Request an asset"
      footer={
        <>
          <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
          <button className={btnPrimary} onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? 'Submitting…' : 'Submit request'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="flex gap-1 rounded-lg bg-ink-100 p-1">
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'SPECIFIC' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:bg-ink-200'}`}
            onClick={() => setMode('SPECIFIC')}
          >
            Specific devices
          </button>
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'CATEGORY' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:bg-ink-200'}`}
            onClick={() => setMode('CATEGORY')}
          >
            General need
          </button>
        </div>

        {mode === 'SPECIFIC' ? (
          <>
            <Field label="Find devices by tag or name">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  className={`${inputClass} pl-8`}
                  placeholder="e.g. DEMO-PH or iPhone"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </Field>
            {search.trim() && (
              <div className="max-h-48 divide-y divide-ink-100 overflow-auto rounded-lg border border-ink-200">
                {deviceSearch.isLoading && <div className="p-3 text-sm text-ink-500">Searching…</div>}
                {!deviceSearch.isLoading && (deviceSearch.data?.items || []).filter((a: any) => !picked.some((p) => p.id === a.id)).length === 0 && (
                  <div className="p-3 text-sm text-ink-500">No matching devices.</div>
                )}
                {(deviceSearch.data?.items || [])
                  .filter((a: any) => !picked.some((p) => p.id === a.id))
                  .map((a: any) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => addDevice(a)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-mono text-xs text-ink-500">{a.assetTag}</span>
                        <span className="ml-2 text-ink-900">{a.name}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${deviceAvailable(a) ? 'bg-emerald-500' : 'bg-ink-300'}`} />
                        <span className="text-xs text-ink-500">{deviceAvailable(a) ? 'Available' : 'In use'}</span>
                        <Plus className="h-4 w-4 text-brand-600" />
                      </span>
                    </button>
                  ))}
              </div>
            )}
            <div>
              <div className="mb-1 text-xs font-medium text-ink-500">Selected devices ({picked.length})</div>
              {picked.length === 0 ? (
                <p className="text-sm text-ink-400">Search and add the exact devices you need.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {picked.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-800 ring-1 ring-brand-200">
                      <span className={`h-1.5 w-1.5 rounded-full ${deviceAvailable(p) ? 'bg-emerald-500' : 'bg-ink-300'}`} />
                      <span className="font-mono">{p.assetTag}</span>
                      <button type="button" onClick={() => removeDevice(p.id)} className="text-brand-400 hover:text-brand-700">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <Field label="Note for the manager (optional)">
              <input className={inputClass} placeholder="e.g. Need these for the payments test rig" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
          </>
        ) : (
          <>
            <Field label="What do you need?">
              <input className={inputClass} placeholder="e.g. Laptop for new project" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Category (optional)">
              <select className={inputClass} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">— Any —</option>
                {categories.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </>
        )}

        <Field label="Urgency">
          <select className={inputClass} value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}>
            {URGENCIES.map((u) => <option key={u} value={u}>{u.charAt(0) + u.slice(1).toLowerCase()}</option>)}
          </select>
        </Field>
        <Field label="Needed by (optional)">
          <input type="datetime-local" className={inputClass} value={form.neededBy} onChange={(e) => setForm({ ...form, neededBy: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={form.isTemporary} onChange={(e) => setForm({ ...form, isTemporary: e.target.checked })} />
          Temporary use (I&apos;ll return it)
        </label>
        {form.isTemporary && (
          <Field label="Return by (optional)">
            <input type="date" className={inputClass} value={form.returnBy} onChange={(e) => setForm({ ...form, returnBy: e.target.value })} />
          </Field>
        )}
        {mode === 'CATEGORY' && (
          <Field label="Reason (optional)">
            <textarea className={inputClass} rows={2} placeholder="Why do you need this?" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
        )}
        {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
      </div>
    </Modal>
  );

  // ---------------------------------------------------------------------------
  // EMPLOYEE VIEW (Phase 3C)
  // ---------------------------------------------------------------------------
  if (isEmployee) {
    return (
      <div className="space-y-6">
        <SectionHeader
          title="My asset requests"
          action={<Button onClick={() => openModal()} icon={<FilePlus className="h-4 w-4" />}>Request an asset</Button>}
        />

        <QueryState query={statsQuery}>
          {(stats) => <RequestStatBar stats={stats} role="EMPLOYEE" onFilter={setStatusFilter} />}
        </QueryState>

        <QueryState query={listQuery}>
          {(items) => {
            const declined = items.filter((r: any) => r.status === 'DECLINED');
            const active = items.filter((r: any) => r.status === 'PENDING' || r.status === 'APPROVED');
            const past = items.filter((r: any) => r.status === 'FULFILLED' || r.status === 'CANCELLED');

            if (items.length === 0 && !statusFilter) {
              return (
                <EmptyState
                  icon={<HandHelping />}
                  title="No requests yet"
                  description="Need a laptop, monitor, or other equipment? Submit a request and we'll handle the rest."
                  action={<Button onClick={() => openModal()}>Request an asset</Button>}
                />
              );
            }

            return (
              <div className="space-y-8">
                {/* Needs Attention */}
                {declined.length > 0 && (
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-rose-700">Needs attention</h2>
                    <div className="space-y-3">
                      {declined.map((r: any) => (
                        <div key={r.id} className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs text-rose-500">{r.number}</span>
                                <RequestStatusPill s={r.status} />
                              </div>
                              <h3 className="mt-1 font-medium text-ink-900">{r.title}</h3>
                              {r.declineReason && (
                                <p className="mt-2 text-sm text-rose-700">Reason: {r.declineReason}</p>
                              )}
                            </div>
                            <Button
                              variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />}
                              onClick={() => openModal({ title: r.title, categoryId: r.categoryId || '', urgency: r.urgency, reason: '' })}
                            >
                              Re-request
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Active Requests */}
                {(active.length > 0 || statusFilter) && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-ink-900">Active requests</h2>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {active.map((r: any) => (
                        <div key={r.id} className="relative rounded-xl border border-ink-200 bg-white p-4 shadow-card hover:border-ink-300">
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <div>
                              <div className="font-mono text-xs text-ink-500">{r.number}</div>
                              <h3 className="font-medium text-ink-900">{r.title}</h3>
                            </div>
                            <RequestUrgencyPill u={r.urgency} />
                          </div>
                          <div className="mb-3 flex items-center gap-2 text-sm">
                            <RequestStatusPill s={r.status} />
                            <span className="text-ink-300">•</span>
                            {r.status === 'PENDING' && <AgeBadge daysOpen={r.daysOpen} />}
                            {r.status !== 'PENDING' && <span className="text-xs text-ink-500">{new Date(r.updatedAt || r.createdAt).toLocaleDateString()}</span>}
                          </div>
                          {r.assignedTo && (
                            <p className="mb-3 text-xs text-ink-500">
                              Assigned to: {r.assignedTo.firstName} {r.assignedTo.lastName}
                            </p>
                          )}
                          <div className="flex justify-end gap-2 border-t border-ink-100 pt-3">
                            {r.status === 'PENDING' && (
                              <button onClick={() => cancel.mutate(r.id)} className="text-xs font-medium text-rose-600 hover:underline">
                                Cancel request
                              </button>
                            )}
                            <button onClick={() => router.push(`/dashboard/asset-requests/${r.id}`)} className="text-xs font-medium text-brand-600 hover:underline ml-auto">
                              View details →
                            </button>
                          </div>
                        </div>
                      ))}
                      {active.length === 0 && statusFilter && (
                        <div className="col-span-full py-8 text-center text-sm text-ink-500">No active requests matching filter.</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Past Requests */}
                {past.length > 0 && (
                  <div className="space-y-3">
                    <button
                      onClick={() => setShowPast(!showPast)}
                      className="flex w-full items-center gap-2 rounded-lg bg-ink-50 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100"
                    >
                      {showPast ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      Past requests ({past.length})
                    </button>
                    {showPast && (
                      <div className="rounded-xl border border-ink-200 bg-white">
                        <ul className="divide-y divide-ink-100">
                          {past.map((r: any) => (
                            <li key={r.id} className="flex items-center justify-between p-3 hover:bg-ink-50 cursor-pointer" onClick={() => router.push(`/dashboard/asset-requests/${r.id}`)}>
                              <div>
                                <span className="font-mono text-xs text-ink-500 mr-2">{r.number}</span>
                                <span className="text-sm font-medium text-ink-900">{r.title}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <RequestStatusPill s={r.status} />
                                <span className="text-xs text-ink-500">{new Date(r.createdAt).toLocaleDateString()}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          }}
        </QueryState>
        {renderCreateModal()}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // MANAGER VIEW (Phase 3D)
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <SectionHeader title="Asset requests" />

      <QueryState query={statsQuery}>
        {(stats) => <RequestStatBar stats={stats} role="ASSET_MANAGER" onFilter={setStatusFilter} />}
      </QueryState>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main List */}
        <div className="space-y-4 lg:col-span-2">
          {/* Tabs + Filters */}
          <div className="flex flex-col gap-3 rounded-xl border border-ink-200 bg-white p-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-1 rounded-lg bg-ink-100 p-1">
              <button
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === 'mine' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:bg-ink-200'}`}
                onClick={() => setTab('mine')}
              >
                My Queue
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === 'all' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:bg-ink-200'}`}
                onClick={() => setTab('all')}
              >
                All Requests
              </button>
            </div>
            <select
              className={`${inputClass} sm:max-w-[140px]`}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          {/* List */}
          <QueryState query={listQuery}>
            {(items) => {
              // Priority Sort (Phase 3D)
              const sorted = [...items].sort((a: any, b: any) => {
                const aScore = a.escalatedToAdmin ? 10 : (a.urgency === 'URGENT' ? 8 : (a.urgency === 'HIGH' ? 6 : (a.daysOpen > 7 ? 4 : (a.daysOpen > 3 ? 2 : 0))));
                const bScore = b.escalatedToAdmin ? 10 : (b.urgency === 'URGENT' ? 8 : (b.urgency === 'HIGH' ? 6 : (b.daysOpen > 7 ? 4 : (b.daysOpen > 3 ? 2 : 0))));
                if (aScore !== bScore) return bScore - aScore;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
              });

              if (sorted.length === 0) {
                return (
                  <div className="rounded-xl border border-dashed border-ink-200 bg-white/60 py-12 text-center text-sm text-ink-500">
                    No requests found.
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {sorted.map((r: any) => {
                    const URGENCY_BORDER: Record<string, string> = {
                      URGENT: 'border-l-rose-500', HIGH: 'border-l-amber-500', NORMAL: 'border-l-brand-500', LOW: 'border-l-ink-300'
                    };
                    return (
                      <div key={r.id} className={`flex flex-col gap-4 rounded-xl border border-ink-200 border-l-4 bg-white p-4 shadow-card hover:border-ink-300 sm:flex-row sm:items-center sm:justify-between ${URGENCY_BORDER[r.urgency] || 'border-l-ink-200'}`}>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="font-mono text-[11px] font-medium text-ink-500">{r.number}</span>
                            {r.escalatedToAdmin && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700 tracking-wider">Escalated</span>}
                            <RequestUrgencyPill u={r.urgency} />
                          </div>
                          <h3 className="truncate font-medium text-ink-900">{r.title}</h3>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-600">
                            <span>{r.requestedBy?.firstName} {r.requestedBy?.lastName}</span>
                            {r.requestedBy?.department?.name && <span>• {r.requestedBy.department.name}</span>}
                            <span>•</span>
                            <span className="truncate">{r.category?.name || 'No category'}</span>
                          </div>
                        </div>
                        
                        <div className="flex shrink-0 flex-row items-center justify-between sm:flex-col sm:items-end gap-2">
                          <div className="flex items-center gap-2">
                            {r.status === 'PENDING' && r.categoryInStock === 0 && r.categoryId && (
                              <span className="flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                                ⚠️ 0 in stock
                              </span>
                            )}
                            <RequestStatusPill s={r.status} />
                            {r.status === 'PENDING' && <span className="ml-1"><AgeBadge daysOpen={r.daysOpen} /></span>}
                          </div>
                          <Button variant="secondary" size="sm" onClick={() => router.push(`/dashboard/asset-requests/${r.id}`)}>
                            Review →
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            }}
          </QueryState>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
            <h3 className="mb-4 text-sm font-semibold text-ink-900">Demand trends (this month)</h3>
            <QueryState query={demandQuery}>
              {(data) => <DemandChart data={data} />}
            </QueryState>
          </div>
        </div>
      </div>
    </div>
  );
}
