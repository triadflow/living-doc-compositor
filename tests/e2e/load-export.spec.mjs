import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openLocalCompositor, openTopMenu } from './helpers.mjs';

test('loads fixture JSON and exports standalone HTML', async ({ page }) => {
  await openLocalCompositor(page);
  const fixture = await readFile('tests/fixtures/feature-doc.json', 'utf8');

  await openTopMenu(page);
  await page.locator('#top-load').click();
  await page.locator('#load-json-text').fill(fixture);
  await page.locator('#load-apply').click();

  await expect(page.locator('#doc-title')).toHaveValue('Fixture Feature Living Doc');
  await expect(page.locator('.visual-section-card').filter({ hasText: 'Tooling Surface' })).toBeVisible();

  await openTopMenu(page);
  const jsonDownloadPromise = page.waitForEvent('download');
  await page.locator('#top-export').click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = await jsonDownload.path();
  const exportedJson = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(exportedJson.title, 'Fixture Feature Living Doc');
  assert.equal(exportedJson.sections.length, 2);

  await openTopMenu(page);
  const htmlDownloadPromise = page.waitForEvent('download');
  await page.locator('#top-html').click();
  const htmlDownload = await htmlDownloadPromise;
  const htmlPath = await htmlDownload.path();
  const exportedHtml = await readFile(htmlPath, 'utf8');

  assert.match(exportedHtml, /<script type="application\/json" id="doc-meta">/);
  assert.match(exportedHtml, /Fixture Feature Living Doc/);
  assert.match(exportedHtml, /Portable Snapshot/);
  assert.match(exportedHtml, /id="comp-iframe" srcdoc="/);
  assert.match(exportedHtml, /Living Doc Compositor/);
});
