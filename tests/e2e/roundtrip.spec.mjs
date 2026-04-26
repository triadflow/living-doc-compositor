import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { openLocalCompositor, openTopMenu } from './helpers.mjs';

test('authors a doc, renders it, reopens it from the snapshot, and re-exports the revised artifact', async ({ page }) => {
  await openLocalCompositor(page);

  await page.locator('#doc-title').fill('Roundtrip Draft Living Doc');
  await page.locator('#doc-objective').fill('First pass authored in the browser before snapshot.');

  await page.locator('[data-ct-id="status-snapshot"]').click();
  await page.locator('[data-ct-id="tooling-surface"]').click();

  await expect(page.locator('.visual-section-card').filter({ hasText: 'Status Snapshot' })).toBeVisible();
  await expect(page.locator('.visual-section-card').filter({ hasText: 'Tooling Surface' })).toBeVisible();

  await openTopMenu(page);
  const jsonDownloadPromise = page.waitForEvent('download');
  await page.locator('#top-export').click();
  const jsonDownload = await jsonDownloadPromise;
  const exportedJsonPath = await jsonDownload.path();
  const exportedJson = JSON.parse(await readFile(exportedJsonPath, 'utf8'));

  assert.equal(exportedJson.title, 'Roundtrip Draft Living Doc');
  assert.equal(exportedJson.objective, 'First pass authored in the browser before snapshot.');
  assert.deepEqual(
    exportedJson.sections.map((section) => ({
      id: section.id,
      title: section.title,
      convergenceType: section.convergenceType,
    })),
    [
      { id: 'sec-status-snapshot', title: 'Status Snapshot', convergenceType: 'status-snapshot' },
      { id: 'sec-tooling-surface', title: 'Tooling Surface', convergenceType: 'tooling-surface' },
    ],
  );

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-e2e-roundtrip-'));
  const jsonPath = path.join(tmpDir, 'roundtrip-doc.json');
  const htmlPath = path.join(tmpDir, 'roundtrip-doc.html');
  await writeFile(jsonPath, JSON.stringify(exportedJson, null, 2));

  execFileSync(process.execPath, ['scripts/render-living-doc.mjs', jsonPath], { stdio: 'inherit' });
  await page.goto(pathToFileURL(htmlPath).href);

  await expect(page.locator('h1')).toContainText('Roundtrip Draft Living Doc');
  await expect(page.locator('body')).toContainText('First pass authored in the browser before snapshot.');
  await expect(page.locator('.nav-icon[data-target="sec-status-snapshot"]')).toBeVisible();
  await expect(page.locator('.nav-icon[data-target="sec-tooling-surface"]')).toBeVisible();

  await page.locator('#comp-toggle').click();
  await expect(page.locator('#comp-overlay')).toHaveClass(/open/);

  const compositor = page.frameLocator('#comp-iframe');
  await expect(compositor.locator('#doc-title')).toHaveValue('Roundtrip Draft Living Doc');
  await expect(compositor.locator('#doc-objective')).toHaveValue('First pass authored in the browser before snapshot.');

  await compositor.locator('#doc-title').fill('Roundtrip Revised Living Doc');
  await compositor.locator('#doc-objective').fill('Second pass edited from the rendered snapshot.');

  await openTopMenu(compositor);
  const htmlDownloadPromise = page.waitForEvent('download');
  await compositor.locator('#top-html').click();
  const htmlDownload = await htmlDownloadPromise;
  const reexportedHtmlPath = await htmlDownload.path();
  const reexportedHtml = await readFile(reexportedHtmlPath, 'utf8');
  const reopenedHtmlPath = path.join(tmpDir, 'roundtrip-reexported.html');
  await writeFile(reopenedHtmlPath, reexportedHtml);

  assert.match(reexportedHtml, /Roundtrip Revised Living Doc/);
  assert.match(reexportedHtml, /Second pass edited from the rendered snapshot\./);
  assert.match(reexportedHtml, /<script type="application\/json" id="doc-meta">/);
  assert.match(reexportedHtml, /id="comp-iframe" srcdoc="/);
  assert.match(reexportedHtml, /sec-tooling-surface/);

  await page.goto(pathToFileURL(reopenedHtmlPath).href);
  await expect(page.locator('h1')).toContainText('Roundtrip Revised Living Doc');
  await expect(page.locator('body')).toContainText('Second pass edited from the rendered snapshot.');
});
