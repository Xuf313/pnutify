import { expect, mockApis, test, visible } from './fixtures';

test.beforeEach(async ({ page }) => {
  await mockApis(page);
});

const noSidewaysScroll = async (page: import('@playwright/test').Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test.describe('Briefing', () => {
  test('shows the painting, caption, summary and sections', async ({ page }) => {
    await page.goto('/');
    const brief = visible(page, '.brief');
    await expect(brief.locator('h1.brief-day')).toHaveText(/^\w+day Brief$/);

    // The painting actually loads (through the image optimizer).
    const img = brief.locator('.brief-frame img');
    await expect(img).toHaveClass(/is-loaded/);
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

    // Caption first, then the summary line.
    const order = await brief.locator('header p').evaluateAll((ps) => ps.map((p) => p.className));
    expect(order).toEqual(['brief-caption', 'brief-blurb']);
    await expect(brief.locator('.brief-blurb')).toContainText('new notice');

    for (const h of ['To-dos', 'New updates', 'Looking ahead']) await expect(brief.getByRole('heading', { name: h })).toBeVisible();
    await expect(brief.locator('.brief-item')).toHaveCount(3); // the three fresh notices, numbered
    await expect(brief.locator('.brief-item__num').first()).toHaveText('01');
    await noSidewaysScroll(page);
  });
});

test.describe('Notices', () => {
  test('lists, searches and marks notices read', async ({ page }) => {
    await page.goto('/?tab=notices');
    const main = visible(page, 'main');
    await expect(main.getByText('[장학] 국가장학금 신청 안내')).toBeVisible();

    await main.getByPlaceholder('Search notices').fill('visa');
    await expect(main.getByText('Visa document review hours')).toBeVisible();
    await expect(main.getByText('[장학] 국가장학금 신청 안내')).toHaveCount(0);
    await main.getByPlaceholder('Search notices').fill('');

    await main.getByRole('button', { name: 'Mark "건물 출입 통제 알림" as read' }).click();
    await expect(main.getByRole('button', { name: 'Mark "건물 출입 통제 알림" as unread' })).toBeVisible();
    await noSidewaysScroll(page);
  });

  test('reads a notice inside the app', async ({ page }) => {
    await page.goto('/?tab=notices');
    const main = visible(page, 'main');
    await main.getByText('[장학] 국가장학금 신청 안내').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.notice-body')).toContainText('신청기간: 11/24 ~ 1/7');
    await expect(dialog.locator('.notice-body table')).toBeVisible();
    await expect(dialog.getByRole('link', { name: '붙임1. 안내문.pdf' })).toHaveAttribute('href', /download\.do$/);
    await expect(dialog.getByText('Posted 2026.11.19 · 정*랑')).toBeVisible();
    await expect(dialog.getByRole('link', { name: /Open on the CSE site/ })).toBeVisible();
    // Reading it marks it read.
    await expect(dialog.getByRole('button', { name: 'Mark unread' })).toBeVisible();
    // Long tables scroll inside the sheet rather than widening the page.
    await noSidewaysScroll(page);
  });
});

test.describe('Tasks', () => {
  test('add, tick off and clear a task', async ({ page }) => {
    await page.goto('/?tab=tasks');
    const main = visible(page, 'main');

    // "+ Add" stays on one line even on a narrow phone.
    const add = main.getByRole('button', { name: /^Add$/ });
    expect((await add.boundingBox())!.height).toBeLessThan(60);
    // The reminders line is left-aligned.
    expect(await main.getByRole('button', { name: /Reminders (on|off)/ }).evaluate((el) => getComputedStyle(el).textAlign)).toBe('left');

    await add.click();
    await main.getByLabel("What's due").fill('OS homework 3');
    await main.getByRole('button', { name: 'Add task' }).click();
    await expect(main.getByText('OS homework 3')).toBeVisible();

    await main.getByRole('button', { name: 'Mark "OS homework 3" as done' }).click();
    await expect(main.getByRole('heading', { name: /^Done \(1\)$/i })).toBeVisible();
    await main.getByRole('button', { name: 'Clear done' }).click();
    await expect(main.getByText('OS homework 3')).toHaveCount(0);

    // Survives a reload (saved on the device).
    await page.reload();
    await expect(visible(page, 'main').getByText('OS homework 3')).toHaveCount(0);
  });
});

test.describe('Settings and privacy', () => {
  test('a visitor sees no PLATO, NESPA or owner data', async ({ page }) => {
    await page.goto('/');
    await expect(visible(page, '.brief')).toBeVisible();
    await expect(page.getByText(/PLATO|NESPA|From your courses/)).toHaveCount(0);

    await visible(page, 'button[aria-label="Settings"], button:has-text("Settings & alerts")').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Owner sign-in')).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'PLATO & NESPA' })).toHaveCount(0);
  });

  test('the server refuses owner data to a visitor', async ({ request }) => {
    // Straight to the server, no mocks: these must never answer a visitor.
    for (const path of ['/api/owner/data', '/api/owner/state', '/api/owner/alerts?deviceId=abcdefgh123']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(401);
      expect(await res.text()).not.toMatch(/plato|nespa/i);
    }
    expect((await request.get('/api/push/send')).status()).toBe(401);
  });

  test('the status bar colour follows the theme', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('theme_v1', 'night'));
    await page.goto('/');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#121826');
  });
});

test.describe('Boards', () => {
  test('a board can be hidden, and it disappears from the lists', async ({ page }) => {
    await page.goto('/?tab=notices');
    const main = visible(page, 'main');
    await expect(main.getByRole('tab', { name: /Intl/ })).toBeVisible();
    await expect(main.getByText('Visa document review hours')).toBeVisible();

    await visible(page, 'button[aria-label="Settings"], button:has-text("Settings & alerts")').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove International' }).click();
    await page.keyboard.press('Escape');

    await expect(main.getByRole('tab', { name: /Intl/ })).toHaveCount(0);
    await expect(main.getByText('Visa document review hours')).toHaveCount(0);
    // Remembered on this device.
    await page.reload();
    await expect(visible(page, 'main').getByRole('tab', { name: /Intl/ })).toHaveCount(0);
  });

  test('a department board can be found by search and added', async ({ page }) => {
    await page.goto('/?tab=notices');
    const main = visible(page, 'main');
    await expect(main.getByText('2027학년도 수학과 졸업시험 안내')).toHaveCount(0);

    await visible(page, 'button[aria-label="Settings"], button:has-text("Settings & alerts")').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Search departments').fill('수학');
    await dialog.getByRole('button', { name: 'Add 수학과' }).click();
    await expect(dialog.getByRole('button', { name: 'Remove 수학과' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(main.getByRole('tab', { name: /수학과/ })).toBeVisible();
    await expect(main.getByText('2027학년도 수학과 졸업시험 안내')).toBeVisible();
  });

  test('departments are listed by college', async ({ page }) => {
    await page.goto('/');
    await visible(page, 'button[aria-label="Settings"], button:has-text("Settings & alerts")').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^공과대학/ }).click();
    await expect(dialog.getByRole('button', { name: 'Add 항공우주공학과' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add 수학과' })).toHaveCount(0);
  });
});
