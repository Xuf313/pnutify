import { test } from '@playwright/test';
import { mockApis, ownerData } from '../e2e/fixtures';

const OUT = process.env.SHOTS_OUT ?? 'e2e-shots/out';
const H = 3_600_000;

/** The Briefing's "From your classes" with a realistic week of announcements. */
test('classes section', async ({ page }, info) => {
  await mockApis(page, { owner: true });
  const data = ownerData();
  const now = Date.now();
  data.data.plato.data.announcements = [
    { id: 'platonews_1', title: '중간고사 강의실 변경 안내', course: '운영체제', author: 'Prof', postedAt: now - 2 * H, url: 'https://plato.pusan.ac.kr/mod/forum/discuss.php?d=1', excerpt: '안녕하세요, 운영체제 담당 김교수입니다. 중간고사 강의실이 201호에서 305호로 변경되었습니다. 시간은 그대로 오후 3시입니다.' },
    { id: 'platonews_2', title: '11/28(금) 휴강 및 보강 안내', course: '자료구조', author: 'TA', postedAt: now - 26 * H, url: 'https://plato.pusan.ac.kr/mod/forum/discuss.php?d=2', excerpt: '수강생 여러분 안녕하세요. 11월 28일 금요일 수업은 휴강입니다. 보강은 12월 3일 수요일 6교시에 진행합니다.' },
    { id: 'platonews_3', title: 'Lab 7 report template updated', course: '운영체제', author: 'TA', postedAt: now - 3 * 24 * H, url: 'https://plato.pusan.ac.kr/mod/forum/discuss.php?d=3', excerpt: 'Hello everyone. The Lab 7 template now includes a section for the scheduler results. Please use the new version.' },
  ];
  await page.route('**/api/owner/data', (r) => r.fulfill({ json: data }));
  await page.addInitScript(() => localStorage.setItem('notice_read_v3', JSON.stringify(['platonews_3'])));
  await page.goto('/');
  await page.waitForTimeout(900);
  const brief = page.locator('.brief >> visible=true');
  await brief.locator('.brief-clip').screenshot({ path: `${OUT}/${info.project.name}-classes-top.png` });
  const section = brief.locator('section[aria-labelledby="brief-classes"]');
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: `${OUT}/${info.project.name}-classes.png` });
});
