import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export async function GET() {
  try {
    const scrapedNotices: { id: string; title: string; date: string; source: string; url: string; status: string; }[] = [];
    let idCounter = 1;

    const isFromAugustOnwards = (dateStr: string) => {
      const cleanDate = dateStr.replace(/\./g, '-');
      const noticeDate = new Date(cleanDate);
      const cutoffDate = new Date('2026-08-01');
      return noticeDate >= cutoffDate || dateStr.includes('2026.08') || dateStr.includes('2026-08');
    };

    const cleanTitle = (t: string) => t.replace(/새글/g, '').replace(/\s+/g, ' ').trim();

    // 1. Scrape CSE Notice Board
    const cseUrl = 'https://cse.pusan.ac.kr/cse/14221/subview.do';
    const cseRes = await fetch(cseUrl, { cache: 'no-store' });
    
    if (cseRes.ok) {
      const $cse = cheerio.load(await cseRes.text());
      $cse('table tbody tr').each((_, el) => {
        const $row = $cse(el);
        const titleEl = $row.find('td.title a, td.td-subject a, td a').first();
        
        // Aggressively hunt for the hidden full title attribute
        const possibleTitleAttr = titleEl.attr('title') || $row.find('[title]').attr('title') || '';
        let rawTitle = titleEl.text() || $row.find('td').eq(1).text();
        
        // If the hidden title is longer than the visible text, use it!
        if (possibleTitleAttr && possibleTitleAttr.length > rawTitle.length) {
          rawTitle = possibleTitleAttr;
        }
        
        const title = cleanTitle(rawTitle);
        const href = titleEl.attr('href');
        const url = href ? (href.startsWith('http') ? href : `https://cse.pusan.ac.kr${href}`) : '';
        const date = $row.find('td.date, td.td-date').text().trim() || $row.find('td').eq(3).text().trim();
        
        if (title && date && isFromAugustOnwards(date)) {
          scrapedNotices.push({ id: `cse_${idCounter++}`, title, date, source: 'cse', url, status: 'unread' });
        }
      });
    }

    // 2. Scrape International Office (OIA) Notice Board
    const intlUrl = 'https://international.pusan.ac.kr/international/15224/subview.do';
    const intlRes = await fetch(intlUrl, { cache: 'no-store' });
    
    if (intlRes.ok) {
      const $intl = cheerio.load(await intlRes.text());
      $intl('table tbody tr').each((_, el) => {
        const $row = $intl(el);
        const titleEl = $row.find('td.title a, td.td-subject a, td a').first();
        
        // Aggressively hunt for the hidden full title attribute
        const possibleTitleAttr = titleEl.attr('title') || $row.find('[title]').attr('title') || '';
        let rawTitle = titleEl.text() || $row.find('td').eq(1).text();
        
        if (possibleTitleAttr && possibleTitleAttr.length > rawTitle.length) {
          rawTitle = possibleTitleAttr;
        }

        const title = cleanTitle(rawTitle);
        const href = titleEl.attr('href');
        const url = href ? (href.startsWith('http') ? href : `https://international.pusan.ac.kr${href}`) : '';
        const date = $row.find('td.date, td.td-date').text().trim() || $row.find('td').eq(3).text().trim();
        
        if (title && date && isFromAugustOnwards(date)) {
          scrapedNotices.push({ id: `intl_${idCounter++}`, title, date, source: 'international', url, status: 'unread' });
        }
      });
    }

    return NextResponse.json({ notices: scrapedNotices });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch notices' }, { status: 500 });
  }
}