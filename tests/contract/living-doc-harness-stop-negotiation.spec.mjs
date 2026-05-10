import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inferStopNegotiation } from '../../scripts/living-doc-harness-stop-negotiation.mjs';
import { validateHarnessContract } from '../../scripts/validate-living-doc-harness-contract.mjs';

const hashA = `sha256:${'a'.repeat(64)}`;
const hashB = `sha256:${'b'.repeat(64)}`;
const hashC = `sha256:${'c'.repeat(64)}`;

function baseEvidence(overrides = {}) {
  return {
    schema: 'living-doc-harness-stop-evidence/v1',
    runId: 'ldh-test',
    objectiveState: {
      objectiveHash: hashC,
      stageBefore: 'implementing',
      stageAfter: 'stopped',
      unresolvedObjectiveTerms: ['native logs must be inspected'],
      unprovenAcceptanceCriteria: ['criterion-native-inference-log-inspection'],
    },
    workerEvidence: {
      nativeInferenceTraceRefs: ['traces/trace.summary.json'],
      wrapperLogRefs: ['codex-turns/codex-events.jsonl'],
      finalMessageSummary: 'Worker stopped after partial implementation.',
      toolFailures: [],
      filesChanged: ['scripts/example.mjs'],
    },
    wrapperSummary: {
      claimedClassification: 'stopped',
    },
    proofGates: {
      standaloneRun: 'pass',
      nativeTraceInspected: 'pass',
      livingDocRendered: 'pass',
      acceptanceCriteriaSatisfied: 'fail',
      evidenceBundleWritten: 'pending',
      closureAllowed: false,
    },
    availableNextActions: [],
    ...overrides,
  };
}

function contractWith(verdict, evidence = baseEvidence()) {
  return {
    schema: 'living-doc-harness-iteration-proof/v1',
    runId: evidence.runId,
    iteration: 1,
    createdAt: '2026-05-07T06:50:00.000Z',
    livingDoc: {
      sourcePath: 'docs/living-doc-agentic-harness.json',
      beforeHash: hashA,
      afterHash: hashB,
      renderedHtml: 'docs/living-doc-agentic-harness.html',
    },
    objectiveState: evidence.objectiveState,
    workerEvidence: evidence.workerEvidence,
    stopVerdict: verdict.stopVerdict,
    skillsApplied: [],
    proofGates: evidence.proofGates,
    nextIteration: verdict.nextIteration,
    ...(verdict.terminal ? { terminal: verdict.terminal } : {}),
  };
}

// Missing native trace is repairable even when wrapper claims success.
{
  const evidence = baseEvidence({
    workerEvidence: {
      nativeInferenceTraceRefs: [],
      wrapperLogRefs: ['wrapper.log'],
      finalMessageSummary: 'Done.',
      toolFailures: [],
      filesChanged: [],
    },
    wrapperSummary: { claimedClassification: 'closed' },
  });
  const verdict = inferStopNegotiation(evidence);
  assert.equal(verdict.stopVerdict.classification, 'repairable');
  assert.equal(verdict.stopVerdict.reasonCode, 'missing-native-trace-evidence');
  assert.equal(verdict.nextIteration.allowed, true);
  assert.equal(verdict.nextIteration.mode, 'repair');
  assert.equal(verdict.mismatch.wrapperClaim, 'closed');
}

// Fake closure becomes closure-candidate, not closed.
{
  const evidence = baseEvidence({
    workerEvidence: {
      nativeInferenceTraceRefs: ['traces/trace.summary.json'],
      wrapperLogRefs: ['wrapper.log'],
      finalMessageSummary: 'Worker says everything is complete.',
      toolFailures: [],
      filesChanged: [],
    },
    wrapperSummary: { claimedClassification: 'closed' },
  });
  const verdict = inferStopNegotiation(evidence);
  assert.equal(verdict.stopVerdict.classification, 'closure-candidate');
  assert.equal(verdict.stopVerdict.reasonCode, 'closure-proof-incomplete');
  assert.equal(verdict.nextIteration.mode, 'repair');
  assert.equal(validateHarnessContract(contractWith(verdict, evidence)).ok, true);
}

// Synthetic premature handoff is resumable when the evidence has available next actions.
{
  const evidence = baseEvidence({
    workerEvidence: {
      nativeInferenceTraceRefs: ['traces/trace.summary.json'],
      wrapperLogRefs: ['wrapper.log'],
      finalMessageSummary: 'Need user confirmation before continuing.',
      toolFailures: [],
      filesChanged: [],
    },
    wrapperSummary: { claimedClassification: 'needs-user' },
    availableNextActions: ['run objective-execution-readiness against the repaired living doc'],
  });
  const verdict = inferStopNegotiation(evidence);
  assert.equal(verdict.stopVerdict.classification, 'resumable');
  assert.equal(verdict.stopVerdict.reasonCode, 'premature-handoff');
  assert.equal(verdict.nextIteration.mode, 'resume');
  assert.match(verdict.nextIteration.instruction, /objective-execution-readiness/);
  assert.equal(validateHarnessContract(contractWith(verdict, evidence)).ok, true);
}

// Valid closure requires native trace refs, no unresolved terms, and all gates pass.
{
  const evidence = baseEvidence({
    objectiveState: {
      objectiveHash: hashC,
      stageBefore: 'closure-candidate',
      stageAfter: 'closed',
      unresolvedObjectiveTerms: [],
      unprovenAcceptanceCriteria: [],
    },
    wrapperSummary: { claimedClassification: 'closed' },
    proofGates: {
      standaloneRun: 'pass',
      nativeTraceInspected: 'pass',
      livingDocRendered: 'pass',
      acceptanceCriteriaSatisfied: 'pass',
      evidenceBundleWritten: 'pass',
      closureAllowed: true,
    },
  });
  const verdict = inferStopNegotiation(evidence);
  assert.equal(verdict.stopVerdict.classification, 'closed');
  assert.equal(verdict.nextIteration.allowed, false);
  assert.equal(validateHarnessContract(contractWith(verdict, evidence)).ok, true);
}

// True block is continuation evidence and cannot stop the lifecycle.
{
  const evidence = baseEvidence({
    terminalSignal: {
      kind: 'true-block',
      reasonCode: 'missing-source-authority',
      owningLayer: 'source-authority',
      requiredDecision: 'Grant access to the required source.',
      unblockCriteria: ['source is readable by the standalone harness'],
      basis: ['Native trace shows the required repository is unavailable.'],
    },
  });
  const verdict = inferStopNegotiation(evidence);
  assert.equal(verdict.stopVerdict.classification, 'true-block');
  assert.equal(verdict.nextIteration.allowed, true);
  assert.equal(verdict.nextIteration.mode, 'continuation');
  assert.equal(validateHarnessContract(contractWith(verdict, evidence)).ok, true);
}

// CLI emits the same verdict shape.
{
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-stop-negotiation-'));
  try {
    const evidencePath = path.join(tmp, 'evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(baseEvidence(), null, 2)}\n`, 'utf8');
    const outPath = path.join(tmp, 'verdict.json');
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, ['scripts/living-doc-harness-stop-negotiation.mjs', 'diagnose', evidencePath, '--out', outPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const verdict = JSON.parse(await readFile(outPath, 'utf8'));
    assert.equal(verdict.schema, 'living-doc-harness-stop-verdict/v1');
    assert.equal(verdict.stopVerdict.classification, 'repairable');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

console.log('living-doc harness stop-negotiation contract spec: all assertions passed');
