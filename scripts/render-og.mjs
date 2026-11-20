// Renders an HTML file to a 1200x630 PNG (Open Graph image).
//   node scripts/render-og.mjs <in.html> <out.png>
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const [input, output] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(input).toString(), { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: output, type: 'png' });
await browser.close();
console.log(`wrote ${output}`);
