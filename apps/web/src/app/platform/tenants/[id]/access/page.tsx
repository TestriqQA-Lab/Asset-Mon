'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { papi, getPlatformSession } from '@/lib/platform-api';
import { Card, Pill, QueryState, Button } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { Pause, Play, RotateCw, Ban, Copy, Check } from 'lucide-react';
import { useCopy } from '../_shared';

/**
 * Access section — invite link management + suspend/activate workspace.
 */
export default function TenantAccessPage() {
  const params = useParams();
  const id = params?.id as string;
  const qc = useQueryClient();
  const canEdit = getPlatformSession()?.user.role === 'SUPER_ADMIN';

  const tenant = useQuery({
    queryKey: ['platform-tenant', id],
    queryFn: () => papi<any>(`/platform/tenants/${id}`),
    enabled: !!id,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['platform-tenant', id] });
    qc.invalidateQueries({ queryKey: ['platform-tenants'] });
  };

  const suspend = useMutation({
    mutationFn: () => papi(`/platform/tenants/${id}/suspend`, { method: 'POST' }),
    onSuccess: () => { toast.success('Workspace suspended'); refresh(); },
  });
  const activate = useMutation({
    mutationFn: () => papi(`/platform/tenants/${id}/activate`, { method: 'POST' }),
    onSuccess: () => { toast.success('Workspace activated'); refresh(); },
  });

  // ── Invite link ───────────────────────────────────────────────────────────
  const invite = useQuery({
    queryKey: ['platform-tenant-invite', id],
    queryFn: () => papi<{ enabled: boolean; disabled: boolean; token: string | null; needsRotation?: boolean }>(`/platform/tenants/${id}/invite`),
    enabled: !!id,
  });
  const [link, setLink] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const { copied, copy } = useCopy();
  const urlFor = (token: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/invite/${token}`;

  const regenerate = useMutation({
    mutationFn: () => papi<{ token: string }>(`/platform/tenants/${id}/invite/regenerate`, { method: 'POST' }),
    onSuccess: (d) => { setLink(urlFor(d.token)); toast.success('Invite link generated'); qc.invalidateQueries({ queryKey: ['platform-tenant-invite', id] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const disable = useMutation({
    mutationFn: () => papi(`/platform/tenants/${id}/invite/disable`, { method: 'POST' }),
    onSuccess: () => { setConfirmDisable(false); setLink(null); toast.success('Invite link disabled'); qc.invalidateQueries({ queryKey: ['platform-tenant-invite', id] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const s = invite.data;

  return (
    <div className="space-y-5">
      {/* Suspend / activate */}
      <QueryState query={tenant}>
        {(t: any) => (
          <Card>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-500">Workspace status</h3>
            <div className="flex items-center gap-3">
              <Pill tone={t.status === 'ACTIVE' ? 'green' : t.status === 'SUSPENDED' ? 'red' : 'gray'} dot>{t.status}</Pill>
              {t.status === 'SUSPENDED' ? (
                <Button variant="secondary" icon={<Play className="h-4 w-4" />} loading={activate.isPending} onClick={() => activate.mutate()}>
                  Activate
                </Button>
              ) : t.status === 'ACTIVE' ? (
                <Button variant="secondary" icon={<Pause className="h-4 w-4" />} loading={suspend.isPending} onClick={() => suspend.mutate()}>
                  Suspend
                </Button>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-ink-500">
              Suspending blocks all tenant users from logging in. Their data is preserved.
            </p>
          </Card>
        )}
      </QueryState>

      {/* Invite link */}
      <Card padded={false}>
        <div className="flex flex-col gap-2 border-b border-ink-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Workspace invite</h3>
            <p className="mt-0.5 text-xs text-ink-500">The company's shared join link. <strong>Disabling is sticky</strong> — it stays off until you regenerate it.</p>
          </div>
          {s && (s.disabled ? <Pill tone="red" dot>Disabled</Pill> : s.enabled ? <Pill tone="green" dot>Enabled</Pill> : <Pill tone="gray" dot>No link</Pill>)}
        </div>
        <QueryState query={invite}>
          {(st: any) => (
            <div className="space-y-3 p-4">
              {!canEdit && (
                <div className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">Read-only — managing the invite link requires a super-admin operator.</div>
              )}
              {(link || st.token) ? (
                <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-xs">
                  <span className="flex-1 break-all">{link || urlFor(st.token)}</span>
                  <button onClick={() => copy(link || urlFor(st.token))} className="rounded p-1 hover:bg-white">
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-ink-500" />}
                  </button>
                </div>
              ) : st.enabled && st.needsRotation ? (
                <p className="text-xs text-ink-500">A link exists but can't be shown (it isn't stored in plain text). Regenerate to get a fresh shareable link.</p>
              ) : st.disabled ? (
                <p className="text-xs text-ink-500">The invite link is disabled. Re-enable to create a fresh link and turn joining back on.</p>
              ) : (
                <p className="text-xs text-ink-500">No invite link yet. Generate one to let new employees join.</p>
              )}
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" icon={<RotateCw className="h-3.5 w-3.5" />} loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
                    {st.disabled ? 'Re-enable link' : st.enabled ? 'Regenerate link' : 'Generate link'}
                  </Button>
                  {st.enabled && (
                    <Button variant="secondary" size="sm" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setConfirmDisable(true)}>Disable link</Button>
                  )}
                </div>
              )}
            </div>
          )}
        </QueryState>

        <Modal
          open={confirmDisable}
          onClose={() => setConfirmDisable(false)}
          title="Disable the invite link?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDisable(false)}>Cancel</Button>
              <Button variant="danger" loading={disable.isPending} onClick={() => disable.mutate()}>Disable link</Button>
            </>
          }
        >
          <div className="space-y-2 text-sm text-ink-700">
            <p>Anyone holding the current link will no longer be able to join. It stays <strong>disabled</strong> until you regenerate it — it won't be silently re-created.</p>
            <p className="text-xs text-ink-500">Recorded in the audit log.</p>
          </div>
        </Modal>
      </Card>
    </div>
  );
}
