import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    // 1. Fetch Login Page to get the hidden Moodle login token
    const loginUrl = 'https://plato.pusan.ac.kr/login.php';
    const initialRes = await fetch(loginUrl);
    const initialHtml = await initialRes.text();
    
    const $login = cheerio.load(initialHtml);
    const loginToken = $login('input[name="logintoken"]').val();
    const initialCookies = initialRes.headers.get('set-cookie') || '';

    // 2. Submit Login Credentials
    const authParams = new URLSearchParams();
    authParams.append('username', username);
    authParams.append('password', password);
    if (typeof loginToken === 'string') authParams.append('logintoken', loginToken);

    const authRes = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': initialCookies,
      },
      body: authParams.toString(),
      redirect: 'manual'
    });

    const authCookies = authRes.headers.get('set-cookie') || initialCookies;

    // 3. Fetch Dashboard HTML
    const dashboardUrl = 'https://plato.pusan.ac.kr/'; 
    const dashRes = await fetch(dashboardUrl, {
      headers: { 'Cookie': authCookies }
    });
    
    const dashHtml = await dashRes.text();
    const $dash = cheerio.load(dashHtml);

    // 4. Extract Data Arrays
    const classes: any[] = [];
    const announcements: any[] = [];
    const tasks: any[] = [];

    // --- A. Scrape Classes ("나의강좌") ---
    $dash('.course-box').each((i, el) => {
      // Target the h3 element containing the title
      const titleElement = $dash(el).find('.course-title h3').clone();
      
      // Remove the professor span from our clone so it doesn't mix with the title text
      titleElement.find('.prof').remove(); 
      const name = titleElement.text().trim();
      
      // Grab the professor name separately
      const professor = $dash(el).find('.prof').text().trim(); 
      
      if (name) {
        classes.push({ 
          id: `cls_${i}`, 
          name: name, 
          location: professor || "PLATO", 
          time: "Online", 
          days: [1, 2, 3, 4, 5], 
          color: "bg-[#81B29A] text-white" 
        });
      }
    });

    // --- B. Scrape Course Announcements ("진행강좌공지") ---
    $dash('.notice-item').each((i, el) => {
      const courseName = $dash(el).find('.coursename').text().trim();
      const title = $dash(el).find('.subject').text().trim();
      const dateStr = $dash(el).find('.date').text().trim(); 

      if (title) {
        announcements.push({
          id: `plato_ann_${i}`,
          title: `[${courseName}] ${title}`, 
          date: dateStr.split(' ')[0], 
          source: 'classes',
          status: 'unread'
        });
      }
    });

    // --- C. Scrape To-Dos ("예정된 할일") ---
    // Using fallback Moodle classes since the board is currently empty
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

    // 5. Return JSON payload to frontend
    return NextResponse.json({ 
      classes, 
      announcements, 
      tasks 
    });

  } catch (error) {
    console.error('PLATO scraping error:', error);
    return NextResponse.json({ error: 'Failed to sync with PLATO' }, { status: 500 });
  }
}