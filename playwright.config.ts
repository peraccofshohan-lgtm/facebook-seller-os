import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a real production build served by `vite preview`,
 * because the service worker (and therefore the offline tests) only exists there.
 *
 * Run: npm run build && npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    locale: 'bn-BD',
    timezoneId: 'Asia/Dhaka',
    // Set CHROMIUM_BIN to drive a browser that is already on the machine
    // (useful when the Playwright CDN cannot be reached).
    launchOptions: process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {},
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Kept explicitly: the device preset above would otherwise reset the
        // phone-sized viewport that the app is designed for.
        viewport: { width: 390, height: 844 },
        launchOptions: process.env.CHROMIUM_BIN
          ? { executablePath: process.env.CHROMIUM_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
          : {},
      },
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
