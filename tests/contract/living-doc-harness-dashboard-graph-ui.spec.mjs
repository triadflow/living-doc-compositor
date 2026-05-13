import assert from 'node:assert/strict';

import {
  collectLifecycleGraph,
  dashboardHtml,
} from '../../scripts/living-doc-harness-dashboard-server.mjs';
import { createDashboardGraphFixture } from './helpers/harness-dashboard-graph-fixture.mjs';

let fixture;

try {
  fixture = await createDashboardGraphFixture();
  const graph = await collectLifecycleGraph(fixture.lifecycleDir, {
    cwd: process.cwd(),
    runsDir: fixture.runsDir,
  });
  const html = dashboardHtml({
    runsDir: fixture.runsDir,
    evidenceDir: fixture.evidenceDir,
  });

  assert.match(html, /Living Doc Harness Live Dashboard/);
  assert.match(html, /Lifecycle Graph/);
  assert.match(html, /data-graph-node-id/);
  assert.match(html, /graph-edge-label-group/);
  assert.match(html, /graph-edge-label-box/);
  assert.match(html, /localStorage/);
  assert.match(html, /startGraphNodeDrag/);
  assert.match(html, /resetGraphLayout/);
  assert.match(html, /living-doc-harness-graph-layout:v8:/);
  assert.match(html, /graphCompactLanePosition/);
  assert.match(html, /const left = 0;/);
  assert.match(html, /DEFAULT_GRAPH_BOARD/);
  assert.match(html, /width:2400px/);
  assert.match(html, /height:1400px/);
  assert.match(html, /grid-template-columns:390px/);
  assert.match(html, /lifecycle-card-head/);
  assert.match(html, /lifecycle-status/);
  assert.match(html, /inspector-header/);
  assert.match(html, /inspector-action/);
  assert.match(html, /Operated living doc/);
  assert.doesNotMatch(html, /Run Control/);
  assert.doesNotMatch(html, /Start Lifecycle/);
  assert.doesNotMatch(html, /id="startRun"/);
  assert.doesNotMatch(html, /id="runs"/);
  assert.doesNotMatch(html, /id="detail"/);
  assert.doesNotMatch(html, /id="graphTimeline"/);
  assert.doesNotMatch(html, /graph-tick/);
  assert.doesNotMatch(html, /evidence-dock/);

  assert.match(html, /function renderCommitIntentSection\(intent\)/);
  assert.match(html, /new WebSocket\(streamUrlForLifecycle\(state\.selectedLifecycleId\)\)/);
  assert.match(html, /function applyStreamEvent\(event\)/);
  assert.match(html, /function reconcileGraphSelection\(graph, \{ previousActive = null \} = \{\}\)/);
  assert.match(html, /graphTerminalNodeId\(graph\)/);
  assert.match(html, /graph\?\.activeInferenceUnitId/);
  assert.match(html, /current-unit/);
  assert.match(html, /\/api\/lifecycles\/' \+ encodeURIComponent\(state\.selectedLifecycleId\) \+ '\/nodes\//);
  assert.match(html, /Live Events/);
  assert.match(html, /<h3>Commit Intent<\/h3>/);
  assert.match(html, /\['Required', intent\.required === true \? 'required' : 'not required'\]/);
  assert.match(html, /\['Source', intent\.source \|\| 'artifact'\]/);
  assert.match(html, /\['Reason', intent\.reason \|\| 'none'\]/);
  assert.match(html, /\['Message', intent\.message \|\| 'none'\]/);
  assert.match(html, /<h3>Body<\/h3>/);
  assert.match(html, /<h3>Changed Files<\/h3>/);
  assert.match(html, /edge\.contract\?\.commitIntent/);
  assert.match(html, /renderCommitIntentSection\(commitIntent\)/);
  assert.match(html, /graphRole\(node\) === 'repair-skill' \? renderCommitIntentSection\(node\.meta\?\.commitIntent \|\| null\)/);

  const docChangeEdge = graph.edges.find((edge) => edge.id === 'repair-unit-to-living-doc-1-2');
  assert.ok(docChangeEdge, 'changed-living-doc repair edge must exist');
  assert.equal(docChangeEdge.contract.commitIntent.source, 'repair-chain-result');
  assert.equal(docChangeEdge.contract.commitIntent.required, true);
  assert.equal(docChangeEdge.contract.commitIntent.reason, 'Repair-chain fixture deferred the commit because repair units run under commit-intent-only policy.');
  assert.equal(docChangeEdge.contract.commitIntent.message, 'Repair minimal living doc fixture from repair chain');
  assert.deepEqual(docChangeEdge.contract.commitIntent.body, ['This body comes from repair-chain-result.json, not from the per-unit result fixture.']);
  assert.deepEqual(docChangeEdge.contract.commitIntent.changedFiles, ['tests/fixtures/minimal-doc.json', 'tests/fixtures/minimal-doc.html']);

  const readinessNode = graph.nodes.find((node) => node.id === 'iteration-1-repair-3');
  assert.ok(readinessNode, 'readiness repair node must exist');
  assert.equal(readinessNode.meta.commitIntent.source, 'repair-chain-result');
  assert.equal(readinessNode.meta.commitIntent.required, false);
  assert.equal(readinessNode.meta.commitIntent.reason, 'No files changed during readiness in the repair-chain fixture.');
  assert.deepEqual(readinessNode.meta.commitIntent.changedFiles, []);

  console.log('living-doc harness dashboard graph UI contract spec: all assertions passed');
} finally {
  if (fixture) await fixture.cleanup();
}
