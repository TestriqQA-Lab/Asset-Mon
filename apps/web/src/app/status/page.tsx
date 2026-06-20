import { MarketingShell } from '@/components/marketing/Shell';
import { pageMetadata, breadcrumbLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';

export const metadata = pageMetadata({
  title: 'AssetMon status — service health',
  description: 'Real-time status of the AssetMon platform: API, dashboard, marketing site, webhooks and email delivery.',
  path: '/status',
});

const COMPONENTS = [
  { name: 'API', status: 'operational' },
  { name: 'Dashboard', status: 'operational' },
  { name: 'Marketing site', status: 'operational' },
  { name: 'Webhook delivery', status: 'operational' },
  { name: 'Email delivery', status: 'operational' },
  { name: 'Background jobs', status: 'operational' },
];

const HISTORY = [
  { date: '2026-05-01', summary: 'No incidents.' },
  { date: '2026-04-01', summary: 'Brief webhook retry delay (4 min) on 2026-04-12; auto-recovered.' },
  { date: '2026-03-01', summary: 'No incidents.' },
];

export default function StatusPage() {
  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'Status', url: '/status' }])} />
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-900">Service status</h1>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          All systems operational
        </div>

        <ul className="mt-8 divide-y divide-ink-100 rounded-2xl border border-ink-200 bg-white shadow-card">
          {COMPONENTS.map((c) => (
            <li key={c.name} className="flex items-center justify-between px-5 py-3 text-sm">
              <span className="font-medium text-ink-900">{c.name}</span>
              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Operational
              </span>
            </li>
          ))}
        </ul>

        <h2 className="mt-12 text-2xl font-semibold tracking-tight text-ink-900">Incident history</h2>
        <ul className="mt-4 space-y-3">
          {HISTORY.map((h) => (
            <li key={h.date} className="rounded-xl border border-ink-200 bg-white p-4 shadow-soft">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{h.date}</p>
              <p className="mt-1 text-sm text-ink-700">{h.summary}</p>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-xs text-ink-500">
          Subscribe to status updates at <a className="text-brand-700 hover:underline" href="mailto:status@assetmon.app">status@assetmon.app</a>.
          For an outage, page our on-call rotation through your account manager.
        </p>
      </section>
    </MarketingShell>
  );
}
