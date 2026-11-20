import { defineConfig } from '@playwright/test';

// Live-site checks (log in, every page, every non-sending button, one voice call).
//   TATVA_URL=https://tatva-work.vercel.app pnpm exec playwright test
// Defaults to the local production build on :3100. Uses the installed Chrome.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.TATVA_URL ?? 'http://localhost:3100',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'app', testMatch: /app\.spec\.ts/ },
    // Loads extension/ into Playwright's Chromium (one-time: pnpm exec playwright install chromium).
    { name: 'extension', testMatch: /extension\.spec\.ts/ },
    // Toolbar popup opens and renders; needs no server (pnpm test:extension).
    { name: 'extension-popup', testMatch: /extension-popup\.spec\.ts/ },
    {
      name: 'voice',
      testMatch: /voice\.spec\.ts/,
      use: {
        permissions: ['microphone'],
        launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
});
