'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Menu, X, ArrowRight } from 'lucide-react';

const LINKS = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/blog', label: 'Blog' },
  { href: '/security', label: 'Security' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

export function MarketingHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-ink-200/60 glass">
      <nav aria-label="Primary" className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="AssetMon home">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white shadow-[0_8px_24px_-8px_rgba(217,70,239,0.7)]"
            style={{ backgroundImage: 'linear-gradient(135deg,#f472b6 0%,#a78bfa 50%,#22d3ee 100%)' }}
          >A</span>
          <span className="text-base font-semibold tracking-tight text-ink-900">AssetMon</span>
        </Link>
        <ul className="hidden items-center gap-1 md:flex" role="list">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-50 hover:text-ink-900">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden items-center gap-2 md:flex">
          <Link href="/login" className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50">Sign in</Link>
          <Link href="/signup" className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3.5 py-1.5 text-sm font-medium text-white shadow-soft hover:bg-ink-800">
            Start free trial <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <button
          className="rounded-md p-2 text-ink-700 hover:bg-ink-100 md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>
      {open && (
        <div className="border-t border-ink-200 bg-white px-6 py-3 md:hidden">
          <ul className="space-y-1" role="list">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="block rounded-md px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50">{l.label}</Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2 border-t border-ink-100 pt-3">
            <Link href="/login" className="flex-1 rounded-lg border border-ink-200 px-3 py-1.5 text-center text-sm font-medium text-ink-700">Sign in</Link>
            <Link href="/signup" className="flex-1 rounded-lg bg-ink-900 px-3 py-1.5 text-center text-sm font-medium text-white">Start free trial</Link>
          </div>
        </div>
      )}
    </header>
  );
}
