#!/usr/bin/env node
// Capture additional screenshots for the Trackers blog post:
//   - template in the compositor
//   - Flow view (governance canvas)
//   - Flow view scrolled to show body-flow (cards + wires)
// Usage: node scripts/screenshot-ai-labor-more.mjs

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'docs', 'assets', 'blog');
await mkdir(outDir, { recursive: true });

const base = process.env.BASE_URL || 'http://localhost:8111';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 2,
});

// 1. Template opened in the compositor
{
  const page = await context.newPage();
  await page.goto(`${base}/living-doc-template-monitoring-tracker.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.click('#comp-toggle');
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(outDir, 'tracker-template-compositor.png'),
    fullPage: false,
  });
  await page.close();
}

// 2. Flow view of the AI-labor tracker (governance canvas)
{
  const page = await context.newPage();
  await page.goto(`${base}/ai-labor-monitor.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.click('#comp-toggle');
  await page.waitForTimeout(1500);

  // Inside the compositor iframe, switch to Flow tab
  const frame = page.frameLocator('#comp-iframe').first();
  await frame.locator('[data-tab="flow"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);

  await page.screenshot({
    path: path.join(outDir, 'tracker-flow-governance.png'),
    fullPage: false,
  });

  // Try to scroll/pan the flow canvas to find a body-flow region
  await frame.locator('body').evaluate((el) => {
    const scrollable = el.querySelector('.flow-canvas, .l2-canvas, .flow-scroll, [class*="flow"], [class*="canvas"]');
    if (scrollable) scrollable.scrollBy(0, 400);
    else window.scrollBy(0, 400);
  }).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(outDir, 'tracker-flow-body.png'),
    fullPage: false,
  });

  await page.close();
}

await browser.close();
console.log(`Additional screenshots saved to ${outDir}`);
