import { test } from '@playwright/test';
import { mockApis } from '../e2e/fixtures';

const OUT = process.env.SHOTS_OUT ?? 'e2e-shots/out';

/** The PLATO deadlines section in Settings, before and after linking. */
test('plato calendar section', async ({ page }, info) => {
  await mockApis(page);
  const now = Date.now();
  const calendar = { checkedAt: now - 3 * 60_000, okAt: now, error: null, deadlines: [{ id: 'platocal_a', title: 'OS HW 3', course: '운영체제', dueAt: now + 2 * 86_400_000, firstSeen: now }, { id: 'platocal_b', title: 'Quiz 2', course: '자료구조', dueAt: now + 5 * 86_400_000, firstSeen: now }] };
  let linked = false;
  await page.route('**/api/plato-calendar**', (r) => {
    if (r.request().method() === 'POST') {
      linked = true;
      return r.fulfill({ json: { key: 'k'.repeat(24), calendar } });
    }
    return linked ? r.fulfill({ json: { calendar } }) : r.fulfill({ status: 404, json: {} });
  });
  await page.goto('/?tab=tasks');
  await page.getByRole('button', { name: /^Settings/ }).filter({ visible: true }).first().click();
  const section = page.locator('section[aria-labelledby="plato-calendar"]');
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: `${OUT}/${info.project.name}-calendar-before.png` });
  await section.getByLabel('PLATO calendar link').fill('https://plato.pusan.ac.kr/calendar/export_execute.php?userid=1&authtoken=0123456789abcdef0123456789abcdef01234567');
  await section.getByRole('button', { name: 'Link PLATO' }).click();
  await page.waitForTimeout(400);
  await section.screenshot({ path: `${OUT}/${info.project.name}-calendar-after.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${info.project.name}-calendar-tasks.png` });
});
