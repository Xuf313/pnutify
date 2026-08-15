import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export async function GET() {
  try {
    const scrapedNotices: { id: number; title: string; date: string; source: string; status: string; }[] = [];
    let idCounter = 1;

    // 1. Scrape CSE Notice Board
    const cseRes = await fetch('https://cse.pusan.ac.kr/cse/14221/subview.do', { cache: 'no-store' });
    if (cseRes.ok) {
      const $cse = cheerio.load(await cseRes.text());
      $cse('table tbody tr').each((_, el) => {
        const title = $cse(el).find('td.title a, td.td-subject a').text().trim() || $cse(el).find('td').eq(1).text().trim();
        const date = $cse(el).find('td.date, td.td-date').text().trim() || $cse(el).find('td').eq(3).text().trim();
        if (title && date) scrapedNotices.push({ id: idCounter++, title: title.replace(/\s+/g, ' '), date, source: 'cse', status: 'unread' });
      });
    }

    // 2. Scrape International Office (OIA) Notice Board
    const intlRes = await fetch('https://international.pusan.ac.kr/international/15225/subview.do', { cache: 'no-store' });
    if (intlRes.ok) {
      const $intl = cheerio.load(await intlRes.text());
      $intl('table tbody tr').each((_, el) => {
        const title = $intl(el).find('td.title a, td.td-subject a').text().trim() || $intl(el).find('td').eq(1).text().trim();
        const date = $intl(el).find('td.date, td.td-date').text().trim() || $intl(el).find('td').eq(3).text().trim();
        if (title && date) scrapedNotices.push({ id: idCounter++, title: title.replace(/\s+/g, ' '), date, source: 'international', status: 'unread' });
      });
    }

    return NextResponse.json({ notices: scrapedNotices });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch notices' }, { status: 500 });
  }
}