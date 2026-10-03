import { defineConfig, devices } from '@playwright/test';

// Installation check (tests/acceptance): runs against a real installation.
//   PRESENTIFY_URL=http://192.168.1.20:8080 CHECK_SA_EMAIL=… CHECK_SA_PASSWORD=… npm run test:install
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './acceptance',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PRESENTIFY_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'install-check', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 820 }, launchOptions: { executablePath } } }],
});
