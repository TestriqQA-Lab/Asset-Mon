'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { usePermissions } from '@/lib/settings';
import { Modal } from '@/components/Modal';
import { Field, inputClass, btnPrimary, btnSecondary } from '@/components/Field';
import { Card, Pill, SectionHeader } from '@/components/ui';
import {
  CheckCircle2, XCircle, ArrowUpRight, Package, Clock, CircleDot, StickyNote, MinusCircle,
} from 'lucide-react';

import { RequestStatusPill, RequestUrgencyPill, RequestItemStatusPill } from '../_components';

export default function AssetRequestDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const perms = usePermissions();
  const isEmployee = perms.role === 'EMPLOYEE';
  const canAct = perms.role === 'ADMIN' || perms.role === 'ASSET_MANAGER';

  const request = useQuery({
    queryKey: ['asset-request', id],
    queryFn: () => api(`/asset-requests/${id}`),
    enabled: !!id,
  });

  // Asset picker for approve flow
  const [approveOpen, setApproveOpen] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const assets = useQuery({
    queryKey: ['assets-for-request', request.data?.category?.id],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: '200' });
      if (request.data?.category?.id) params.set('categoryId', request.data.category.id);
      return api(`/assets?${params}`);
    },
    enabled: approveOpen,
  });

  // Decline modal
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  // Escalate modal
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateNote, setEscalateNote] = useState('');

  // Note modal (specific-device requests)
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');

  const approve = useMutation({
    mutationFn: () => {
      if (!selectedAssetId) throw new Error('Select an asset');
      return api(`/asset-requests/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ assetId: selectedAssetId }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-request', id] });
      qc.invalidateQueries({ queryKey: ['asset-requests'] });
      setApproveOpen(false);
    },
  });

  const decline = useMutation({
    mutationFn: () => {
      if (!declineReason.trim()) throw new Error('Reason is required');
      return api(`/asset-requests/${id}/decline`, {
        method: 'POST',
        body: JSON.stringify({ reason: declineReason }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-request', id] });
      qc.invalidateQueries({ queryKey: ['asset-requests'] });
      setDeclineOpen(false);
    },
  });

  const escalate = useMutation({
    mutationFn: () => api(`/asset-requests/${id}/escalate`, {
      method: 'POST',
      body: JSON.stringify({ note: escalateNote || undefined }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-request', id] });
      setEscalateOpen(false);
    },
  });

  const fulfil = useMutation({
    mutationFn: () => api(`/asset-requests/${id}/fulfil`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-request', id] });
      qc.invalidateQueries({ queryKey: ['asset-requests'] });
    },
  });

  // SPECIFIC-mode manager actions (v2B endpoints)
  const approveAvailable = useMutation({
    mutationFn: () => api(`/asset-requests/${id}/approve`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-request', id] });
      qc.invalidateQueries({ queryKey: ['asset-requests'] });
    },
  });

  const noteM = useMutation({
    mutationFn: () => {
      if (!noteText.trim()) throw new Error('Note is required');
      return api(`/asset-requests/${id}/note`, { method: 'POST', body: JSON.stringify({ note: noteText.trim() }) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-request', id] });
      setNoteOpen(false);
    },
  });

  const declineItem = useMutation({
    mutationFn: (itemId: string) => api(`/asset-requests/${id}/items/${itemId}/decline`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset-request', id] }),
  });

  const cancelReq = useMutation({
    mutationFn: () => api(`/asset-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-request', id] });
      qc.invalidateQueries({ queryKey: ['asset-requests'] });
    },
  });

  const r = request.data;
  if (!r) return <div className="p-8 text-center text-ink-500">Loading…</div>;
  const isSpecific = r.mode === 'SPECIFIC';

  return (
    <div className="space-y-6">
      <a href="/dashboard/asset-requests" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline mb-2">
        ← Asset requests
      </a>
      <SectionHeader
        title={r.title}
        subtitle={`Request ${r.number}`}
      />

      {/* Status + actions bar */}
      <div className="flex flex-wrap items-center gap-3">
        <RequestStatusPill s={r.status} />
        <RequestUrgencyPill u={r.urgency} />
        {r.escalatedToAdmin && (
          <Pill tone="red" dot>Escalated to Admin</Pill>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          {/* Employee: cancel own pending request */}
          {isEmployee && r.status === 'PENDING' && (
            <button
              className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
              onClick={() => cancelReq.mutate()}
              disabled={cancelReq.isPending}
            >
              Cancel request
            </button>
          )}

          {/* Manager/Admin: approve */}
          {canAct && r.status === 'PENDING' && (
            isSpecific ? (
              <button
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                onClick={() => approveAvailable.mutate()}
                disabled={approveAvailable.isPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> {approveAvailable.isPending ? 'Approving…' : 'Approve available'}
              </button>
            ) : (
              <button
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                onClick={() => { setSelectedAssetId(''); setApproveOpen(true); }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Approve
              </button>
            )
          )}

          {/* Manager/Admin: one-way note (specific requests) */}
          {canAct && isSpecific && (r.status === 'PENDING' || r.status === 'APPROVED') && (
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
              onClick={() => { setNoteText(r.managerNote || ''); setNoteOpen(true); }}
            >
              <StickyNote className="h-3.5 w-3.5" /> Send note
            </button>
          )}

          {/* Manager/Admin: decline */}
          {canAct && r.status === 'PENDING' && (
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
              onClick={() => { setDeclineReason(''); setDeclineOpen(true); }}
            >
              <XCircle className="h-3.5 w-3.5" /> Decline
            </button>
          )}

          {/* Manager: escalate to admin */}
          {perms.role === 'ASSET_MANAGER' && r.status === 'PENDING' && !r.escalatedToAdmin && (
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
              onClick={() => { setEscalateNote(''); setEscalateOpen(true); }}
            >
              <ArrowUpRight className="h-3.5 w-3.5" /> Escalate to Admin
            </button>
          )}

          {/* Manager/Admin: fulfil (checkout) */}
          {canAct && r.status === 'APPROVED' && (
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
              onClick={() => fulfil.mutate()}
              disabled={fulfil.isPending}
            >
              <Package className="h-3.5 w-3.5" /> {fulfil.isPending ? 'Checking out…' : (isSpecific ? 'Hand over devices' : 'Fulfil (check out)')}
            </button>
          )}
        </div>
      </div>

      {/* Error / result displays */}
      {fulfil.error && <p className="text-sm text-red-600">{(fulfil.error as Error).message}</p>}
      {cancelReq.error && <p className="text-sm text-red-600">{(cancelReq.error as Error).message}</p>}
      {approveAvailable.error && <p className="text-sm text-red-600">{(approveAvailable.error as Error).message}</p>}
      {isSpecific && fulfil.data && typeof fulfil.data.handed === 'number' && (
        <p className="text-sm text-green-700">
          Handed over {fulfil.data.handed} of {fulfil.data.total} device(s)
          {fulfil.data.skipped?.length ? ` — ${fulfil.data.skipped.length} still unavailable` : ''}.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left: request details */}
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-500">Request details</h2>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-ink-400">Requester</dt>
                <dd className="text-ink-900">{r.requestedBy?.firstName} {r.requestedBy?.lastName}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">Email</dt>
                <dd className="text-ink-900">{r.requestedBy?.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">Category</dt>
                <dd className="text-ink-900">{r.category?.name || 'Not specified'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">Date</dt>
                <dd className="text-ink-900">{new Date(r.createdAt).toLocaleDateString()}</dd>
              </div>
              {r.neededBy && (
                <div>
                  <dt className="text-xs text-ink-400">Needed by</dt>
                  <dd className="text-ink-900">{new Date(r.neededBy).toLocaleString()}</dd>
                </div>
              )}
              {r.isTemporary && (
                <div>
                  <dt className="text-xs text-ink-400">Temporary</dt>
                  <dd className="text-ink-900">{r.returnBy ? `Return by ${new Date(r.returnBy).toLocaleDateString()}` : 'Yes'}</dd>
                </div>
              )}
              {r.assignedTo && (
                <div>
                  <dt className="text-xs text-ink-400">Assigned manager</dt>
                  <dd className="text-ink-900">{r.assignedTo.firstName} {r.assignedTo.lastName}</dd>
                </div>
              )}
              {r.reviewedBy && (
                <div>
                  <dt className="text-xs text-ink-400">Reviewed by</dt>
                  <dd className="text-ink-900">{r.reviewedBy.firstName} {r.reviewedBy.lastName}</dd>
                </div>
              )}
              {r.reviewedAt && (
                <div>
                  <dt className="text-xs text-ink-400">Reviewed at</dt>
                  <dd className="text-ink-900">{new Date(r.reviewedAt).toLocaleString()}</dd>
                </div>
              )}
            </dl>
            {r.reason && (
              <div className="mt-4 rounded-md bg-ink-50 px-3 py-2">
                <div className="text-xs font-medium text-ink-400">Reason</div>
                <div className="mt-1 text-sm text-ink-700">{r.reason}</div>
              </div>
            )}
          </Card>

          {/* Manager's one-way note */}
          {r.managerNote && (
            <Card>
              <div className="flex items-start gap-3">
                <StickyNote className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
                <div>
                  <h3 className="text-sm font-semibold text-brand-700">Note from the manager</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{r.managerNote}</p>
                </div>
              </div>
            </Card>
          )}

          {/* Specific-device lines */}
          {isSpecific && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Requested devices ({r.items?.length || 0})</h2>
                {r.isTemporary && <Pill tone="amber">Temporary{r.returnBy ? ` · return by ${new Date(r.returnBy).toLocaleDateString()}` : ''}</Pill>}
              </div>
              <div className="divide-y divide-ink-100">
                {(r.items || []).map((it: any) => (
                  <div key={it.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-ink-500">{it.asset?.assetTag}</span>
                        <span className="truncate text-sm text-ink-900">{it.asset?.name}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                        <span className={`h-1.5 w-1.5 rounded-full ${it.available ? 'bg-emerald-500' : 'bg-ink-300'}`} />
                        <span className="text-ink-500">{it.available ? 'Available' : (it.heldBy ? `In use by ${it.heldBy.name}` : 'In use')}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <RequestItemStatusPill s={it.status} />
                      {canAct && (r.status === 'PENDING' || r.status === 'APPROVED') && it.status !== 'DECLINED' && it.status !== 'FULFILLED' && (
                        <button
                          onClick={() => declineItem.mutate(it.id)}
                          disabled={declineItem.isPending}
                          className="rounded-md border border-red-200 bg-red-50 p-1 text-red-600 hover:bg-red-100 disabled:opacity-50"
                          title="Decline this device"
                        >
                          <MinusCircle className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {(r.items || []).length === 0 && <div className="py-3 text-sm text-ink-500">No devices on this request.</div>}
              </div>
              {declineItem.error && <p className="mt-2 text-sm text-red-600">{(declineItem.error as Error).message}</p>}
            </Card>
          )}

          {/* Decline reason */}
          {r.status === 'DECLINED' && r.declineReason && (
            <Card>
              <div className="flex items-start gap-3">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                <div>
                  <h3 className="text-sm font-semibold text-red-700">Request declined</h3>
                  <p className="mt-1 text-sm text-ink-700">{r.declineReason}</p>
                </div>
              </div>
            </Card>
          )}

          {/* Escalation note */}
          {r.escalatedToAdmin && r.escalationNote && (
            <Card>
              <div className="flex items-start gap-3">
                <ArrowUpRight className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div>
                  <h3 className="text-sm font-semibold text-amber-700">Escalation note</h3>
                  <p className="mt-1 text-sm text-ink-700">{r.escalationNote}</p>
                </div>
              </div>
            </Card>
          )}

          {/* Fulfilled asset */}
          {r.fulfilledAsset && (
            <Card>
              <div className="flex items-start gap-3">
                <Package className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
                <div>
                  <h3 className="text-sm font-semibold text-green-700">
                    {r.status === 'FULFILLED' ? 'Asset checked out' : 'Asset allocated'}
                  </h3>
                  <a
                    href={`/dashboard/assets/${r.fulfilledAsset.id}`}
                    className="mt-1 text-sm text-brand-600 hover:underline"
                  >
                    {r.fulfilledAsset.assetTag} · {r.fulfilledAsset.name}
                  </a>
                  {r.fulfilledAt && (
                    <p className="text-xs text-ink-400 mt-1">Fulfilled {new Date(r.fulfilledAt).toLocaleString()}</p>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Right: status timeline */}
        <div>
          <Card>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-ink-500">Timeline</h2>
            <ol className="relative border-l border-ink-200 ml-2 space-y-4">
              <TimelineItem
                icon={<CircleDot className="h-3.5 w-3.5" />}
                label="Request created"
                date={r.createdAt}
                active
              />
              {r.status === 'PENDING' && (
                <TimelineItem
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label="Awaiting review"
                  active
                  accent="amber"
                />
              )}
              {r.status === 'APPROVED' && (
                <TimelineItem
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  label="Approved — awaiting fulfilment"
                  date={r.reviewedAt}
                  active
                  accent="brand"
                />
              )}
              {r.status === 'DECLINED' && (
                <TimelineItem
                  icon={<XCircle className="h-3.5 w-3.5" />}
                  label="Declined"
                  date={r.reviewedAt}
                  active
                  accent="red"
                />
              )}
              {r.status === 'FULFILLED' && (
                <>
                  <TimelineItem
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    label="Approved"
                    date={r.reviewedAt}
                    active
                    accent="brand"
                  />
                  <TimelineItem
                    icon={<Package className="h-3.5 w-3.5" />}
                    label="Fulfilled — asset checked out"
                    date={r.fulfilledAt}
                    active
                    accent="green"
                  />
                </>
              )}
              {r.status === 'CANCELLED' && (
                <TimelineItem
                  icon={<XCircle className="h-3.5 w-3.5" />}
                  label="Cancelled by requester"
                  active
                  accent="neutral"
                />
              )}
            </ol>
          </Card>
        </div>
      </div>

      {/* Approve modal — asset picker */}
      <Modal
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title="Approve — select an asset"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setApproveOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => approve.mutate()} disabled={approve.isPending || !selectedAssetId}>
              {approve.isPending ? 'Approving…' : 'Approve & allocate'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Pick an available asset">
            <select
              className={inputClass}
              value={selectedAssetId}
              onChange={(e) => setSelectedAssetId(e.target.value)}
            >
              <option value="">— Select —</option>
              {(assets.data?.items || assets.data || [])
                .filter((a: any) => a.status === 'AVAILABLE')
                .map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.assetTag} · {a.name} ({a.status})
                  </option>
                ))}
            </select>
          </Field>
          {approve.error && <p className="text-sm text-red-600">{(approve.error as Error).message}</p>}
        </div>
      </Modal>

      {/* Decline modal */}
      <Modal
        open={declineOpen}
        onClose={() => setDeclineOpen(false)}
        title="Decline request"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setDeclineOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => decline.mutate()} disabled={decline.isPending}>
              {decline.isPending ? 'Declining…' : 'Decline'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Reason (the employee will see this)">
            <textarea
              className={inputClass}
              rows={3}
              placeholder="Why is this request being declined?"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
            />
          </Field>
          {decline.error && <p className="text-sm text-red-600">{(decline.error as Error).message}</p>}
        </div>
      </Modal>

      {/* Escalate modal */}
      <Modal
        open={escalateOpen}
        onClose={() => setEscalateOpen(false)}
        title="Escalate to Admin"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setEscalateOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => escalate.mutate()} disabled={escalate.isPending}>
              {escalate.isPending ? 'Escalating…' : 'Escalate'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Note for admin (optional)">
            <textarea
              className={inputClass}
              rows={3}
              placeholder="Why are you escalating this request?"
              value={escalateNote}
              onChange={(e) => setEscalateNote(e.target.value)}
            />
          </Field>
          {escalate.error && <p className="text-sm text-red-600">{(escalate.error as Error).message}</p>}
        </div>
      </Modal>

      {/* Note modal — one-way manager → employee */}
      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Send a note to the employee"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setNoteOpen(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => noteM.mutate()} disabled={noteM.isPending}>
              {noteM.isPending ? 'Sending…' : 'Send note'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Note (one-way — the employee will see this)">
            <textarea
              className={inputClass}
              rows={3}
              placeholder="e.g. TAG-045 is in use — want a substitute?"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
          </Field>
          {noteM.error && <p className="text-sm text-red-600">{(noteM.error as Error).message}</p>}
        </div>
      </Modal>
    </div>
  );
}

function TimelineItem({ icon, label, date, active, accent }: {
  icon: React.ReactNode; label: string; date?: string; active?: boolean;
  accent?: 'brand' | 'green' | 'amber' | 'red' | 'neutral';
}) {
  const colors: Record<string, string> = {
    brand: 'bg-brand-100 text-brand-600 ring-brand-200',
    green: 'bg-green-100 text-green-600 ring-green-200',
    amber: 'bg-amber-100 text-amber-600 ring-amber-200',
    red: 'bg-red-100 text-red-600 ring-red-200',
    neutral: 'bg-ink-100 text-ink-500 ring-ink-200',
  };
  const cls = accent ? colors[accent] : 'bg-ink-100 text-ink-500 ring-ink-200';
  return (
    <li className="ml-4">
      <div className={`absolute -left-[9px] flex h-[18px] w-[18px] items-center justify-center rounded-full ring-2 ring-white ${cls}`}>
        {icon}
      </div>
      <div className={`pb-0.5 text-sm ${active ? 'font-medium text-ink-900' : 'text-ink-400'}`}>
        {label}
      </div>
      {date && (
        <time className="text-xs text-ink-400">{new Date(date).toLocaleString()}</time>
      )}
    </li>
  );
}
