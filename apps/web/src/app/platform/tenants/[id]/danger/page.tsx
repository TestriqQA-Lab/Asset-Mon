'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { papi } from '@/lib/platform-api';
import { Card, QueryState, Button, inputClass, Field } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { Trash2, AlertTriangle } from 'lucide-react';

/**
 * Danger zone — delete tenant. Isolated on its own page so it can't be hit
 * accidentally while doing routine work.
 */
export default function TenantDangerPage() {
  const params = useParams();
  const id = params?.id as string;
  const r = useRouter();
  const qc = useQueryClient();

  const tenant = useQuery({
    queryKey: ['platform-tenant', id],
    queryFn: () => papi<any>(`/platform/tenants/${id}`),
    enabled: !!id,
  });

  const [delConfirm, setDelConfirm] = useState(false);
  const [delSlug, setDelSlug] = useState('');
  const remove = useMutation({
    mutationFn: () => papi(`/platform/tenants/${id}?confirmSlug=${encodeURIComponent(delSlug)}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Workspace deleted');
      setDelConfirm(false);
      r.push('/platform/tenants');
    },
  });

  return (
    <QueryState query={tenant}>
      {(t: any) => (
        <>
          <div className="rounded-xl border-2 border-rose-200 bg-rose-50/50 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-rose-900">Delete this workspace</h3>
                <p className="mt-1 text-sm text-rose-700">
                  This will <strong>permanently drop the tenant database</strong>. All users, assets, attachments, and history for <strong>{t.name}</strong> will be lost. This cannot be undone.
                </p>
                <div className="mt-4">
                  <Button
                    variant="danger"
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => setDelConfirm(true)}
                    disabled={t.status === 'DELETED'}
                  >
                    Delete workspace "{t.name}"
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Delete confirmation */}
          <Modal
            open={delConfirm}
            onClose={() => { setDelConfirm(false); setDelSlug(''); }}
            title={`Delete workspace "${t.name}"`}
            footer={
              <>
                <Button variant="secondary" onClick={() => { setDelConfirm(false); setDelSlug(''); }}>Cancel</Button>
                <Button
                  variant="danger"
                  icon={<Trash2 className="h-4 w-4" />}
                  disabled={delSlug !== t.slug || remove.isPending}
                  loading={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  Permanently delete
                </Button>
              </>
            }
          >
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">
                <p className="font-semibold">This will drop the tenant database.</p>
                <p className="mt-1">All users, assets, attachments, and history for <strong>{t.name}</strong> will be lost. This cannot be undone.</p>
              </div>
              <Field label={`Type "${t.slug}" to confirm`}>
                <input className={inputClass} value={delSlug} onChange={(e) => setDelSlug(e.target.value)} placeholder={t.slug} autoFocus />
              </Field>
            </div>
          </Modal>
        </>
      )}
    </QueryState>
  );
}
