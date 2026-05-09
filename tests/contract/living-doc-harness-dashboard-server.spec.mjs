import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createHarnessRun } from '../../scripts/living-doc-harness-runner.mjs';
import { createDashboardServer } from '../../scripts/living-doc-harness-dashboard-server.mjs';

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

async function jsonFetch(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  return { response, body };
}

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('timed out waiting for condition');
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-dashboard-server-'));
const runsDir = path.join(tmp, 'runs');
const evidenceDir = path.join(tmp, 'evidence');
let server;

try {
  const prepared = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir,
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T12:00:00.000Z',
  });

  server = createDashboardServer({
    cwd: process.cwd(),
    runsDir,
    evidenceDir,
  });
  const base = await listen(server);

  const health = await jsonFetch(`${base}/api/health`);
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.schema, 'living-doc-harness-dashboard-health/v1');

  const page = await fetch(`${base}/`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Living Doc Harness Live Dashboard/);
  assert.match(html, /\/api\/runs/);
  assert.match(html, /Lifecycle Graph/);
  assert.match(html, /Standalone replacement dashboard/);
  assert.match(html, /\/api\/lifecycles/);
  assert.match(html, /data-graph-node-id/);
  assert.match(html, /graph-edge-label-group/);
  assert.match(html, /graph-edge-label-box/);
  assert.match(html, /localStorage/);
  assert.match(html, /startGraphNodeDrag/);
  assert.match(html, /resetGraphLayout/);
  assert.match(html, /living-doc-harness-graph-layout:v2:/);
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

  const runs = await jsonFetch(`${base}/api/runs`);
  assert.equal(runs.response.status, 200);
  assert.equal(runs.body.schema, 'living-doc-harness-dashboard-runs/v1');
  assert.equal(runs.body.runCount, 1);
  assert.equal(runs.body.runs[0].runId, prepared.runId);
  assert.equal(runs.body.runs[0].process.isolatedFromUserSession, true);
  assert.equal(runs.body.runs[0].privacy.rawNativeTraceIncluded, false);

  const runDetail = await jsonFetch(`${base}/api/runs/${encodeURIComponent(prepared.runId)}`);
  assert.equal(runDetail.response.status, 200);
  assert.equal(runDetail.body.runId, prepared.runId);
  assert.equal(runDetail.body.artifacts.contract, 'contract.json');

  const tail = await jsonFetch(`${base}/api/runs/${encodeURIComponent(prepared.runId)}/tail?lines=20`);
  assert.equal(tail.response.status, 200);
  assert.equal(tail.body.schema, 'living-doc-harness-run-tail/v1');
  assert.equal(tail.body.privacy.localOperatorOnly, true);
  assert.equal(tail.body.privacy.rawNativeTraceIncluded, false);
  assert.equal(tail.body.runEvents.some((line) => line.includes('run-created')), true);

  const repairUnitDir = path.join(prepared.runDir, 'repair-skills', 'iteration-1', '01-live-repair-unit');
  const docUpdateUnitDir = path.join(prepared.runDir, 'repair-skills', 'iteration-1', '02-doc-update-unit');
  await mkdir(repairUnitDir, { recursive: true });
  await mkdir(docUpdateUnitDir, { recursive: true });
  await writeFile(path.join(repairUnitDir, 'prompt.md'), 'hidden local prompt\n', 'utf8');
  await writeFile(path.join(repairUnitDir, 'input-contract.json'), `${JSON.stringify({
    schema: 'living-doc-repair-skill-chain-input/v1',
    unitRole: 'repair-skill',
    skill: 'live-repair-unit',
    sequence: 1,
    requiredInspectionPaths: ['/tmp/required-evidence.json'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(repairUnitDir, 'codex-events.jsonl'), '{"type":"thread.started"}\n', 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'prompt.md'), 'hidden local update prompt\n', 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'input-contract.json'), `${JSON.stringify({
    schema: 'living-doc-repair-skill-chain-input/v1',
    unitRole: 'repair-skill',
    skill: 'doc-update-unit',
    sequence: 2,
    requiredInspectionPaths: ['/tmp/required-evidence.json'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'codex-events.jsonl'), '{"type":"thread.started"}\n', 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'result.json'), `${JSON.stringify({
    schema: 'living-doc-harness-inference-unit-result/v1',
    unitId: 'doc-update-unit',
    role: 'repair-skill',
    status: 'repaired',
    outputContract: {
      schema: 'living-doc-repair-skill-result/v1',
      skill: 'doc-update-unit',
      sequence: 2,
      status: 'repaired',
      changedFiles: [
        'tests/fixtures/minimal-doc.json',
        'tests/fixtures/minimal-doc.html',
      ],
      commitSha: 'abcdef1234567890',
      commitMessage: 'Repair minimal living doc fixture',
      nextRecommendedAction: 'continue-repair-chain',
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'validation.json'), `${JSON.stringify({ ok: true }, null, 2)}\n`, 'utf8');
  setTimeout(() => {
    writeFile(path.join(repairUnitDir, 'codex-events.jsonl'), '{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"command_execution","command":"cat /tmp/required-evidence.json","status":"completed","exit_code":0}}\n', 'utf8');
  }, 100);

  const repairUnits = await jsonFetch(`${base}/api/runs/${encodeURIComponent(prepared.runId)}/repair-units`);
  assert.equal(repairUnits.response.status, 200);
  assert.equal(repairUnits.body.schema, 'living-doc-harness-repair-units/v1');
  assert.equal(repairUnits.body.unitCount, 2);
  assert.equal(repairUnits.body.units[0].unitKey, 'iteration-1/01-live-repair-unit');
  assert.equal(repairUnits.body.units[0].status, 'running');
  assert.equal(repairUnits.body.units[0].hasCodexEvents, true);
  assert.deepEqual(repairUnits.body.units[1].changedFiles, ['tests/fixtures/minimal-doc.json', 'tests/fixtures/minimal-doc.html']);
  assert.equal(repairUnits.body.units[1].commitSha, 'abcdef1234567890');
  assert.equal(repairUnits.body.privacy.rawPromptIncluded, false);

  const liveRepairTail = await waitFor(async () => {
    const result = await jsonFetch(`${base}/api/runs/${encodeURIComponent(prepared.runId)}/repair-units/iteration-1/01-live-repair-unit/tail?lines=20`);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.schema, 'living-doc-harness-repair-unit-tail/v1');
    assert.equal(result.body.privacy.localOperatorOnly, true);
    assert.equal(result.body.privacy.rawPromptIncluded, false);
    return result.body.codexEvents.some((line) => line.includes('/tmp/required-evidence.json')) ? result.body : null;
  });
  assert.equal(liveRepairTail.status, 'running');
  assert.equal(liveRepairTail.result.length, 0);

  const reviewerDir = path.join(prepared.runDir, 'reviewer-inference');
  const outputInputDir = path.join(prepared.runDir, 'output-input');
  const terminalDir = path.join(prepared.runDir, 'terminal');
  await mkdir(reviewerDir, { recursive: true });
  await mkdir(outputInputDir, { recursive: true });
  await mkdir(terminalDir, { recursive: true });
  const reviewerInputPath = path.join(reviewerDir, 'iteration-1-input.json');
  const reviewerPromptPath = path.join(reviewerDir, 'iteration-1-prompt.md');
  const reviewerVerdictPath = path.join(reviewerDir, 'iteration-1-verdict.json');
  const terminalPath = path.join(terminalDir, 'iteration-1-true-blocked.json');
  const outputInputPath = path.join(outputInputDir, 'iteration-1.json');
  await writeFile(reviewerPromptPath, 'Inspect the raw worker JSONL and classify the lifecycle transition.\n', 'utf8');
  await writeFile(reviewerInputPath, `${JSON.stringify({
    schema: 'living-doc-harness-reviewer-input/v1',
    runId: prepared.runId,
    iteration: 1,
    rawWorkerJsonlPaths: ['/tmp/raw-worker.jsonl'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(reviewerVerdictPath, `${JSON.stringify({
    schema: 'living-doc-harness-reviewer-verdict/v1',
    runId: prepared.runId,
    iteration: 1,
    createdAt: '2026-05-07T12:00:10.000Z',
    mode: 'fixture',
    reviewerInputPath: 'reviewer-inference/iteration-1-input.json',
    promptPath: 'reviewer-inference/iteration-1-prompt.md',
    codexEventsPath: 'reviewer-inference/iteration-1-codex-events.jsonl',
    verdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification: 'repairable',
        reasonCode: 'graph-fixture-repairable',
        closureAllowed: false,
      },
      nextIteration: {
        allowed: true,
        mode: 'repair',
      },
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(terminalPath, `${JSON.stringify({
    id: 'blocker-graph-fixture',
    kind: 'true-blocked',
    status: 'terminal',
    reasonCode: 'graph-fixture-blocked',
    loopMayContinue: false,
    nextAction: 'create issue and stop',
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(prepared.runDir, 'terminal-states.jsonl'), `${JSON.stringify({
    id: 'blocker-graph-fixture',
    kind: 'true-blocked',
    status: 'terminal',
    reasonCode: 'graph-fixture-blocked',
    loopMayContinue: false,
    createdAt: '2026-05-07T12:00:20.000Z',
  })}\n`, 'utf8');
  await writeFile(path.join(prepared.runDir, 'blockers.jsonl'), `${JSON.stringify({
    id: 'blocker-graph-fixture',
    reasonCode: 'graph-fixture-blocked',
    owningLayer: 'dashboard-graph',
    issueRef: '#209',
    unblockCriteria: ['prove graph nodes are artifact-derived'],
  })}\n`, 'utf8');
  await writeFile(outputInputPath, `${JSON.stringify({
    schema: 'living-doc-harness-output-input/v1',
    runId: prepared.runId,
    iteration: 1,
    previousOutput: {
      classification: 'true-block',
      terminalKind: 'true-blocked',
      reviewerVerdictPath: 'reviewer-inference/iteration-1-verdict.json',
      terminalPath: 'terminal/iteration-1-true-blocked.json',
    },
    nextAction: {
      action: 'stop-terminal-state',
      allowed: false,
      reason: 'Graph fixture terminal state.',
    },
  }, null, 2)}\n`, 'utf8');
  const graphLifecycleId = 'ldhl-20260507T120030Z-dashboard-graph-fixture';
  const graphLifecycleDir = path.join(runsDir, graphLifecycleId);
  await mkdir(graphLifecycleDir, { recursive: true });
  await writeFile(path.join(graphLifecycleDir, 'lifecycle-result.json'), `${JSON.stringify({
    schema: 'living-doc-harness-lifecycle-result/v1',
    resultId: graphLifecycleId,
    createdAt: '2026-05-07T12:00:30.000Z',
    docPath: 'tests/fixtures/minimal-doc.json',
    lifecycleDir: graphLifecycleDir,
    maxIterations: 1,
    iterationCount: 1,
    finalState: {
      kind: 'true-blocked',
      reason: 'Graph fixture terminal state.',
      runId: prepared.runId,
    },
    iterations: [
      {
        iteration: 1,
        runId: prepared.runId,
        runDir: prepared.runDir,
        classification: 'true-block',
        terminalKind: 'true-blocked',
        nextAction: {
          action: 'stop-terminal-state',
          allowed: false,
        },
        outputInputPath,
        reviewerVerdictPath,
        proofValid: true,
      },
    ],
  }, null, 2)}\n`, 'utf8');

  const lifecycles = await jsonFetch(`${base}/api/lifecycles`);
  assert.equal(lifecycles.response.status, 200);
  assert.equal(lifecycles.body.schema, 'living-doc-harness-dashboard-lifecycles/v1');
  assert.equal(lifecycles.body.lifecycles.some((item) => item.resultId === graphLifecycleId), true);

  const graph = await jsonFetch(`${base}/api/lifecycles/${encodeURIComponent(graphLifecycleId)}/graph`);
  assert.equal(graph.response.status, 200);
  assert.equal(graph.body.schema, 'living-doc-harness-inference-graph/v1');
  assert.equal(graph.body.privacy.localOperatorOnly, true);
  assert.equal(graph.body.privacy.rawPromptIncluded, false);
  assert.equal(graph.body.nodes.some((node) => node.role === 'worker'), true);
  assert.equal(graph.body.nodes.some((node) => node.role === 'reviewer'), true);
  assert.equal(graph.body.nodes.some((node) => node.role === 'living-doc' && node.artifactPaths.livingDocPath === 'tests/fixtures/minimal-doc.json'), true);
  assert.equal(graph.body.nodes.some((node) => node.role === 'repair-skill' && node.status === 'running'), true);
  assert.equal(graph.body.nodes.some((node) => node.type === 'terminal-state'), true);
  assert.equal(graph.body.nodes.some((node) => node.type === 'blocker' && node.meta.issueRef === '#209'), true);
  assert.equal(graph.body.nodes.some((node) => node.type === 'issue' && node.label === '#209'), true);
  assert.equal(graph.body.edges.some((edge) => edge.from.includes('worker') && edge.to.includes('reviewer') && edge.contract.inputContractPath && edge.contract.evidencePaths.includes('/tmp/raw-worker.jsonl')), true);
  assert.equal(graph.body.edges.some((edge) => edge.to.includes('repair') && edge.contract.codexEventsPath), true);
  assert.equal(graph.body.edges.some((edge) => edge.to === 'operated-living-doc' && edge.label === 'commit abcdef1234' && edge.contract.commitSha === 'abcdef1234567890' && edge.contract.changedFiles.includes('tests/fixtures/minimal-doc.json')), true);

  const created = await jsonFetch(`${base}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      docPath: 'tests/fixtures/minimal-doc.json',
      execute: false,
    }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.schema, 'living-doc-harness-dashboard-run-created/v1');
  assert.equal(created.body.executed, false);
  assert.match(created.body.runId, /^ldh-/);

  const fakeBin = path.join(tmp, 'fake-codex');
  const fakeCodexHome = path.join(tmp, 'fake-codex-home');
  await writeFile(fakeBin, `#!/bin/sh
mkdir -p "$CODEX_HOME/sessions/2026/05/07"
LIVE_TS="$(node -e 'console.log(new Date().toISOString())')"
cat > "$CODEX_HOME/sessions/2026/05/07/rollout-dashboard-live.jsonl" <<EOF
{"timestamp":"$LIVE_TS","type":"session_meta","payload":{"id":"dashboard-live","source":"codex-cli","cli_version":"test","model_provider":"openai","cwd":"/private/path"}}
EOF
printf '{"type":"done"}\\n'
exit 0
`, 'utf8');
  await chmod(fakeBin, 0o755);
  await mkdir(fakeCodexHome, { recursive: true });

  const started = await jsonFetch(`${base}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      docPath: 'tests/fixtures/minimal-doc.json',
      execute: true,
      now: '2026-05-07T12:10:00.000Z',
      codexBin: fakeBin,
      codexHome: fakeCodexHome,
    }),
  });
  assert.equal(started.response.status, 202);
  assert.equal(started.body.schema, 'living-doc-harness-dashboard-run-started/v1');
  assert.equal(started.body.background, true);

  const backgroundContractPath = path.join(runsDir, started.body.runId, 'contract.json');
  await waitFor(async () => {
    try {
      const contract = JSON.parse(await readFile(backgroundContractPath, 'utf8'));
      return contract.status === 'finished' ? contract : null;
    } catch {
      return null;
    }
  });

  const lifecycleSequencePath = path.join(tmp, 'dashboard-lifecycle-sequence.json');
  await writeFile(lifecycleSequencePath, `${JSON.stringify({
    schema: 'living-doc-harness-lifecycle-evidence-sequence/v1',
    iterations: [
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Dashboard lifecycle controller fixture reached closure.',
        reviewerVerdict: {
          schema: 'living-doc-harness-stop-verdict/v1',
          stopVerdict: {
            classification: 'closed',
            reasonCode: 'dashboard-lifecycle-fixture',
            confidence: 'high',
            closureAllowed: true,
            basis: ['Dashboard lifecycle fixture provided a closed verdict.'],
          },
          nextIteration: {
            allowed: false,
            mode: 'none',
            instruction: 'Stop.',
          },
        },
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const lifecycle = await jsonFetch(`${base}/api/lifecycles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      docPath: 'tests/fixtures/minimal-doc.json',
      evidenceSequencePath: lifecycleSequencePath,
      maxIterations: 1,
      now: '2026-05-07T12:20:00.000Z',
      execute: false,
      executeRepairSkills: false,
    }),
  });
  assert.equal(lifecycle.response.status, 202);
  assert.equal(lifecycle.body.schema, 'living-doc-harness-dashboard-lifecycle-started/v1');
  assert.match(lifecycle.body.resultId, /^ldhl-/);
  assert.equal(lifecycle.body.background, true);
  const lifecycleResultPath = path.join(runsDir, lifecycle.body.resultId, 'lifecycle-result.json');
  const lifecycleResult = await waitFor(async () => {
    try {
      return JSON.parse(await readFile(lifecycleResultPath, 'utf8'));
    } catch {
      return null;
    }
  });
  assert.equal(lifecycleResult.finalState.kind, 'closed');
  assert.equal(lifecycleResult.iterationCount, 1);

  const bundle = await jsonFetch(`${base}/api/evidence/bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: prepared.runId }),
  });
  assert.equal(bundle.response.status, 200);
  assert.equal(bundle.body.schema, 'living-doc-harness-dashboard-bundle-written/v1');
  assert.equal(bundle.body.runId, prepared.runId);
  assert.match(bundle.body.bundlePath, /bundle\.json$/);
} finally {
  if (server) await close(server);
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness dashboard server contract spec: all assertions passed');
