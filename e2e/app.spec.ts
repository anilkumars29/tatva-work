// Live-site check: log in, open every page, click every button that doesn't
// send a real message or change data. Dialogs for outward actions (email,
// Slack, calendar, issue) are opened, checked for the server's read-back, and
// cancelled. Skipped on purpose: Mark complete / status toggles (change data),
// Brief me / Ask Tatva / suggestion chips (start voice calls: see voice.spec.ts).
import { expect, test, type Page } from '@playwright/test';
import { accessCode, watch } from './helpers';

test.describe.configure({ mode: 'serial' });

let page: Page;
let problems: string[];
let meetingId: string;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  problems = watch(page);
});
test.afterAll(async () => page.close());
test.afterEach(async ({}, info) => {
  // Every step must finish without console errors or failed API calls.
  const found = problems.splice(0);
  expect(found, `${info.title}: ${found.join(' | ')}`).toEqual([]);
});

async function cancelDialog(name: RegExp, expectReadBack = true) {
  const dialog = page.getByRole('dialog', { name });
  await expect(dialog).toBeVisible();
  if (expectReadBack) await expect(dialog.getByText('Tatva will')).toBeVisible();
  if (expectReadBack) await expect(dialog.getByText('Preparing…')).toBeHidden({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
}

async function closePopup(click: () => Promise<void>) {
  const popup = page.waitForEvent('popup');
  await click();
  const p = await popup;
  await p.close();
}

test('login: signed-out redirect, wrong code, right code', async () => {
  await page.goto('/tracker');
  await expect(page).toHaveURL(/\/login\?next=%2Ftracker/);
  await page.getByLabel('Access code').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('That code is not right.')).toBeVisible();
  problems.splice(0); // the expected 401 from the wrong code
  await page.getByLabel('Access code').fill(accessCode());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/tracker$/);
});

test('dashboard', async () => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  await expect(page.getByText('Meetings recorded', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Time saved this week', { exact: false })).toBeVisible();
  meetingId = await page.evaluate(async () => (await (await fetch('/tatva/meetings')).json()).meetings.find((m: { status: string }) => m.status === 'ready').id);
  const ping = page.getByRole('button', { name: /^Ping .* on Slack$/ }).first();
  await ping.click();
  await cancelDialog(/Ping/i);
  await page.getByRole('link', { name: 'View all tracker tasks' }).click();
  await expect(page).toHaveURL(/\/tracker/);
  await page.goto('/');
  await page.getByRole('link', { name: 'View all' }).first().click();
  await expect(page).toHaveURL(/\/meetings$/);
  await page.goto('/');
  await page.getByRole('link', { name: 'Talk to Tatva' }).first().click();
  await expect(page).toHaveURL(/\/talk/);
  // The four stat cards open the page behind each number.
  for (const [card, url, check] of [
    [/^Meetings Recorded/i, /\/meetings$/, null],
    [/^Open Action Items/i, /\/tracker\?filter=pending$/, () => page.locator('button[aria-pressed="true"]', { hasText: 'Pending' })],
    [/^Actions by Tatva/i, /\/tracker\?view=activity$/, () => page.getByRole('tab', { name: /^Activity log/, selected: true })],
    [/^Time Saved This Week/i, /\/meetings\?sort=time_saved$/, () => page.getByRole('tab', { name: /Time saved/, selected: true })],
  ] as const) {
    await page.goto('/');
    await page.getByRole('link', { name: card }).click();
    await expect(page).toHaveURL(url);
    if (check) await expect(check()).toBeVisible();
  }
});

test('meetings list: filter and open', async () => {
  await page.goto('/meetings');
  await page.getByPlaceholder(/Filter by title/).fill('Hiring');
  await expect(page.getByRole('link', { name: /Hiring Plan Sync/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Q4 Vendor Review/ })).toBeHidden();
  await page.getByPlaceholder(/Filter by title/).fill('');
  await page.getByRole('link', { name: /Q4 Vendor Review/ }).click();
  await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]{36}$/);
  meetingId = page.url().split('/').pop()!;
});

