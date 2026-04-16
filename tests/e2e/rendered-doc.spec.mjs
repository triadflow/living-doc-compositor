import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

let renderedHtmlUrl;

test.beforeAll(async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-e2e-rendered-'));
  const jsonPath = path.join(tmpDir, 'feature-doc.json');
  const htmlPath = path.join(tmpDir, 'feature-doc.html');
  await copyFile('tests/fixtures/feature-doc.json', jsonPath);
  execFileSync(process.execPath, ['scripts/render-living-doc.mjs', jsonPath], { stdio: 'inherit' });
  renderedHtmlUrl = pathToFileURL(htmlPath).href;
});

test('opens rendered HTML and launches the embedded compositor with current document data', async ({ page }) => {
  await page.goto(renderedHtmlUrl);

  await expect(page.locator('h1')).toContainText('Fixture Feature Living Doc');
  await expect(page.locator('#snapshot-generated-at')).toBeVisible();
  await expect(page.locator('.nav-icon[data-target="status-snapshot"]')).toBeVisible();
  await expect(page.locator('#tooling')).toContainText('Universal renderer');

  await page.locator('#comp-toggle').click();
  await expect(page.locator('#comp-overlay')).toHaveClass(/open/);

  const compositor = page.frameLocator('#comp-iframe');
  await expect(compositor.locator('#top-bar')).toContainText('Living Doc Compositor');
  await expect(compositor.locator('#doc-title')).toHaveValue('Fixture Feature Living Doc');
  await expect(compositor.locator('.visual-section-card').filter({ hasText: 'Tooling Surface' })).toBeVisible();
});
