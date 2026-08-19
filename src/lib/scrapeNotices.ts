import * as cheerio from 'cheerio';

export type ScrapedNotice = {
  id: string;
  title: string;
  date: string;
  source: 'cse' | 'international';
  url: string;
  status: string;
};

const isFromAugustOnwards = (dateStr: string) => {
  const cleanDate = dateStr.replace(/\./g, '-');
  const noticeDate = new Date(cleanDate);
  const cutoffDate = new Date('2026-08-01');
  return noticeDate >= cutoffDate || dateStr.includes('2026.08') || dateStr.includes('2026-08');
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

function scrapeBoard($: cheerio.CheerioAPI, source: 'cse' | 'international', origin: string, idPrefix: string): ScrapedNotice[] {
  const notices: ScrapedNotice[] = [];
  let idCounter = 1;

  $('table tbody tr').each((_, el) => {
    const $row = $(el);
    const titleEl = $row.find('td.title a, td.td-subject a, td a').first();

    const possibleTitleAttr = titleEl.attr('title') || $row.find('[title]').attr('title') || '';
    let rawTitle = titleEl.text() || $row.find('td').eq(1).text();
    if (possibleTitleAttr && possibleTitleAttr.length > rawTitle.length) rawTitle = possibleTitleAttr;

    const title = cleanTitle(rawTitle);
    const href = titleEl.attr('href');
    const url = href ? (href.startsWith('http') ? href : `${origin}${href}`) : '';
    const date = $row.find('td.date, td.td-date').text().trim() || $row.find('td').eq(3).text().trim();

    if (title && date && isFromAugustOnwards(date)) {
      const stableId = url ? extractId(url) : null;
      notices.push({
        id: stableId ? `${idPrefix}_${stableId}` : `${idPrefix}_${idCounter++}`,
        title,
        date,
        source,
        url,
        status: 'unread',
      });
    }
  });

  return notices;
}

export async function scrapeAllNotices(): Promise<ScrapedNotice[]> {
  const cseUrl = 'https://cse.pusan.ac.kr/cse/14221/subview.do';
  const intlUrl = 'https://international.pusan.ac.kr/international/15224/subview.do';

  const [cseRes, intlRes] = await Promise.all([
    fetch(cseUrl, { next: { revalidate: 300 } }),
    fetch(intlUrl, { next: { revalidate: 300 } }),
  ]);

  const notices: ScrapedNotice[] = [];

  if (cseRes.ok) {
    const $cse = cheerio.load(await cseRes.text());
    notices.push(...scrapeBoard($cse, 'cse', 'https://cse.pusan.ac.kr', 'cse'));
  }
  if (intlRes.ok) {
    const $intl = cheerio.load(await intlRes.text());
    notices.push(...scrapeBoard($intl, 'international', 'https://international.pusan.ac.kr', 'intl'));
  }

  return notices;
}
