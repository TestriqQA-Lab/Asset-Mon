'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, CreditCard, AlertCircle, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, SectionHeader, Button, Pill } from '@/components/ui';
import { PLANS } from '@/lib/plans';

export default function BillingPage() {
  const qc = useQueryClient();
  const billing = useQuery({ queryKey: ['billing-summary'], queryFn: () => api<any>('/billing') });

  const change = useMutation<any, Error, string>({
    mutationFn: (plan: string) => api('/billing/change-plan', { method: 'POST', body: JSON.stringify({ plan }) }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['billing-summary'] });
      qc.invalidateQueries({ queryKey: ['tenant-settings'] });
      if (r?.checkoutUrl) {
        toast.success('Opening Razorpay checkout…');
        window.open(r.checkoutUrl, '_blank', 'noopener,noreferrer');
      } else if (r?.devMode) {
        toast.success('Plan updated (Razorpay dev mode)');
      } else {
        toast.success('Plan updated');
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const b = billing.data;
  const currentKey: keyof typeof PLANS | undefined = b?.planKey;

  return (
    <div className="space-y-5">
      <SectionHeader title="Billing" subtitle="See your usage, manage your plan, and download invoices." />

      {b?.inTrial && (
        <Card>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">
              <AlertCircle className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-900">You're on a free trial.</p>
              <p className="mt-1 text-sm text-ink-600">
                <b>{b.daysRemainingInTrial} days</b> remaining. No card on file. Pick a plan below to keep your workspace active after the trial.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Current usage</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <UsageBar label="Users" used={b?.usage?.users ?? 0} limit={b?.limits?.users} />
          <UsageBar label="Assets" used={b?.usage?.assets ?? 0} limit={b?.limits?.assets} />
        </div>
      </Card>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Plans</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {(Object.values(PLANS)).map((p) => {
            const isCurrent = currentKey === p.key;
            return (
              <div key={p.key} className={`rounded-2xl border p-5 shadow-card ${isCurrent ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50/30' : 'border-ink-200 bg-white'}`}>
                <div className="flex items-start justify-between">
                  <h4 className="text-sm font-semibold text-ink-900">{p.name}</h4>
                  {isCurrent && <Pill tone="brand" dot>Current</Pill>}
                </div>
                <p className="mt-1 text-xs text-ink-500">{p.description}</p>
                <div className="mt-3">
                  {p.key === 'enterprise'
                    ? <span className="text-3xl font-semibold text-ink-900">Custom</span>
                    : p.priceMonthly === 0
                      ? <span className="text-3xl font-semibold text-ink-900">Free</span>
                      : <><span className="text-3xl font-semibold text-ink-900">{p.currency === 'INR' ? '₹' : '$'}{p.priceMonthly}</span><span className="ml-1 text-sm text-ink-500">/user/mo</span></>}
                </div>
                <ul className="mt-4 space-y-1.5 text-sm text-ink-700">
                  {p.key === 'starter' && (
                    <>
                      <Line>Up to {p.limits.users} users</Line>
                      <Line>Up to {p.limits.assets} assets</Line>
                      <Line>Core asset tracking + CSV import</Line>
                    </>
                  )}
                  {p.key === 'business' && (
                    <>
                      <Line>Unlimited users + assets</Line>
                      <Line>All modules unlocked</Line>
                      <Line>API + webhooks + SSO</Line>
                    </>
                  )}
                  {p.key === 'enterprise' && (
                    <>
                      <Line>Dedicated cluster + SCIM</Line>
                      <Line>Custom SLAs + DPA</Line>
                      <Line>Region pinning</Line>
                    </>
                  )}
                </ul>
                <Button
                  className="mt-5 w-full"
                  variant={isCurrent ? 'secondary' : 'primary'}
                  disabled={isCurrent || p.key === 'enterprise'}
                  loading={change.isPending}
                  onClick={() => change.mutate(p.key)}
                  icon={p.key === 'enterprise' ? <CreditCard className="h-4 w-4" /> : undefined}
                >
                  {isCurrent ? 'Current plan' : p.key === 'enterprise' ? 'Contact sales' : 'Switch to this plan'}
                  {!isCurrent && p.key !== 'enterprise' && <ArrowRight className="h-4 w-4" />}
                </Button>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-400">
          Plan changes apply immediately. Stripe integration is in dev mode in this build — no card is charged.
        </p>
      </div>
    </div>
  );
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null | undefined }) {
  const cap = limit ?? Infinity;
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  const over = limit && used > limit;
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">{label}</span>
        <span className={`text-sm font-semibold ${over ? 'text-rose-700' : 'text-ink-900'}`}>{used}{limit ? ` / ${limit}` : ''}</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-100">
        <div className={`h-full rounded-full ${over ? 'bg-rose-500' : 'bg-gradient-to-r from-brand-500 to-brand-700'}`} style={{ width: limit ? `${pct}%` : '100%' }} />
      </div>
      {!limit && <p className="mt-2 text-[11px] text-ink-400">Unlimited on your plan.</p>}
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{children}</li>;
}
