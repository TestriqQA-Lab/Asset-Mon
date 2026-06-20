import { SITE } from '@/lib/site';
import { CHANGELOG } from '@/lib/changelog';

export function GET() {
  const items = CHANGELOG.map((c) => {
    const date = new Date(c.date).toUTCString();
    const body = c.items.map((i) => `<li>${escape(i)}</li>`).join('');
    return `
    <item>
      <title>${escape(c.title)}</title>
      <link>${SITE.url}/changelog</link>
      <guid isPermaLink="false">${c.date}-${slug(c.title)}</guid>
      <pubDate>${date}</pubDate>
      <description><![CDATA[<ul>${body}</ul>]]></description>
    </item>`;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>${SITE.name} changelog</title>
    <link>${SITE.url}/changelog</link>
    <description>What's new in ${SITE.name}.</description>
    <language>en-us</language>
    ${items}
  </channel>
</rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
}

function escape(s: string) {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' } as any)[c]);
}
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
