import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHarnessRun } from '../../scripts/living-doc-harness-runner.mjs';
import { inferStopNegotiation } from '../../scripts/living-doc-harness-stop-negotiation.mjs';
import { canResumeRun, validateTerminalStateRecord, writeTerminalState } from '../../scripts/living-doc-harness-terminal-state.mjs';

const hashC = `sha256:${'c'.repeat(64)}`;

function evidence(overrides = {}) {
  return {
    runId: 'ldh-terminal-test',
    objectiveState: {
      objectiveHash: hashC,
      stageBefore: 'implementing',
      stageAfter: 'stopped',
      unresolvedObjectiveTerms: ['objective still needs outside state'],
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
    wrapperSummary: { claimedClassification: 'stopped' },
    ...overrides,
  };
}

function terminalEvidence(reasonCode, extra = {}) {
  return evidence({
    terminalSignal: {
      kind: 'true-block',
      reasonCode,
      requiredDecision: `Resolve ${reasonCode}.`,
      unblockCriteria: [`${reasonCode} is resolved`],
      basis: [`Native trace proves ${reasonCode}.`],
      ...extra,
    },
  });
}

async function makeRun(tmp, now = '2026-05-07T08:00:00.000Z') {
  return createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir: path.join(tmp, 'runs'),
    execute: false,
    cwd: process.cwd(),
    now,
  });
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-terminal-state-'));

try {
  // True-block fixtures cover the blocker reasons named in #191.
  for (const [i, reasonCode] of [
    'missing-source',
    'missing-permission',
    'missing-proof-authority',
    'objective-undecidable',
    'privacy-boundary',
    'platform-capability-gap',
  ].entries()) {
    const run = await makeRun(tmp, `2026-05-07T08:0${i}:00.000Z`);
    const ev = terminalEvidence(reasonCode);
    const verdict = inferStopNegotiation(ev);
    const result = await writeTerminalState({
      runDir: run.runDir,
      verdict,
      evidence: ev,
      iteration: i + 1,
      now: `2026-05-07T08:1${i}:00.000Z`,
    });
    assert.equal(result.record.kind, 'continuation-required');
    assert.equal(result.record.loopMayContinue, true);
    assert.ok(result.record.blockerRef);
    assert.equal(result.blocker.reasonCode, reasonCode);
    assert.equal(result.blocker.dashboardVisible, true);
    assert.ok(result.blocker.unblockCriteria.length > 0);
    assert.equal(validateTerminalStateRecord(result.record).ok, true);
    const resume = await canResumeRun(run.runDir);
    assert.equal(resume.allowed, true);
    assert.match(resume.reason, /continuation/i);
    const blockersJsonl = await readFile(path.join(run.runDir, 'blockers.jsonl'), 'utf8');
    assert.match(blockersJsonl, new RegExp(reasonCode));
  }

  // Budget exhaustion is a batch boundary, not lifecycle termination.
  {
    const run = await makeRun(tmp, '2026-05-07T08:20:00.000Z');
    const ev = evidence({
      terminalSignal: {
        kind: 'budget-exhausted',
        reasonCode: 'budget-exhausted',
        basis: ['Iteration budget was exhausted before objective proof.'],
      },
    });
    const verdict = inferStopNegotiation(ev);
    const result = await writeTerminalState({ runDir: run.runDir, verdict, evidence: ev, iteration: 7, now: '2026-05-07T08:21:00.000Z' });
    assert.equal(result.record.kind, 'continuation-required');
    assert.equal(result.record.status, 'repair-resumed');
    assert.equal(result.record.loopMayContinue, true);
    assert.equal((await canResumeRun(run.runDir)).allowed, true);
  }

  // Pivot and deferral pressure remain continuation evidence unless the user explicitly stops.
  for (const kind of ['pivot', 'deferred']) {
    const run = await makeRun(tmp, kind === 'pivot' ? '2026-05-07T08:30:00.000Z' : '2026-05-07T08:40:00.000Z');
    const ev = evidence({
      terminalSignal: {
        kind,
        reasonCode: `${kind}-required`,
        basis: [`${kind} requires outside approval.`],
      },
    });
    const verdict = inferStopNegotiation(ev);
    const result = await writeTerminalState({ runDir: run.runDir, verdict, evidence: ev, iteration: 8, now: '2026-05-07T08:41:00.000Z' });
    assert.equal(result.record.kind, 'continuation-required');
    assert.equal(result.record.loopMayContinue, true);
    assert.equal((await canResumeRun(run.runDir)).allowed, true);
  }

  // Closed is terminal, but not a blocker.
  {
    const run = await makeRun(tmp, '2026-05-07T08:50:00.000Z');
    const ev = evidence({
      objectiveState: {
        objectiveHash: hashC,
        stageBefore: 'closure-candidate',
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
      },
      proofGates: {
        standaloneRun: 'pass',
        nativeTraceInspected: 'pass',
        livingDocRendered: 'pass',
        acceptanceCriteriaSatisfied: 'pass',
        evidenceBundleWritten: 'pass',
        closureAllowed: true,
      },
      wrapperSummary: { claimedClassification: 'closed' },
    });
    const verdict = inferStopNegotiation(ev);
    const result = await writeTerminalState({ runDir: run.runDir, verdict, evidence: ev, iteration: 9, now: '2026-05-07T08:51:00.000Z' });
    assert.equal(result.record.kind, 'closed');
    assert.equal(result.blocker, null);
    assert.equal((await canResumeRun(run.runDir)).allowed, false);
  }

  // Repair-resumed is an iteration terminal state that allows the next run.
  {
    const run = await makeRun(tmp, '2026-05-07T09:00:00.000Z');
    const ev = evidence();
    const verdict = inferStopNegotiation(ev);
    const result = await writeTerminalState({ runDir: run.runDir, verdict, evidence: ev, iteration: 10, now: '2026-05-07T09:01:00.000Z' });
    assert.equal(result.record.kind, 'repair-resumed');
    assert.equal(result.record.loopMayContinue, true);
    assert.equal((await canResumeRun(run.runDir)).allowed, true);
  }

  // CLI can write and can-resume continues after true-block continuation evidence.
  {
    const run = await makeRun(tmp, '2026-05-07T09:10:00.000Z');
    const ev = terminalEvidence('missing-source');
    const verdict = inferStopNegotiation(ev);
    const evPath = path.join(tmp, 'terminal-evidence.json');
    const verdictPath = path.join(tmp, 'terminal-verdict.json');
    await writeFile(evPath, `${JSON.stringify(ev, null, 2)}\n`, 'utf8');
    await writeFile(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
    const writeResult = spawnSync(process.execPath, ['scripts/living-doc-harness-terminal-state.mjs', 'write', verdictPath, '--run-dir', run.runDir, '--evidence', evPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.equal(writeResult.status, 0, writeResult.stderr);
    const resumeResult = spawnSync(process.execPath, ['scripts/living-doc-harness-terminal-state.mjs', 'can-resume', run.runDir], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.equal(resumeResult.status, 0);
    assert.match(resumeResult.stdout, /continuation/i);
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness terminal-state contract spec: all assertions passed');
