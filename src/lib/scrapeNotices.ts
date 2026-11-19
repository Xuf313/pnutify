import * as cheerio from 'cheerio';

export type NoticeSource = 'cse' | 'international';

export type ScrapedNotice = {
  id: string;
  title: string;
  /** Board date as shown on the site, e.g. "2026.11.18". */
  date: string;
  /** Same date as epoch ms at 00:00 KST, or null if it couldn't be parsed. */
  postedAt: number | null;
  source: NoticeSource;
  url: string;
  pinned: boolean;
};

type Board = {
  source: NoticeSource;
  url: string;
  origin: string;
  idPrefix: string;
  /** The list cuts titles at this many characters, with no ellipsis and no full copy in the HTML. */
  titleCut: number;
};

export const BOARDS: Board[] = [
  { source: 'cse', url: 'https://cse.pusan.ac.kr/cse/14221/subview.do', origin: 'https://cse.pusan.ac.kr', idPrefix: 'cse', titleCut: 50 },
  { source: 'international', url: 'https://international.pusan.ac.kr/international/15224/subview.do', origin: 'https://international.pusan.ac.kr', idPrefix: 'intl', titleCut: 60 },
];

// Rolling window instead of a hard-coded semester date, so the app keeps
// working next semester without a code change.
const WINDOW_DAYS = 120;
const MAX_PAGES = 6;
const FETCH_TIMEOUT_MS = 12_000;
const DAY_MS = 86_400_000;

