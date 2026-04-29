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

  await page.getByRole('button', { name: 'Board' }).click();
  await expect(page.locator('#board-view')).toBeVisible();
  await expect(page.locator('#board-view')).toContainText('Trusted');
  await expect(page.locator('#board-view')).toContainText('Universal renderer');
  const boardTrack = page.locator('.board-track');
  await expect(boardTrack).toBeVisible();
  expect(await boardTrack.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  await page.getByRole('button', { name: 'Graph' }).click();
  await expect(page.locator('#graph-view')).toBeVisible();
  await expect(page.locator('#graph-view')).toContainText('JSON Structure Graph');
  await expect.poll(() => page.locator('#graph-view').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return Math.round(window.innerWidth - rect.width);
  })).toBeLessThan(96);
  await expect.poll(() => page.locator('.json-graph-canvas').evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBeGreaterThan(820);
  await expect(page.locator('.json-graph-canvas')).toHaveAttribute('data-graph-gravity', 'settled');
  await expect(page.locator('.json-graph-node-section').filter({ hasText: 'Tooling Surface' })).toBeVisible();
  await expect(page.locator('.json-graph-node-card').filter({ hasText: 'Universal renderer' })).toBeVisible();
  const graphCardNode = page.locator('.json-graph-node-card').first();
  await graphCardNode.click();
  await expect(page.locator('.json-graph-inspector')).toContainText('$.sections');
  await expect(page.locator('.json-graph-node.dimmed')).toHaveCount(0);
  await expect(page.locator('.json-graph-edge-group.dimmed')).toHaveCount(0);
  const graphSvg = page.locator('[data-graph-svg]');
  const graphViewBoxBeforeZoom = await graphSvg.getAttribute('viewBox');
  await page.locator('[data-graph-zoom="in"]').click();
  await expect.poll(() => graphSvg.getAttribute('viewBox')).not.toBe(graphViewBoxBeforeZoom);
  await expect(page.locator('[data-graph-info]')).toContainText('%');
  await page.locator('[data-graph-fullscreen]').click();
  await expect(page.locator('.json-graph-canvas')).toHaveClass(/graph-fullscreen/);
  await page.locator('[data-graph-fullscreen]').click();
  await expect(page.locator('.json-graph-canvas')).not.toHaveClass(/graph-fullscreen/);
  const draggableGraphNode = page.locator('.json-graph-node-document');
  const graphNodeTransformBeforeDrag = await draggableGraphNode.getAttribute('transform');
  const graphNodeBox = await draggableGraphNode.locator('.json-graph-node-hit').boundingBox();
  expect(graphNodeBox).toBeTruthy();
  await page.mouse.move(graphNodeBox.x + graphNodeBox.width / 2, graphNodeBox.y + graphNodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(graphNodeBox.x + graphNodeBox.width / 2 + 44, graphNodeBox.y + graphNodeBox.height / 2 + 18);
  await page.mouse.up();
  await expect.poll(() => draggableGraphNode.getAttribute('transform')).not.toBe(graphNodeTransformBeforeDrag);

  await page.locator('#comp-toggle').click();
  await expect(page.locator('#comp-overlay')).toHaveClass(/open/);

  const compositor = page.frameLocator('#comp-iframe');
  await expect(compositor.locator('#top-bar')).toContainText('Living Doc Compositor');
  await expect(compositor.locator('#doc-title')).toHaveValue('Fixture Feature Living Doc');
  await expect(compositor.locator('.visual-section-card').filter({ hasText: 'Tooling Surface' })).toBeVisible();
  await compositor.getByRole('button', { name: 'Board' }).click();
  await expect(compositor.locator('.board-preview')).toContainText('Trusted');
  await expect(compositor.locator('.board-preview')).toContainText('Universal renderer');
  const previewTrack = compositor.locator('.board-preview-track');
  await expect(previewTrack).toBeVisible();
  expect(await previewTrack.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});
