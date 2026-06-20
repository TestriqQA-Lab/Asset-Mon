import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';
import { POSTS } from '@/lib/blog';
import { GLOSSARY } from '@/lib/glossary';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date().toISOString();
  const staticRoutes = [
    { url: SITE.url, priority: 1.0, changeFrequency: 'weekly' as const },
    { url: `${SITE.url}/pricing`, priority: 0.9, changeFrequency: 'weekly' as const },
    { url: `${SITE.url}/about`, priority: 0.7, changeFrequency: 'monthly' as const },
    { url: `${SITE.url}/security`, priority: 0.7, changeFrequency: 'monthly' as const },
    { url: `${SITE.url}/contact`, priority: 0.6, changeFrequency: 'yearly' as const },
    { url: `${SITE.url}/blog`, priority: 0.9, changeFrequency: 'daily' as const },
    { url: `${SITE.url}/privacy`, priority: 0.4, changeFrequency: 'yearly' as const },
    { url: `${SITE.url}/terms`, priority: 0.4, changeFrequency: 'yearly' as const },
    { url: `${SITE.url}/cookies`, priority: 0.3, changeFrequency: 'yearly' as const },
    { url: `${SITE.url}/glossary`, priority: 0.7, changeFrequency: 'monthly' as const },
    { url: `${SITE.url}/roi`, priority: 0.7, changeFrequency: 'monthly' as const },
    { url: `${SITE.url}/changelog`, priority: 0.7, changeFrequency: 'weekly' as const },
    { url: `${SITE.url}/status`, priority: 0.5, changeFrequency: 'daily' as const },
    { url: `${SITE.url}/compare/snipe-it`, priority: 0.7, changeFrequency: 'monthly' as const },
    { url: `${SITE.url}/compare/asset-panda`, priority: 0.7, changeFrequency: 'monthly' as const },
  ].map((r) => ({ ...r, lastModified: now }));

  const postRoutes = POSTS.map((p) => ({
    url: `${SITE.url}/blog/${p.slug}`,
    lastModified: p.updatedAt || p.publishedAt,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));
  const glossaryRoutes = GLOSSARY.map((g) => ({
    url: `${SITE.url}/glossary/${g.slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...postRoutes, ...glossaryRoutes];
}
