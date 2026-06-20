import { MarketingShell } from '@/components/marketing/Shell';
import { pageMetadata, breadcrumbLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { CHANGELOG } from '@/lib/changelog';
import { Rss } from 'lucide-react';

export const metadata = pageMetadata({
  title: 'Changelog — what is new in AssetMon',
  description: 'A running list of new features, fixes and security updates shipped to the AssetMon platform.',
  path: '/changelog',
});

const TAG_BG: Record<string, string> = {
  feature: 'bg-brand-50 text-brand-700 ring-brand-200',
  fix: 'bg-amber-50 text-amber-700 ring-amber-200',
  security: 'bg-rose-50 text-rose-700 ring-rose-200',
};

export default function ChangelogPage() {
  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'Changelog', url: '/changelog' }])} />

      <section className="mx-auto max-w-3xl px-6 py-16">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Changelog</p>
            <h1 className="mt-2 text-5xl font-semibold tracking-tight text-ink-900">What's new.</h1>
            <p className="mt-3 text-base text-ink-600">Features, fixes and security updates — newest first.</p>
          </div>
          <a href="/changelog.xml" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-700 shadow-soft hover:bg-ink-50">
            <Rss className="h-3.5 w-3.5 text-amber-500" /> RSS
          </a>
        </div>

        <ol className="mt-10 space-y-8">
          {CHANGELOG.map((c) => (
            <li key={c.date + c.title} className="relative pl-7">
              <span className="absolute left-0 top-2 h-2 w-2 rounded-full bg-brand-500 ring-4 ring-brand-100" />
              <div className="flex flex-wrap items-baseline gap-3">
                <time dateTime={c.date} className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  {new Date(c.date).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                </time>
                {c.tag && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${TAG_BG[c.tag]}`}>{c.tag}</span>}
              </div>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">{c.title}</h2>
              <ul className="mt-3 ml-5 list-disc space-y-1 text-base leading-relaxed text-ink-700">
                {c.items.map((it) => <li key={it}>{it}</li>)}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </MarketingShell>
  );
}
