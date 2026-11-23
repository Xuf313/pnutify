import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

export default defineConfig({
  ...base,
  testDir: '.',
  webServer: { ...(base.webServer as object), cwd: '..' } as typeof base.webServer,
  reporter: 'list',
  projects: [
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 } },
  ],
});
