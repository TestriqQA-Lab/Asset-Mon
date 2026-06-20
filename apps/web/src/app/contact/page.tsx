import { Mail, MessageCircle, ShieldCheck, Building2 } from 'lucide-react';
import { MarketingShell } from '@/components/marketing/Shell';
import { pageMetadata, breadcrumbLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { SITE } from '@/lib/site';

export const metadata = pageMetadata({
  title: 'Contact AssetMon — sales, support, security',
  description: 'Get in touch with AssetMon. Sales questions, support requests, security disclosures and DPA review — every email is read by a human.',
  path: '/contact',
});

export default function ContactPage() {
  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'Contact', url: '/contact' }])} />

      <section className="mx-auto max-w-4xl px-6 py-20">
        <h1 className="text-balance text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
          We answer our own emails.
        </h1>
        <p className="mt-5 max-w-2xl text-balance text-base text-ink-600">
          No tier-one outsourced help desk. No bots pretending to be humans. Whichever route you pick, you'll reach someone who actually built or sold AssetMon.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <ContactCard
            icon={<MessageCircle className="h-5 w-5" />} title="Sales & demos"
            email="hello@assetmon.app"
            note="Pricing, evaluations, onboarding help, partner programs."
          />
          <ContactCard
            icon={<Mail className="h-5 w-5" />} title="Customer support"
            email={SITE.supportEmail}
            note="Existing customers: bugs, how-to questions, feature requests."
          />
          <ContactCard
            icon={<ShieldCheck className="h-5 w-5" />} title="Security & compliance"
            email="security@assetmon.app"
            note="Vulnerability disclosure, DPA / InfoSec review, audit reports."
          />
          <ContactCard
            icon={<Building2 className="h-5 w-5" />} title="Enterprise"
            email="enterprise@assetmon.app"
            note="SCIM, dedicated cluster, on-prem, custom SLAs."
          />
        </div>

        <p className="mt-10 text-sm text-ink-500">
          For responsible vulnerability disclosure, please follow our security policy at{' '}
          <a className="text-brand-700 hover:underline" href="/.well-known/security.txt">/.well-known/security.txt</a>.
        </p>
      </section>
    </MarketingShell>
  );
}

function ContactCard({ icon, title, email, note }: { icon: React.ReactNode; title: string; email: string; note: string }) {
  return (
    <a href={`mailto:${email}`} className="group block rounded-2xl border border-ink-200 bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">{icon}</span>
        <div>
          <div className="text-sm font-semibold text-ink-900">{title}</div>
          <div className="text-sm text-brand-700 group-hover:underline">{email}</div>
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-500">{note}</p>
    </a>
  );
}
