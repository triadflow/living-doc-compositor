import assert from 'node:assert/strict';
import { loadHarnessContractSchema, validateHarnessContract } from '../../scripts/validate-living-doc-harness-contract.mjs';

const hashA = `sha256:${'a'.repeat(64)}`;
const hashB = `sha256:${'b'.repeat(64)}`;
const hashC = `sha256:${'c'.repeat(64)}`;

function baseContract(overrides = {}) {
  const contract = {
    schema: 'living-doc-harness-iteration-proof/v1',
    runId: 'ldh-2026-05-07-001',
    iteration: 2,
    createdAt: '2026-05-07T05:30:00.000Z',
    livingDoc: {
      sourcePath: 'docs/living-doc-agentic-harness.json',
      beforeHash: hashA,
      afterHash: hashB,
      renderedHtml: 'docs/living-doc-agentic-harness.html',
    },
    objectiveState: {
      objectiveHash: hashC,
      stageBefore: 'implementing',
      stageAfter: 'resume-ready',
      unresolvedObjectiveTerms: ['native headless inference logs are inspected as hard evidence'],
      unprovenAcceptanceCriteria: ['criterion-native-inference-log-inspection'],
    },
    workerEvidence: {
      nativeInferenceTraceRefs: ['~/.codex/headless-runs/ldh-2026-05-07-001/trace.jsonl'],
      wrapperLogRefs: ['.living-doc-runs/ldh-2026-05-07-001/wrapper.log'],
      finalMessageSummary: 'Worker stopped after creating the contract draft.',
      toolFailures: [],
      filesChanged: ['scripts/validate-living-doc-harness-contract.mjs'],
    },
    stopVerdict: {
      classification: 'repairable',
      reasonCode: 'missing-native-trace-reader',
      confidence: 'high',
      basis: ['The native trace exists but no reader validates it yet.'],
    },
    skillsApplied: [
      {
        skill: 'objective-execution-readiness',
        verdict: 'executable',
        patchRefs: [],
      },
    ],
    proofGates: {
      standaloneRun: 'pass',
      nativeTraceInspected: 'fail',
      livingDocRendered: 'pass',
      acceptanceCriteriaSatisfied: 'fail',
      evidenceBundleWritten: 'pending',
      closureAllowed: false,
    },
    nextIteration: {
      allowed: true,
      mode: 'repair',
      instruction: 'Implement the native inference-log reader and keep closure blocked.',
      mustNotDo: ['do not rely on wrapper summaries', 'do not claim closure'],
    },
  };
  return structuredClone(Object.assign(contract, overrides));
}

function validTerminal(classification, extra = {}) {
  return baseContract({
    objectiveState: {
      objectiveHash: hashC,
      stageBefore: 'implementing',
      stageAfter: classification,
      unresolvedObjectiveTerms: ['objective requires outside decision'],
      unprovenAcceptanceCriteria: ['criterion-e2e-demo'],
    },
    stopVerdict: {
      classification,
      reasonCode: `${classification}-reason`,
      confidence: 'high',
      basis: [`${classification} is the valid terminal state for this fixture.`],
    },
    proofGates: {
      standaloneRun: 'pass',
      nativeTraceInspected: 'pass',
      livingDocRendered: 'pass',
      acceptanceCriteriaSatisfied: 'fail',
      evidenceBundleWritten: 'pass',
      closureAllowed: false,
    },
    nextIteration: {
      allowed: false,
      mode: classification === 'budget-exhausted' ? 'stop-budget' : classification === 'deferred' ? 'defer' : classification === 'true-block' ? 'block' : classification,
    },
    terminal: {
      kind: classification,
      reasonCode: `${classification}-reason`,
      basis: [`${classification} was proven from native trace and objective state.`],
      ...extra,
    },
  });
}

const schema = await loadHarnessContractSchema();
assert.equal(schema.$id, 'https://triadflow.github.io/living-doc-compositor/schemas/living-doc-harness-iteration-proof.schema.json');
assert.equal(schema.title, 'living-doc-harness-iteration-proof/v1');

