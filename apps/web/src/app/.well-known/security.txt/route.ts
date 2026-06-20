import { SITE } from '@/lib/site';

export function GET() {
  const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
  const body = `# AssetMon security disclosure
Contact: mailto:security@assetmon.app
Expires: ${expires}
Preferred-Languages: en
Canonical: ${SITE.url}/.well-known/security.txt
Policy: ${SITE.url}/security
Acknowledgments: ${SITE.url}/security#acknowledgments

# Please coordinate disclosure with us. We do not run a public bug bounty,
# but we issue Hall-of-Fame acknowledgements for valid reports.
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
