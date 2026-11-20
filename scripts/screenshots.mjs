// Screenshots of every page (full page) plus each page's console errors and warnings.
//   node scripts/screenshots.mjs <baseUrl> <outDir> [width=1366]
// Logs in with TATVA_ACCESS_CODE (env or .env.deploy) when the site asks for it.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const [base = 'http://localhost:3000', outDir = 'shots', widthArg = '1366'] = process.argv.slice(2);
const width = Number(widthArg);
fs.mkdirSync(outDir, { recursive: true });

function accessCode() {
  if (process.env.TATVA_ACCESS_CODE) return process.env.TATVA_ACCESS_CODE;
  const line = fs.existsSync('.env.deploy') ? fs.readFileSync('.env.deploy', 'utf8').split(/\r?\n/).find((l) => l.startsWith('TATVA_ACCESS_CODE=')) : '';
  return line ? line.slice('TATVA_ACCESS_CODE='.length).trim() : '';
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const log = [];
let current = 'start';
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) log.push(`[${current}] ${m.type()}: ${m.text().replace(/\s+/g, ' ').slice(0, 240)}`);
});
page.on('pageerror', (e) => log.push(`[${current}] pageerror: ${e.message.slice(0, 240)}`));

async function shot(name, url, settle = 2500) {
  current = name;
  await page.goto(new URL(url, base).toString(), { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(settle);
  const file = path.join(outDir, `${name}.png`);
  // Pages with a live animation (Talk) never settle for a full-page capture.
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled', timeout: 15_000 }).catch(() => page.screenshot({ path: file, animations: 'disabled', timeout: 15_000 }));
  console.log(`${name}: "${await page.title()}"`);
}

await shot('login', '/login', 800);
if (await page.getByLabel('Access code').isVisible().catch(() => false)) {
  await page.getByLabel('Access code').fill(accessCode());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}
await shot('dashboard', '/');
await shot('meetings', '/meetings');
const firstMeeting = await page.locator('a[href^="/meetings/"]').first().getAttribute('href').catch(() => null);
if (firstMeeting) await shot('meeting', firstMeeting, 3500);
await shot('talk', '/talk');
await shot('knowledge', '/knowledge');
await shot('tracker', '/tracker');
await shot('contacts', '/contacts');
await shot('not-found', '/this-page-does-not-exist', 800);

fs.writeFileSync(path.join(outDir, 'console.txt'), log.join('\n') + '\n');
console.log(`\n${log.length} console errors/warnings (${path.join(outDir, 'console.txt')})`);
await browser.close();
