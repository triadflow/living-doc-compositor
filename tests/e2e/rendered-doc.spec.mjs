import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

let renderedHtmlUrl;

function pdfFixtureBytes() {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 160] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 52 >>\nstream\nBT /F1 18 Tf 42 86 Td (Embedded PDF fixture) Tj ET\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'utf8');
}

test.beforeAll(async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-e2e-rendered-'));
  const jsonPath = path.join(tmpDir, 'feature-doc.json');
  const htmlPath = path.join(tmpDir, 'feature-doc.html');
  const embeddedRoot = path.join(tmpDir, 'embedded-pages');
  await copyFile('tests/fixtures/feature-doc.json', jsonPath);
  await mkdir(path.join(embeddedRoot, 'notes'), { recursive: true });
  await writeFile(path.join(embeddedRoot, 'overview.html'), '<!doctype html><html><head><title>Popup HTML</title></head><body><main><h1>Embedded popup page</h1><p>Rendered from integrated content.</p></main></body></html>\n');
  await writeFile(path.join(embeddedRoot, 'notes', 'context.md'), '# Popup Markdown\n\nRendered from integrated markdown content.\n');
  await writeFile(path.join(embeddedRoot, 'notes', 'brief.pdf'), pdfFixtureBytes());
  execFileSync(process.execPath, ['scripts/render-living-doc.mjs', jsonPath, '--embed-file-library', embeddedRoot, '--embed-file-library-label', 'Popup fixture'], { stdio: 'inherit' });
  renderedHtmlUrl = pathToFileURL(htmlPath).href;
});

test('opens rendered HTML and launches the embedded compositor with current document data', async ({ page }) => {
  await page.goto(renderedHtmlUrl);

  await expect(page.locator('h1')).toContainText('Fixture Feature Living Doc');
  await expect(page.locator('#snapshot-generated-at')).toBeVisible();
  await expect(page.locator('.nav-icon[data-target="status-snapshot"]')).toBeVisible();
  await expect(page.locator('#tooling')).toContainText('Universal renderer');

  await expect(page.locator('#embedded-file-library')).toHaveCount(0);

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
  const dragStart = {
    x: graphNodeBox.x + graphNodeBox.width / 2,
    y: graphNodeBox.y + graphNodeBox.height / 2,
  };
  const dragEnd = { x: dragStart.x + 44, y: dragStart.y + 18 };
  await draggableGraphNode.dispatchEvent('pointerdown', {
    button: 0,
    buttons: 1,
    pointerId: 1,
    clientX: dragStart.x,
    clientY: dragStart.y,
  });
  await page.evaluate(({ x, y }) => {
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
      clientX: x,
      clientY: y,
    }));
  }, dragEnd);
  await page.evaluate(({ x, y }) => {
    document.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      buttons: 0,
      pointerId: 1,
      clientX: x,
      clientY: y,
    }));
  }, dragEnd);
  await expect.poll(() => draggableGraphNode.getAttribute('transform')).not.toBe(graphNodeTransformBeforeDrag);

  await page.locator('#comp-toggle').click();
  await expect(page.locator('#comp-overlay')).toHaveClass(/open/);

  const compositor = page.frameLocator('#comp-iframe');
  await expect(compositor.locator('#top-bar')).toContainText('Living Doc Compositor');
  await expect(compositor.locator('#doc-title')).toHaveValue('Fixture Feature Living Doc');
  await compositor.locator('.rail-button[data-rail-mode="library"]').click();
  await expect(compositor.locator('[data-embedded-file-path="overview.html"]')).toContainText('Popup HTML');
  await expect(compositor.locator('[data-embedded-file-path="notes/context.md"]')).toContainText('Popup Markdown');
  await expect(compositor.locator('[data-embedded-file-path="notes/brief.pdf"]')).toContainText('brief.pdf');
  await expect(compositor.locator('[data-embedded-file-path="notes/brief.pdf"]')).toContainText('PDF');
  await compositor.locator('[data-embedded-file-path="overview.html"]').click();
  await expect(page.locator('#comp-overlay')).toHaveClass(/open/);
  await expect(page.locator('#embedded-file-modal')).toBeVisible();
  await expect(page.locator('#embedded-file-title')).toHaveText('Popup HTML');
  await expect(page.locator('#embedded-file-path')).toHaveText('overview.html');
  const embeddedFrame = page.frameLocator('.embedded-file-frame');
  await expect(embeddedFrame.locator('h1')).toHaveText('Embedded popup page');
  await page.locator('#embedded-file-close').click();
  await expect(page.locator('#embedded-file-modal')).toBeHidden();
  await expect(page.locator('#comp-overlay')).toHaveClass(/open/);
  await compositor.locator('.rail-button[data-rail-mode="library"]').click();
  await compositor.locator('[data-embedded-file-path="notes/context.md"]').click();
  await expect(page.locator('#comp-overlay')).toHaveClass(/open/);
  await expect(page.locator('#embedded-file-modal')).toBeVisible();
  await expect(page.locator('.embedded-markdown')).toContainText('Popup Markdown');
  await page.keyboard.press('Escape');
  await expect(page.locator('#embedded-file-modal')).toBeHidden();
  await compositor.locator('[data-embedded-file-path="notes/brief.pdf"]').click();
  await expect(page.locator('#embedded-file-modal')).toBeVisible();
  await expect(page.locator('#embedded-file-title')).toHaveText('brief.pdf');
  await expect(page.locator('#embedded-file-kind')).toHaveText('Embedded PDF');
  await expect(page.locator('.embedded-pdf-frame')).toBeVisible();
  await expect(page.locator('.embedded-pdf-actions a')).toHaveText('Open PDF');
  await expect(page.locator('.embedded-pdf-actions a')).toHaveAttribute('href', /^blob:/);
  await page.locator('#embedded-file-close').click();
  await expect(page.locator('#embedded-file-modal')).toBeHidden();
  await expect(page.locator('#comp-overlay')).toHaveClass(/open/);
  await expect(compositor.locator('.visual-section-card').filter({ hasText: 'Tooling Surface' })).toBeVisible();
  await page.waitForTimeout(1300);
  await compositor.locator('.preview-tab[data-tab="board"]').click();
  await expect(compositor.locator('.board-preview')).toContainText('Trusted');
  await expect(compositor.locator('.board-preview')).toContainText('Universal renderer');
  const previewTrack = compositor.locator('.board-preview-track');
  await expect(previewTrack).toBeVisible();
  expect(await previewTrack.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});