// Repair handover validates and warns that native trace inspection has not passed yet.
{
  const result = validateHarnessContract(baseContract());
  assert.equal(result.ok, true, JSON.stringify(result.violations, null, 2));
  assert.equal(result.summary.classification, 'repairable');
  assert.equal(result.summary.nativeTraceRefs, 1);
  assert.ok(result.warnings.some((w) => w.path === '$.proofGates.nativeTraceInspected'));
}

// Resumable handover validates.
{
  const contract = baseContract({
    stopVerdict: {
      classification: 'resumable',
      reasonCode: 'premature-handoff',
      confidence: 'high',
      basis: ['Native trace shows available next action despite final message asking the user.'],
    },
    nextIteration: {
      allowed: true,
      mode: 'resume',
      instruction: 'Resume the worker with the unresolved objective terms from this handover.',
      mustNotDo: ['do not ask the user before exhausting available sources'],
    },
  });
  assert.equal(validateHarnessContract(contract).ok, true);
}

// Valid closure has no unresolved terms, all proof gates pass, and stops iteration.
{
  const contract = baseContract({
    objectiveState: {
      objectiveHash: hashC,
      stageBefore: 'closure-candidate',
      stageAfter: 'closed',
      unresolvedObjectiveTerms: [],
      unprovenAcceptanceCriteria: [],
    },
    stopVerdict: {
      classification: 'closed',
      reasonCode: 'objective-proven',
      confidence: 'high',
      basis: ['Native trace, proof gates, evidence bundle, and acceptance criteria agree.'],
    },
    proofGates: {
      standaloneRun: 'pass',
      nativeTraceInspected: 'pass',
      livingDocRendered: 'pass',
      acceptanceCriteriaSatisfied: 'pass',
      evidenceBundleWritten: 'pass',
      closureAllowed: true,
    },
    nextIteration: {
      allowed: false,
      mode: 'none',
    },
  });
  assert.equal(validateHarnessContract(contract).ok, true);
}

// Terminal states are explicit and do not allow silent continuation.
for (const terminal of [
  validTerminal('true-block', {
    owningLayer: 'source-authority',
    requiredDecision: 'User must grant access to the required source repository.',
    unblockCriteria: ['source repository is available to the standalone harness'],
  }),
  validTerminal('pivot'),
  validTerminal('deferred'),
  validTerminal('budget-exhausted'),
]) {
  assert.equal(validateHarnessContract(terminal).ok, true, terminal.stopVerdict.classification);
}

// Wrapper-only evidence is invalid.
{
  const contract = baseContract({
    workerEvidence: {
      nativeInferenceTraceRefs: [],
      wrapperLogRefs: ['.living-doc-runs/ldh-2026-05-07-001/wrapper.log'],
      finalMessageSummary: 'Wrapper claims success.',
      toolFailures: [],
      filesChanged: [],
    },
  });
  const result = validateHarnessContract(contract);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.rule === 'proof-contract' && v.path === '$.workerEvidence.nativeInferenceTraceRefs'));
}

// Fake closure is rejected when objective terms, acceptance criteria, or gates remain unresolved.
{
  const contract = baseContract({
    stopVerdict: {
      classification: 'closed',
      reasonCode: 'worker-claimed-done',
      confidence: 'medium',
      basis: ['Worker final message said done.'],
    },
    proofGates: {
      standaloneRun: 'pass',
      nativeTraceInspected: 'pass',
      livingDocRendered: 'pass',
      acceptanceCriteriaSatisfied: 'fail',
      evidenceBundleWritten: 'pass',
      closureAllowed: true,
    },
    nextIteration: {
      allowed: false,
      mode: 'none',
    },
  });
  const result = validateHarnessContract(contract);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.rule === 'closure-contract'));
}

// Allowed next iterations need concrete continuation authority.
{
  const contract = baseContract({
    nextIteration: {
      allowed: true,
      mode: 'repair',
      instruction: '',
      mustNotDo: [],
    },
  });
  const result = validateHarnessContract(contract);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.path === '$.nextIteration.instruction'));
}

console.log('living-doc harness contract spec: all assertions passed');
