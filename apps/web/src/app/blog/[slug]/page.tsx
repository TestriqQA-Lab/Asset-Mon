import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Clock, Calendar, ChevronRight } from 'lucide-react';
import { MarketingShell } from '@/components/marketing/Shell';
import { POSTS, getPost, relatedPosts, type BlogPost } from '@/lib/blog';
import { pageMetadata, breadcrumbLd, articleLd, faqLd } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { SITE } from '@/lib/site';

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

// Next 15 makes `params` a promise so the route can start rendering before the
// segment is resolved. The values are the same; only the await is new.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return pageMetadata({ title: 'Not found', path: '/blog' });
  return pageMetadata({
    title: post.title,
    description: post.description,
    path: `/blog/${post.slug}`,
    type: 'article',
    publishedAt: new Date(post.publishedAt).toISOString(),
    updatedAt: post.updatedAt ? new Date(post.updatedAt).toISOString() : undefined,
    author: post.author,
    tags: post.tags,
  });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();
  const faqs = post.body.flatMap((b) => b.faq || []);
  const related = relatedPosts(post.slug, 3);
  const dateFmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <MarketingShell>
      <JsonLd data={breadcrumbLd([
        { name: 'Home', url: '/' },
        { name: 'Blog', url: '/blog' },
        { name: post.title, url: `/blog/${post.slug}` },
      ])} />
      <JsonLd data={articleLd({
        title: post.title,
        description: post.description,
        slug: post.slug,
        publishedAt: new Date(post.publishedAt).toISOString(),
        updatedAt: post.updatedAt ? new Date(post.updatedAt).toISOString() : undefined,
        author: post.author,
        tags: post.tags,
      })} />
      {faqs.length > 0 && <JsonLd data={faqLd(faqs)} />}

      <article className="mx-auto max-w-3xl px-6 pt-10 pb-20">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-ink-500">
          <Link href="/" className="hover:text-ink-900">Home</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href="/blog" className="hover:text-ink-900">Blog</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-ink-700">{post.category}</span>
        </nav>

        <header className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">{post.category}</p>
          <h1 className="mt-2 text-balance text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">{post.title}</h1>
          <p className="mt-3 text-base text-ink-600">{post.description}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3 border-y border-ink-100 py-3 text-xs text-ink-500">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-ink-700 to-ink-900 text-[10px] font-semibold text-white">{post.author.charAt(0)}</span>
            <span className="font-medium text-ink-700">{post.author}</span>
            <span>·</span>
            <Calendar className="h-3 w-3" aria-hidden />
            <time dateTime={post.publishedAt}>{dateFmt(post.publishedAt)}</time>
            <span>·</span>
            <Clock className="h-3 w-3" aria-hidden />
            <span>{post.readingMinutes} min read</span>
          </div>
        </header>

        {/* Body */}
        <div className="prose mt-10 max-w-none">
          {post.body.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </div>

        {/* Tags */}
        <div className="mt-10 flex flex-wrap gap-1.5">
          {post.tags.map((t) => (
            <span key={t} className="rounded-full border border-ink-200 bg-white px-2 py-0.5 text-xs text-ink-600">#{t}</span>
          ))}
        </div>

        {/* CTA */}
        <aside className="mt-12 overflow-hidden rounded-2xl border border-ink-200 bg-gradient-to-br from-ink-900 to-brand-900 p-6 text-white shadow-pop">
          <p className="text-sm font-medium uppercase tracking-wider text-brand-200">Try it on us</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">Start your 30-day free trial of {SITE.name}.</p>
          <p className="mt-1 text-sm text-ink-300">No credit card. No questions asked. Cancel anytime.</p>
          <Link href="/signup" className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-ink-900 shadow-soft hover:bg-ink-100">
            Create your workspace <ArrowRight className="h-4 w-4" />
          </Link>
        </aside>
      </article>

      {related.length > 0 && (
        <section aria-label="Related" className="border-t border-ink-100 bg-ink-50/30 py-16">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Keep reading</h2>
            <div className="mt-6 grid gap-5 md:grid-cols-3">
              {related.map((p) => <Card key={p.slug} post={p} />)}
            </div>
          </div>
        </section>
      )}
    </MarketingShell>
  );
}

function Block({ block }: { block: BlogPost['body'][number] }) {
  return (
    <>
      {block.h2 && <h2 className="mt-8 text-2xl font-semibold tracking-tight text-ink-900">{block.h2}</h2>}
      {block.p && <p className="mt-3 text-base leading-relaxed text-ink-700">{block.p}</p>}
      {block.ul && (
        <ul className="mt-3 ml-5 list-disc space-y-1.5 text-base leading-relaxed text-ink-700">
          {block.ul.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      )}
      {block.quote && (
        <blockquote className="mt-6 border-l-4 border-brand-500 bg-brand-50/40 px-4 py-2 text-base italic text-ink-700">{block.quote}</blockquote>
      )}
    </>
  );
}

function Card({ post }: { post: BlogPost }) {
  return (
    <Link href={`/blog/${post.slug}`} className="group block overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop">
      <div className="aspect-[16/9] bg-gradient-to-br from-ink-900 via-brand-700 to-brand-500 p-5 text-white">
        <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">{post.category}</span>
        <p className="mt-3 line-clamp-3 text-base font-semibold">{post.title}</p>
      </div>
      <div className="p-4">
        <p className="line-clamp-2 text-sm text-ink-600">{post.description}</p>
      </div>
    </Link>
  );
}
