import Link from 'next/link';
import {
  Sparkles, ArrowRight, ShieldCheck, Boxes, Wrench, CalendarClock, KeyRound, FileText,
  TrendingDown, AppWindow, ClipboardCheck, BarChart3, Webhook, CheckCircle2, Quote,
  Zap, LockKeyhole, GitBranch, Layers, Rocket, ChevronRight, Star,
} from 'lucide-react';
import { MarketingShell } from '@/components/marketing/Shell';
import { FAQ, type FaqItem } from '@/components/marketing/FAQ';
import { pageMetadata, organizationLd, websiteLd, softwareApplicationLd, faqLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { SITE } from '@/lib/site';

export const metadata = pageMetadata({
  title: 'AssetMon · Asset management for modern teams',
  description: SITE.description,
  path: '/',
});

const FAQ_ITEMS: FaqItem[] = [
  { category: 'Getting started', q: 'How long does setup take?', a: 'About five minutes. Sign up, your tenant database is provisioned, default asset categories are seeded, and you can start adding assets — or import a CSV from your spreadsheet in one click.' },
  { category: 'Getting started', q: 'Can I import my existing inventory?', a: 'Yes. AssetMon imports CSV files with auto-mapping for category, location and department by name. We also offer a free migration assist on annual plans.' },
  { category: 'Getting started', q: 'Do I need to install anything?', a: 'No. AssetMon is fully browser-based. Asset QR labels print from a regular printer, and scanning works from any phone camera — no app required.' },
  { category: 'Pricing & trial', q: 'Is the 30-day trial really free?', a: 'Completely. No credit card, no scheduled call, no auto-renewal. At day 30 you can pick a plan or simply walk away — your data is exportable any time, even after.' },
  { category: 'Pricing & trial', q: 'What happens at the end of the trial?', a: 'Your workspace pauses for 14 days while you decide. Pick a plan and pick up where you left off, or export everything and close the workspace. No surprises.' },
  { category: 'Pricing & trial', q: 'Can I cancel any time?', a: 'Yes. Cancel from the dashboard in two clicks. You keep access until the end of your billing period and can export data at any time.' },
  { category: 'Security & data', q: 'Where does my data live?', a: 'Every workspace gets its own isolated PostgreSQL database. We do not use shared schemas with tenant_id, so cross-tenant reads are physically impossible. Data is encrypted at rest and in transit.' },
  { category: 'Security & data', q: 'Are you GDPR / DPDP compliant?', a: 'Yes. We sign a DPA (Data Processing Addendum) with every paid customer, support data subject access requests, and offer pseudonymisation of offboarded user records.' },
  { category: 'Security & data', q: 'Do you support SSO?', a: 'Single sign-on (Google Workspace, Microsoft Entra ID, SAML 2.0, OIDC) is included on Business and Enterprise plans, and is available on a trial extension for evaluation.' },
  { category: 'Integrations', q: 'Do you have an API?', a: 'A full REST API with OpenAPI / Swagger documentation. Admins can mint scoped API keys (read-only or read-write) and revoke them on demand.' },
  { category: 'Integrations', q: 'How do webhooks work?', a: 'Subscribe to events like asset.created or ticket.opened. Deliveries are HMAC-SHA256-signed (X-AssetMon-Signature) with a three-attempt retry policy and a per-webhook delivery log.' },
  { category: 'Integrations', q: 'Slack, Teams, or HR system sync?', a: 'Slack and Microsoft Teams notifications ship as connectors. Workday, BambooHR and SCIM provisioning are on the Enterprise plan or available as an add-on.' },
  { category: 'Platform', q: 'Can I disable modules I don\'t need?', a: 'Yes. As a workspace admin, head to Settings → Modules and toggle individual modules (tickets, maintenance, procurement, depreciation, software/licenses, audits, integrations, reports) on or off. Disabled modules disappear from the sidebar and are blocked at the API.' },
  { category: 'Platform', q: 'Can I customise the look with my logo and colour?', a: 'Of course. Settings → Branding lets you upload a PNG/SVG logo, pick a brand colour (or paste a hex), and rename the workspace. Changes apply live across the entire UI.' },
  { category: 'Platform', q: 'Is there an audit trail?', a: 'Every asset event — create, update, check-out, check-in, ticket open, maintenance done, license assign — is captured in an immutable audit log, exportable to CSV.' },
];

export default function LandingPage() {
  return (
    <MarketingShell>
      <JsonLd data={organizationLd()} />
      <JsonLd data={websiteLd()} />
      <JsonLd data={softwareApplicationLd()} />
      <JsonLd data={faqLd(FAQ_ITEMS.map(({ q, a }) => ({ q, a })))} />

      {/* HERO — bold dark with animated colour blobs */}
      <section aria-label="Hero" className="relative isolate overflow-hidden bg-[#06080f] text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-32 -left-32 h-[42rem] w-[42rem] rounded-full bg-fuchsia-600/40 mix-blend-screen blur-3xl animate-blob" />
          <div className="absolute -top-20 right-0 h-[40rem] w-[40rem] rounded-full bg-indigo-500/40 mix-blend-screen blur-3xl animate-blob-slow" />
          <div className="absolute bottom-0 left-1/3 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-cyan-400/30 mix-blend-screen blur-3xl animate-blob" />
          <div className="absolute inset-0 bg-grid-light bg-[size:40px_40px] opacity-[0.06]" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#06080f]" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pt-24 pb-28 text-center">
          <Link href="/blog/what-is-it-asset-management" className="group inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-white/80 backdrop-blur-md transition hover:bg-white/[0.08]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            New playbook: the complete guide to IT Asset Management
            <ChevronRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
          </Link>

          <h1 className="mx-auto mt-6 max-w-4xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
            <span className="block">Asset management.</span>
            <span
              className="block bg-clip-text text-transparent"
              style={{
                backgroundImage: 'linear-gradient(90deg,#f472b6 0%,#a78bfa 35%,#60a5fa 65%,#22d3ee 100%)',
                backgroundSize: '200% 100%',
                animation: 'gradient-shift 8s ease infinite',
              }}
            >
              Reimagined in technicolor.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-balance text-base text-white/70 sm:text-lg">
            Track every device, license, ticket, and rupee — in one isolated workspace
            that looks great and ships in minutes. Built for modern, multi-tenant teams.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/signup"
              className="group relative inline-flex h-12 items-center gap-2 overflow-hidden rounded-xl bg-white px-6 text-sm font-semibold text-ink-900 shadow-[0_10px_40px_-10px_rgba(99,102,241,0.6)] transition hover:shadow-[0_14px_50px_-8px_rgba(99,102,241,0.8)]"
            >
              <Rocket className="h-4 w-4" />
              Start 30-day free trial
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            <Link href="/pricing" className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-6 text-sm font-semibold text-white backdrop-blur-md hover:bg-white/[0.08]">
              See pricing
            </Link>
          </div>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-white/60">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            No credit card. No questions asked. Cancel anytime.
          </p>

          {/* Product preview — colorful screenshot-like */}
          <div className="mx-auto mt-16 max-w-5xl">
            <div className="relative">
              <div aria-hidden className="absolute -inset-2 rounded-[28px] bg-gradient-to-br from-fuchsia-500 via-indigo-500 to-cyan-400 opacity-50 blur-2xl animate-glow-pulse" />
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020]/95 shadow-2xl backdrop-blur">
                <div className="flex items-center gap-1.5 border-b border-white/5 bg-white/[0.03] px-3 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <span className="ml-3 rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-white/50">acme.assetmon.app/dashboard</span>
                </div>
                <div className="grid grid-cols-12 gap-3 p-4">
                  <div className="col-span-12 space-y-1 rounded-xl bg-white/[0.03] p-3 md:col-span-3">
                    {['Overview', 'Assets', 'Tickets', 'Maintenance', 'Licenses', 'Reports'].map((s, i) => (
                      <div
                        key={s}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${i === 0 ? 'bg-gradient-to-r from-fuchsia-500 to-indigo-500 text-white shadow-[0_0_24px_-4px_rgba(217,70,239,0.6)]' : 'text-white/60'}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                        {s}
                      </div>
                    ))}
                  </div>
                  <div className="col-span-12 grid grid-cols-2 gap-3 md:col-span-9 md:grid-cols-3">
                    <Tile label="Total assets" value="1,284" tone="fuchsia" />
                    <Tile label="Assigned" value="912" tone="indigo" />
                    <Tile label="Open tickets" value="7" tone="amber" />
                    <Tile label="Maintenance" value="3 due" tone="cyan" />
                    <Tile label="Licenses" value="2 ⚠" tone="rose" />
                    <Tile label="Book value" value="$284K" tone="emerald" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Marquee */}
      <section aria-label="Trusted by" className="border-y border-ink-200 bg-white py-10">
        <p className="text-center text-xs font-medium uppercase tracking-wider text-ink-400">Loved by ops teams everywhere</p>
        <div className="mt-5 overflow-hidden">
          <div className="flex w-max animate-marquee gap-12 whitespace-nowrap px-6 text-ink-300">
            {[...'Acme Northwind Globex Hooli Initech Umbrella Pied-Piper Cyberdyne Massive-Dynamic Soylent'.split(' '),
              ...'Acme Northwind Globex Hooli Initech Umbrella Pied-Piper Cyberdyne Massive-Dynamic Soylent'.split(' ')].map((n, i) => (
              <span key={i} className="text-lg font-semibold tracking-widest opacity-60">{n.toUpperCase()}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Bento features */}
      <section id="features" aria-labelledby="features-heading" className="mx-auto max-w-6xl px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-600">The platform</p>
          <h2 id="features-heading" className="mt-3 text-balance text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
            Every asset operation,
            <span className="bg-gradient-to-r from-fuchsia-600 via-violet-600 to-sky-600 bg-clip-text text-transparent"> beautifully wired together.</span>
          </h2>
          <p className="mt-4 text-balance text-base text-ink-500">A modular platform you can toggle to fit your shop — without losing a coherent feel.</p>
        </div>

        <div className="mt-14 grid grid-cols-12 gap-4">
          <BentoTile
            className="col-span-12 md:col-span-8 row-span-2"
            tone="fuchsia"
            icon={<Boxes className="h-5 w-5" />}
            title="A living inventory of everything"
            body="Custom fields per category, photos, QR-coded labels, immutable audit trail, full CSV import & export. Spreadsheets, retired."
            big
          />
          <BentoTile className="col-span-12 sm:col-span-6 md:col-span-4" tone="indigo" icon={<Wrench className="h-5 w-5" />} title="Service tickets" body="Asset auto-flips to IN_REPAIR. Priority-routed. Vendor-aware." />
          <BentoTile className="col-span-12 sm:col-span-6 md:col-span-4" tone="cyan" icon={<CalendarClock className="h-5 w-5" />} title="Preventive maintenance" body="Recurring schedules that auto-bump their next due date." />
          <BentoTile className="col-span-12 sm:col-span-6 md:col-span-4" tone="rose" icon={<TrendingDown className="h-5 w-5" />} title="Depreciation engine" body="Straight-line + double-declining, fleet report, CSV export." />
          <BentoTile className="col-span-12 sm:col-span-6 md:col-span-4" tone="emerald" icon={<AppWindow className="h-5 w-5" />} title="Software & licenses" body="Seats used vs. owned. Expiry alerts. Audit-ready." />
          <BentoTile className="col-span-12 sm:col-span-6 md:col-span-4" tone="amber" icon={<FileText className="h-5 w-5" />} title="Procurement" body="PR → PO → receipt. Auto-create assets on delivery." />
          <BentoTile className="col-span-12 sm:col-span-6 md:col-span-4" tone="violet" icon={<ClipboardCheck className="h-5 w-5" />} title="Physical audits" body="Scan-to-audit from any phone. Live discrepancies." />
          <BentoTile className="col-span-12 sm:col-span-6 md:col-span-4" tone="sky" icon={<Webhook className="h-5 w-5" />} title="API & webhooks" body="Scoped keys, HMAC-signed events, OpenAPI docs." />
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-heading" className="relative overflow-hidden bg-[#06080f] py-24 text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 top-10 h-80 w-80 rounded-full bg-fuchsia-600/40 mix-blend-screen blur-3xl animate-blob-slow" />
          <div className="absolute -right-32 bottom-0 h-80 w-80 rounded-full bg-cyan-400/30 mix-blend-screen blur-3xl animate-blob" />
        </div>
        <div className="relative mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">How it works</p>
            <h2 id="how-heading" className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              From zero to audit-ready in <span className="bg-gradient-to-r from-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">three steps</span>.
            </h2>
            <p className="mt-4 text-balance text-base text-white/70">No long-winded onboarding. No mandatory call.</p>
          </div>
          <ol className="mt-14 grid gap-5 md:grid-cols-3" role="list">
            <Step n={1} tone="fuchsia" title="Sign up" body="Your dedicated database is provisioned in seconds with sensible defaults." />
            <Step n={2} tone="violet" title="Import or add" body="CSV import or new asset form. QR labels print right from the browser." />
            <Step n={3} tone="cyan" title="Run your op" body="Tickets, audits, procurement, depreciation — toggle modules to match your team." />
          </ol>
          <div className="mt-14 text-center">
            <Link href="/signup" className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-ink-900 shadow-[0_10px_40px_-10px_rgba(255,255,255,0.4)] hover:bg-ink-100">
              <Rocket className="h-4 w-4" /> Spin up your workspace · No card <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Differentiators */}
      <section aria-label="Why AssetMon" className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-600">The architecture</p>
            <h2 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
              <span className="bg-gradient-to-r from-sky-600 to-emerald-600 bg-clip-text text-transparent">Multi-tenant by design.</span>
              <br />Yours by default.
            </h2>
            <p className="mt-4 text-base text-ink-600">
              Every workspace runs in its own isolated PostgreSQL database — no shared schemas, no cross-tenant blast radius.
              Branding, modules and themes are configured per tenant, never inherited from a "platform default" you can't change.
            </p>
            <ul className="mt-6 space-y-3" role="list">
              <Diff tone="fuchsia" icon={<LockKeyhole className="h-4 w-4" />} title="Database-per-tenant isolation" body="One missed WHERE clause cannot leak data — it is physically impossible." />
              <Diff tone="indigo" icon={<Zap className="h-4 w-4" />} title="Modular activation" body="Toggle each module on or off in two clicks. UI and API stay in sync." />
              <Diff tone="cyan" icon={<GitBranch className="h-4 w-4" />} title="Open data, open API" body="Full REST API, OpenAPI docs, CSV everywhere. Your data is never held hostage." />
              <Diff tone="violet" icon={<Layers className="h-4 w-4" />} title="Brandable in minutes" body="Upload a logo, pick a colour, rename the workspace — the entire UI rebrands live." />
            </ul>
          </div>
          <div className="relative">
            <div aria-hidden className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-fuchsia-500/30 via-indigo-500/30 to-cyan-400/30 blur-2xl animate-glow-pulse" />
            <div className="relative space-y-4">
              <DbCard tenant="acme" assets="1,284" tone="fuchsia" />
              <DbCard tenant="beta" assets="438" tone="indigo" />
              <DbCard tenant="globex" assets="2,914" tone="cyan" />
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section aria-labelledby="loved-heading" className="relative border-y border-ink-100 bg-ink-50/40 py-24">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-mesh opacity-40" />
        <div className="relative mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-500">Loved by</p>
            <h2 id="loved-heading" className="mt-3 text-balance text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
              Teams that switched, never went back.
            </h2>
          </div>
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            <Testimonial gradient="from-fuchsia-500 to-rose-500" quote="We replaced four spreadsheets and a 6-year-old desktop app in a single weekend. The QR labels alone saved my team 40 hours a quarter." name="Priya Sundaram" title="Head of IT Ops, Northwind" />
            <Testimonial gradient="from-indigo-500 to-cyan-500" quote="The depreciation engine speaks the same language our auditors do. First clean ITAM audit in five years." name="Marcus Lee" title="Finance Director, Globex" />
            <Testimonial gradient="from-emerald-500 to-teal-500" quote="Modular activation is the killer feature. We turned off procurement because we already have one — the rest is best in class." name="Diana Park" title="VP Engineering, Acme" />
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section aria-labelledby="pricing-teaser" className="mx-auto max-w-6xl px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Pricing</p>
          <h2 id="pricing-teaser" className="mt-3 text-balance text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
            Honest pricing. <span className="bg-gradient-to-r from-emerald-600 to-cyan-600 bg-clip-text text-transparent">Always a free option.</span>
          </h2>
          <p className="mt-3 text-balance text-base text-ink-500">No credit card. No "schedule a call." See full plans on the pricing page.</p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <PriceCard name="Starter" price="₹0" sub="Forever, up to 50 assets" cta="Start free" highlight={false} features={['Up to 5 users', 'Core asset tracking', 'CSV import', 'Email support']} />
          <PriceCard name="Business" price="₹699" sub="per user / month" cta="Try 30 days free" highlight features={['Everything in Starter', 'All modules unlocked', 'API + webhooks', 'SSO + audit log', 'Priority support']} />
          <PriceCard name="Enterprise" price="Custom" sub="Volume + on-prem options" cta="Contact sales" highlight={false} features={['Dedicated tenant cluster', 'SCIM provisioning', 'Custom SLAs', 'DPA + InfoSec review']} />
        </div>
      </section>

      <FAQ items={FAQ_ITEMS} />

      {/* Final CTA — aurora bg */}
      <section aria-labelledby="final-cta" className="relative isolate overflow-hidden bg-[#06080f] py-28 text-center text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-1/2 h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fuchsia-600/40 mix-blend-screen blur-3xl animate-blob-slow" />
          <div className="absolute left-[20%] top-1/2 h-[36rem] w-[36rem] -translate-y-1/2 rounded-full bg-indigo-500/40 mix-blend-screen blur-3xl animate-blob" />
          <div className="absolute right-[20%] top-1/2 h-[32rem] w-[32rem] -translate-y-1/2 rounded-full bg-cyan-400/30 mix-blend-screen blur-3xl animate-blob" />
        </div>
        <div className="relative mx-auto max-w-3xl px-6">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-white/80 backdrop-blur">
            <Star className="h-3 w-3 text-amber-300" /> Rated 4.8 / 5 by ops teams
          </div>
          <h2 id="final-cta" className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            Start your <span className="bg-gradient-to-r from-fuchsia-300 via-violet-300 to-cyan-300 bg-clip-text text-transparent">free 30-day trial</span> today.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-balance text-base text-white/70">
            No credit card. No questions asked. Spin up your workspace and ship asset management in an afternoon.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/signup" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-ink-900 shadow-[0_10px_40px_-10px_rgba(255,255,255,0.5)] hover:bg-ink-100">
              <Rocket className="h-4 w-4" /> Create your workspace <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/contact" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/15 px-6 text-sm font-semibold text-white hover:bg-white/[0.08]">
              Talk to sales
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

/* ------------------- helpers ------------------- */

const TONE_BG: Record<string, string> = {
  fuchsia: 'from-fuchsia-500 to-rose-500',
  indigo: 'from-indigo-500 to-violet-500',
  violet: 'from-violet-500 to-fuchsia-500',
  cyan: 'from-cyan-500 to-sky-500',
  sky: 'from-sky-500 to-blue-500',
  emerald: 'from-emerald-500 to-teal-500',
  amber: 'from-amber-500 to-orange-500',
  rose: 'from-rose-500 to-pink-500',
};

const TONE_TEXT_LIGHT: Record<string, string> = {
  fuchsia: 'text-fuchsia-300',
  indigo: 'text-indigo-300',
  violet: 'text-violet-300',
  cyan: 'text-cyan-300',
  sky: 'text-sky-300',
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
};

const TONE_TEXT_DARK: Record<string, string> = {
  fuchsia: 'text-fuchsia-700',
  indigo: 'text-indigo-700',
  violet: 'text-violet-700',
  cyan: 'text-cyan-700',
  sky: 'text-sky-700',
  emerald: 'text-emerald-700',
  amber: 'text-amber-700',
  rose: 'text-rose-700',
};

function Tile({ label, value, tone }: { label: string; value: string; tone: keyof typeof TONE_BG }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className={`text-[10px] font-semibold uppercase tracking-wider ${TONE_TEXT_LIGHT[tone]}`}>{label}</div>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-2xl font-semibold text-white">{value}</span>
        <span className={`h-6 w-6 rounded-md bg-gradient-to-br ${TONE_BG[tone]} opacity-90`} />
      </div>
      <div className={`mt-3 h-1 w-full rounded-full bg-gradient-to-r ${TONE_BG[tone]} opacity-80`} />
    </div>
  );
}

function BentoTile({ className = '', tone, icon, title, body, big }: { className?: string; tone: keyof typeof TONE_BG; icon: React.ReactNode; title: string; body: string; big?: boolean }) {
  return (
    <article className={`group relative overflow-hidden rounded-3xl border border-ink-200 bg-white p-6 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop ${className}`}>
      <div aria-hidden className={`pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-gradient-to-br ${TONE_BG[tone]} opacity-25 blur-2xl transition group-hover:opacity-40`} />
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${TONE_BG[tone]} text-white shadow-soft`}>{icon}</div>
      <h3 className={`mt-4 ${big ? 'text-2xl' : 'text-base'} font-semibold tracking-tight text-ink-900`}>{title}</h3>
      <p className={`mt-1.5 ${big ? 'max-w-md text-base' : 'text-sm'} text-ink-500`}>{body}</p>
      {big && (
        <div aria-hidden className="mt-6 grid grid-cols-3 gap-2">
          <span className="h-2 rounded-full bg-fuchsia-200" />
          <span className="h-2 rounded-full bg-indigo-200" />
          <span className="h-2 rounded-full bg-cyan-200" />
        </div>
      )}
    </article>
  );
}

function Step({ n, title, body, tone }: { n: number; title: string; body: string; tone: keyof typeof TONE_BG }) {
  return (
    <li className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition hover:bg-white/[0.07]">
      <div aria-hidden className={`pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gradient-to-br ${TONE_BG[tone]} opacity-30 blur-2xl`} />
      <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${TONE_BG[tone]} text-sm font-bold text-white shadow-lg`}>{n}</div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-white/70">{body}</p>
    </li>
  );
}

function Diff({ icon, title, body, tone }: { icon: React.ReactNode; title: string; body: string; tone: keyof typeof TONE_BG }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${TONE_BG[tone]} text-white shadow-soft`}>{icon}</span>
      <div>
        <div className="text-sm font-semibold text-ink-900">{title}</div>
        <div className="text-sm text-ink-500">{body}</div>
      </div>
    </li>
  );
}

function DbCard({ tenant, assets, tone }: { tenant: string; assets: string; tone: keyof typeof TONE_BG }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-ink-200 bg-white p-5 shadow-card">
      <div aria-hidden className={`pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-gradient-to-br ${TONE_BG[tone]} opacity-20 blur-2xl`} />
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-2 w-2 rounded-full bg-gradient-to-br ${TONE_BG[tone]}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${TONE_TEXT_DARK[tone]}`}>tenant: {tenant}</span>
      </div>
      <p className="mt-3 font-mono text-sm text-ink-700">
        <span className="text-ink-400">$</span> assetmon db status<br />
        <span className="text-emerald-600">✓</span> <span className="text-ink-500">{tenant}_db isolated</span><br />
        <span className="text-emerald-600">✓</span> <span className="text-ink-500">migrations up-to-date</span><br />
        <span className="text-emerald-600">✓</span> <span className="text-ink-500">{assets} assets</span>
      </p>
    </div>
  );
}

