import Link from 'next/link';
import { ArrowRight, Sparkles, BookOpen } from 'lucide-react';
import { MarketingShell } from '@/components/marketing/Shell';
import { pageMetadata, breadcrumbLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { GLOSSARY } from '@/lib/glossary';

export const metadata = pageMetadata({
  title: 'Glossary — IT asset management terms, defined plainly',
  description: 'Short, practical definitions of the terms every ITAM practitioner uses: ITAM, CMDB, SAM, HAM, depreciation methods, MTTR, TCO and more.',
  path: '/glossary',
});

export default function GlossaryPage() {
  const groups = new Map<string, typeof GLOSSARY>();
  for (const g of GLOSSARY) {
    const letter = g.term.replace(/\(.*\)/, '').trim()[0].toUpperCase();
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(g);
  }
  const letters = Array.from(groups.keys()).sort();

  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'Glossary', url: '/glossary' }])} />
      <section className="relative overflow-hidden border-b border-ink-100">
        <div aria-hidden className="absolute inset-0 bg-mesh opacity-70" />
        <div className="relative mx-auto max-w-4xl px-6 py-16 text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white/70 px-3 py-1 text-xs text-ink-600 shadow-soft backdrop-blur">
            <Sparkles className="h-3 w-3 text-brand-600" /> Glossary
          </p>
          <h1 className="mt-4 text-balance text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
            ITAM, defined.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-base text-ink-600">
            {GLOSSARY.length} short definitions of the words you'll meet on the job — from <em>asset tag</em> to <em>true-up</em>.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="mb-6 flex flex-wrap gap-1.5">
          {letters.map((l) => (
            <a key={l} href={`#letter-${l}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ink-200 bg-white text-xs font-semibold text-ink-700 hover:bg-ink-50">{l}</a>
          ))}
        </div>

        {letters.map((l) => (
          <section key={l} id={`letter-${l}`} className="scroll-mt-24">
            <h2 className="mt-8 text-3xl font-semibold tracking-tight text-ink-900">{l}</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {groups.get(l)!.map((g) => (
                <li key={g.slug}>
                  <Link href={`/glossary/${g.slug}`} className="group flex items-start gap-3 rounded-2xl border border-ink-200 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">
                      <BookOpen className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-ink-900">{g.term}</span>
                      <span className="mt-0.5 block text-sm text-ink-500">{g.short}</span>
                    </span>
                    <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-ink-300 group-hover:text-brand-700" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
    </MarketingShell>
  );
}
