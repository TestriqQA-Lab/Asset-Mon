import Link from 'next/link';
import { Twitter, Linkedin, Github, Youtube, Facebook } from 'lucide-react';
import { SITE } from '@/lib/site';

const COLS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/security', label: 'Security' },
      { href: '/#faq', label: 'FAQ' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { href: '/blog', label: 'Blog' },
      { href: '/glossary', label: 'Glossary' },
      { href: '/roi', label: 'ROI calculator' },
      { href: '/changelog', label: 'Changelog' },
      { href: '/status', label: 'Status' },
      { href: '/compare/snipe-it', label: 'vs Snipe-IT' },
      { href: '/compare/asset-panda', label: 'vs Asset Panda' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/terms', label: 'Terms of service' },
      { href: '/cookies', label: 'Cookie policy' },
      { href: '/security#dpa', label: 'Data processing addendum' },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="mt-16 border-t border-ink-200 bg-white" role="contentinfo">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-10 md:grid-cols-5">
          <div className="md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5" aria-label="AssetMon home">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">A</span>
              <span className="text-base font-semibold tracking-tight text-ink-900">{SITE.name}</span>
            </Link>
            <p className="mt-3 text-sm text-ink-500">{SITE.tagline}</p>
            <div className="mt-4 flex items-center gap-2">
              <SocialIcon href={SITE.social.twitter} label="Twitter / X"><Twitter className="h-4 w-4" /></SocialIcon>
              <SocialIcon href={SITE.social.linkedin} label="LinkedIn"><Linkedin className="h-4 w-4" /></SocialIcon>
              <SocialIcon href={SITE.social.github} label="GitHub"><Github className="h-4 w-4" /></SocialIcon>
              <SocialIcon href={SITE.social.youtube} label="YouTube"><Youtube className="h-4 w-4" /></SocialIcon>
              <SocialIcon href={SITE.social.facebook} label="Facebook"><Facebook className="h-4 w-4" /></SocialIcon>
            </div>
          </div>
          {COLS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">{col.heading}</h2>
              <ul className="mt-3 space-y-2" role="list">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-sm text-ink-600 hover:text-ink-900">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-ink-100 pt-6 text-xs text-ink-500 md:flex-row md:items-center">
          <p>© {new Date().getFullYear()} {SITE.name}. All rights reserved.</p>
          <p className="flex items-center gap-2">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /> All systems operational
          </p>
        </div>
      </div>
    </footer>
  );
}

function SocialIcon({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 text-ink-600 transition-colors hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900"
    >
      {children}
    </a>
  );
}
