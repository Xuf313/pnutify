import { defineConfig, devices } from '@playwright/test';

const PORT = 3210;

/**
 * Browser tests against the production build (`npm run build` first).
 * The app's API calls are answered by the tests themselves (see e2e/fixtures.ts),
 * so nothing here touches the university sites, Redis or push services.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Phone-sized, in Chromium (the iPhone preset would otherwise pick WebKit).
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/manifest.webmanifest`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // No Redis, owner secret or push keys: the server runs as a plain visitor-only site.
    env: { UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', OWNER_SECRET: '' },
  },
});