test('meeting page: player, moments, transcript, actions (cancelled)', async () => {
  await page.goto(`/meetings/${meetingId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
  await page.getByRole('button', { name: 'Rewind 10 seconds' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: /^1(\.0)?x$/ }).click();
  await page.getByRole('button', { name: 'Mute' }).click();
  await page.getByRole('button', { name: 'Unmute' }).click();
  await page.getByRole('button', { name: /^Jump to / }).nth(1).click();
  await page.getByPlaceholder(/Search transcript/).fill('deadline');
  await expect(page.getByText(/deadline/i).first()).toBeVisible();
  await page.getByPlaceholder(/Search transcript/).fill('');
  await expect(page.getByRole('button', { name: /Export Jira\/Asana/ })).toBeDisabled();

  await closePopup(() => page.getByRole('button', { name: 'Open Google Doc' }).click());
  await page.getByRole('button', { name: 'Send by email' }).click();
  await cancelDialog(/email/i);
  await page.getByRole('button', { name: 'Send to Slack' }).click();
  await cancelDialog(/Slack/i);
  await page.getByRole('button', { name: 'Add to Calendar' }).first().click();
  await cancelDialog(/Calendar|invite|follow/i);
});

test('meeting page: attachments (preview, file picker)', async () => {
  const section = page.getByRole('region', { name: 'Attachments' });
  await section.scrollIntoViewIfNeeded();
  const chooser = page.waitForEvent('filechooser');
  await section.getByRole('button', { name: 'Add files' }).click();
  expect((await chooser).isMultiple()).toBe(true);
  const preview = section.getByRole('button', { name: /^Preview / }).first();
  if (await preview.count()) {
    await preview.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/What Tatva read/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
  }
});

test('talk page renders (call is tested in voice.spec.ts)', async () => {
  await page.goto('/talk');
  await expect(page.getByRole('heading', { name: 'Talk to Tatva' })).toBeVisible();
  for (const chip of ['Brief me for my next meeting', "What's still pending?", 'Post the summary in Slack', 'Schedule a follow-up']) await expect(page.getByRole('button', { name: chip })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start conversation' }).first()).toBeEnabled();
  await expect(page.getByText('What Tatva is doing')).toBeVisible();
});

test('knowledge base: tabs, search, preview, download, upload picker', async () => {
  await page.goto('/knowledge');
  for (const tab of [/^Meetings/, /^Documents/, /^Attachments/, /^All/]) await page.getByRole('tab', { name: tab }).first().click();
  await page.getByPlaceholder(/Ask or search/).fill('premium tier price');
  await page.getByPlaceholder(/Ask or search/).press('Enter');
  await expect(page.getByText(/% match/).first()).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder(/Ask or search/).fill('');
  await page.getByPlaceholder(/Ask or search/).press('Enter');
  const docPreview = page.getByRole('button', { name: /^Preview .*\.pdf$/ }).first();
  await closePopup(() => docPreview.click());
  const imgPreview = page.getByRole('button', { name: /^Preview .*\.(png|jpe?g|webp)$/ }).first();
  if (await imgPreview.count()) {
    await imgPreview.click();
    await expect(page.getByRole('dialog').getByText(/What Tatva read/)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Download .*\.pdf$/ }).first().click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload document' }).click();
  await chooser;
});

test('tracker: tabs, filters, sort, CSV, paging, log issue (cancelled), sheet', async () => {
  await page.goto('/tracker');
  await page.getByRole('tab', { name: /^Activity log/ }).click();
  await expect(page.getByText(/Sent|Posted|Created|Logged|Searched|Uploaded/).first()).toBeVisible();
  await page.getByRole('tab', { name: /^Action items/ }).click();
  for (const f of [/^Pending\s*\d/, /^Done\s*\d/, /^Issues\s*\d/, /^All\s*\d/]) await page.getByRole('button', { name: f }).click();
  await page.getByRole('button', { name: /Due date/ }).click();
  await page.getByPlaceholder(/Filter actions or owners/).fill('Priya');
  await expect(page.getByText('Priya').first()).toBeVisible();
  await page.getByPlaceholder(/Filter actions or owners/).fill('');
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current view as CSV' }).click();
  expect((await csv).suggestedFilename()).toMatch(/\.csv$/);
  const next = page.getByRole('button', { name: 'Next page' });
  if (await next.isEnabled()) {
    await next.click();
    await page.getByRole('button', { name: 'Previous page' }).click();
  }
  await page.getByRole('button', { name: 'Log issue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log an issue' });
  await expect(dialog.getByText('Describe the issue to see what Tatva will do.')).toBeVisible();
  await dialog.getByPlaceholder(/Login bug reported/).fill('Playwright check: test issue (cancelled, not logged)');
  await expect(dialog.getByText(/log the issue/i)).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('button', { name: 'Log & escalate' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await closePopup(() => page.getByRole('link', { name: /Open in Google Sheets/ }).click());
});

test('contacts: search, CSV, add and edit (cancelled)', async () => {
  await page.goto('/contacts');
  await page.getByPlaceholder(/Search by name/).fill('Priya');
  await expect(page.getByRole('button', { name: 'Edit Priya Sharma' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Rahul Das' })).toBeHidden();
  await page.getByPlaceholder(/Search by name/).fill('');
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export contacts as CSV' }).click();
  expect((await csv).suggestedFilename()).toMatch(/\.csv$/);
  for (const open of [() => page.getByRole('button', { name: 'Add contact' }).click(), () => page.getByRole('button', { name: 'Edit Priya Sharma' }).click()]) {
    await open();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  }
});

test('profile menu: status rows, refresh, edit (cancelled), sign out', async () => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open profile menu' }).click();
  const menu = page.getByRole('menu', { name: 'Profile' });
  await expect(menu.getByText('Chrome extension')).toBeVisible();
  await menu.getByRole('button', { name: 'Refresh' }).click();
  await expect(menu.getByText('Connected', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  for (const app of ['Gmail', 'Google Calendar', 'Slack', 'Google Sheets', 'Google Docs', 'Google Drive']) await expect(menu.getByText(app, { exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Edit profile' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit profile' });
  await expect(dialog.getByLabel('Name')).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Open profile menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/contacts');
  await expect(page).toHaveURL(/\/login\?next=%2Fcontacts/);
});
