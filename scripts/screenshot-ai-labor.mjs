#!/usr/bin/env node
// One-off: capture screenshots of the AI-labor monitor tracker for the Trackers blog post.
// Usage: node scripts/screenshot-ai-labor.mjs
// Assumes a local server is running on http://localhost:8111 serving docs/.

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'docs', 'assets', 'blog');
await mkdir(outDir, { recursive: true });

const base = process.env.BASE_URL || 'http://localhost:8111';
const url = `${base}/ai-labor-monitor.html`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// 1. Hero with period strip visible
await page.screenshot({
  path: path.join(outDir, 'tracker-hero.png'),
  fullPage: false,
});

// 2. Experts section (scroll to it)
await page.evaluate(() => {
  const el = document.getElementById('experts');
  if (el) el.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(300);
await page.screenshot({
  path: path.join(outDir, 'tracker-experts.png'),
  fullPage: false,
});

// 3. Indicator dashboard (scroll to it)
await page.evaluate(() => {
  const el = document.getElementById('indicators');
  if (el) el.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(300);
await page.screenshot({
  path: path.join(outDir, 'tracker-indicators.png'),
  fullPage: false,
});

// 4. Divergence map
await page.evaluate(() => {
  const el = document.getElementById('divergence');
  if (el) el.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(300);
await page.screenshot({
  path: path.join(outDir, 'tracker-divergence.png'),
  fullPage: false,
});

// 5. Sources (citation feed)
await page.evaluate(() => {
  const el = document.getElementById('sources');
  if (el) el.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(300);
await page.screenshot({
  path: path.join(outDir, 'tracker-sources.png'),
  fullPage: false,
});

// 6. Compositor panel — click the pencil and wait for overlay
try {
  await page.click('#comp-toggle', { timeout: 3000 });
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: path.join(outDir, 'tracker-compositor.png'),
    fullPage: false,
  });
} catch (e) {
  console.warn('Could not open compositor overlay:', e.message);
}

await browser.close();
console.log(`Screenshots saved to ${outDir}`);
