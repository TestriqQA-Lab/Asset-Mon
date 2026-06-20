import Link from 'next/link';
import { Sparkles, Clock, ArrowRight, Tag as TagIcon } from 'lucide-react';
import { MarketingShell } from '@/components/marketing/Shell';
import { pageMetadata, breadcrumbLd, websiteLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { POSTS, type BlogPost } from '@/lib/blog';

export const metadata = pageMetadata({
  title: 'AssetMon Blog — guides, playbooks and benchmarks for asset management',
  description: 'Sharp, practical writing on IT Asset Management, license compliance, depreciation, physical audits, procurement and the operations that hold them together.',
  path: '/blog',
});

const CATEGORIES = ['All', 'ITAM', 'Operations', 'Security', 'Finance', 'How-to', 'Industry'] as const;

export default function BlogIndexPage({ searchParams }: { searchParams: { category?: string } }) {
  const filter = searchParams.category && (CATEGORIES as readonly string[]).includes(searchParams.category)
    ? searchParams.category : 'All';
  const sorted = [...POSTS].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  const posts = filter === 'All' ? sorted : sorted.filter((p) => p.category === filter);
  const featured = sorted[0];
  const rest = posts.filter((p) => p.slug !== featured.slug);

  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', url: '/' }, { name: 'Blog', url: '/blog' }])} />
      <JsonLd data={websiteLd()} />

      <section className="relative overflow-hidden border-b border-ink-100">
        <div aria-hidden className="absolute inset-0 bg-mesh opacity-70" />
        <div className="relative mx-auto max-w-6xl px-6 pt-16 pb-10 text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white/70 px-3 py-1 text-xs text-ink-600 shadow-soft backdrop-blur">
            <Sparkles className="h-3 w-3 text-brand-600" /> Blog
          </p>
          <h1 className="mt-4 text-balance text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
            Guides, playbooks &amp; benchmarks.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-base text-ink-600">
            We write about the asset operations that actually move the needle — and the tooling decisions you'll thank yourself for in two years.
          </p>
        </div>
      </section>

      <section aria-label="Filter" className="border-b border-ink-100">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-1.5 px-6 py-4">
          {CATEGORIES.map((c) => {
            const active = filter === c;
            return (
              <Link
                key={c}
                href={c === 'All' ? '/blog' : `/blog?category=${c}`}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-ink-900 text-white shadow-soft' : 'border border-ink-200 bg-white text-ink-600 hover:bg-ink-50'}`}
              >
                <TagIcon className="h-3 w-3" /> {c}
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-label="Featured" className="mx-auto max-w-6xl px-6 py-10">
        {filter === 'All' && (
          <Link href={`/blog/${featured.slug}`} className="group block overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop">
            <div className="grid md:grid-cols-[1.3fr_1fr]">
              <div className="relative overflow-hidden bg-gradient-to-br from-brand-500 to-brand-700 p-8 text-white">
                <div aria-hidden className="absolute inset-0 bg-grid-light bg-[size:36px_36px] opacity-20" />
                <div className="relative">
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">Featured</span>
                  <p className="mt-4 text-3xl font-semibold leading-tight">{featured.title}</p>
                  <p className="mt-3 max-w-md text-sm text-white/80">{featured.description}</p>
                </div>
              </div>
              <div className="flex flex-col justify-center gap-3 p-6">
                <Meta post={featured} />
                <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 group-hover:underline">
                  Read article <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </div>
          </Link>
        )}
      </section>

      <section aria-label="All posts" className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {(filter === 'All' ? rest : posts).map((p) => <PostCard key={p.slug} post={p} />)}
        </div>
      </section>
    </MarketingShell>
  );
}

function Meta({ post }: { post: BlogPost }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
      <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700 ring-1 ring-inset ring-brand-200">{post.category}</span>
      <span>·</span>
      <span>{new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      <span>·</span>
      <Clock className="h-3 w-3" aria-hidden /><span>{post.readingMinutes} min read</span>
    </div>
  );
}

function PostCard({ post }: { post: BlogPost }) {
  return (
    <Link href={`/blog/${post.slug}`} className="group block overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop">
      <div className="aspect-[16/9] bg-gradient-to-br from-ink-900 via-brand-700 to-brand-500 p-5 text-white">
        <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">{post.category}</span>
        <p className="mt-3 line-clamp-3 text-lg font-semibold">{post.title}</p>
      </div>
      <div className="space-y-3 p-5">
        <Meta post={post} />
        <p className="line-clamp-3 text-sm text-ink-600">{post.description}</p>
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 group-hover:underline">
          Read article <ArrowRight className="h-3.5 w-3.5" />
        </div>
      </div>
    </Link>
  );
}
