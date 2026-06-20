import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, BookOpen, ArrowRight } from 'lucide-react';
import { MarketingShell } from '@/components/marketing/Shell';
import { pageMetadata, breadcrumbLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { GLOSSARY, getGlossaryEntry } from '@/lib/glossary';

export function generateStaticParams() { return GLOSSARY.map((g) => ({ slug: g.slug })); }

export function generateMetadata({ params }: { params: { slug: string } }) {
  const g = getGlossaryEntry(params.slug);
  if (!g) return pageMetadata({ title: 'Not found', path: '/glossary' });
  return pageMetadata({
    title: `${g.term} — Glossary`,
    description: g.short,
    path: `/glossary/${g.slug}`,
    tags: g.tags,
  });
}

export default function GlossaryEntryPage({ params }: { params: { slug: string } }) {
  const g = getGlossaryEntry(params.slug);
  if (!g) notFound();
  const related = (g.related || []).map(getGlossaryEntry).filter(Boolean) as typeof GLOSSARY;

  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([
        { name: 'Home', url: '/' },
        { name: 'Glossary', url: '/glossary' },
        { name: g.term, url: `/glossary/${g.slug}` },
      ])} />
      <JsonLd data={{
        '@context': 'https://schema.org',
        '@type': 'DefinedTerm',
        name: g.term,
        description: g.short,
        inDefinedTermSet: 'https://schema.org/DefinedTermSet',
      }} />

      <article className="mx-auto max-w-3xl px-6 py-12">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-ink-500">
          <Link href="/" className="hover:text-ink-900">Home</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href="/glossary" className="hover:text-ink-900">Glossary</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-ink-700">{g.term}</span>
        </nav>

        <header className="mt-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">
            <BookOpen className="h-5 w-5" />
          </div>
          <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">{g.term}</h1>
          <p className="mt-3 text-lg text-ink-600">{g.short}</p>
        </header>

        <div className="mt-8 space-y-4 text-base leading-relaxed text-ink-700">
          {g.body.map((p, i) => <p key={i}>{p}</p>)}
        </div>

        {related.length > 0 && (
          <div className="mt-10 border-t border-ink-100 pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Related</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link href={`/glossary/${r.slug}`} className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white px-3 py-1 text-xs text-ink-700 hover:bg-ink-50">
                    {r.term}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <aside className="mt-10 overflow-hidden rounded-2xl border border-ink-200 bg-gradient-to-br from-ink-900 to-brand-900 p-6 text-white shadow-pop">
          <p className="text-sm font-medium uppercase tracking-wider text-brand-200">Try it on us</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">Spin up a free workspace in 5 minutes.</p>
          <p className="mt-1 text-sm text-ink-300">Free 30-day trial. No credit card. Cancel anytime.</p>
          <Link href="/signup" className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-ink-900 shadow-soft hover:bg-ink-100">
            Create your workspace <ArrowRight className="h-4 w-4" />
          </Link>
        </aside>
      </article>
    </MarketingShell>
  );
}
