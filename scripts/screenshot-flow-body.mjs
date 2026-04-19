#!/usr/bin/env node
// Capture the Flow → Body view specifically.
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'docs', 'assets', 'blog');

const base = process.env.BASE_URL || 'http://localhost:8111';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 2,
});

const page = await context.newPage();
await page.goto(`${base}/ai-labor-monitor.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.click('#comp-toggle');
await page.waitForTimeout(1500);

const frame = page.frameLocator('#comp-iframe').first();
// Switch to Flow tab
await frame.locator('[data-tab="flow"]').first().click({ timeout: 5000 });
await page.waitForTimeout(1000);

// Click the "Body" sub-tab inside Flow
// Try multiple ways to locate it
try {
  await frame.getByRole('button', { name: /^Body$/ }).click({ timeout: 3000 });
} catch {
  try {
    await frame.getByText(/^Body$/, { exact: true }).click({ timeout: 3000 });
  } catch (e) {
    console.warn('Could not click Body tab:', e.message);
  }
}
await page.waitForTimeout(1500);

await page.screenshot({
  path: path.join(outDir, 'tracker-flow-body.png'),
  fullPage: false,
});

await browser.close();
console.log('Saved tracker-flow-body.png');
