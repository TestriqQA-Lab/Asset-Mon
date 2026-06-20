import Link from 'next/link';
import { CheckCircle2, X, ArrowRight, Sparkles } from 'lucide-react';
import { MarketingShell } from '@/components/marketing/Shell';
import { pageMetadata, breadcrumbLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';

export const metadata = pageMetadata({
  title: 'AssetMon vs Asset Panda — modern asset management compared',
  description: 'A side-by-side comparison of AssetMon and Asset Panda: pricing transparency, multi-tenancy, depreciation engine, integrations and total cost of ownership.',
  path: '/compare/asset-panda',
});

const ROWS: { feature: string; us: string | boolean; them: string | boolean; note?: string }[] = [
  { feature: 'Public pricing', us: '$0 / $8 per user · per month', them: 'Quote-only · "talk to sales"' },
  { feature: 'Free tier', us: 'Forever Starter (50 assets, 5 users)', them: false },
  { feature: 'Setup time', us: 'Under 5 minutes', them: 'Implementation engagement' },
  { feature: 'Multi-tenant isolation', us: 'Database-per-tenant', them: 'Shared platform' },
  { feature: 'Custom fields per category', us: true, them: true },
  { feature: 'Service tickets', us: true, them: true },
  { feature: 'Maintenance schedules', us: true, them: true },
  { feature: 'Reservations / booking', us: true, them: 'Add-on' },
  { feature: 'Procurement (PR → PO → receive)', us: true, them: 'Add-on' },
  { feature: 'Depreciation engine (SL + DDB)', us: true, them: true },
  { feature: 'Software license management', us: true, them: 'Add-on' },
  { feature: 'Modular activation (enable / disable)', us: true, them: false },
  { feature: 'Branding per tenant (logo + colour)', us: true, them: 'Enterprise tier' },
  { feature: 'REST API + signed webhooks', us: 'OpenAPI + HMAC', them: 'REST API; webhooks limited' },
  { feature: 'SSO (Google / Entra / SAML)', us: 'Business plan', them: 'Enterprise tier' },
  { feature: 'Audit log tamper-evidence', us: true, them: false },
  { feature: 'Data export', us: 'CSV anywhere + full API', them: 'CSV / Excel' },
  { feature: 'Mobile audit (scan-to-audit)', us: 'PWA + camera scan', them: 'Native app' },
];

export default function CompareAssetPandaPage() {
  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'Compare', url: '/compare/asset-panda' }, { name: 'AssetMon vs Asset Panda', url: '/compare/asset-panda' }])} />
      <section className="relative overflow-hidden border-b border-ink-100">
        <div aria-hidden className="absolute inset-0 bg-mesh opacity-70" />
        <div className="relative mx-auto max-w-4xl px-6 py-16 text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white/70 px-3 py-1 text-xs text-ink-600 shadow-soft backdrop-blur">
            <Sparkles className="h-3 w-3 text-brand-600" /> Honest comparison
          </p>
          <h1 className="mt-4 text-balance text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">AssetMon vs Asset Panda</h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-base text-ink-600">
            Asset Panda is full-featured and capable — but it's a "talk to sales" product. AssetMon
            puts pricing on the website, ships modules à la carte, and lets you start in five minutes.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60 text-left text-xs uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-3">Feature</th>
                <th className="px-4 py-3 text-brand-700">AssetMon</th>
                <th className="px-4 py-3">The other tool</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.feature} className="border-t border-ink-100 align-top">
                  <td className="px-4 py-3 font-medium text-ink-900">{r.feature}</td>
                  <td className="px-4 py-3 text-ink-700">
                    {r.us === true ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-4 w-4" />Included</span>
                      : r.us === false ? <span className="inline-flex items-center gap-1.5 text-ink-400"><X className="h-4 w-4" />Not available</span>
                      : r.us}
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    {r.them === true ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-4 w-4" />Included</span>
                      : r.them === false ? <span className="inline-flex items-center gap-1.5 text-ink-400"><X className="h-4 w-4" />Not available</span>
                      : r.them}
                    {r.note && <p className="mt-0.5 text-xs text-ink-400">{r.note}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-ink-900">Five-minute setup. No sales call.</h2>
        <p className="mt-3 text-base text-ink-600">Try the full Business tier free for 30 days. We don't ask for your card.</p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/signup" className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white shadow-soft hover:bg-ink-800">
            Start free trial <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/contact" className="inline-flex h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-5 text-sm font-semibold text-ink-700 shadow-soft hover:bg-ink-50">
            Talk to us
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
