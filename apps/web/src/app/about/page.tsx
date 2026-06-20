import Link from 'next/link';
import { ArrowRight, Sparkles, Boxes, ShieldCheck, Heart } from 'lucide-react';
import { MarketingShell } from '@/components/marketing/Shell';
import { pageMetadata, breadcrumbLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';

export const metadata = pageMetadata({
  title: 'About AssetMon — the team building modern asset management',
  description: 'We are building AssetMon because every team deserves modern, isolated, audit-ready asset management. Founded by ITAM operators tired of legacy software.',
  path: '/about',
});

const VALUES = [
  { icon: <Boxes className="h-4 w-4" />, title: 'Multi-tenant by default', body: 'Every workspace gets a database of its own. No shortcuts, no shared-schema risk.' },
  { icon: <ShieldCheck className="h-4 w-4" />, title: 'Security as a habit', body: 'Helmet, rate limits, RBAC, immutable audit log, magic-byte file checks. Defaults you can trust.' },
  { icon: <Heart className="h-4 w-4" />, title: 'For the operator', body: 'Built by people who have run physical audits. The product fits the work — not the other way around.' },
  { icon: <Sparkles className="h-4 w-4" />, title: 'Polish without prison', body: 'Beautiful UI, but your data is yours. Open API, CSV everywhere, real export buttons.' },
];

export default function AboutPage() {
  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'About', url: '/about' }])} />

      <section className="relative overflow-hidden border-b border-ink-100">
        <div aria-hidden className="absolute inset-0 bg-mesh opacity-70" />
        <div className="relative mx-auto max-w-3xl px-6 py-20 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">About</p>
          <h1 className="mt-3 text-balance text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
            We are building the asset platform we always wished existed.
          </h1>
          <p className="mt-5 text-balance text-base text-ink-600 sm:text-lg">
            AssetMon was founded in 2025 by a small team of ITAM operators and engineers who, between
            us, ran asset programs at five mid-market and two enterprise companies. We tried every
            tool. We hated almost all of them. So we built one that respects your time and your data.
          </p>
        </div>
      </section>

      <section aria-label="Our values" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-3xl font-semibold tracking-tight text-ink-900">What we believe</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {VALUES.map((v) => (
            <article key={v.title} className="rounded-2xl border border-ink-200 bg-white p-5 shadow-card">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">{v.icon}</div>
              <h3 className="mt-3 text-sm font-semibold text-ink-900">{v.title}</h3>
              <p className="mt-1 text-sm text-ink-500">{v.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-ink-100 bg-ink-50/40 py-16">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-3xl font-semibold tracking-tight text-ink-900">A little more, in plain English</h2>
          <div className="mt-5 space-y-4 text-base leading-relaxed text-ink-700">
            <p>The asset management category is full of two kinds of products: legacy enterprise giants that need a six-month implementation and a dedicated administrator, or hobby-grade spreadsheets dressed up with a UI. There is precious little for the middle — modern, fast teams who need clean data, audit-ready logs, and the discipline of real ITAM without the procurement nightmare.</p>
            <p>We started AssetMon to live in that middle. We took the parts of ITAM that actually move the needle — inventory, lifecycle, service tickets, depreciation, license compliance, audits — and built them on a multi-tenant architecture that gives every workspace its own database. We added the kind of modular control that lets you turn off the parts you do not need, and the branding controls that make the workspace feel like yours.</p>
            <p>We are remote, small, and answering our own emails. If you want to talk to us, you almost certainly will reach the person who wrote the feature.</p>
          </div>
          <div className="mt-8 flex items-center gap-3">
            <Link href="/signup" className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white shadow-soft hover:bg-ink-800">
              Try AssetMon free <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/contact" className="inline-flex h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-5 text-sm font-semibold text-ink-700 shadow-soft hover:bg-ink-50">
              Say hello
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
