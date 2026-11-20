// UI checks: dashboard cards link to the right views, hover/cursor/focus states,
// no caret on text, the fonts, and no console errors or warnings.
//   node scripts/ui-check.mjs <baseUrl>
// Logs in with TATVA_ACCESS_CODE (env or .env.deploy) when the site asks for it.
import fs from 'node:fs';
import { chromium } from '@playwright/test';
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const accessCode = () => process.env.TATVA_ACCESS_CODE ?? (fs.existsSync('.env.deploy') ? (fs.readFileSync('.env.deploy', 'utf8').match(/^TATVA_ACCESS_CODE=(.*)$/m)?.[1] ?? '').trim() : '');
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
const errors = [];
p.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(m.text().slice(0, 160)));
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};
await p.goto(base + '/', { waitUntil: 'networkidle' });
if (new URL(p.url()).pathname === '/login') {
  await p.getByLabel('Access code').fill(accessCode());
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL((u) => u.pathname === '/', { timeout: 30000 });
}
for (const [label, expect] of [['Meetings Recorded', '/meetings'], ['Open Action Items', '/tracker?filter=pending'], ['Actions by Tatva', '/tracker?view=activity'], ['Time Saved This Week', '/meetings?sort=time_saved']]) {
  await p.goto(base + '/', { waitUntil: 'networkidle' });
  const card = p.locator('a', { hasText: label }).first();
  const before = await card.evaluate((e) => getComputedStyle(e).borderColor);
  await card.hover();
  await p.waitForTimeout(250);
  const after = await card.evaluate((e) => getComputedStyle(e).borderColor);
  const cursor = await card.evaluate((e) => getComputedStyle(e).cursor);
  await card.click();
  await p.waitForURL((u) => u.pathname + u.search === expect, { timeout: 10000 }).catch(() => {});
  const url = new URL(p.url());
  ok(`card "${label}" -> ${expect}`, url.pathname + url.search === expect && before !== after && cursor === 'pointer', `hover border ${before} -> ${after}, cursor ${cursor}`);
  if (expect.includes('filter=pending')) ok('tracker opens on Pending filter', await p.locator('button[aria-pressed]', { hasText: 'Pending' }).getAttribute('aria-pressed') === 'true');
  if (expect.includes('view=activity')) ok('tracker opens on Activity log tab', (await p.getByRole('tab', { name: /Activity log/ }).getAttribute('aria-selected')) === 'true');
  if (expect.includes('time_saved')) ok('meetings sorted by time saved', (await p.getByRole('tab', { name: /Time saved/ }).getAttribute('aria-selected')) === 'true' && (await p.getByText(/min saved/).first().waitFor({ timeout: 10000 }).then(() => true, () => false)));
}
await p.goto(base + '/knowledge', { waitUntil: 'networkidle' });
const caret = await p.evaluate(() => ({ h1: getComputedStyle(document.querySelector('h1')).caretColor, input: getComputedStyle(document.querySelector('input[type=text]')).caretColor, p: getComputedStyle(document.querySelector('p')).caretColor }));
ok('no caret on text, caret on inputs', caret.h1 === 'rgba(0, 0, 0, 0)' && caret.p === 'rgba(0, 0, 0, 0)' && caret.input !== 'rgba(0, 0, 0, 0)', JSON.stringify(caret));
const fonts = await p.evaluate(() => ({ h1: getComputedStyle(document.querySelector('h1')).fontFamily, body: getComputedStyle(document.querySelector('p')).fontFamily }));
ok('Arimo headings, Open Sans body', /Arimo/i.test(fonts.h1) && /Open Sans/i.test(fonts.body), `${fonts.h1.slice(0, 40)} | ${fonts.body.slice(0, 40)}`);
const editable = await p.evaluate(() => document.querySelectorAll('[contenteditable]').length);
ok('no contentEditable elements', editable === 0);
// every visible button/link has pointer (or not-allowed when disabled)
for (const path of ['/', '/meetings', '/talk', '/knowledge', '/tracker', '/contacts']) {
  await p.goto(base + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const bad = await p.evaluate(() => [...document.querySelectorAll('a[href],button,[role=button],[role=tab]')].filter((e) => e.offsetParent).filter((e) => { const c = getComputedStyle(e).cursor; return e.disabled || e.getAttribute('aria-disabled') === 'true' ? c !== 'not-allowed' : c !== 'pointer'; }).map((e) => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 40)));
  ok(`${path}: pointer / not-allowed cursors`, bad.length === 0, bad.join(' | '));
}
// keyboard focus ring
await p.goto(base + '/', { waitUntil: 'networkidle' });
await p.keyboard.press('Tab');
await p.keyboard.press('Tab');
const ring = await p.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return `${s.outlineStyle} ${s.outlineColor}`; });
ok('keyboard focus ring visible', /solid/.test(ring), ring);
ok('no console errors or warnings', errors.length === 0, errors.join(' || '));
await b.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll UI checks passed');
process.exit(failed ? 1 : 0);
