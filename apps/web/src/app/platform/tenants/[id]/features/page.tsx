'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { papi, getPlatformSession } from '@/lib/platform-api';
import { Card, Pill, QueryState, Button } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { MODULE_KEYS, type ModuleKey } from '@/lib/settings';
import { MODULES, Toggle } from '../_shared';

/**
 * Features section — per-module toggles with confirm modal.
 */
export default function TenantFeaturesPage() {
  const params = useParams();
  const id = params?.id as string;
  const qc = useQueryClient();
  const role = getPlatformSession()?.user.role;
  const canEdit = role === 'SUPER_ADMIN';

  const modules = useQuery({
    queryKey: ['platform-tenant-modules', id],
    queryFn: () => papi<{ modules: Record<ModuleKey, boolean> }>(`/platform/tenants/${id}/modules`),
    enabled: !!id,
  });

  const [state, setState] = useState<Record<ModuleKey, boolean> | null>(null);
  useEffect(() => { if (modules.data) setState(modules.data.modules); }, [modules.data]);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const save = useMutation({
    mutationFn: () => papi(`/platform/tenants/${id}/modules`, { method: 'PATCH', body: JSON.stringify({ modules: state }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-tenant-modules', id] });
      setConfirmOpen(false);
      toast.success('Features updated');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const dirty = !!(state && modules.data && MODULE_KEYS.some((k) => state[k] !== modules.data!.modules[k]));
  const disablingSomething = !!(state && modules.data && MODULE_KEYS.some((k) => modules.data!.modules[k] && !state[k]));
  const enabledCount = state ? MODULE_KEYS.filter((k) => state[k]).length : 0;

  const onSave = () => { if (disablingSomething) setConfirmOpen(true); else save.mutate(); };

  return (
    <Card padded={false}>
      <div className="flex flex-col gap-2 border-b border-ink-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Features</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Turn this company's features on or off. <strong>Off truly blocks</strong> the feature — menus, screens and API. They can re-enable from Settings → Modules.
          </p>
        </div>
        <Pill tone="brand" dot>{enabledCount} / {MODULE_KEYS.length} on</Pill>
      </div>

      <QueryState query={modules}>
        {() => (
          <>
            {!canEdit && (
              <div className="border-b border-ink-100 bg-ink-50 px-5 py-2 text-xs text-ink-500">
                Read-only — changing features requires a super-admin operator.
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
              {MODULES.map((m) => {
                const on = !!state?.[m.key];
                return (
                  <div key={m.key} className={`flex items-start justify-between gap-3 rounded-lg border border-ink-100 p-3 ${on ? '' : 'opacity-80'}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink-900">{m.name}</div>
                      <div className="mt-0.5 text-xs text-ink-500">{m.description}</div>
                    </div>
                    <Toggle checked={on} disabled={!canEdit} onChange={(v) => setState((s) => (s ? { ...s, [m.key]: v } : s))} />
                  </div>
                );
              })}
            </div>
            {canEdit && (
              <div className="flex items-center justify-end gap-2 border-t border-ink-100 px-5 py-3">
                {dirty
                  ? <span className="text-xs text-amber-700">Unsaved changes</span>
                  : <span className="text-xs text-ink-400">All changes saved</span>}
                <Button variant="secondary" onClick={() => modules.data && setState(modules.data.modules)} disabled={!dirty}>Reset</Button>
                <Button onClick={onSave} loading={save.isPending} disabled={!dirty}>Save changes</Button>
              </div>
            )}
          </>
        )}
      </QueryState>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Turn features off?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={save.isPending} onClick={() => save.mutate()}>Yes, apply</Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-ink-700">
          <p>Turning a feature <strong>off</strong> blocks it for everyone in this company — its menu, its screens, and any API key / automation that uses it.</p>
          <p className="text-xs text-ink-500">They can re-enable it themselves from <em>Settings → Modules</em>. This change is recorded in the audit log.</p>
        </div>
      </Modal>
    </Card>
  );
}
