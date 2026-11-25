import { test } from '@playwright/test';
import { mockApis } from '../e2e/fixtures';

const OUT = process.env.SHOTS_OUT ?? 'e2e-shots/out';

/** Frames of sliding a finger along the phone tab bar, then letting go. */
test('nav slide frames', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone');
  await mockApis(page);
  await page.goto('/');
  await page.waitForTimeout(800);
  const bar = page.locator('nav[aria-label="Sections"] >> visible=true').first();
  const box = await bar.boundingBox();
  const tab = (name: string) => bar.getByRole('button', { name, exact: true }).boundingBox();
  const a = (await tab('Briefing'))!;
  const b = (await tab('Calendar'))!;
  const clip = { x: 0, y: box!.y - 24, width: 390, height: box!.height + 40 };
  const y = a.y + a.height / 2;
  let n = 0;
  const shot = () => page.screenshot({ path: `${OUT}/nav-${String(n++).padStart(2, '0')}.png`, clip });
  await shot();
  await page.mouse.move(a.x + a.width / 2, y);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await shot();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 12, y);
    await page.waitForTimeout(40);
    await shot();
  }
  await page.mouse.up();
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(70);
    await shot();
  }
});
