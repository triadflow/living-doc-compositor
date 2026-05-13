import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createHarnessRun } from '../../scripts/living-doc-harness-runner.mjs';
import {
  collectLifecycleGraph,
  dashboardHtml,
} from '../../scripts/living-doc-harness-dashboard-server.mjs';
import { createDashboardGraphFixture } from './helpers/harness-dashboard-graph-fixture.mjs';

let fixture;
let closableTmp;

try {
  fixture = await createDashboardGraphFixture();
  const lifecycleDir = path.join(fixture.runsDir, fixture.lifecycleId);
  const graph = await collectLifecycleGraph(lifecycleDir, {
    cwd: process.cwd(),
    runsDir: fixture.runsDir,
  });
  assert.equal(graph.finalState.kind, 'continuation-required');
  assert.equal(graph.activeInferenceUnitId, null);
  assert.equal(graph.nodes.some((node) => node.id === 'iteration-1-worker' && node.status === 'continuation-required'), true);
  assert.equal(graph.nodes.some((node) => node.id === 'stale-active-lifecycle'), false);

  const docChangeEdge = graph.edges.find((edge) => edge.id === 'repair-unit-to-living-doc-1-2');
  assert.ok(docChangeEdge, 'changed-living-doc repair edge must exist');
  assert.equal(docChangeEdge.contract.commitIntent.source, 'repair-chain-result');
  assert.equal(docChangeEdge.contract.commitIntent.required, true);
  assert.equal(docChangeEdge.contract.commitIntent.reason, 'Repair-chain fixture deferred the commit because repair units run under commit-intent-only policy.');
  assert.equal(docChangeEdge.contract.commitIntent.message, 'Repair minimal living doc fixture from repair chain');
  assert.deepEqual(docChangeEdge.contract.commitIntent.body, ['This body comes from repair-chain-result.json, not from the per-unit result fixture.']);
  assert.deepEqual(docChangeEdge.contract.commitIntent.changedFiles, ['tests/fixtures/minimal-doc.json', 'tests/fixtures/minimal-doc.html']);

  const readinessNode = graph.nodes.find((node) => node.id === 'iteration-1-repair-3');
  assert.ok(readinessNode, 'not-required readiness repair node must exist');
  assert.equal(readinessNode.meta.commitIntent.source, 'repair-chain-result');
  assert.equal(readinessNode.meta.commitIntent.required, false);
  assert.equal(readinessNode.meta.commitIntent.reason, 'No files changed during readiness in the repair-chain fixture.');
  assert.deepEqual(readinessNode.meta.commitIntent.changedFiles, []);

  closableTmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-dashboard-closable-'));
  const closableRunsDir = path.join(closableTmp, 'runs');
  const closableRun = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir: closableRunsDir,
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T12:30:00.000Z',
  });
  const closableLifecycleId = 'ldhl-20260507T123001Z-dashboard-closable-fixture';
  const closableLifecycleDir = path.join(closableRunsDir, closableLifecycleId);
  await mkdir(closableLifecycleDir, { recursive: true });
  await writeFile(path.join(closableRun.runDir, 'state.json'), `${JSON.stringify({
    status: 'finished',
    lifecycleStage: 'closed',
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(closableLifecycleDir, 'lifecycle-result.json'), `${JSON.stringify({
    schema: 'living-doc-harness-lifecycle-result/v1',
    resultId: closableLifecycleId,
    createdAt: '2026-05-07T12:30:01.000Z',
    docPath: 'tests/fixtures/minimal-doc.json',
    lifecycleDir: closableLifecycleDir,
    iterationCount: 1,
    runConfig: {
      schema: 'living-doc-harness-run-inference-config/v1',
      allowedUnitTypes: closableRun.contract.runConfig.allowedUnitTypes,
      prReviewPolicy: closableRun.contract.runConfig.prReviewPolicy,
    },
    finalState: {
      kind: 'closed',
      reason: 'Closability fixture reached terminal closure without repair.',
      runId: closableRun.runId,
    },
    iterations: [
      {
        iteration: 1,
        runId: closableRun.runId,
        runDir: closableRun.runDir,
        classification: 'closed',
        terminalKind: 'closed',
        nextAction: {
          action: 'stop-closed',
          allowed: false,
        },
      },
    ],
  }, null, 2)}\n`, 'utf8');

  const closableGraph = await collectLifecycleGraph(closableLifecycleDir, {
    cwd: process.cwd(),
    runsDir: closableRunsDir,
  });
  assert.equal(closableGraph.finalState.kind, 'closed');
  const closableController = closableGraph.nodes.find((node) => node.id === 'lifecycle-controller');
  assert.equal(closableController.meta.prReviewPolicy?.mode, 'disabled');
  const closableWorker = closableGraph.nodes.find((node) => node.role === 'worker');
  assert.equal(closableWorker.meta.prReviewPolicy?.mode, 'disabled');
  assert.equal(closableWorker.meta.prReviewGate.state, 'disabled');
  assert.equal(closableWorker.meta.prReviewGate.required, false);
  assert.equal(closableGraph.nodes.some((node) => node.role === 'repair-skill' || node.role === 'balance-scan'), false);
  assert.equal(closableGraph.edges.some((edge) => edge.gate === 'ordered-repair-unit-required' || edge.gate === 'balance-scan-required'), false);
  assert.equal(closableGraph.nodes.some((node) => node.role === 'worker'), true);

  const html = dashboardHtml({ runsDir: fixture.runsDir, evidenceDir: fixture.evidenceDir });
  assert.match(html, /function renderCommitIntentSection\(intent\)/);
  assert.match(html, /edge\.contract\?\.commitIntent/);
  assert.match(html, /graphRole\(node\) === 'repair-skill' \? renderCommitIntentSection\(node\.meta\?\.commitIntent \|\| null\)/);
  assert.match(html, /Commit Intent/);
  assert.match(html, /Required/);
  assert.match(html, /Source/);
  assert.match(html, /Reason/);
  assert.match(html, /Message/);
  assert.match(html, /Body/);
  assert.match(html, /Changed Files/);
  assert.match(html, /not required/);

  console.log('living-doc harness dashboard artifact graph contract spec: all assertions passed');
} finally {
  if (fixture) await fixture.cleanup();
  if (closableTmp) await rm(closableTmp, { recursive: true, force: true });
}
