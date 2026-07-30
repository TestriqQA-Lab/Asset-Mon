import { MarketingShell } from '@/components/marketing/Shell';
import { LegalShell, LegalSection } from '@/components/marketing/Legal';
import { pageMetadata, breadcrumbLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { SITE } from '@/lib/site';
import Link from 'next/link';

export const metadata = pageMetadata({
  title: 'Terms of Service',
  description: 'AssetMon Terms of Service: the agreement that governs your use of AssetMon. Clearly written, fair to both sides.',
  path: '/terms',
});

const TOC = [
  { id: 'acceptance', label: 'Acceptance' },
  { id: 'service', label: 'The service' },
  { id: 'account', label: 'Your account' },
  { id: 'acceptable-use', label: 'Acceptable use' },
  { id: 'fees', label: 'Fees & free trial' },
  { id: 'data', label: 'Your data' },
  { id: 'ip', label: 'Intellectual property' },
  { id: 'warranties', label: 'Warranties' },
  { id: 'liability', label: 'Limitation of liability' },
  { id: 'termination', label: 'Termination' },
  { id: 'law', label: 'Governing law' },
  { id: 'changes', label: 'Changes' },
];

export default function TermsPage() {
  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'Terms', url: '/terms' }])} />
      <LegalShell title="Terms of service" lastUpdated="May 2026" toc={TOC}>
        <LegalSection id="acceptance" title="Acceptance">
          <p>By creating an AssetMon workspace or using the service, you agree to these Terms. If you are signing up on behalf of a company, you confirm that you have authority to bind that company to these Terms.</p>
        </LegalSection>
        <LegalSection id="service" title="The service">
          <p>{SITE.name} is a cloud-based asset management platform provided by us. Features may change over time; we will not materially reduce paid features without notice.</p>
        </LegalSection>
        <LegalSection id="account" title="Your account">
          <ul className="ml-5 list-disc space-y-1">
            <li>You are responsible for keeping your credentials secure.</li>
            <li>You are responsible for the actions of users you add to your workspace.</li>
            <li>You must be at least 18 years old (or the age of majority in your jurisdiction) to sign up.</li>
          </ul>
        </LegalSection>
        <LegalSection id="acceptable-use" title="Acceptable use">
          <p>You agree not to: use the service to store illegal content; reverse-engineer the service; attempt to interfere with other tenants' workspaces; bypass rate limits or security controls; or use the service in violation of any applicable export-control or sanctions law.</p>
        </LegalSection>
        <LegalSection id="fees" title="Fees & free trial">
          <p>Paid plans are billed monthly or annually in advance. The {SITE.trial.headline} requires no credit card. After the trial, your workspace pauses for 14 days unless you pick a plan. Refunds are issued for annual plans on a prorated basis within 30 days of charge.</p>
        </LegalSection>
        <LegalSection id="data" title="Your data">
          <p>You own your workspace data. We act as the data processor; you are the data controller (see our DPA on the <Link className="text-brand-700 hover:underline" href="/security#dpa">Security page</Link>). You can export your data via CSV / API at any time. We delete workspace data within 30 days of cancellation.</p>
        </LegalSection>
        <LegalSection id="ip" title="Intellectual property">
          <p>AssetMon and the AssetMon logo are our trademarks. The software, content and design are owned by us or our licensors. You retain all rights in your workspace data.</p>
        </LegalSection>
        <LegalSection id="warranties" title="Warranties">
          <p>The service is provided "as is" without warranty of merchantability or fitness for a particular purpose, except as required by law. We will provide commercially reasonable efforts to keep the service available with the uptime stated for your plan.</p>
        </LegalSection>
        <LegalSection id="liability" title="Limitation of liability">
          <p>Our aggregate liability under these Terms is limited to the fees you paid us in the 12 months preceding the claim. Neither party is liable for indirect, incidental or consequential damages.</p>
        </LegalSection>
        <LegalSection id="termination" title="Termination">
          <p>You may terminate at any time from the dashboard. We may terminate for material breach (e.g., non-payment, abusive content) with 14 days written notice and an opportunity to cure.</p>
        </LegalSection>
        <LegalSection id="law" title="Governing law">
          <p>These Terms are governed by the laws of England and Wales. Disputes are resolved in the courts of London, except where mandatory consumer-protection law in your country requires otherwise.</p>
        </LegalSection>
        <LegalSection id="changes" title="Changes">
          <p>We may update these Terms; material changes will be announced by email to workspace admins at least 30 days before they take effect.</p>
        </LegalSection>
      </LegalShell>
    </MarketingShell>
  );
}
