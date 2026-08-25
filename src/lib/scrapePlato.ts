import * as cheerio from 'cheerio';

export type PlatoResult =
  | { ok: true; classes: any[]; announcements: any[]; tasks: any[] }
  | { ok: false; error: string };

export async function loginAndScrapePlato(username: string, password: string): Promise<PlatoResult> {
  try {
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
      return { ok: false, error: 'Invalid ID or Password. Please try again.' };
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
      return { ok: false, error: 'Invalid ID or Password. Please try again.' };
    }

    const classes: any[] = [];
    const announcements: any[] = [];
    const tasks: any[] = [];

    // 4. Parse Enrolled Courses (new Splide-carousel UI)
    $dash('ul.course-lists > li.splide__slide').each((i, el) => {
      const linkTag = $dash(el).find('a.course-card');
      const url = linkTag.attr('href');

      if (url) {
        const rawText = linkTag.text().trim().replace(/\s+/g, ' ');
        const afterUndergrad = rawText.split('Undergraduate').pop()?.trim() || '';
        // Course title always ends in a "(NNN)" section code — split there
        // instead of grabbing everything after "Undergraduate", which was
        // swallowing the professor name into the course name.
        const titleMatch = afterUndergrad.match(/^(.*?\([0-9]+\))/);
        const courseName = titleMatch ? titleMatch[1].trim() : (afterUndergrad || 'Unknown Course');
        let professor = titleMatch ? afterUndergrad.slice(titleMatch[0].length).trim() : '';
        // The avatar circle's initial letter gets concatenated onto the front
        // of the professor's name in the flattened text — strip it off.
        professor = professor.replace(/^(.)\s*(?=\1)/, '').trim();
        const idMatch = url.match(/id=(\d+)/);

        classes.push({
          id: idMatch ? idMatch[1] : `cls_${i}`,
          name: courseName,
          location: professor || "PLATO",
          time: "Online",
          days: [1, 2, 3, 4, 5],
          color: i % 2 === 0 ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
          url
        });
      }
    });

    // 5. Parse Announcements (new board-list UI). Scoped to the
    // course-linked announcements container only — the site-wide/system
    // announcements block sits in a separate container and isn't something
    // tied to a specific class, so it's excluded the same way the old
    // Moodle-based scraper intentionally ignored system notices.
    $dash('.announcement-item-course .csms-board-item').each((i, el) => {
      const course = $dash(el).find('.coursename').text().trim();
      const linkTag = $dash(el).find('a.btn-csms-link');
      const title = linkTag.find('.text').text().trim();
      const url = linkTag.attr('href');
      const date = $dash(el).find('.csms-board-item-date').text().trim();

      if (title && url) {
        const idMatch = url.match(/id=(\d+)/);
        const id = idMatch ? `plato_ann_${idMatch[1]}` : `plato_ann_${Date.now()}_${i}`;

        announcements.push({
          id,
          title: course ? `[${course}] ${title}` : title,
          date: date || new Date().toISOString(),
          source: 'classes',
          url,
          status: 'unread'
        });
      }
    });

    // 6. Parse Tasks / Progress (new accordion-per-course UI). Note: the
    // per-task rows inside an expanded accordion aren't confirmed (every
    // example we've seen so far has a count of 0), so this synthesizes one
    // placeholder task per course with a pending count, due in 24h. Revisit
    // once a course actually shows a nonzero count.
    $dash('.accordion-item').each((i, el) => {
      const course = $dash(el).find('.csms-user-picture .text-truncate').text().trim();
      // Real class is "cell-upcoming-count" (a second token alongside
      // "grid-cell"), not "grid-cell-upcoming-count" as one combined class.
      const countText = $dash(el).find('.cell-upcoming-count .count').text().trim();
      const count = parseInt(countText, 10);

      if (course && !isNaN(count) && count > 0) {
        tasks.push({
          id: `plato_task_${course.replace(/\s+/g, '_')}_${Date.now()}`,
          title: `${count} pending task${count > 1 ? 's' : ''}`,
          course: course,
          dueDate: new Date(Date.now() + 86400000).getTime(), // Sets exactly 24 hours into the future
          source: 'plato',
          status: 'pending'
        });
      }
    });

    return { ok: true, classes, announcements, tasks };
  } catch (error) {
    console.error('PLATO scraping error:', error);
    return { ok: false, error: 'Failed to sync with PLATO. Network error.' };
  }
}