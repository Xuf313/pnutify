import * as cheerio from 'cheerio';

export type ScrapedNotice = {
  id: string;
  title: string;
  date: string;
  source: 'cse' | 'international';
  url: string;
  status: string;
};

const CUTOFF = new Date('2026-08-01');
const MAX_PAGES = 6;

const isFromAugustOnwards = (dateStr: string) => {
  const cleanDate = dateStr.replace(/\./g, '-');
  const noticeDate = new Date(cleanDate);
  return noticeDate >= CUTOFF || dateStr.includes('2026.08') || dateStr.includes('2026-08');
};

const parseDate = (dateStr: string): Date | null => {
  const d = new Date(dateStr.replace(/\./g, '-'));
  return isNaN(d.getTime()) ? null : d;
};

const cleanTitle = (t: string) => t.replace(/새글/g, '').replace(/\s+/g, ' ').trim();

// Derive a stable ID from the article URL (survives re-scrapes) instead of a
// per-request counter.
const extractId = (url: string): string | null => {
  const direct = url.match(/\/(\d+)\/(\d+)\/artclView\.do/);
  if (direct) return direct[2];
  const encMatch = url.match(/[?&]enc=([^&]+)/);
  if (encMatch) {
    try {
      const decoded = decodeURIComponent(Buffer.from(decodeURIComponent(encMatch[1]), 'base64').toString('utf-8'));
      const inner = decoded.match(/\/(\d+)\/(\d+)\/artclView\.do/);
      if (inner) return inner[2];
    } catch {}
  }
  return null;
};

function scrapePage($: cheerio.CheerioAPI, source: 'cse' | 'international', origin: string, idPrefix: string, page: number): { notices: ScrapedNotice[]; oldestDate: Date | null; rowCount: number } {
  const notices: ScrapedNotice[] = [];
  let idCounter = 1;
  let oldestDate: Date | null = null;
  const rows = $('table tbody tr');

  rows.each((_, el) => {
    const $row = $(el);
    const titleEl = $row.find('td.title a, td.td-subject a, td a').first();

    const possibleTitleAttr = titleEl.attr('title') || $row.find('[title]').attr('title') || '';
    let rawTitle = titleEl.text() || $row.find('td').eq(1).text();
    if (possibleTitleAttr && possibleTitleAttr.length > rawTitle.length) rawTitle = possibleTitleAttr;

    const title = cleanTitle(rawTitle);
    const href = titleEl.attr('href');
    const url = href ? (href.startsWith('http') ? href : `${origin}${href}`) : '';
    const dateText = $row.find('td.date, td.td-date').text().trim() || $row.find('td').eq(3).text().trim();
    if (!title || !dateText) return;

    const parsed = parseDate(dateText);
    if (parsed && (!oldestDate || parsed < oldestDate)) oldestDate = parsed;

    if (isFromAugustOnwards(dateText)) {
      const stableId = url ? extractId(url) : null;
      notices.push({
        id: stableId ? `${idPrefix}_${stableId}` : `${idPrefix}_p${page}_${idCounter++}`,
        title,
        date: dateText,
        source,
        url,
        status: 'unread',
      });
    }
  });

  return { notices, oldestDate, rowCount: rows.length };
}

async function scrapeBoardPaginated(baseUrl: string, source: 'cse' | 'international', origin: string, idPrefix: string): Promise<ScrapedNotice[]> {
  const all: ScrapedNotice[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = page === 1 ? baseUrl : `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${page}`;
    let html: string;
    try {
      const res = await fetch(pageUrl, { next: { revalidate: 300 } });
      if (!res.ok) break;
      html = await res.text();
    } catch {
      break;
    }

    const $ = cheerio.load(html);
    const { notices, oldestDate, rowCount } = scrapePage($, source, origin, idPrefix, page);
    all.push(...notices);

    // Stop once the board runs out of rows, or once we've scrolled back
    // past the cutoff date (older pages only get older from here).
    if (rowCount === 0) break;
    if (oldestDate && oldestDate < CUTOFF) break;
  }

  return all;
}

export async function scrapeAllNotices(): Promise<ScrapedNotice[]> {
  const cseUrl = 'https://cse.pusan.ac.kr/cse/14221/subview.do';
  const intlUrl = 'https://international.pusan.ac.kr/international/15224/subview.do';

  const [cseNotices, intlNotices] = await Promise.all([
    scrapeBoardPaginated(cseUrl, 'cse', 'https://cse.pusan.ac.kr', 'cse'),
    scrapeBoardPaginated(intlUrl, 'international', 'https://international.pusan.ac.kr', 'intl'),
  ]);

  return [...cseNotices, ...intlNotices];
}
