import Link from 'next/link';
import { CheckCircle2, ArrowRight, X } from 'lucide-react';
import { MarketingShell } from '@/components/marketing/Shell';
import { pageMetadata, faqLd, breadcrumbLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { FAQ, type FaqItem } from '@/components/marketing/FAQ';

export const metadata = pageMetadata({
  title: 'Pricing — start free, scale fairly',
  description: 'AssetMon pricing: a generous free Starter plan, predictable per-user Business pricing, and an Enterprise plan with SCIM and DPA. 30-day free trial, no credit card required.',
  path: '/pricing',
});

const PLANS = [
  {
    name: 'Starter', price: '₹0', sub: 'forever',
    description: 'For small teams getting their first 50 assets under control.',
    cta: 'Start free',
    highlight: false,
    features: [
      ['Up to 5 users', true],
      ['Up to 50 assets', true],
      ['Core asset tracking', true],
      ['CSV import & export', true],
      ['Email support', true],
      ['Service tickets', false],
      ['Maintenance', false],
      ['Procurement', false],
      ['Depreciation engine', false],
      ['API & webhooks', false],
      ['SSO', false],
    ] as [string, boolean][],
  },
  {
    name: 'Business', price: '₹699', sub: 'per user / month',
    description: 'Everything most teams need. 30-day free trial — no card.',
    cta: 'Start 30-day trial',
    highlight: true,
    features: [
      ['Unlimited users', true],
      ['Unlimited assets', true],
      ['Service tickets', true],
      ['Maintenance schedules', true],
      ['Procurement (PR + PO)', true],
      ['Depreciation engine', true],
      ['Software & license compliance', true],
      ['Reservations + physical audits', true],
      ['API + webhooks', true],
      ['SSO (Google, Azure AD, SAML)', true],
      ['Priority support', true],
    ] as [string, boolean][],
  },
  {
    name: 'Enterprise', price: 'Custom', sub: 'volume / on-prem',
    description: 'For organisations with InfoSec, SCIM and DPA requirements.',
    cta: 'Contact sales',
    highlight: false,
    features: [
      ['Everything in Business', true],
      ['Dedicated tenant cluster', true],
      ['SCIM 2.0 user provisioning', true],
      ['Custom SLAs (99.95%)', true],
      ['DPA + InfoSec review', true],
      ['Region pinning (EU, IN, US)', true],
      ['Self-hosted option', true],
      ['Named CSM', true],
    ] as [string, boolean][],
  },
];

const PRICING_FAQ: FaqItem[] = [
  { category: 'Pricing & trial', q: 'Is the 30-day trial really free?', a: 'Completely. No credit card, no scheduled call, no auto-renewal. At the end of 30 days, you choose a plan or simply walk away.' },
  { category: 'Pricing & trial', q: 'What happens to my data after the trial?', a: 'Your workspace pauses for 14 days. Pick a plan to pick up where you left off, or export your data and walk away. We never sell, share or repurpose customer data.' },
  { category: 'Pricing & trial', q: 'Do you offer discounts?', a: 'Yes — 20% off annual billing, 50% off for registered nonprofits and student / academic projects, and volume discounts on 100+ seats.' },
  { category: 'Pricing & trial', q: 'Which payment methods do you accept?', a: 'We bill through Razorpay — UPI, NetBanking, all major debit/credit cards (Visa, Mastercard, RuPay, Amex), Wallets, and e-mandate for auto-debit on subscriptions. Enterprise customers can pay by invoice in INR or USD.' },
  { category: 'Pricing & trial', q: 'Can I cancel any time?', a: 'Yes, in two clicks from the dashboard. You keep access until the end of your billing period.' },
  { category: 'Pricing & trial', q: 'Are there per-asset fees?', a: 'No. Business and Enterprise plans are flat per-user. Starter has a 50-asset ceiling.' },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'Pricing', url: '/pricing' }])} />
      <JsonLd data={faqLd(PRICING_FAQ.map(({ q, a }) => ({ q, a })))} />

      <section className="relative overflow-hidden border-b border-ink-100">
        <div aria-hidden className="absolute inset-0 bg-mesh opacity-70" />
        <div className="relative mx-auto max-w-6xl px-6 pt-16 pb-12 text-center">
          <h1 className="text-balance text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
            Honest pricing.<br />
            <span className="bg-gradient-to-r from-brand-600 to-accent-600 bg-clip-text text-transparent">Always a free option.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-base text-ink-600">
            Start free. Upgrade when you actually need more. Cancel any time — your data stays yours.
          </p>
          <p className="mt-4 text-xs text-ink-500">
            <CheckCircle2 className="-mt-0.5 mr-1 inline h-3.5 w-3.5 text-emerald-600" />
            30-day trial includes every Business feature. No credit card.
          </p>
        </div>
      </section>

      <section aria-label="Plans" className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-4 lg:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name} className={`relative rounded-2xl border p-6 shadow-card ${p.highlight ? 'border-brand-500/50 bg-gradient-to-b from-white to-brand-50/30 ring-1 ring-brand-500/40 shadow-glow' : 'border-ink-200 bg-white'}`}>
              {p.highlight && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-brand-600 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white shadow-soft">
                  Most popular
                </span>
              )}
              <h2 className="text-sm font-semibold text-ink-900">{p.name}</h2>
              <p className="mt-1 text-sm text-ink-500">{p.description}</p>
              <div className="mt-4">
                <span className="text-5xl font-semibold tracking-tight text-ink-900">{p.price}</span>
                <span className="ml-2 text-sm text-ink-500">{p.sub}</span>
              </div>
              <Link
                href={p.name === 'Enterprise' ? '/contact' : '/signup'}
                className={`mt-5 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-semibold shadow-soft ${p.highlight ? 'bg-ink-900 text-white hover:bg-ink-800' : 'border border-ink-200 bg-white text-ink-700 hover:bg-ink-50'}`}
              >
                {p.cta} <ArrowRight className="h-4 w-4" />
              </Link>
              <ul className="mt-6 space-y-2 text-sm" role="list">
                {p.features.map(([label, ok]) => (
                  <li key={label} className="flex items-start gap-2">
                    {ok
                      ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                      : <X className="mt-0.5 h-4 w-4 shrink-0 text-ink-300" aria-hidden />}
                    <span className={ok ? 'text-ink-700' : 'text-ink-400'}>{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <FAQ items={PRICING_FAQ} />
    </MarketingShell>
  );
}
