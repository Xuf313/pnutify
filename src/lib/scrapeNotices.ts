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
  const clean = dateStr.replace(/\./g, '-');
  const d = new Date(clean);
  return isNaN(d.getTime()) ? null : d;
};

const cleanTitle = (t: string) => t.replace(/새글/g, '').replace(/\s+/g, ' ').trim();

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
  
  const rows = $('table tbody tr, .b-list tbody tr, .board-list tbody tr');

  rows.each((_, el) => {
    const $row = $(el);
    
    // Extract Title & URL
    const titleEl = $row.find('td.title a, td.td-subject a, td.b-td-left a, td a, .b-subject a').first();
    const possibleTitleAttr = titleEl.attr('title') || $row.find('[title]').attr('title') || '';
    let rawTitle = titleEl.text() || $row.find('td').eq(1).text();
    if (possibleTitleAttr && possibleTitleAttr.length > rawTitle.length) rawTitle = possibleTitleAttr;

    const title = cleanTitle(rawTitle);
    const href = titleEl.attr('href') || '';
    const url = href ? (href.startsWith('http') ? href : `${origin}${href}`) : '';
    
    // Extract Date
    let dateText = $row.find('td.date, td.td-date, td.b-date, .b-date').text().trim();
    if (!dateText) {
       dateText = $row.find('td').eq(3).text().trim();
    }
    
    if (!title || !dateText) return;

    // VERY STRICT Pinned Check: 
    // If the first column isn't perfectly numerical, it is considered pinned.
    const firstCol = $row.find('td').first();
    const numText = firstCol.text().replace(/\s+/g, '');
    const hasIcon = firstCol.find('img, .b-notice').length > 0;
    const isPinned = $row.hasClass('b-top-box') || $row.hasClass('notice') || hasIcon || !/^\d+$/.test(numText);

    const parsed = parseDate(dateText);
    
    // Crucial: Only NON-pinned dates update the oldestDate tracking variable!
    if (parsed && !isPinned) {
      if (!oldestDate || parsed < oldestDate) {
        oldestDate = parsed;
      }
    }

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

function findNextPageUrl($: cheerio.CheerioAPI, currentPage: number, base: string): string | null {
  const wantText = String(currentPage + 1);
  const baseOrigin = new URL(base).origin;
  const allLinks = $('a').toArray();

  const resolveSameOrigin = (href: string): string | null => {
    try {
      const resolved = new URL(href, base);
      // Board pagination never legitimately crosses to a different
      // subdomain — a numbered link that does is unrelated site chrome
      // (nav, footer, cross-department links), not a real "next page".
      return resolved.origin === baseOrigin ? resolved.toString() : null;
    } catch {
      return null;
    }
  };
  
  // 1. Direct text match
  for (const el of allLinks) {
    const $el = $(el).clone();
    
    // Ignore links buried inside actual article content text
    if ($(el).closest('.b-content-box, .artcl-content').length > 0) continue;

    $el.find('.hide, .blind, .sr-only').remove();
    const text = $el.text().replace(/\s+/g, '');
    
    // Accepts '2' or '[2]'
    if (text === wantText || text === `[${wantText}]`) {
      const href = $(el).attr('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        const resolved = resolveSameOrigin(href);
        if (resolved) return resolved;
      }
    }
  }

  // 2. Button block fallback (e.g., 'Next')
  for (const el of allLinks) {
    const $el = $(el);
    if ($el.closest('[class*="paging"], [class*="paginate"], .pagination, .b-paging-wrap').length > 0) {
      const text = $el.text().trim().toLowerCase();
      const title = ($el.attr('title') || '').toLowerCase();
      const aria = ($el.attr('aria-label') || '').toLowerCase();
      
      if (text.includes('다음') || text.includes('next') || title.includes('다음') || aria.includes('다음')) {
        const href = $el.attr('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          const resolved = resolveSameOrigin(href);
          if (resolved) return resolved;
        }
      }
    }
  }
  
  return null;
}

async function scrapeBoardPaginated(baseUrl: string, source: 'cse' | 'international', origin: string, idPrefix: string): Promise<ScrapedNotice[]> {
  const all: ScrapedNotice[] = [];
  let pageUrl = baseUrl;

  for (let page = 1; page <= MAX_PAGES; page++) {
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

    // Stop if table was completely empty
    if (rowCount === 0) break;
    
    // Stop if normal notices successfully reached past the cut-off date limits
    if (oldestDate && oldestDate < CUTOFF) break;

    const next = findNextPageUrl($, page, pageUrl);
    if (next) {
      pageUrl = next;
    } else {
      // 3. Ultimate Fallback: If pagination links use JavaScript that Cheerio cannot click,
      // force navigation natively by injecting `page` params into the target board.
      const u = new URL(pageUrl);
      u.searchParams.set('page', String(page + 1));
      pageUrl = u.toString();
    }
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

  const combined = [...cseNotices, ...intlNotices];
  const seen = new Set<string>();
  const deduped: ScrapedNotice[] = [];
  for (const notice of combined) {
    if (seen.has(notice.id)) continue;
    seen.add(notice.id);
    deduped.push(notice);
  }
  return deduped;
}