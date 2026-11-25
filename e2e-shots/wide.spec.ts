import { test } from '@playwright/test';
import { mockApis, ownerData } from '../e2e/fixtures';

const OUT = process.env.SHOTS_OUT ?? 'e2e-shots/out';
const H = 3_600_000;

/** The Briefing's two-column front page on laptop and desktop widths, and a new device on a phone. */
for (const width of [1280, 1600]) {
  test(`briefing at ${width}px`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await page.setViewportSize({ width, height: 1000 });
    await mockApis(page, { owner: true });
    const data = ownerData();
    const now = Date.now();
    data.data.plato.data.announcements = [
      { id: 'platonews_1', title: '중간고사 강의실 변경 안내', course: '운영체제', author: 'Prof', postedAt: now - 2 * H, url: 'https://plato.pusan.ac.kr/mod/forum/discuss.php?d=1', excerpt: '안녕하세요, 운영체제 담당 김교수입니다. 중간고사 강의실이 201호에서 305호로 변경되었습니다. 시간은 그대로 오후 3시입니다.' },
      { id: 'platonews_2', title: '11/28(금) 휴강 및 보강 안내', course: '자료구조', author: 'TA', postedAt: now - 26 * H, url: 'https://plato.pusan.ac.kr/mod/forum/discuss.php?d=2', excerpt: '수강생 여러분 안녕하세요. 11월 28일 금요일 수업은 휴강입니다. 보강은 12월 3일 수요일 6교시에 진행합니다.' },
    ];
    await page.route('**/api/owner/data', (r) => r.fulfill({ json: data }));
    await page.addInitScript(() => {
      localStorage.setItem('owner_device_v1', 'true');
      localStorage.setItem('tasks_v3', JSON.stringify([
        { id: 't1', title: '강연 보고서 [12주차]', course: '진로탐색', dueDate: Date.now() + 26 * 3600e3, status: 'pending', createdAt: Date.now() - 86400e3 },
        { id: 't2', title: 'Linear algebra quiz', course: '선형대수', dueDate: Date.now() + 4 * 86400e3, status: 'pending', createdAt: Date.now() - 86400e3 },
      ]));
    });
    await page.goto('/');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/wide-${width}.png` });
    await page.screenshot({ path: `${OUT}/wide-${width}-full.png`, fullPage: true });
  });
}

test('new device on a phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone');
  await mockApis(page, { newDevice: true });
  await page.goto('/');
  await page.waitForTimeout(900);
  const card = page.locator('.brief-dept >> visible=true');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/phone-new-device.png` });
});
