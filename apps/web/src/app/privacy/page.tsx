import { MarketingShell } from '@/components/marketing/Shell';
import { LegalShell, LegalSection } from '@/components/marketing/Legal';
import { pageMetadata, breadcrumbLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { SITE } from '@/lib/site';
import Link from 'next/link';

export const metadata = pageMetadata({
  title: 'Privacy Policy',
  description: 'How AssetMon collects, uses, stores and protects personal data — written in plain English, aligned with GDPR and India\'s DPDP Act.',
  path: '/privacy',
});

const TOC = [
  { id: 'overview', label: 'Overview' },
  { id: 'what-we-collect', label: 'What we collect' },
  { id: 'how-we-use', label: 'How we use it' },
  { id: 'sharing', label: 'Sharing' },
  { id: 'storage', label: 'Storage & retention' },
  { id: 'rights', label: 'Your rights' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'security', label: 'Security' },
  { id: 'contact', label: 'Contact' },
  { id: 'changes', label: 'Changes' },
];

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'Privacy policy', url: '/privacy' }])} />
      <LegalShell title="Privacy policy" lastUpdated="May 2026" toc={TOC}>
        <LegalSection id="overview" title="Overview">
          <p>This Privacy Policy explains how {SITE.name} ("we", "our", "us") collects, uses and shares personal information when you visit our website, sign up for a workspace, or use the AssetMon service. We have written this policy in plain English; the legal definitions in our Terms apply.</p>
        </LegalSection>
        <LegalSection id="what-we-collect" title="What we collect">
          <p>We collect three categories of information:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li><strong>Account data</strong> you provide on signup: workspace name, workspace slug, your name, email, hashed password.</li>
            <li><strong>Usage data</strong> automatically generated when you use the product: pages visited, actions taken, request metadata, IP address, browser user-agent. We use this for security, fraud prevention and product analytics.</li>
            <li><strong>Workspace data</strong> you choose to store inside AssetMon: asset records, user records you add, license keys, photos, attachments. We treat this as <em>customer content</em>; we are the data processor, you are the controller.</li>
          </ul>
        </LegalSection>
        <LegalSection id="how-we-use" title="How we use it">
          <ul className="ml-5 list-disc space-y-1">
            <li>To provide the service you signed up for (contract performance).</li>
            <li>To send transactional emails (account changes, security alerts, billing notices).</li>
            <li>To improve the product through aggregated, de-identified analytics (legitimate interest).</li>
            <li>To comply with legal obligations (e.g., a valid court order or tax records).</li>
          </ul>
          <p>We do <strong>not</strong> sell personal data. We do not use customer workspace data to train models, build aggregate insights for third parties, or feed advertising.</p>
        </LegalSection>
        <LegalSection id="sharing" title="Sharing">
          <p>We share data only with sub-processors that help us run the service. The current list is available in our DPA and includes: our cloud hosting provider, our database provider, our transactional email provider, and our error-tracking provider. Each sub-processor is contractually bound by GDPR Article 28 obligations.</p>
        </LegalSection>
        <LegalSection id="storage" title="Storage & retention">
          <p>Workspace data is stored in PostgreSQL databases in our chosen region (default: EU). We keep your data for as long as your workspace is active. After cancellation, we keep an encrypted backup for 30 days and then delete permanently. Audit logs are retained 365 days unless otherwise required.</p>
        </LegalSection>
        <LegalSection id="rights" title="Your rights">
          <p>If you are in the EU, UK, India (under DPDP Act 2023) or California, you have rights to: access your data, correct inaccuracies, request deletion, port data in machine-readable form, restrict processing and object to processing. Email <a className="text-brand-700 hover:underline" href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a> and we will respond within 30 days.</p>
        </LegalSection>
        <LegalSection id="cookies" title="Cookies">
          <p>We use a minimal set of first-party cookies for authentication and CSRF protection. We do not use third-party advertising cookies. See our <Link className="text-brand-700 hover:underline" href="/cookies">Cookie policy</Link> for details.</p>
        </LegalSection>
        <LegalSection id="security" title="Security">
          <p>See the full breakdown on our <Link className="text-brand-700 hover:underline" href="/security">Security page</Link>. Highlights: database-per-tenant isolation, encryption at rest and in transit, helmet HTTP security headers, immutable audit log, rate limiting, HMAC-signed webhooks.</p>
        </LegalSection>
        <LegalSection id="contact" title="Contact">
          <p>Questions, complaints or DSARs: <a className="text-brand-700 hover:underline" href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.</p>
        </LegalSection>
        <LegalSection id="changes" title="Changes">
          <p>If we make material changes to this policy, we will notify the workspace admin by email at least 14 days before the change takes effect.</p>
        </LegalSection>
      </LegalShell>
    </MarketingShell>
  );
}
