import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { BOARDS } from '@/lib/scrapeNotices';
import { parseArticle, type NoticeArticle } from '@/lib/noticeArticle';
import { getRedis } from '@/lib/redis';

/** Only the boards PNUtify reads; this is not a general-purpose proxy. */
const ALLOWED_HOSTS = new Set(BOARDS.map((b) => new URL(b.origin).hostname));
/** Articles rarely change once posted; keep them for a while so reading doesn't hit the school site every time. */
const CACHE_SECONDS = 6 * 60 * 60;
const memoryCache = new Map<string, { at: number; article: NoticeArticle }>();
const cacheKey = (url: string) => `notice:article:v1:${createHash('sha1').update(url).digest('hex')}`;

async function cached(url: string): Promise<NoticeArticle | null> {
  const redis = getRedis();
  if (redis) return (await redis.get<NoticeArticle>(cacheKey(url)).catch(() => null)) ?? null;
  const hit = memoryCache.get(url);
  return hit && Date.now() - hit.at < CACHE_SECONDS * 1000 ? hit.article : null;
}

async function remember(url: string, article: NoticeArticle): Promise<void> {
  const redis = getRedis();
  if (redis) await redis.set(cacheKey(url), article, { ex: CACHE_SECONDS }).catch(() => null);
  else {
    if (memoryCache.size > 200) memoryCache.clear();
    memoryCache.set(url, { at: Date.now(), article });
  }
}

// Listing pages sometimes link through a `?enc=<base64>` menu-context wrapper
// instead of the direct article URL. That wrapper can 404 once the menu
// context goes stale; the decoded /bbs/.../artclView.do path is the CMS's
// stable identifier for the article, so resolve to it before fetching.
function resolveCanonicalUrl(u: URL): URL {
  const enc = u.searchParams.get('enc');
  if (!enc) return u;
  try {
    const decoded = decodeURIComponent(Buffer.from(decodeURIComponent(enc), 'base64').toString('utf-8'));
    const match = decoded.match(/(\/bbs\/[^\s?]+\/artclView\.do)/);
    if (match) return new URL(match[1], u.origin);
  } catch {}
  return u;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get('url');
  const listingTitle = (searchParams.get('title') || '').replace(/\s+/g, ' ').trim();
  if (!target) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname) || !/^https?:$/.test(parsed.protocol)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 400 });
  }
  parsed = resolveCanonicalUrl(parsed);

  const sourceUrl = parsed.toString();
  const hit = await cached(sourceUrl);
  if (hit) return NextResponse.json({ ...hit, title: hit.title || listingTitle || null, sourceUrl }, { headers: { 'Cache-Control': 'public, s-maxage=600' } });

  try {
    const res = await fetch(sourceUrl, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return NextResponse.json({ error: 'Source page unavailable', sourceUrl: parsed.toString() }, { status: 502 });
    const html = await res.text();
    if (/찾을\s*수\s*없|존재\s*하지\s*않/.test(html.slice(0, 3000))) {
      return NextResponse.json({ error: 'Source page not found', sourceUrl: parsed.toString(), title: listingTitle || null });
    }
    const article = parseArticle(html, sourceUrl, listingTitle);
    await remember(sourceUrl, article);
    return NextResponse.json({ ...article, title: article.title || listingTitle || null, sourceUrl }, { headers: { 'Cache-Control': 'public, s-maxage=600' } });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch notice', sourceUrl }, { status: 500 });
  }
}
