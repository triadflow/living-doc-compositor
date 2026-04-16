import { defineConfig, devices } from '@playwright/test';

const localBaseURL = 'http://127.0.0.1:4173';
const baseURL = process.env.BASE_URL || localBaseURL;
const useLocalServer = !process.env.BASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 1000 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: useLocalServer
    ? {
        command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory .',
        url: localBaseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 10_000,
      }
    : undefined,
});
