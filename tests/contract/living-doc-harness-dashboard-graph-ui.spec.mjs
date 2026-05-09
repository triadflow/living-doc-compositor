import assert from 'node:assert/strict';

import { chromium } from '@playwright/test';

import { createDashboardServer } from '../../scripts/living-doc-harness-dashboard-server.mjs';
import { createDashboardGraphFixture } from './helpers/harness-dashboard-graph-fixture.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
}

function labelPoint(transform) {
  const match = String(transform || '').match(/translate\(([-\d.]+)\s+([-\d.]+)\)/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

function endpointPathNumbers(d) {
  return Array.from(String(d || '').matchAll(/[-]?\d+(?:\.\d+)?/g)).map((match) => Number(match[0]));
}

let fixture;
let server;
let browser;

try {
  fixture = await createDashboardGraphFixture();
  server = createDashboardServer({
    cwd: process.cwd(),
    runsDir: fixture.runsDir,
    evidenceDir: fixture.evidenceDir,
  });
  const base = await listen(server);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator(`[data-lifecycle-id="${fixture.lifecycleId}"]`).click();
  await page.waitForSelector('[data-role="living-doc"]');
  await page.waitForSelector('[data-graph-edge-id="repair-unit-to-living-doc-1-2"].graph-edge-line');

  const canvasState = await page.evaluate(() => {
    const doc = document.querySelector('[data-role="living-doc"]');
    const docRect = doc?.getBoundingClientRect();
    const boardRect = document.querySelector('#graphBoard')?.getBoundingClientRect();
    const edgeId = 'repair-unit-to-living-doc-1-2';
    const edge = document.querySelector(`[data-graph-edge-id="${edgeId}"].graph-edge-line`);
    const label = document.querySelector(`[data-graph-edge-id="${edgeId}"].graph-edge-label-group`);
    return {
      boardSize: boardRect ? { width: Math.round(boardRect.width), height: Math.round(boardRect.height) } : null,
      docSize: docRect ? { width: Math.round(docRect.width), height: Math.round(docRect.height) } : null,
      hasRunControl: document.body.textContent.includes('Run Control'),
      hasRunsPanel: Boolean(document.querySelector('#runs')),
      hasGraphTimeline: Boolean(document.querySelector('#graphTimeline')),
      nodeCount: document.querySelectorAll('.graph-node-card').length,
      changeEdgePath: edge?.getAttribute('d') || '',
      changeEdgeLabel: label?.getAttribute('transform') || '',
      hasControllerDocEdge: Boolean(document.querySelector('[data-graph-edge-id="living-doc-to-lifecycle-controller"]')),
    };
  });

  assert.deepEqual(canvasState.boardSize, { width: 2400, height: 1400 });
  assert.deepEqual(canvasState.docSize, { width: 250, height: 104 });
  assert.equal(canvasState.hasRunControl, false);
  assert.equal(canvasState.hasRunsPanel, false);
  assert.equal(canvasState.hasGraphTimeline, false);
  assert.equal(canvasState.hasControllerDocEdge, false);
  assert.equal(canvasState.nodeCount >= 8, true);

  const edgeNumbers = endpointPathNumbers(canvasState.changeEdgePath);
  const label = labelPoint(canvasState.changeEdgeLabel);
  assert.equal(edgeNumbers.length >= 8, true);
  assert.ok(label);
  assert.equal(edgeNumbers[0] > edgeNumbers.at(-2), true, 'change edge must route leftward into the living-doc card');
  assert.equal(Math.abs(label.x - Math.round((edgeNumbers[0] + edgeNumbers.at(-2)) / 2)) <= 2, true);
  assert.equal(Math.abs(label.y - Math.round((edgeNumbers[1] + edgeNumbers.at(-1)) / 2)) <= 12, true);

  await page.locator('[data-role="living-doc"]').click();
  const docInspector = await page.evaluate(() => ({
    kicker: document.querySelector('.inspector-kicker')?.textContent,
    title: document.querySelector('.inspector-title')?.textContent,
    activeNode: document.querySelector('.graph-node-card.active')?.dataset.graphNodeId,
  }));
  assert.equal(docInspector.kicker, 'Operated living doc');
  assert.equal(docInspector.title, 'Minimal Fixture Living Doc');
  assert.equal(docInspector.activeNode, 'operated-living-doc');

  await page.locator('[data-graph-node-id="iteration-1-worker"]').click();
  const workerInspector = await page.evaluate(() => ({
    kicker: document.querySelector('.inspector-kicker')?.textContent,
    title: document.querySelector('.inspector-title')?.textContent,
    activeNode: document.querySelector('.graph-node-card.active')?.dataset.graphNodeId,
  }));
  assert.equal(workerInspector.kicker, 'Inference unit');
  assert.equal(workerInspector.title, 'Worker iteration 1');
  assert.equal(workerInspector.activeNode, 'iteration-1-worker');

  await page.locator('[data-graph-edge-id="repair-unit-to-living-doc-1-2"].graph-edge-label-group').click({ force: true });
  const edgeInspector = await page.evaluate(() => {
    const text = document.querySelector('#graphInspector')?.textContent || '';
    return {
      kicker: document.querySelector('.inspector-kicker')?.textContent,
      title: document.querySelector('.inspector-title')?.textContent,
      activeEdges: document.querySelectorAll('.graph-edge-line.active').length,
      hasChangedJson: text.includes('tests/fixtures/minimal-doc.json'),
      hasCommitSha: text.includes('abcdef1234567890'),
    };
  });
  assert.equal(edgeInspector.kicker, 'Contract arrow');
  assert.equal(edgeInspector.title, 'commit abcdef1234');
  assert.equal(edgeInspector.activeEdges, 1);
  assert.equal(edgeInspector.hasChangedJson, true);
  assert.equal(edgeInspector.hasCommitSha, true);

  console.log('living-doc harness dashboard graph UI contract spec: all assertions passed');
} finally {
  if (browser) await browser.close();
  if (server) await close(server);
  if (fixture) await fixture.cleanup();
}
