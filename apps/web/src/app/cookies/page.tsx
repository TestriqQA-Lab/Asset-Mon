import { MarketingShell } from '@/components/marketing/Shell';
import { LegalShell, LegalSection } from '@/components/marketing/Legal';
import { pageMetadata, breadcrumbLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';

export const metadata = pageMetadata({
  title: 'Cookie Policy',
  description: 'AssetMon\'s cookie policy: which cookies we set, why, and how to control them. We use a minimal set of first-party cookies — no ad-network trackers.',
  path: '/cookies',
});

const TOC = [
  { id: 'overview', label: 'Overview' },
  { id: 'what-we-use', label: 'What we use' },
  { id: 'choices', label: 'Your choices' },
  { id: 'no-trackers', label: 'No third-party trackers' },
];

export default function CookiesPage() {
  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'Cookies', url: '/cookies' }])} />
      <LegalShell title="Cookie policy" lastUpdated="May 2026" toc={TOC}>
        <LegalSection id="overview" title="Overview">
          <p>Cookies are small text files stored in your browser. We use a minimal set of first-party cookies — strictly necessary for authentication and CSRF protection. We do not use third-party advertising or cross-site tracking cookies.</p>
        </LegalSection>
        <LegalSection id="what-we-use" title="What we use">
          <ul className="ml-5 list-disc space-y-1">
            <li><strong>Session storage (not cookies):</strong> we store your access token in browser localStorage. This is required to keep you signed in.</li>
            <li><strong>Authentication cookie</strong> (in future SSO flows): an httpOnly, SameSite=Lax cookie used to maintain your session.</li>
            <li><strong>Preferences (functional):</strong> we may store small UI preferences (e.g. sidebar state) in localStorage.</li>
          </ul>
        </LegalSection>
        <LegalSection id="choices" title="Your choices">
          <p>You can clear all AssetMon storage from your browser settings or by signing out from the user menu. Clearing storage signs you out and removes preferences.</p>
        </LegalSection>
        <LegalSection id="no-trackers" title="No third-party trackers">
          <p>The marketing site uses no advertising trackers, no Facebook Pixel, no LinkedIn Insight tag, and no Google Analytics. Anonymous, aggregate page analytics may be added in the future; if so, we will update this page and offer an opt-out.</p>
        </LegalSection>
      </LegalShell>
    </MarketingShell>
  );
}
