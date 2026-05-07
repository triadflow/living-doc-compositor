import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHarnessRun } from '../../scripts/living-doc-harness-runner.mjs';
import { attachTraceSummaryToRun } from '../../scripts/living-doc-harness-trace-reader.mjs';
import { inferStopNegotiation } from '../../scripts/living-doc-harness-stop-negotiation.mjs';
import { routeStopVerdict } from '../../scripts/living-doc-harness-skill-router.mjs';
import { writeTerminalState } from '../../scripts/living-doc-harness-terminal-state.mjs';
import { renderDashboard, writeEvidenceBundle } from '../../scripts/living-doc-harness-evidence-dashboard.mjs';

const hashC = `sha256:${'c'.repeat(64)}`;
const privatePayload = 'PRIVATE_TRACE_PAYLOAD_SHOULD_NOT_LEAK';

function evidence() {
  return {
    runId: 'ldh-evidence-test',
    objectiveState: {
      objectiveHash: hashC,
      stageBefore: 'implementing',
      stageAfter: 'blocked',
      unresolvedObjectiveTerms: ['source must be readable'],
      unprovenAcceptanceCriteria: ['criterion-true-block-mode'],
    },
    workerEvidence: {
      nativeInferenceTraceRefs: ['traces/trace.summary.json'],
      wrapperLogRefs: ['codex-turns/codex-events.jsonl'],
      finalMessageSummary: 'Terminal condition detected.',
      toolFailures: [],
      filesChanged: [],
    },
    proofGates: {
      standaloneRun: 'pass',
      nativeTraceInspected: 'pass',
      livingDocRendered: 'pass',
      acceptanceCriteriaSatisfied: 'fail',
      evidenceBundleWritten: 'pass',
      closureAllowed: false,
    },
    terminalSignal: {
      kind: 'true-block',
      reasonCode: 'missing-source',
      owningLayer: 'source-authority',
      requiredDecision: 'Grant source access.',
      unblockCriteria: ['source readable'],
      basis: ['Native trace shows source missing.'],
    },
  };
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-evidence-dashboard-'));

try {
  const runsDir = path.join(tmp, 'runs');
  const evidenceDir = path.join(tmp, 'evidence');
  const run = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir,
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T09:30:00.000Z',
  });

  const codexHome = path.join(tmp, '.codex');
  const traceDir = path.join(codexHome, 'sessions', '2026', '05', '07');
  await mkdir(traceDir, { recursive: true });
  const tracePath = path.join(traceDir, 'rollout-private.jsonl');
  await writeFile(tracePath, `${JSON.stringify({
    timestamp: '2026-05-07T09:31:00.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: privatePayload }],
    },
  })}\n`, 'utf8');
  await attachTraceSummaryToRun({ runDir: run.runDir, tracePath, now: '2026-05-07T09:32:00.000Z' });

  const ev = evidence();
  const verdict = inferStopNegotiation(ev);
  await routeStopVerdict({
    verdict,
    evidence: ev,
    runDir: run.runDir,
    livingDocPath: 'tests/fixtures/minimal-doc.json',
    iteration: 1,
    now: '2026-05-07T09:33:00.000Z',
  });
  await writeTerminalState({
    runDir: run.runDir,
    verdict,
    evidence: ev,
    iteration: 1,
    now: '2026-05-07T09:34:00.000Z',
  });

  const { bundle, bundlePath, summaryPath } = await writeEvidenceBundle({
    runDir: run.runDir,
    outDir: evidenceDir,
    now: '2026-05-07T09:35:00.000Z',
  });
  assert.equal(bundle.schema, 'living-doc-harness-evidence-bundle/v1');
  assert.equal(bundle.recommendation, 'block');
  assert.equal(bundle.lifecycleStage, 'true-blocked');
  assert.equal(bundle.proofGates.nativeTrace, 'pass');
  assert.equal(bundle.proofGates.blockersVisible, 'pass');
  assert.equal(bundle.blockers[0].reasonCode, 'missing-source');
  assert.equal(bundle.skillTimeline.some((item) => item.skill === 'reaction-path-validator'), true);
  assert.equal(bundle.traceRefs[0].rawPayloadIncluded, false);
  assert.equal(bundle.privacy.rawNativeTraceIncluded, false);
  assert.equal(JSON.stringify(bundle).includes(privatePayload), false);

  const bundleJson = await readFile(bundlePath, 'utf8');
  const summary = await readFile(summaryPath, 'utf8');
  assert.equal(bundleJson.includes(privatePayload), false);
  assert.match(summary, /raw native trace included: false/);

  const dashboardPath = path.join(tmp, 'dashboard.html');
  const dashboard = await renderDashboard({
    runsDir,
    evidenceDir,
    outPath: dashboardPath,
    now: '2026-05-07T09:36:00.000Z',
  });
  assert.equal(dashboard.bundles.length, 1);
  const html = await readFile(dashboardPath, 'utf8');
  assert.match(html, /Living Doc Harness Dashboard/);
  assert.match(html, /data-recommendation="block"/);
  assert.match(html, /missing-source/);
  assert.match(html, /reaction-path-validator/);
  assert.match(html, /Native Trace Summaries/);
  assert.equal(html.includes(privatePayload), false);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness evidence dashboard contract spec: all assertions passed');
