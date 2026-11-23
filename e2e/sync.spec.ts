import { expect, mockApis, test, visible } from './fixtures';
import type { Browser, Page } from '@playwright/test';

/** A separate "device": its own browser storage. */
async function device(browser: Browser, use: { viewport?: { width: number; height: number } | null }) {
  const ctx = await browser.newContext({ viewport: use.viewport ?? { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await mockApis(page);
  return { ctx, page };
}

async function addTask(page: Page, title: string) {
  await page.goto('/?tab=tasks');
  const main = visible(page, 'main');
  await main.getByRole('button', { name: /^Add$/ }).click();
  await main.getByLabel("What's due").fill(title);
  await main.getByRole('button', { name: 'Add task' }).click();
  await expect(main.getByText(title)).toBeVisible();
}

const openSettings = (page: Page) => visible(page, 'button[aria-label="Settings"], button:has-text("Settings & alerts")').first().click();

test('two devices sync tasks with a sync code', async ({ browser, viewport }) => {
  const phone = await device(browser, { viewport });
  const laptop = await device(browser, { viewport });

  await addTask(phone.page, 'Task from the phone');
  await addTask(laptop.page, 'Task from the laptop');

  // Phone: create a code and read it.
  await openSettings(phone.page);
  const phoneSettings = phone.page.getByRole('dialog');
  await phoneSettings.getByRole('button', { name: 'Create a sync code' }).click();
  const codeEl = phoneSettings.getByLabel('Your sync code');
  await expect(codeEl).toHaveText(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){4}$/);
  const code = (await codeEl.textContent())!;

  // Laptop: enter it.
  await openSettings(laptop.page);
  const laptopSettings = laptop.page.getByRole('dialog');
  await laptopSettings.getByRole('button', { name: 'Enter a code' }).click();
  await laptopSettings.getByLabel('Sync code from your other device').fill(code.toLowerCase());
  await laptopSettings.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(laptopSettings.getByText('Linked. This device now syncs.')).toBeVisible();
  await laptop.page.keyboard.press('Escape');

  // The laptop now has both tasks, and says it syncs.
  const laptopMain = visible(laptop.page, 'main');
  await expect(laptopMain.getByText('Task from the phone')).toBeVisible();
  await expect(laptopMain.getByText('Task from the laptop')).toBeVisible();
  await expect(laptopMain.getByText('synced across your devices')).toBeVisible();

  // The phone picks up the laptop's task on its next sync (opening the app again).
  await phone.page.goto('/?tab=tasks');
  await expect(visible(phone.page, 'main').getByText('Task from the laptop')).toBeVisible();

  // Deleting the synced copy stops syncing on both, and each keeps its tasks.
  await openSettings(phone.page);
  phone.page.once('dialog', (d) => d.accept());
  await phone.page.getByRole('dialog').getByRole('button', { name: 'Delete synced data' }).click();
  await expect(phone.page.getByRole('dialog').getByRole('button', { name: 'Create a sync code' })).toBeVisible();
  await laptop.page.goto('/?tab=tasks');
  await expect(visible(laptop.page, 'main').getByText('saved on this device')).toBeVisible();
  await expect(visible(laptop.page, 'main').getByText('Task from the phone')).toBeVisible();

  await phone.ctx.close();
  await laptop.ctx.close();
});
