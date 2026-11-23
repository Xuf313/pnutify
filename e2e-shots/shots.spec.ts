import { test } from '@playwright/test';
import { mockApis } from '../e2e/fixtures';

/** Screenshots of every screen, for design review. Not part of CI (separate config). */
const OUT = process.env.SHOTS_OUT ?? 'e2e-shots/out';
const tabs = ['briefing', 'notices', 'tasks', 'calendar'] as const;

for (const theme of (process.env.SHOTS_THEMES ?? 'pnu').split(',')) {
  test(`screens ${theme}`, async ({ page }, info) => {
    await mockApis(page, { owner: true });
    await page.addInitScript((t) => {
      localStorage.setItem('theme_v1', t);
      localStorage.setItem('owner_device_v1', 'true');
      localStorage.setItem('boards_v1', JSON.stringify(['cse', 'international', 'math']));
      localStorage.setItem('tasks_v3', JSON.stringify([
        { id: 't1', title: 'OS homework 3', course: '운영체제', dueDate: Date.now() + 26 * 3600e3, status: 'pending', createdAt: Date.now() - 86400e3 },
        { id: 't2', title: 'Linear algebra quiz', course: '선형대수', dueDate: Date.now() + 4 * 86400e3, status: 'pending', createdAt: Date.now() - 86400e3 },
        { id: 't3', title: 'Submit lab report', course: 'General', dueDate: Date.now() - 86400e3, status: 'completed', createdAt: Date.now() - 3 * 86400e3 },
      ]));
    }, theme);
    const p = info.project.name;
    for (const tab of tabs) {
      await page.goto(`/?tab=${tab}`);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/${p}-${theme}-${tab}.png`, fullPage: true });
    }
    await page.goto('/?tab=notices');
    await page.waitForTimeout(600);
    await page.locator('main >> visible=true').getByText('[장학] 국가장학금 신청 안내').first().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${p}-${theme}-notice.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Settings/ }).filter({ visible: true }).first().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${p}-${theme}-settings.png` });
  });
}
