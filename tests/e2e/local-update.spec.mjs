import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

let server;
let serverOrigin;
let manifestRequests = 0;
let latestHtml = '';
let latestHtmlUrl;
let localHtmlPath;
let localHtmlUrl;
let originalLocalHtml = '';

async function listen(serverInstance) {
  await new Promise((resolve, reject) => {
    serverInstance.listen(0, '127.0.0.1', (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function closeServer(serverInstance) {
  if (!serverInstance) return;
  await new Promise((resolve, reject) => {
    serverInstance.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    if (req.url === '/manifest.json') {
      manifestRequests += 1;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        docId: 'test:feature-doc',
        version: 'fixture-v2',
        htmlUrl: latestHtmlUrl,
      }));
      return;
    }

    if (req.url === '/latest/feature-doc.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(latestHtml);
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  serverOrigin = `http://127.0.0.1:${address.port}`;
  latestHtmlUrl = `${serverOrigin}/latest/feature-doc.html`;

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-local-update-'));
  const fixture = JSON.parse(await readFile('tests/fixtures/feature-doc.json', 'utf8'));

  const v1 = structuredClone(fixture);
  v1.title = 'Fixture Feature Living Doc v1';
  v1.version = 'fixture-v1';
  v1.updateSource = { manifestUrl: `${serverOrigin}/manifest.json` };

  const v2 = structuredClone(fixture);
  v2.title = 'Fixture Feature Living Doc v2';
  v2.version = 'fixture-v2';
  v2.updateSource = { manifestUrl: `${serverOrigin}/manifest.json` };

  const v1JsonPath = path.join(tmpDir, 'feature-doc-v1.json');
  const v2JsonPath = path.join(tmpDir, 'feature-doc-v2.json');
  localHtmlPath = path.join(tmpDir, 'feature-doc-v1.html');
  const latestHtmlPath = path.join(tmpDir, 'feature-doc-v2.html');

  await writeFile(v1JsonPath, JSON.stringify(v1, null, 2));
  await writeFile(v2JsonPath, JSON.stringify(v2, null, 2));

  execFileSync(process.execPath, ['scripts/render-living-doc.mjs', v1JsonPath], { stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/render-living-doc.mjs', v2JsonPath], { stdio: 'inherit' });

  originalLocalHtml = await readFile(localHtmlPath, 'utf8');
  latestHtml = await readFile(latestHtmlPath, 'utf8');
  localHtmlUrl = pathToFileURL(localHtmlPath).href;
});

test.afterAll(async () => {
  await closeServer(server);
});

test('file:// doc detects newer upstream version and refreshes via latest artifact without mutating the local file', async ({ page }) => {
  await page.goto(localHtmlUrl);

  await expect(page.locator('h1')).toContainText('Fixture Feature Living Doc v1');

  const updateBanner = page.locator('#ld-update-banner');
  await expect(updateBanner).toBeVisible();
  await expect(updateBanner).toContainText('Update available');
  await expect(updateBanner).toContainText('fixture-v2');
  assert.ok(manifestRequests > 0, 'doc should check the remote manifest');

  await updateBanner.getByRole('button', { name: 'Refresh' }).click();

  await page.waitForURL(latestHtmlUrl);
  await expect(page.locator('h1')).toContainText('Fixture Feature Living Doc v2');

  const localHtmlAfter = await readFile(localHtmlPath, 'utf8');
  assert.equal(localHtmlAfter, originalLocalHtml, 'plain file:// refresh should not overwrite the local file');
  assert.match(localHtmlAfter, /Fixture Feature Living Doc v1/);
  assert.doesNotMatch(localHtmlAfter, /Fixture Feature Living Doc v2/);
});