function Testimonial({ quote, name, title, gradient }: { quote: string; name: string; title: string; gradient: string }) {
  return (
    <figure className="group relative rounded-2xl p-[1.5px] shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop">
      <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${gradient} opacity-70 group-hover:opacity-100`} />
      <div className="relative rounded-2xl bg-white p-5">
        <div className="flex items-center gap-1 text-amber-400">
          {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-current" />)}
        </div>
        <Quote className="mt-3 h-4 w-4 text-ink-300" aria-hidden />
        <blockquote className="mt-2 text-sm leading-relaxed text-ink-700">"{quote}"</blockquote>
        <figcaption className="mt-4 flex items-center gap-3">
          <span className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-xs font-semibold text-white`}>{name.charAt(0)}</span>
          <span className="text-xs">
            <span className="block font-medium text-ink-900">{name}</span>
            <span className="block text-ink-500">{title}</span>
          </span>
        </figcaption>
      </div>
    </figure>
  );
}

function PriceCard({ name, price, sub, cta, features, highlight }: { name: string; price: string; sub: string; cta: string; features: string[]; highlight?: boolean }) {
  if (highlight) {
    return (
      <div className="group relative rounded-2xl p-[2px] shadow-pop">
        <div aria-hidden className="absolute inset-0 rounded-2xl bg-gradient-to-br from-fuchsia-500 via-indigo-500 to-cyan-400 opacity-100 animate-glow-pulse" />
        <div className="relative rounded-2xl bg-white p-6">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-ink-900">{name}</h3>
            <span className="rounded-full bg-gradient-to-r from-fuchsia-600 to-indigo-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Most popular</span>
          </div>
          <div className="mt-3">
            <span className="text-4xl font-semibold tracking-tight text-ink-900">{price}</span>
            <span className="ml-1 text-sm text-ink-500">{sub}</span>
          </div>
          <ul className="mt-5 space-y-2 text-sm text-ink-700" role="list">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> {f}
              </li>
            ))}
          </ul>
          <Link href="/signup" className="mt-6 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-ink-900 text-sm font-semibold text-white shadow-soft hover:bg-ink-800">
            {cta} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
      <h3 className="text-sm font-semibold text-ink-900">{name}</h3>
      <div className="mt-3">
        <span className="text-4xl font-semibold tracking-tight text-ink-900">{price}</span>
        <span className="ml-1 text-sm text-ink-500">{sub}</span>
      </div>
      <ul className="mt-5 space-y-2 text-sm text-ink-700" role="list">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> {f}
          </li>
        ))}
      </ul>
      <Link href="/signup" className="mt-6 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-white text-sm font-semibold text-ink-700 hover:bg-ink-50">
        {cta} <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
