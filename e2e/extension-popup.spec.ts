// The toolbar popup must open on an ordinary website (the user clicks the
// Tatva icon on a Meet / YouTube tab) and render in its default state.
// Needs no server: `pnpm test:extension` (one-time: pnpm exec playwright install chromium).
import path from 'node:path';
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';

// The extension APIs used inside worker.evaluate() (this file has no @types/chrome).
declare const chrome: {
  runtime: {
    id: string;
    getManifest(): { version: string };
    ContextType: { POPUP: string };
    getContexts(filter: { contextTypes: string[] }): Promise<{ documentUrl: string }[]>;
  };
  action: { openPopup(): Promise<void> };
};

let context: BrowserContext;
let worker: Worker;
let extensionId: string;

test.beforeAll(async () => {
  const ext = path.resolve('extension');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});
test.afterAll(async () => context?.close());

test('the service worker starts without errors', async () => {
  // A worker that failed to evaluate (bad importScripts, syntax error) has no chrome.runtime id.
  expect(await worker.evaluate(() => chrome.runtime.id)).toBe(extensionId);
  const state = await worker.evaluate(() => chrome.runtime.getManifest().version);
  expect(state).toMatch(/^\d+\.\d+\.\d+$/);
});

test('clicking the toolbar icon on a normal website opens the popup', async () => {
  const tab = await context.newPage();
  await tab.goto('data:text/html,<title>Weekly sync - Google Meet</title><h1>A meeting</h1>');
  await tab.bringToFront();
  // chrome.action.openPopup() is what a toolbar click does.
  const contexts = await worker.evaluate(async () => {
    await chrome.action.openPopup();
    for (let i = 0; i < 30; i++) {
      const found = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.POPUP] });
      if (found.length) return found.map((c) => c.documentUrl);
      await new Promise((r) => setTimeout(r, 100));
    }
    return [];
  });
  expect(contexts).toEqual([`chrome-extension://${extensionId}/popup.html`]);
  await tab.close();
});

test('the popup renders its default state with no errors', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 332, height: 600 });
  const errors: string[] = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(page.locator('.wordmark')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible();
  await expect(page.locator('#status')).not.toBeEmpty();
  // Hidden panels stay hidden (a CSS display rule once overrode [hidden]).
  for (const id of ['settings', 'warning', 'error', 'meeting', 'lastFile']) await expect(page.locator(`#${id}`)).toBeHidden();

  // The gear opens settings with the saved server selected.
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('input[name=server]:checked')).toHaveCount(1);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('#settings')).toBeHidden();

  expect(errors).toEqual([]);
  await page.close();
});
