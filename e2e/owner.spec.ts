import { expect, mockApis, ownerData, test, visible } from './fixtures';

// The owner's view, with the owner API answered by test data.
test.beforeEach(async ({ page }) => {
  await mockApis(page, { owner: true });
});

test('PLATO and NESPA show up in the Briefing and Tasks', async ({ page }) => {
  await page.goto('/');
  const brief = visible(page, '.brief');
  await expect(brief.getByText('Lab 7 report').first()).toBeVisible();
  // The newest course post leads "Push your work forward".
  await expect(brief.locator('.brief-push__topic')).toHaveText('중간고사 강의실 변경 안내');
  // Class announcements have their own section, with a one-line summary, and a line in the summary up top.
  const classes = brief.locator('section[aria-labelledby="brief-classes"]');
  await expect(classes.getByRole('heading', { name: /From your classes/ })).toContainText('1 announcement this week');
  await expect(classes.locator('.brief-class').first()).toContainText('중간고사 강의실 변경 안내');
  await expect(classes.locator('.brief-class__summary').first()).toHaveText('201호에서 진행합니다.');
  await expect(brief.locator('.brief-blurb')).toContainText('1 class announcement this week (운영체제).');
  // Board notices stay in New updates; class posts aren't repeated there.
  await expect(brief.locator('.brief-item', { hasText: '중간고사 강의실 변경 안내' })).toHaveCount(0);

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

test('a quiet week still gets a class summary, pointing at the last announcement', async ({ page }) => {
  const data = ownerData();
  data.data.plato.data.announcements[0].postedAt = Date.now() - 10 * 86_400_000;
  await page.route('**/api/owner/data', (r) => r.fulfill({ json: data }));
  await page.goto('/');
  const brief = visible(page, '.brief');
  const classes = brief.locator('section[aria-labelledby="brief-classes"]');
  await expect(classes).toContainText('No new announcements from your classes this week.');
  await expect(classes.getByRole('button', { name: '중간고사 강의실 변경 안내' })).toBeVisible();
  await expect(brief.locator('.brief-blurb')).toContainText('No new class announcements this week.');
});
