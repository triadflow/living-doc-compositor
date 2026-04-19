#!/usr/bin/env node
// Capture screenshots of the AI Labs Watcher for the Trackers blog post.
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
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});

// Main tracker screenshots
{
  const page = await context.newPage();
  await page.goto(`${base}/ai-labs-watcher.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  await page.screenshot({ path: path.join(outDir, 'labs-hero.png'), fullPage: false });

  for (const [id, file] of [
    ['labs', 'labs-cards.png'],
    ['moves', 'labs-moves.png'],
    ['predictions', 'labs-predictions.png'],
    ['indicators', 'labs-indicators.png'],
    ['positions', 'labs-positions.png'],
    ['sources', 'labs-sources.png'],
  ]) {
    await page.evaluate((sid) => {
      const el = document.getElementById(sid);
      if (el) el.scrollIntoView({ block: 'start' });
    }, id);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, file), fullPage: false });
  }
  await page.close();
}

// Blank competitor-watcher template in the compositor
{
  const page = await context.newPage();
  await context.pages()[0] || await context.newPage();
  await page.goto(`${base}/living-doc-template-competitor-watcher.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.click('#comp-toggle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'labs-template-compositor.png'), fullPage: false });
  await page.close();
}

await browser.close();
console.log(`AI-labs screenshots saved to ${outDir}`);
