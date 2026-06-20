import Link from 'next/link';
import { CheckCircle2, X, ArrowRight, Sparkles } from 'lucide-react';
import { MarketingShell } from '@/components/marketing/Shell';
import { pageMetadata, breadcrumbLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';

export const metadata = pageMetadata({
  title: 'AssetMon vs Snipe-IT — modern asset management compared',
  description: 'A side-by-side comparison of AssetMon and Snipe-IT: hosting, modules, depreciation, multi-tenancy, integrations and pricing. Pick the right tool for your team.',
  path: '/compare/snipe-it',
});

const ROWS: { feature: string; us: string | boolean; them: string | boolean; note?: string }[] = [
  { feature: 'Deployment', us: 'Cloud SaaS · self-host on Enterprise', them: 'Self-host (LAMP) · paid cloud add-on' },
  { feature: 'Multi-tenant isolation', us: 'Database-per-tenant', them: 'Single DB / single tenant per install' },
  { feature: 'Setup time', us: 'Under 5 minutes', them: 'Server provisioning + LAMP install' },
  { feature: 'Custom fields per category', us: true, them: true },
  { feature: 'QR / barcode labels', us: true, them: true },
  { feature: 'CSV import / export', us: true, them: true },
  { feature: 'Service tickets', us: true, them: false, note: 'Snipe-IT is inventory-only' },
  { feature: 'Preventive maintenance schedules', us: true, them: false },
  { feature: 'Reservations / booking', us: true, them: false },
  { feature: 'Procurement (PR → PO → receive)', us: true, them: false },
  { feature: 'Depreciation engine (SL + DDB)', us: true, them: 'Straight-line only' },
  { feature: 'Software license management', us: true, them: true },
  { feature: 'Physical audit (scan-to-audit)', us: true, them: false },
  { feature: 'Modular activation (enable/disable per workspace)', us: true, them: false },
  { feature: 'Branding per tenant (logo + colour)', us: true, them: false },
  { feature: 'REST API + webhooks', us: 'OpenAPI + signed webhooks', them: 'API yes, webhooks limited' },
  { feature: 'SSO (Google / Entra ID / SAML)', us: 'Business plan', them: 'SAML add-on' },
  { feature: 'In-app notifications', us: true, them: false },
  { feature: 'Audit log tamper-evidence (hash chain)', us: true, them: false },
  { feature: 'Free tier', us: 'Forever Starter (50 assets, 5 users)', them: 'Open source, self-host yourself' },
  { feature: 'Pricing', us: '$8 / user / month', them: 'Free OSS / cloud from $39.99/mo' },
];

export default function CompareSnipeITPage() {
  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'Compare', url: '/compare/snipe-it' }, { name: 'AssetMon vs Snipe-IT', url: '/compare/snipe-it' }])} />
      <Hero title="AssetMon vs Snipe-IT" />
      <Table rows={ROWS} />
      <Closer />
    </MarketingShell>
  );
}

function Hero({ title }: { title: string }) {
  return (
    <section className="relative overflow-hidden border-b border-ink-100">
      <div aria-hidden className="absolute inset-0 bg-mesh opacity-70" />
      <div className="relative mx-auto max-w-4xl px-6 py-16 text-center">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white/70 px-3 py-1 text-xs text-ink-600 shadow-soft backdrop-blur">
          <Sparkles className="h-3 w-3 text-brand-600" /> Honest comparison
        </p>
        <h1 className="mt-4 text-balance text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">{title}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-balance text-base text-ink-600">
          We respect the open-source pioneer. If you want a modern, cloud-first platform with tickets,
          maintenance, procurement, depreciation and audits built in — AssetMon is your shorter path.
        </p>
      </div>
    </section>
  );
}

function Table({ rows }: { rows: typeof ROWS }) {
  return (
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
            {rows.map((r) => (
              <tr key={r.feature} className="border-t border-ink-100 align-top">
                <td className="px-4 py-3 font-medium text-ink-900">{r.feature}</td>
                <td className="px-4 py-3 text-ink-700"><Cell v={r.us} /></td>
                <td className="px-4 py-3 text-ink-700">
                  <Cell v={r.them} />
                  {r.note && <p className="mt-0.5 text-xs text-ink-400">{r.note}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Cell({ v }: { v: string | boolean }) {
  if (v === true) return <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-4 w-4" />Included</span>;
  if (v === false) return <span className="inline-flex items-center gap-1.5 text-ink-400"><X className="h-4 w-4" />Not available</span>;
  return <span>{v}</span>;
}

function Closer() {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-20 text-center">
      <h2 className="text-3xl font-semibold tracking-tight text-ink-900">Switching is the easy part.</h2>
      <p className="mt-3 text-base text-ink-600">Bring a CSV. We'll do the rest. Free for 30 days, no credit card.</p>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link href="/signup" className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white shadow-soft hover:bg-ink-800">
          Start free trial <ArrowRight className="h-4 w-4" />
        </Link>
        <Link href="/contact" className="inline-flex h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-5 text-sm font-semibold text-ink-700 shadow-soft hover:bg-ink-50">
          Talk to us
        </Link>
      </div>
    </section>
  );
}
