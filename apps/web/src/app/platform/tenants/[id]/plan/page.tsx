'use client';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { papi } from '@/lib/platform-api';
import { Card, Pill, QueryState, Button, selectClass, Field } from '@/components/ui';

/**
 * Plan & billing section — plan selector, subscription status, trial extension.
 */
export default function TenantPlanPage() {
  const params = useParams();
  const id = params?.id as string;
  const qc = useQueryClient();

  const tenant = useQuery({
    queryKey: ['platform-tenant', id],
    queryFn: () => papi<any>(`/platform/tenants/${id}`),
    enabled: !!id,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['platform-tenant', id] });
    qc.invalidateQueries({ queryKey: ['platform-tenants'] });
  };

  const setPlan = useMutation({
    mutationFn: (plan: string) => papi(`/platform/tenants/${id}/plan`, { method: 'PATCH', body: JSON.stringify({ plan }) }),
    onSuccess: () => { toast.success('Plan updated'); refresh(); },
  });
  const extendTrial = useMutation({
    mutationFn: (days: number) => papi(`/platform/tenants/${id}/extend-trial`, { method: 'POST', body: JSON.stringify({ days }) }),
    onSuccess: () => { toast.success('Trial extended'); refresh(); },
    onError: (e: any) => toast.error(e?.message || 'Could not extend trial'),
  });

  return (
    <QueryState query={tenant}>
      {(t: any) => (
        <div className="space-y-5">
          <Card>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-500">Plan</h3>
            <Field label="Current plan">
              <select className={selectClass} value={t.plan} onChange={(e) => setPlan.mutate(e.target.value)} disabled={setPlan.isPending}>
                <option value="starter">Starter</option>
                <option value="business">Business</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </Field>
          </Card>

          <Card>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-500">Subscription</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-ink-500">Status:</span>
                <Pill tone="purple">{t.subscriptionStatus}</Pill>
              </div>
              {t.trialEndsAt && (
                <div className="text-ink-500">
                  Trial ends: <span className="font-medium text-ink-700">{new Date(t.trialEndsAt).toLocaleDateString()}</span>
                </div>
              )}
              {t.currentPeriodEnd && (
                <div className="text-ink-500">
                  Current period ends: <span className="font-medium text-ink-700">{new Date(t.currentPeriodEnd).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-500">Extend trial</h3>
            <p className="mb-3 text-xs text-ink-500">Add days to this tenant's trial period.</p>
            <div className="flex flex-wrap gap-2">
              {[7, 14, 30].map((d) => (
                <Button key={d} variant="secondary" size="sm" loading={extendTrial.isPending} onClick={() => extendTrial.mutate(d)}>
                  +{d} days
                </Button>
              ))}
            </div>
          </Card>
        </div>
      )}
    </QueryState>
  );
}
