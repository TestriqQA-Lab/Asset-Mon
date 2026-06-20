import type { Metadata } from 'next';
import { SITE } from './site';

type SeoInput = {
  title: string;
  description?: string;
  path?: string;
  image?: string;
  type?: 'website' | 'article';
  publishedAt?: string;
  updatedAt?: string;
  author?: string;
  tags?: string[];
};

export function pageMetadata({
  title, description, path = '/', image, type = 'website', publishedAt, updatedAt, author, tags,
}: SeoInput): Metadata {
  const fullTitle = title.includes(SITE.name) ? title : `${title} · ${SITE.name}`;
  const url = SITE.url + (path === '/' ? '' : path);
  const desc = description || SITE.description;
  const img = image || `${SITE.url}/og-default.svg`;

  return {
    metadataBase: new URL(SITE.url),
    title: fullTitle,
    description: desc,
    keywords: tags && tags.length ? tags : SITE.keywords,
    alternates: { canonical: url },
    openGraph: {
      title: fullTitle,
      description: desc,
      url,
      siteName: SITE.name,
      type,
      images: [{ url: img, width: 1200, height: 630, alt: title }],
      publishedTime: publishedAt,
      modifiedTime: updatedAt,
      authors: author ? [author] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      site: SITE.twitter,
      creator: SITE.twitter,
      title: fullTitle,
      description: desc,
      images: [img],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large', 'max-video-preview': -1 },
    },
  };
}

export function organizationLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.url,
    logo: `${SITE.url}/logo.svg`,
    sameAs: Object.values(SITE.social),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: SITE.supportEmail,
      availableLanguage: ['English'],
    },
  };
}

export function websiteLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    url: SITE.url,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE.url}/blog?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

export function softwareApplicationLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE.name,
    operatingSystem: 'Web',
    applicationCategory: 'BusinessApplication',
    description: SITE.description,
    url: SITE.url,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      description: `${SITE.trial.headline} — ${SITE.trial.promise}`,
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      reviewCount: '127',
    },
  };
}

export function breadcrumbLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: SITE.url + it.url,
    })),
  };
}

export function faqLd(items: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.q,
      acceptedAnswer: { '@type': 'Answer', text: it.a },
    })),
  };
}

export function articleLd(p: {
  title: string; description: string; slug: string; publishedAt: string; updatedAt?: string;
  author: string; image?: string; tags?: string[];
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: p.title,
    description: p.description,
    image: p.image ? [p.image] : [`${SITE.url}/og-default.svg`],
    datePublished: p.publishedAt,
    dateModified: p.updatedAt || p.publishedAt,
    author: { '@type': 'Person', name: p.author },
    publisher: {
      '@type': 'Organization',
      name: SITE.name,
      logo: { '@type': 'ImageObject', url: `${SITE.url}/logo.svg` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE.url}/blog/${p.slug}` },
    keywords: (p.tags || []).join(', '),
  };
}

/**
 * Serialise an object for embedding inside `<script type="application/ld+json">…</script>`.
 *
 * `JSON.stringify` happily emits the literal string `</script>` if the input
 * data contains it. Injected into the page, that closes our script tag early
 * and lets the rest of the payload run as HTML — a classic XSS vector for SEO
 * data driven by user input (e.g. blog titles, glossary terms). We escape:
 *   • `</`  → `<\/`   neutralises `</script>`, `</style>`, etc.
 *   • U+2028 / U+2029 → `\u2028` / `\u2029` (older parsers treat these as
 *     JS line terminators inside scripts, breaking the JSON).
 *   • `<!--` / `-->` → broken-up versions; defensive against HTML comments
 *     inside scripts being mishandled.
 */
export function jsonLdString(data: any) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
