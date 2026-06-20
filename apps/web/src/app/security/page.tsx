import Link from 'next/link';
import { ShieldCheck, Database, LockKeyhole, FileCheck2, KeyRound, Activity, ArrowRight } from 'lucide-react';
import { MarketingShell } from '@/components/marketing/Shell';
import { pageMetadata, breadcrumbLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';

export const metadata = pageMetadata({
  title: 'Security at AssetMon — multi-tenant isolation, audit logs, GDPR',
  description: 'How AssetMon protects your data: database-per-tenant isolation, encryption at rest and in transit, helmet headers, immutable audit logs, signed webhooks, and a GDPR-ready DPA.',
  path: '/security',
});

export default function SecurityPage() {
  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'Security', url: '/security' }])} />

      <section className="relative overflow-hidden border-b border-ink-100">
        <div aria-hidden className="absolute inset-0 bg-mesh opacity-70" />
        <div className="relative mx-auto max-w-4xl px-6 py-20">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Security</p>
          <h1 className="mt-3 text-balance text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
            Security defaults you can trust.
          </h1>
          <p className="mt-5 max-w-2xl text-balance text-base text-ink-600 sm:text-lg">
            We treat security as a product feature, not a checkbox. Here is how we protect your data — explained without legalese.
          </p>
        </div>
      </section>

      <section aria-label="Security pillars" className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Pillar icon={<Database className="h-5 w-5" />} title="Database-per-tenant" body="Every workspace gets its own PostgreSQL database. Cross-tenant data leaks are not a 'we promise' control — they are physically impossible." />
          <Pillar icon={<LockKeyhole className="h-5 w-5" />} title="Encryption everywhere" body="TLS 1.2+ in transit; AES-256 at rest. Backups are encrypted with separate keys." />
          <Pillar icon={<ShieldCheck className="h-5 w-5" />} title="Defence in depth" body="Helmet security headers, rate limiting, RBAC, magic-byte file verification, parameterised SQL via Prisma." />
          <Pillar icon={<Activity className="h-5 w-5" />} title="Immutable audit log" body="Every asset event — create, update, check-out, check-in, license assign, ticket open — is captured and exportable." />
          <Pillar icon={<KeyRound className="h-5 w-5" />} title="Scoped API keys" body="Tenant-scoped, hashed at rest, support read-only or read-write, with revocation and expiry." />
          <Pillar icon={<FileCheck2 className="h-5 w-5" />} title="Signed webhooks" body="HMAC-SHA256 signed deliveries with timestamp, three-attempt retry, full delivery audit log." />
        </div>
      </section>

      <section className="border-y border-ink-100 bg-ink-50/40 py-16">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-3xl font-semibold tracking-tight text-ink-900">Frameworks & alignment</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2" role="list">
            <ListItem title="GDPR / DPDP-ready">DPA available on every paid plan; data subject access and erasure workflows.</ListItem>
            <ListItem title="ISO 27001 controls mapping">Asset inventory (A6.5), acceptable use (A6.6), return (A6.7), media disposal (A7.10).</ListItem>
            <ListItem title="SOC 2 alignment (in progress)">Annual penetration tests, vulnerability scans, change-management process.</ListItem>
            <ListItem title="OWASP top 10">Reviewed quarterly; recent VAPT report available under NDA on request.</ListItem>
          </ul>
        </div>
      </section>

      <section id="dpa" className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="text-3xl font-semibold tracking-tight text-ink-900">Data Processing Addendum (DPA)</h2>
        <p className="mt-3 text-base text-ink-700">
          We sign a DPA with every paid customer. It covers GDPR Article 28 obligations, subprocessor list,
          breach notification, and sub-processing terms. Email{' '}
          <a className="text-brand-700 hover:underline" href="mailto:security@assetmon.app">security@assetmon.app</a> for
          the latest version or to start an InfoSec review.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/contact" className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white shadow-soft hover:bg-ink-800">
            Request DPA <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/privacy" className="inline-flex h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-5 text-sm font-semibold text-ink-700 shadow-soft hover:bg-ink-50">
            Privacy policy
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}

function Pillar({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <article className="rounded-2xl border border-ink-200 bg-white p-5 shadow-card">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">{icon}</div>
      <h3 className="mt-3 text-sm font-semibold text-ink-900">{title}</h3>
      <p className="mt-1 text-sm text-ink-500">{body}</p>
    </article>
  );
}

function ListItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-ink-200 bg-white p-4 shadow-soft">
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      <p className="mt-1 text-sm text-ink-500">{children}</p>
    </li>
  );
}
