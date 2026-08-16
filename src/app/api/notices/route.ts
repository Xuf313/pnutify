import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export async function GET() {
  try {
    const scrapedNotices: { id: string; title: string; date: string; source: string; url: string; status: string; }[] = [];
    let idCounter = 1;

    // Filter helper: Only keep notices from August 2026 onwards
    const isFromAugustOnwards = (dateStr: string) => {
      const cleanDate = dateStr.replace(/\./g, '-');
      const noticeDate = new Date(cleanDate);
      const cutoffDate = new Date('2026-08-01');
      return noticeDate >= cutoffDate || dateStr.includes('2026.08') || dateStr.includes('2026-08');
    };

    // 1. Scrape CSE Notice Board (Updated URL)
    const cseUrl = 'https://cse.pusan.ac.kr/cse/14221/subview.do?enc=Zm5jdDF8QEB8JTJGYmJzJTJGY3NlJTJGMjA1NSUyRmFydGNsTGlzdC5kbyUzRg%3D%3D';
    const cseRes = await fetch(cseUrl, { cache: 'no-store' });
    
    if (cseRes.ok) {
      const $cse = cheerio.load(await cseRes.text());
      $cse('table tbody tr').each((_, el) => {
        const titleEl = $cse(el).find('td.title a, td.td-subject a, td a').first();
        const title = titleEl.text().trim() || $cse(el).find('td').eq(1).text().trim();
        const href = titleEl.attr('href');
        const url = href ? (href.startsWith('http') ? href : `https://cse.pusan.ac.kr${href}`) : '';
        const date = $cse(el).find('td.date, td.td-date').text().trim() || $cse(el).find('td').eq(3).text().trim();
        
        if (title && date && isFromAugustOnwards(date)) {
          scrapedNotices.push({ 
            id: `cse_${idCounter++}`, 
            title: title.replace(/\s+/g, ' '), 
            date, 
            source: 'cse', 
            url, 
            status: 'unread' 
          });
        }
      });
    }

    // 2. Scrape International Office (OIA) Notice Board (Updated URL)
    const intlUrl = 'https://international.pusan.ac.kr/international/15224/subview.do';
    const intlRes = await fetch(intlUrl, { cache: 'no-store' });
    
    if (intlRes.ok) {
      const $intl = cheerio.load(await intlRes.text());
      $intl('table tbody tr').each((_, el) => {
        const titleEl = $intl(el).find('td.title a, td.td-subject a, td a').first();
        const title = titleEl.text().trim() || $intl(el).find('td').eq(1).text().trim();
        const href = titleEl.attr('href');
        const url = href ? (href.startsWith('http') ? href : `https://international.pusan.ac.kr${href}`) : '';
        const date = $intl(el).find('td.date, td.td-date').text().trim() || $intl(el).find('td').eq(3).text().trim();
        
        if (title && date && isFromAugustOnwards(date)) {
          scrapedNotices.push({ 
            id: `intl_${idCounter++}`, 
            title: title.replace(/\s+/g, ' '), 
            date, 
            source: 'international', 
            url, 
            status: 'unread' 
          });
        }
      });
    }

    return NextResponse.json({ notices: scrapedNotices });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch notices' }, { status: 500 });
  }
}