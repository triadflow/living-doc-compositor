import assert from 'node:assert/strict';
import { loadHarnessContractSchema, validateHarnessContract } from '../../scripts/validate-living-doc-harness-contract.mjs';
import {
  HARNESS_INFERENCE_UNIT_REGISTRY,
  validateAllowedInferenceUnitRunConfig,
  validateNextUnitSelection,
  validateRegistryCompleteness,
} from '../../scripts/living-doc-harness-inference-unit-types.mjs';

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

function validContinuation(classification) {
  return baseContract({
    objectiveState: {
      objectiveHash: hashC,
      stageBefore: 'implementing',
      stageAfter: 'continuation-required',
      unresolvedObjectiveTerms: ['objective still requires continuation work'],
      unprovenAcceptanceCriteria: ['criterion-e2e-demo'],
    },
    stopVerdict: {
      classification,
      reasonCode: `${classification}-reason`,
      confidence: 'high',
      basis: [`${classification} is continuation evidence for this fixture.`],
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
      allowed: true,
      mode: 'continuation',
      instruction: `Continue after ${classification}; it is not objective closure.`,
      mustNotDo: ['do not stop unless the objective is proven reached or the user explicitly stops'],
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

// Non-closure classifications validate only as explicit continuation handovers.
for (const continuation of [
  validContinuation('true-block'),
  validContinuation('pivot'),
  validContinuation('deferred'),
  validContinuation('budget-exhausted'),
]) {
  assert.equal(validateHarnessContract(continuation).ok, true, continuation.stopVerdict.classification);
}

// Explicit user stop is terminal without pretending the objective is proven.
{
  const contract = baseContract({
    stopVerdict: {
      classification: 'user-stopped',
      reasonCode: 'user-explicit-stop',
      confidence: 'high',
      basis: ['User explicitly stopped the lifecycle.'],
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
      mode: 'user-stop',
    },
  });
  assert.equal(validateHarnessContract(contract).ok, true);
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

// Inference unit type registry is complete and enforces run-scoped routing.
{
  const requiredTypes = [
    'worker',
    'reviewer-inference',
    'closure-review',
    'living-doc-balance-scan',
    'repair-skill',
    'commit-intent',
    'pr-review',
    'continuation-inference',
    'post-flight-summary',
  ];
  const result = validateRegistryCompleteness(HARNESS_INFERENCE_UNIT_REGISTRY);
  assert.equal(result.ok, true);
  for (const unitTypeId of requiredTypes) {
    const type = HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes[unitTypeId];
    assert.ok(type, `${unitTypeId} must be registered`);
    assert.ok(type.inputContract.schema);
    assert.ok(type.promptContract.template);
    assert.ok(type.requiredEvidence.length > 0);
    assert.ok(type.outputVerdicts.length > 0);
    assert.ok(Array.isArray(type.allowedNextUnitTypes));
    assert.ok(Array.isArray(type.deterministicSideEffects));
    assert.ok(type.dashboard.label);
    assert.ok(type.closureImplications);
  }
  assert.equal(validateNextUnitSelection({
    currentUnitTypeId: 'reviewer-inference',
    selectedUnitTypeId: 'commit-intent',
    allowedUnitTypes: requiredTypes,
  }).ok, true);
  assert.equal(validateNextUnitSelection({
    currentUnitTypeId: 'reviewer-inference',
    selectedUnitTypeId: 'commit-intent',
    allowedUnitTypes: ['worker', 'reviewer-inference', 'closure-review', 'continuation-inference'],
  }).reasonCode, 'selected-unit-type-not-allowed-for-run');
  assert.equal(validateNextUnitSelection({
    currentUnitTypeId: 'reviewer-inference',
    selectedUnitTypeId: 'post-flight-summary',
    allowedUnitTypes: requiredTypes,
  }).reasonCode, 'selected-unit-type-not-allowed-by-current-contract');
  assert.equal(validateNextUnitSelection({
    currentUnitTypeId: 'closure-review',
    selectedUnitTypeId: 'post-flight-summary',
    allowedUnitTypes: requiredTypes,
  }).ok, true);
  const invalidRunConfig = validateAllowedInferenceUnitRunConfig({
    allowedUnitTypes: ['worker', 'reviewer-inference', 'closure-review'],
  });
  assert.equal(invalidRunConfig.ok, false);
  assert.ok(invalidRunConfig.violations.some((violation) => (
    violation.reasonCode === 'required-lifecycle-unit-type-missing'
    && violation.unitTypeId === 'continuation-inference'
  )));
  assert.ok(invalidRunConfig.violations.some((violation) => (
    violation.reasonCode === 'required-lifecycle-unit-type-missing'
    && violation.unitTypeId === 'post-flight-summary'
  )));
  assert.equal(validateAllowedInferenceUnitRunConfig({
    allowedUnitTypes: requiredTypes,
  }).ok, true);
}

console.log('living-doc harness contract spec: all assertions passed');
