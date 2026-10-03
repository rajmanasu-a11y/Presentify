import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './api/_helpers.mjs';

// Uses an already-installed Chromium when PW_CHROMIUM_PATH is set; otherwise
// run "npx playwright install chromium" once.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', testIgnore: /participant/, use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 820 }, launchOptions: { executablePath } } },
    { name: 'mobile', testMatch: /responsive|participant/, use: { ...devices['Pixel 7'], launchOptions: { executablePath } } },
  ],
});