/** "2026.11.18" / "2026-11-18" / "2026/11/18" → epoch ms at 00:00 KST. */
export function parseBoardDate(text: string): number | null {
  const m = text.trim().match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const t = Date.parse(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00+09:00`);
  return Number.isNaN(t) ? null : t;
}

export const cleanTitle = (t: string) => t.replace(/새글/g, ' ').replace(/\bNEW\b/g, ' ').replace(/\s+/g, ' ').trim();

/** Small stable string hash (FNV-1a, base36) for notices that have no article id. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function decodeEnc(enc: string): string | null {
  try {
    return decodeURIComponent(Buffer.from(decodeURIComponent(enc), 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

/**
 * The board links each article either directly (/bbs/<board>/<id>/artclView.do)
 * or through a `?enc=<base64>` wrapper that also encodes the current page
 * number. The wrapper changes from page to page, so it must never be used as
 * an identity — the article number inside it is the stable id.
 */
export function articleIdFromUrl(url: string): string | null {
  const direct = url.match(/\/(\d+)\/(\d+)\/artclView\.do/);
  if (direct) return direct[2];
  const enc = url.match(/[?&]enc=([^&#]+)/);
  if (enc) {
    const decoded = decodeEnc(enc[1]);
    const inner = decoded?.match(/\/(\d+)\/(\d+)\/artclView\.do/);
    if (inner) return inner[2];
  }
  const param = url.match(/[?&](?:articleNo|artclNo|nttSn|seq)=(\d+)/i);
  return param ? param[1] : null;
}

/** Resolve an `enc=` wrapper to the canonical article URL when possible. */
export function canonicalUrl(url: string, origin: string): string {
  const enc = url.match(/[?&]enc=([^&#]+)/);
  if (enc) {
    const decoded = decodeEnc(enc[1]);
    const path = decoded?.match(/(\/bbs\/[^\s?&]+\/artclView\.do)/);
    if (path) return new URL(path[1], origin).toString();
  }
  return url;
}

export function parseBoardPage(html: string, board: Board): { notices: ScrapedNotice[]; rowCount: number; oldestRegular: number | null } {
  const $ = cheerio.load(html);
  const notices: ScrapedNotice[] = [];
  let oldestRegular: number | null = null;

  // One selector, scoped to the board list. A broad "table tbody tr, .b-list tbody tr"
  // union can match the same row twice through nested tables.
  let rows = $('.board-table tbody tr, .b-list-wrap tbody tr, .board-list tbody tr');
  if (rows.length === 0) rows = $('table tbody tr');

  rows.each((_, el) => {
    const $row = $(el);
    const link = $row.find('td.td-subject a, td.title a, td.subject a, .b-subject a, td a').first();
    const href = link.attr('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    const attrTitle = link.attr('title') || '';
    let rawTitle = link.find('strong').text() || link.text();
    if (attrTitle.length > rawTitle.length) rawTitle = attrTitle;
    const title = cleanTitle(rawTitle);

    let dateText = $row.find('td.td-date, td.date, td.b-date, .b-date').first().text().trim();
    if (!dateText) {
      $row.find('td').each((__, td) => {
        const t = $(td).text().trim();
        if (!dateText && parseBoardDate(t) !== null) dateText = t;
      });
    }
    if (!title || !dateText) return;

    const numText = $row.find('td').first().text().replace(/\s+/g, '');
    const pinned =
      $row.is('.notice, .b-top-box, .headline, [class*="notice"]') ||
      $row.find('td').first().find('img, .b-notice, .notice, .icon-notice').length > 0 ||
      !/^\d+$/.test(numText);

    const postedAt = parseBoardDate(dateText);
    if (postedAt !== null && !pinned && (oldestRegular === null || postedAt < oldestRegular)) oldestRegular = postedAt;

    let absolute: string;
    try {
      absolute = new URL(href, board.origin).toString();
    } catch {
      return;
    }
    const url = canonicalUrl(absolute, board.origin);
    const articleId = articleIdFromUrl(absolute);
    // Same id scheme as before for notices with an article number, so read
    // states saved by the old version still match.
    const id = articleId
      ? `${board.idPrefix}_${articleId}`
      : `${board.idPrefix}_h${hash(`${title}|${postedAt ?? dateText}`)}`;

    notices.push({ id, title, date: dateText.replace(/\s+/g, ''), postedAt, source: board.source, url, pinned });
  });

  return { notices, rowCount: rows.length, oldestRegular };
}

/** A real "next page" link when the board has one, otherwise ?page=N on the board URL. */
export function findNextPageUrl(html: string, currentPage: number, base: string): string {
  const $ = cheerio.load(html);
  const want = String(currentPage + 1);
  const baseOrigin = new URL(base).origin;
  let found: string | null = null;
  $('[class*="paging"] a, [class*="paginate"] a, .pagination a, ._paging a').each((_, el) => {
    if (found) return;
    const $el = $(el).clone();
    $el.find('.hide, .blind, .sr-only').remove();
    const text = $el.text().replace(/\s+/g, '');
    const href = $(el).attr('href') || '';
    if ((text === want || text === `[${want}]`) && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      try {
        const resolved = new URL(href, base);
        if (resolved.origin === baseOrigin) found = resolved.toString();
      } catch {}
    }
  });
  if (found) return found;
  const u = new URL(base);
  u.searchParams.set('page', want);
  return u.toString();
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PNUtify/2.0; +https://www.pnutify.app)' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Dedupe by id, then by (normalized title, date) — the same post can appear with two ids. */
export function dedupeNotices(list: ScrapedNotice[]): ScrapedNotice[] {
  const byId = new Map<string, ScrapedNotice>();
  const byKey = new Set<string>();
  for (const n of list) {
    const key = `${n.source}|${n.title.replace(/\s+/g, '').toLowerCase()}|${n.postedAt ?? n.date}`;
    const existing = byId.get(n.id);
    if (existing) {
      // Keep the pinned flag if any copy was pinned.
      if (n.pinned && !existing.pinned) byId.set(n.id, { ...existing, pinned: true });
      continue;
    }
    if (byKey.has(key)) continue;
    byKey.add(key);
    byId.set(n.id, n);
  }
  return [...byId.values()];
}

export type BoardResult = { source: NoticeSource; ok: boolean; notices: ScrapedNotice[] };

export async function scrapeBoard(board: Board, now = Date.now()): Promise<BoardResult> {
  const cutoff = now - WINDOW_DAYS * DAY_MS;
  const all: ScrapedNotice[] = [];
  const seenRegular = new Set<string>();

  let pageUrl = board.url;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchHtml(pageUrl);
    if (html === null) {
      // The first page failing means this board is down: report it, so the
      // caller doesn't treat every notice from it as "gone" and later "new".
      if (page === 1) return { source: board.source, ok: false, notices: [] };
      break;
    }

    const { notices, rowCount, oldestRegular } = parseBoardPage(html, board);
    if (rowCount === 0) break;

    let newRegular = 0;
    for (const n of notices) {
      if (n.pinned) {
        // Pinned posts repeat on every page; only take them from page 1.
        if (page === 1) all.push(n);
        continue;
      }
      if (seenRegular.has(n.id)) continue;
      seenRegular.add(n.id);
      newRegular++;
      if (n.postedAt === null || n.postedAt >= cutoff) all.push(n);
    }

    // If the board ignored ?page= and served page 1 again, stop instead of
    // looping over the same rows (this was a source of duplicates).
    if (newRegular === 0) break;
    if (oldestRegular !== null && oldestRegular < cutoff) break;
    pageUrl = findNextPageUrl(html, page, pageUrl);
  }

  return { source: board.source, ok: true, notices: dedupeNotices(all) };
}

export async function scrapeAllBoards(now = Date.now()): Promise<BoardResult[]> {
  return Promise.all(BOARDS.map((b) => scrapeBoard(b, now)));
}

export type FirstPageResult = { source: NoticeSource; ok: boolean; ids: string[] };

/**
 * Cheap change check: page 1 of a board only, returning the ids a full scrape
 * would keep (pinned posts, and regular posts inside the window). One request
 * per board, so it can run every minute without loading the university sites.
 */
export async function scrapeFirstPage(board: Board, now = Date.now()): Promise<FirstPageResult> {
  const html = await fetchHtml(board.url);
  if (html === null) return { source: board.source, ok: false, ids: [] };
  const { notices } = parseBoardPage(html, board);
  if (notices.length === 0) return { source: board.source, ok: false, ids: [] };
  const cutoff = now - WINDOW_DAYS * DAY_MS;
  const ids = notices.filter((n) => n.pinned || n.postedAt === null || n.postedAt >= cutoff).map((n) => n.id);
  return { source: board.source, ok: true, ids };
}

export async function checkFirstPages(now = Date.now()): Promise<FirstPageResult[]> {
  return Promise.all(BOARDS.map((b) => scrapeFirstPage(b, now)));
}

/**
 * True when the board may have cut this title off (see Board.titleCut), so the
 * full one should be read from the article page. One character of slack: a
 * cut that lands on a space loses it when the title is trimmed.
 */
export function mayBeCutOff(n: Pick<ScrapedNotice, 'title' | 'source'>): boolean {
  const board = BOARDS.find((b) => b.source === n.source);
  return board !== undefined && n.title.length >= board.titleCut - 1;
}

/** Full title from an article page, or null. Prefers the untagged hidden copy, which matches the list style. */
export function extractArticleTitle(html: string, listingTitle = ''): string | null {
  const $ = cheerio.load(html);
  const hidden = ($('#artclViewTitle').attr('value') || '').replace(/\s+/g, ' ').trim();
  const heading = $('.board-view .title strong, .view.viewCont .title strong').first().text().replace(/\s+/g, ' ').trim();
  let title = hidden || heading || null;

  if (!title && listingTitle) {
    const prefix = listingTitle.replace(/[.…]+$/, '').trim().slice(0, 15);
    if (prefix.length >= 4) {
      let best: string | null = null;
      $('strong, b, h1, h2, h3, h4, h5, dt, td, div, p, li, span').each((_, el) => {
        const text = $(el).text().trim().replace(/\s+/g, ' ');
        if (text.startsWith(prefix) && (!best || text.length < best.length)) best = text;
      });
      title = best;
    }
  }
  return title ? cleanTitle(title) : null;
}

/**
 * Full title for a notice whose listed title may be cut off. Returns the
 * listed title when the article page can't be read or doesn't agree with it.
 */
export async function fetchFullTitle(n: Pick<ScrapedNotice, 'title' | 'url'>): Promise<{ ok: boolean; title: string }> {
  const html = await fetchHtml(n.url);
  if (html === null) return { ok: false, title: n.title };
  const full = extractArticleTitle(html, n.title);
  const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  // The article title must contain the listed one; otherwise keep what we had.
  if (full && full.length > n.title.length && squash(full).includes(squash(n.title).slice(0, 30))) {
    return { ok: true, title: full };
  }
  return { ok: true, title: n.title };
}

/** Newest first; pinned notices stay in date order with everything else. */
export function sortNotices<T extends { postedAt: number | null; id: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0) || a.id.localeCompare(b.id));
}
