import { expect, mockApis, test, visible } from './fixtures';

// The owner's view, with the owner API answered by test data.
test.beforeEach(async ({ page }) => {
  await mockApis(page, { owner: true });
});

test('PLATO and NESPA show up in the Briefing and Tasks', async ({ page }) => {
  await page.goto('/');
  const brief = visible(page, '.brief');
  await expect(brief.getByText('Lab 7 report').first()).toBeVisible();
  // The newest course post leads "Push your work forward" and is item 01 in New updates.
  await expect(brief.locator('.brief-push__topic')).toHaveText('중간고사 강의실 변경 안내');
  await expect(brief.locator('.brief-item').first()).toContainText('중간고사 강의실 변경 안내');

  await page.goto('/?tab=tasks');
  const main = visible(page, 'main');
  await expect(main.getByText('synced across your devices')).toBeVisible();
  await expect(main.getByText(/PLATO · 운영체제/)).toBeVisible();
  // PLATO items can be opened but not edited or deleted.
  await expect(main.getByRole('button', { name: 'Delete "Lab 7 report"' })).toHaveCount(0);
});

test('Clear done also clears finished PLATO and NESPA items', async ({ page }) => {
  await page.goto('/?tab=tasks');
  const main = visible(page, 'main');
  await main.getByRole('button', { name: 'Mark "Lab 7 report" as done' }).click();
  await expect(main.getByRole('heading', { name: /^Done \(2\)$/i })).toBeVisible(); // Lab 7 + the graded NESPA one

  const synced = page.waitForRequest((r) => r.url().endsWith('/api/owner/state') && /"cleared":true/.test(r.postData() ?? ''));
  await main.getByRole('button', { name: 'Clear done' }).click();
  await synced;
  await expect(main.getByText('Lab 7 report')).toHaveCount(0);
  await expect(main.getByText(/BTS machine/)).toHaveCount(0);
});
