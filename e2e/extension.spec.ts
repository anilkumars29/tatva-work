// The Tatva Recorder extension (extension/) loaded into Playwright's Chromium
// (Chrome stable no longer loads unpacked extensions from the command line).
// Local (default): popup "Local" preset reaches localhost:4000, sidebar on
// localhost:3000 shows "Extension connected".
// Live (TATVA_URL set): popup "Cloud" preset + access code reaches Render, and the
// sidebar on the Vercel site shows "Extension connected" after signing in.
import path from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { accessCode } from './helpers';

const live = !!process.env.TATVA_URL;
let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  const ext = path.resolve('extension');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    viewport: { width: 1440, height: 1000 },
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(sw.url()).host;
});
test.afterAll(async () => context?.close());

test('popup settings: save and test the connection', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator('.wordmark')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator(`input[name=server][value=${live ? 'cloud' : 'local'}]`).check();
  if (live) {
    // Wrong code first: the server must refuse it.
    await page.getByLabel(/Access code/).fill('tatva-wrong-code');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#settingsMessage')).toContainText('access code was refused', { timeout: 90_000 });
    await page.getByLabel(/Access code/).fill(accessCode());
  }
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#settingsMessage')).toContainText('Connected', { timeout: 90_000 });
  type ChromeStorage = { chrome: { storage: { local: { get: (key: string) => Promise<{ settings: { server: string } }> } } } };
  const stored = await page.evaluate(() => (globalThis as unknown as ChromeStorage).chrome.storage.local.get('settings'));
  expect(stored.settings.server).toBe(live ? 'cloud' : 'local');
  await page.close();
});

test('the web app sees the extension', async () => {
  const page = await context.newPage();
  const base = process.env.TATVA_URL ?? 'http://localhost:3000';
  await page.goto(`${base}/login`);
  if (await page.getByLabel('Access code').isVisible().catch(() => false)) {
    await page.getByLabel('Access code').fill(accessCode());
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).not.toHaveURL(/\/login/);
  } else {
    await page.goto(base);
  }
  await expect(page.locator('aside').getByText('Extension connected')).toBeVisible({ timeout: 20_000 });
  const version = await page.evaluate(() => document.documentElement.dataset.tatvaExtension);
  expect(version).toBe('0.5.2');
  await page.close();
});
