import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

const ALLOWED_HOSTS = ['cse.pusan.ac.kr', 'international.pusan.ac.kr'];

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
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 400 });
  }
  parsed = resolveCanonicalUrl(parsed);

  try {
    const res = await fetch(parsed.toString(), { cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ error: 'Source page unavailable', sourceUrl: parsed.toString() }, { status: 502 });
    const html = await res.text();
    if (/찾을\s*수\s*없|존재\s*하지\s*않/.test(html.slice(0, 3000))) {
      return NextResponse.json({ error: 'Source page not found', sourceUrl: parsed.toString(), title: listingTitle || null });
    }
    const $ = cheerio.load(html);

    // Real K2Web structure, confirmed via devtools: the full title lives in
    // .board-view .title strong (keeps the [category] tag, matches listing style),
    // with a clean untagged copy also sitting in a hidden #artclViewTitle input.
    let title: string | null = null;

    const heading = $('.board-view .title strong, .view.viewCont .title strong').first().text().trim().replace(/\s+/g, ' ');
    if (heading) title = heading;

    if (!title) {
      const hidden = $('#artclViewTitle').attr('value');
      if (hidden && hidden.trim()) title = hidden.trim();
    }

    if (!title) {
      const prefix = listingTitle.replace(/[.\u2026]+$/, '').trim().slice(0, 15);
      if (prefix.length >= 4) {
        let best: string | null = null;
        $('strong, b, h1, h2, h3, h4, h5, dt, td, div, p, li, span').each((_, el) => {
          const text = $(el).text().trim().replace(/\s+/g, ' ');
          if (text.startsWith(prefix) && (!best || text.length < best.length)) {
            best = text;
          }
        });
        title = best;
      }
    }

    if (!title) title = listingTitle || null;

    return NextResponse.json({ title, sourceUrl: parsed.toString() });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch notice title' }, { status: 500 });
  }
}
