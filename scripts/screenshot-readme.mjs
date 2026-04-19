#!/usr/bin/env node
// Capture polished screenshots for the README.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'docs', 'assets', 'readme');
await mkdir(outDir, { recursive: true });

const base = process.env.BASE_URL || 'http://localhost:8111';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
});

// 1. Rendered living doc — AI Labs Watcher hero
{
  const page = await context.newPage();
  await page.goto(`${base}/ai-labs-watcher.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'rendered-doc.png'), fullPage: false });
  await page.close();
}

// 2. Compositor visual editor — on AI Labs Watcher
{
  const page = await context.newPage();
  await page.goto(`${base}/ai-labs-watcher.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.click('#comp-toggle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'compositor.png'), fullPage: false });
  await page.close();
}

// 3. Flow — Governance view
{
  const page = await context.newPage();
  await page.goto(`${base}/ai-labs-watcher.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.click('#comp-toggle');
  await page.waitForTimeout(1500);
  const frame = page.frameLocator('#comp-iframe').first();
  await frame.locator('[data-tab="flow"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'flow-governance.png'), fullPage: false });

  // 4. Flow — Body view (from the same page)
  try {
    await frame.getByRole('button', { name: /^Body$/ }).click({ timeout: 3000 });
  } catch {
    await frame.getByText(/^Body$/, { exact: true }).click({ timeout: 3000 });
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'flow-body.png'), fullPage: false });
  await page.close();
}

await browser.close();
console.log(`README screenshots saved to ${outDir}`);
