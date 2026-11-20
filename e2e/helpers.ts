import fs from 'node:fs';
import { expect, type Page } from '@playwright/test';

/** TATVA_ACCESS_CODE from the environment, else from .env.deploy (never printed). */
export function accessCode(): string {
  if (process.env.TATVA_ACCESS_CODE) return process.env.TATVA_ACCESS_CODE;
  const line = fs.existsSync('.env.deploy') ? fs.readFileSync('.env.deploy', 'utf8').split(/\r?\n/).find((l) => l.startsWith('TATVA_ACCESS_CODE=')) : undefined;
  if (!line) throw new Error('Set TATVA_ACCESS_CODE or create .env.deploy (node scripts/deploy-env.mjs).');
  return line.slice('TATVA_ACCESS_CODE='.length).trim();
}

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Access code').fill(accessCode());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Collects console errors and failed app/API responses while a test runs. */
export function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource.*(favicon|401)|Download the React DevTools/i.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if ((u.pathname.startsWith('/tatva/') || u.pathname.startsWith('/api/')) && r.status() >= 400) problems.push(`HTTP ${r.status()} ${u.pathname}`);
  });
  return problems;
}
