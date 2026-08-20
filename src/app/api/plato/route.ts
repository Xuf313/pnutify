import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    };

    const cookieJar: Record<string, string> = {};

    function updateCookies(res: Response) {
      const setCookies = res.headers.getSetCookie 
        ? res.headers.getSetCookie() 
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
        
      for (const c of setCookies) {
        const match = c.match(/^([^=;]+)=([^;]*)/);
        if (match) {
          cookieJar[match[1].trim()] = match[2].trim();
        }
      }
    }

    function getCookieString() {
      return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    // 1. Fetch Login Page
    const loginUrl = 'https://plato.pusan.ac.kr/login/index.php';
    const initialRes = await fetch(loginUrl, { headers, cache: 'no-store' });
    updateCookies(initialRes);
    
    const initialHtml = await initialRes.text();
    const $login = cheerio.load(initialHtml);
    
    const authParams = new URLSearchParams();
    authParams.append('username', username);
    authParams.append('password', password);
    
    const loginToken = $login('input[name="logintoken"]').val();
    if (loginToken) authParams.append('logintoken', loginToken as string);

    // 2. Submit Login
    const authRes = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': getCookieString(),
        'Origin': 'https://plato.pusan.ac.kr',
        'Referer': loginUrl,
      },
      body: authParams.toString(),
      redirect: 'manual',
      cache: 'no-store'
    });

    updateCookies(authRes);

    if (authRes.status === 200) {
        return NextResponse.json({ error: 'Invalid ID or Password. Please try again.' }, { status: 401 });
    }

    const redirectUrl = authRes.headers.get('location');
    if (redirectUrl && redirectUrl.includes('testsession')) {
        const testUrl = redirectUrl.startsWith('http') ? redirectUrl : `https://plato.pusan.ac.kr${redirectUrl}`;
        const testRes = await fetch(testUrl, {
            method: 'GET',
            headers: { ...headers, 'Cookie': getCookieString() },
            redirect: 'manual',
            cache: 'no-store'
        });
        updateCookies(testRes);
    }

    // 3. Fetch Dashboard
    const dashboardUrl = 'https://plato.pusan.ac.kr/'; 
    const dashRes = await fetch(dashboardUrl, {
      headers: { ...headers, 'Cookie': getCookieString() },
      cache: 'no-store'
    });
    
    const dashHtml = await dashRes.text();
    const $dash = cheerio.load(dashHtml);
    
    if ($dash('input[type="password"]').length > 0 || dashHtml.includes('login/index.php')) {
        return NextResponse.json({ error: 'Invalid ID or Password. Please try again.' }, { status: 401 });
    }

    const classes: any[] = [];
    const announcements: any[] = [];
    const tasks: any[] = [];

    $dash('.course-box').each((i, el) => {
      const titleElement = $dash(el).find('.course-title h3').clone();
      titleElement.find('.prof').remove(); 
      const name = titleElement.text().trim();
      const professor = $dash(el).find('.prof').text().trim(); 
      
      if (name) {
        classes.push({ 
          id: `cls_${i}`, 
          name: name, 
          location: professor || "PLATO", 
          time: "Online", 
          days: [1, 2, 3, 4, 5], 
          color: "bg-primary text-primary-foreground" 
        });
      }
    });

    $dash('.notice-item').each((i, el) => {
      const courseName = $dash(el).find('.coursename').text().trim();
      const title = $dash(el).find('.subject').text().trim();
      const dateStr = $dash(el).find('.date').text().trim(); 
      const href = $dash(el).find('.subject a, a.subject').attr('href') || $dash(el).find('a').first().attr('href');
      const url = href ? (href.startsWith('http') ? href : `https://plato.pusan.ac.kr${href.startsWith('/') ? '' : '/'}${href}`) : '';

      // ✅ FIX: Only push to the array if a specific course name exists! 
      // This naturally ignores site-wide PLATO ads and system notices.
      if (title && courseName) {
        announcements.push({
          id: `plato_ann_${i}`,
          title: `[${courseName}] ${title}`, 
          date: dateStr.split(' ')[0], 
          source: 'classes',
          url,
          status: 'unread'
        });
      }
    });

    const todoBlock = $dash('.block_timeline, .block_myoverview'); 
    if (!todoBlock.text().includes('계획된 일정이 없습니다.')) {
      todoBlock.find('.list-group-item, .event-list-item, li').each((i, el) => {
        const title = $dash(el).find('.event-name, .coursename').text().trim();
        const dueDate = $dash(el).find('.date, .time').text().trim();
        
        if (title) {
          tasks.push({
            id: `plato_task_${i}`,
            title,
            course: "PLATO",
            dueDate: new Date(dueDate).getTime() || Date.now(),
            status: 'pending'
          });
        }
      });
    }

    return NextResponse.json({ classes, announcements, tasks });

  } catch (error) {
    console.error('PLATO scraping error:', error);
    return NextResponse.json({ error: 'Failed to sync with PLATO. Network error.' }, { status: 500 });
  }
}
