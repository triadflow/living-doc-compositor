import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHarnessRun } from '../../scripts/living-doc-harness-runner.mjs';
import { inferStopNegotiation } from '../../scripts/living-doc-harness-stop-negotiation.mjs';
import { routeStopVerdict } from '../../scripts/living-doc-harness-skill-router.mjs';

const hashC = `sha256:${'c'.repeat(64)}`;

function evidence(overrides = {}) {
  return {
    runId: 'ldh-route-test',
    objectiveState: {
      objectiveHash: hashC,
      stageBefore: 'implementing',
      stageAfter: 'stopped',
      unresolvedObjectiveTerms: ['repair doc objective state'],
      unprovenAcceptanceCriteria: ['criterion-doc-repair-loop'],
    },
    workerEvidence: {
      nativeInferenceTraceRefs: ['traces/trace.summary.json'],
      wrapperLogRefs: ['codex-turns/codex-events.jsonl'],
      finalMessageSummary: 'Worker stopped after partial implementation.',
      toolFailures: [],
      filesChanged: [],
    },
    proofGates: {
      standaloneRun: 'pass',
      nativeTraceInspected: 'pass',
      livingDocRendered: 'pass',
      acceptanceCriteriaSatisfied: 'fail',
      evidenceBundleWritten: 'pending',
      closureAllowed: false,
    },
    wrapperSummary: { claimedClassification: 'stopped' },
    availableNextActions: [],
    ...overrides,
  };
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-skill-router-'));

try {
  const beforeDoc = path.join(tmp, 'doc.json');
  const afterDoc = path.join(tmp, 'doc-after.json');
  await writeFile(beforeDoc, `${JSON.stringify({
    docId: 'test:router',
    title: 'Router Before',
    subtitle: 'Before',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: beforeDoc,
    sourceCoverage: 'fixture',
    updated: '2026-05-07T06:00:00.000Z',
    objective: 'Prove router handover.',
    successCondition: 'Router writes handover.',
    sections: [],
  }, null, 2)}\n`, 'utf8');
  await writeFile(afterDoc, `${JSON.stringify({
    docId: 'test:router',
    title: 'Router After',
    subtitle: 'After',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: afterDoc,
    sourceCoverage: 'fixture',
    updated: '2026-05-07T06:05:00.000Z',
    objective: 'Prove router handover.',
    successCondition: 'Router writes handover.',
    sections: [],
  }, null, 2)}\n`, 'utf8');

  const run = await createHarnessRun({
    docPath: beforeDoc,
    runsDir: path.join(tmp, 'runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T07:00:00.000Z',
  });

  // Repairable routes through balance scan, catalytic repair, readiness, and writes handover artifacts.
  {
    const ev = evidence();
    const verdict = inferStopNegotiation(ev);
    const result = await routeStopVerdict({
      verdict,
      evidence: ev,
      runDir: run.runDir,
      livingDocPath: beforeDoc,
      afterDocPath: afterDoc,
      iteration: 1,
      now: '2026-05-07T07:01:00.000Z',
      render: true,
    });
    const actionNames = result.routing.actions.map((action) => action.skill || action.actionId);
    assert.deepEqual(actionNames.slice(0, 3), ['living-doc-balance-scan', 'catalytic-repair-run', 'objective-execution-readiness']);
    assert.ok(actionNames.includes('prepare-repair-handover'));
    assert.equal(result.handover.unresolvedObjectiveTerms[0], 'repair doc objective state');
    assert.equal(result.handover.unprovenAcceptanceCriteria[0], 'criterion-doc-repair-loop');
    assert.equal(result.handover.livingDoc.before.hash.startsWith('sha256:'), true);
    assert.equal(result.handover.livingDoc.after.hash.startsWith('sha256:'), true);
    assert.equal(result.handover.livingDoc.render.status, 0);
    const handover = JSON.parse(await readFile(result.handoverPath, 'utf8'));
    assert.equal(handover.schema, 'living-doc-harness-repair-handover/v1');
    const invocations = await readFile(result.skillInvocationsPath, 'utf8');
    assert.match(invocations, /living-doc-balance-scan/);
    assert.match(invocations, /catalytic-repair-run/);
  }

  // Premature handoff routes to reaction path validation and resume.
  {
    const ev = evidence({
      workerEvidence: {
        nativeInferenceTraceRefs: ['traces/trace.summary.json'],
        wrapperLogRefs: ['wrapper.log'],
        finalMessageSummary: 'Need user confirmation.',
        toolFailures: [],
        filesChanged: [],
      },
      wrapperSummary: { claimedClassification: 'needs-user' },
      availableNextActions: ['continue implementing the runner'],
    });
    const verdict = inferStopNegotiation(ev);
    const result = await routeStopVerdict({
      verdict,
      evidence: ev,
      runDir: run.runDir,
      livingDocPath: beforeDoc,
      iteration: 2,
      now: '2026-05-07T07:02:00.000Z',
    });
    const actionNames = result.routing.actions.map((action) => action.skill || action.actionId);
    assert.deepEqual(actionNames, ['reaction-path-validator', 'resume-worker']);
    assert.equal(result.handover.nextIteration.mode, 'resume');
  }

  // Closure candidate routes through conservation and activation checks.
  {
    const ev = evidence({
      workerEvidence: {
        nativeInferenceTraceRefs: ['traces/trace.summary.json'],
        wrapperLogRefs: ['wrapper.log'],
        finalMessageSummary: 'Worker says everything is complete.',
        toolFailures: [],
        filesChanged: [],
      },
      wrapperSummary: { claimedClassification: 'closed' },
    });
    const verdict = inferStopNegotiation(ev);
    const result = await routeStopVerdict({
      verdict,
      evidence: ev,
      runDir: run.runDir,
      livingDocPath: beforeDoc,
      iteration: 3,
      now: '2026-05-07T07:03:00.000Z',
    });
    const actionNames = result.routing.actions.map((action) => action.skill || action.actionId);
    assert.deepEqual(actionNames.slice(0, 3), ['objective-conservation-audit', 'activation-energy-review', 'reaction-path-validator']);
  }

  // True block creates blocker record action and terminal handover.
  {
    const ev = evidence({
      terminalSignal: {
        kind: 'true-block',
        reasonCode: 'missing-source',
        owningLayer: 'source-authority',
        requiredDecision: 'Grant source access.',
        unblockCriteria: ['source readable'],
        basis: ['native trace shows source missing'],
      },
    });
    const verdict = inferStopNegotiation(ev);
    const result = await routeStopVerdict({
      verdict,
      evidence: ev,
      runDir: run.runDir,
      livingDocPath: beforeDoc,
      iteration: 4,
      now: '2026-05-07T07:04:00.000Z',
    });
    const actionNames = result.routing.actions.map((action) => action.skill || action.actionId);
    assert.deepEqual(actionNames, ['create-blocker-record', 'reaction-path-validator']);
    assert.equal(result.handover.nextIteration.allowed, false);
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness skill router contract spec: all assertions passed');
