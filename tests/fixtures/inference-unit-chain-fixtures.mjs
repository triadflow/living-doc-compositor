import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runContractBoundInferenceUnit } from '../../scripts/living-doc-harness-inference-unit.mjs';
import {
  DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
  validateNextUnitSelection,
} from '../../scripts/living-doc-harness-inference-unit-types.mjs';
import { writeTerminalState } from '../../scripts/living-doc-harness-terminal-state.mjs';

function arr(value) {
  return Array.isArray(value) ? value : [];
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function defaultRunConfig(allowedUnitTypes) {
  return {
    schema: 'living-doc-harness-run-config/v1',
    allowedInferenceUnitTypes: allowedUnitTypes,
    prReviewPolicy: {
      schema: 'living-doc-harness-pr-review-policy/v1',
      mode: 'disabled',
    },
  };
}

function requiredHardFacts(overrides = {}) {
  return {
    schema: 'living-doc-harness-required-hard-facts/v1',
    sourceFilesChanged: false,
    dirtyTrackedFiles: [],
    relevantUntrackedFiles: [],
    currentRunChangedFiles: [],
    preExistingDirtyFiles: [],
    allowedCommitFiles: [],
    forbiddenCommitFiles: [],
    acceptanceCriteriaSatisfied: false,
    objectiveReady: false,
    documentReady: false,
    renderedHtmlExists: false,
    closureAllowed: false,
    commitEvidencePresent: false,
    prReviewPolicy: {
      schema: 'living-doc-harness-pr-review-policy/v1',
      mode: 'disabled',
    },
    prReviewRequired: false,
    prReviewEvidencePresent: false,
    prReviewGate: {
      required: false,
      status: 'disabled',
      evidencePresent: false,
    },
    ...overrides,
  };
}

function roleFor(unitTypeId) {
  return {
    worker: 'worker',
    'reviewer-inference': 'reviewer',
    'closure-review': 'closure-review',
    'living-doc-balance-scan': 'balance-scan',
    'repair-skill': 'repair-skill',
    'commit-intent': 'commit-intent',
    'pr-review': 'pr-review',
    'post-flight-summary': 'post-flight-summary',
  }[unitTypeId] || unitTypeId;
}

function buildInputContract({
  unitTypeId,
  context,
  output = {},
  requiredInspectionPaths = null,
  inputOverrides = {},
}) {
  const inspect = requiredInspectionPaths || [context.evidencePath];
  const hardFacts = requiredHardFacts(output.requiredHardFacts);
  const prReviewPolicy = output.prReviewPolicy || hardFacts.prReviewPolicy;
  const prReviewRequired = output.prReviewRequired ?? hardFacts.prReviewRequired;
  const common = {
    runId: context.runId,
    iteration: context.iteration,
    requiredInspectionPaths: inspect,
  };

  const contracts = {
    worker: {
      schema: 'living-doc-worker-inference-input/v1',
      runId: context.runId,
      runConfig: defaultRunConfig(context.allowedUnitTypes),
      livingDocPath: context.livingDocPath,
      objective: 'Prove deterministic inference unit chaining.',
      successCondition: 'The chain records valid artifacts, legal transitions, and authority boundaries.',
      requiredInspectionPaths: [context.livingDocPath],
    },
    'reviewer-inference': {
      schema: 'living-doc-harness-reviewer-input/v1',
      ...common,
      evidencePath: context.evidencePath,
      objectiveState: {
        stageAfter: output.classification || 'running',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
      },
      workerEvidence: {
        filesChanged: arr(output.filesChanged),
        nativeInferenceTraceRefs: [context.tracePath],
      },
      proofGates: output.proofGates || {
        acceptanceCriteriaSatisfied: output.classification === 'closed' ? 'pass' : 'fail',
        closureAllowed: output.classification === 'closed',
      },
      requiredHardFacts: hardFacts,
      prReviewPolicy,
      prReviewRequired,
    },
    'closure-review': {
      schema: 'living-doc-harness-closure-review-input/v1',
      ...common,
      evidencePath: context.evidencePath,
      reviewerVerdictPath: context.reviewerVerdictPath,
      evidenceSnapshotPath: context.evidenceSnapshotPath,
      requiredHardFacts: hardFacts,
      prReviewPolicy,
      prReviewRequired,
      proofGates: output.proofGates || {
        acceptanceCriteriaSatisfied: output.terminalAllowed ? 'pass' : 'fail',
        closureAllowed: output.terminalAllowed === true,
      },
      stopVerdict: output.stopVerdict || {
        classification: output.terminalAllowed ? 'closed' : 'closure-candidate',
        reasonCode: output.reasonCode || 'fixture-closure-review',
      },
    },
    'living-doc-balance-scan': {
      schema: 'living-doc-repair-skill-chain-input/v1',
      ...common,
      livingDocPath: context.livingDocPath,
      reviewerVerdictPath: context.reviewerVerdictPath,
      handoverPath: context.handoverPath,
    },
    'repair-skill': {
      schema: 'living-doc-repair-skill-chain-input/v1',
      ...common,
      skill: output.skill || 'objective-conservation-audit',
      sequence: output.sequence ?? 1,
      livingDocPath: context.livingDocPath,
      reviewerVerdictPath: context.reviewerVerdictPath,
      handoverPath: context.handoverPath,
      priorRepairResultPaths: arr(output.priorRepairResultPaths),
      commitPolicy: output.commitPolicy || {
        schema: 'living-doc-harness-commit-policy/v1',
        mode: 'intent-only',
      },
    },
    'commit-intent': {
      schema: 'living-doc-harness-commit-intent-input/v1',
      ...common,
      changedFiles: arr(output.changedFiles).length ? output.changedFiles : ['docs/fixture.json'],
      evidenceSnapshotPath: context.evidenceSnapshotPath,
      requiredHardFacts: requiredHardFacts({
        ...output.requiredHardFacts,
        sourceFilesChanged: true,
        currentRunChangedFiles: arr(output.changedFiles).length ? output.changedFiles : ['docs/fixture.json'],
      }),
      commitIntent: output.commitIntent || {
        required: true,
        reason: 'Fixture source changes require commit evidence.',
        changedFiles: arr(output.changedFiles).length ? output.changedFiles : ['docs/fixture.json'],
      },
      commitPolicy: output.commitPolicy || {
        schema: 'living-doc-harness-commit-policy/v1',
        mode: 'fixture-no-side-effect',
      },
    },
    'pr-review': {
      schema: 'living-doc-harness-pr-review-input/v1',
      ...common,
      livingDocPath: context.livingDocPath,
      reviewerVerdictPath: context.reviewerVerdictPath,
      reviewTarget: output.reviewTarget || 'https://github.example/triadflow/living-doc-compositor/pull/1',
      evidenceSnapshotPath: context.evidenceSnapshotPath,
      requiredHardFacts: requiredHardFacts({
        ...output.requiredHardFacts,
        prReviewPolicy: output.prReviewPolicy || {
          schema: 'living-doc-harness-pr-review-policy/v1',
          mode: 'required-before-closure',
        },
        prReviewRequired: output.prReviewRequired ?? true,
      }),
      prReviewPolicy: output.prReviewPolicy || {
        schema: 'living-doc-harness-pr-review-policy/v1',
        mode: 'required-before-closure',
      },
      prReviewRequired: output.prReviewRequired ?? true,
    },
    'post-flight-summary': {
      schema: 'living-doc-harness-post-flight-summary-input/v1',
      ...common,
      terminalPath: context.terminalPath,
      proofPath: context.proofPath,
      lifecycleResultPath: context.lifecycleResultPath,
    },
  };

  return {
    ...contracts[unitTypeId],
    ...inputOverrides,
  };
}

function reviewerOutput(output) {
  const classification = output.classification || 'resumable';
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification,
      reasonCode: output.reasonCode || `fixture-${classification}`,
      confidence: output.confidence || 'high',
      closureAllowed: output.closureAllowed ?? classification === 'closed',
      basis: output.basis || [`Fixture reviewer emitted ${classification}.`],
    },
    nextIteration: {
      allowed: output.nextAllowed ?? classification !== 'closed',
      mode: output.nextMode || (classification === 'closed' ? 'none' : 'fresh-unit'),
      instruction: output.instruction || 'Continue through the next fixture unit.',
    },
  };
}

function outputContractFor(unitTypeId, output = {}) {
  if (unitTypeId === 'worker') {
    return {
      schema: 'living-doc-worker-output/v1',
      status: output.status || 'finished',
      runId: output.runId,
      livingDocPath: output.livingDocPath,
      nextAuthority: output.nextAuthority || 'reviewer-inference',
      filesChanged: arr(output.filesChanged),
    };
  }
  if (unitTypeId === 'reviewer-inference') return reviewerOutput(output);
  if (unitTypeId === 'closure-review') {
    const approved = output.approved ?? output.terminalAllowed === true;
    return {
      schema: 'living-doc-harness-closure-review/v1',
      approved,
      reasonCode: output.reasonCode || (approved ? 'fixture-terminal-allowed' : 'fixture-terminal-blocked'),
      confidence: output.confidence || 'high',
      basis: output.basis || [`Fixture closure-review ${approved ? 'approved' : 'blocked'} terminal closure.`],
      terminalAllowed: output.terminalAllowed ?? approved,
    };
  }
  if (unitTypeId === 'living-doc-balance-scan') {
    return {
      schema: 'living-doc-balance-scan-result/v1',
      status: output.status || 'ordered',
      basis: output.basis || ['Fixture balance scan selected a repair chain.'],
      orderedSkills: output.orderedSkills || ['objective-conservation-audit'],
    };
  }
  if (unitTypeId === 'repair-skill') {
    const changedFiles = arr(output.changedFiles);
    return {
      schema: 'living-doc-repair-skill-result/v1',
      skill: output.skill || 'objective-conservation-audit',
      sequence: output.sequence ?? 1,
      status: output.status || 'repaired',
      changedFiles,
      commitIntent: output.commitIntent || {
        required: changedFiles.length > 0,
        reason: changedFiles.length > 0 ? 'Fixture repair changed files.' : 'Fixture repair did not change files.',
        changedFiles,
      },
      basis: output.basis || ['Fixture repair skill completed.'],
    };
  }
  if (unitTypeId === 'commit-intent') {
    return {
      schema: 'living-doc-harness-commit-intent-result/v1',
      approved: output.approved ?? true,
      status: output.status || 'approved',
      changedFiles: arr(output.changedFiles).length ? output.changedFiles : ['docs/fixture.json'],
      message: output.message || 'Fixture commit evidence approved.',
      sideEffect: output.sideEffect || {
        type: 'git-commit',
        executed: false,
        reasonCode: 'fixture-no-real-commit',
      },
      basis: output.basis || ['Fixture commit-intent satisfied the source-change gate.'],
    };
  }
  if (unitTypeId === 'pr-review') {
    return {
      schema: 'living-doc-harness-pr-review-result/v1',
      status: output.status || 'approved',
      approvedActions: arr(output.approvedActions),
      sideEffect: output.sideEffect || {
        type: 'github-pr-review',
        executed: false,
        reasonCode: 'fixture-no-real-pr-review',
      },
      basis: output.basis || ['Fixture PR-review satisfied the configured gate.'],
    };
  }
  if (unitTypeId === 'post-flight-summary') {
    return {
      schema: 'living-doc-harness-post-flight-summary/v1',
      status: output.status || 'written',
      summaryPath: output.summaryPath || 'post-flight-summary.md',
      basis: output.basis || ['Fixture post-flight summary written.'],
    };
  }
  throw new Error(`unsupported fixture unit type: ${unitTypeId}`);
}

function rawInferenceOutputFor(unitTypeId, outputContract) {
  return outputContract;
}

export async function createInferenceUnitChainContext({
  rootDir,
  name,
  allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
} = {}) {
  const runDir = path.join(rootDir, name);
  await mkdir(runDir, { recursive: true });
  const context = {
    runDir,
    runId: `fixture-${name}`,
    iteration: 1,
    allowedUnitTypes,
    livingDocPath: path.join(runDir, 'doc.json'),
    evidencePath: path.join(runDir, 'evidence.json'),
    evidenceSnapshotPath: path.join(runDir, 'artifacts', 'controller-evidence-snapshot.json'),
    reviewerVerdictPath: path.join(runDir, 'reviewer-inference', 'iteration-1-verdict.json'),
    handoverPath: path.join(runDir, 'handover.json'),
    tracePath: path.join(runDir, 'native-trace.jsonl'),
    terminalPath: path.join(runDir, 'terminal', 'iteration-1-closed.json'),
    proofPath: path.join(runDir, 'proof.json'),
    lifecycleResultPath: path.join(runDir, 'lifecycle-result.json'),
  };

  await writeJson(context.livingDocPath, {
    docId: `fixture:${name}`,
    title: 'Inference Unit Chain Fixture',
    updated: '2026-05-14T00:00:00.000Z',
    objective: 'Prove deterministic inference unit chaining.',
    successCondition: 'The contract-bound chain can be validated without live inference.',
    sections: [],
  });
  await writeJson(context.evidencePath, {
    schema: 'living-doc-harness-iteration-evidence/v1',
    runId: context.runId,
    livingDocPath: context.livingDocPath,
    sourceFilesChanged: false,
    objectiveState: {
      stageAfter: 'running',
      unresolvedObjectiveTerms: [],
      unprovenAcceptanceCriteria: [],
    },
    workerEvidence: {
      filesChanged: [],
      nativeInferenceTraceRefs: [context.tracePath],
    },
    proofGates: {
      acceptanceCriteriaSatisfied: 'fail',
      closureAllowed: false,
    },
    requiredHardFacts: requiredHardFacts(),
  });
  await writeJson(context.evidenceSnapshotPath, {
    schema: 'living-doc-harness-controller-evidence-snapshot/v1',
    runId: context.runId,
    hardFacts: requiredHardFacts(),
  });
  await writeJson(context.reviewerVerdictPath, reviewerOutput({ classification: 'resumable' }));
  await writeJson(context.handoverPath, {
    schema: 'living-doc-harness-handover/v1',
    runId: context.runId,
    instruction: 'Fixture handover.',
  });
  await writeFile(context.tracePath, `${JSON.stringify({ type: 'fixture-trace', ok: true })}\n`, 'utf8');
  await writeJson(context.proofPath, {
    schema: 'living-doc-harness-iteration-proof/v1',
    runId: context.runId,
  });
  await writeJson(context.lifecycleResultPath, {
    schema: 'living-doc-harness-lifecycle-result/v1',
    runId: context.runId,
  });
  return context;
}

export async function mockInferenceUnit(context, {
  unitTypeId,
  sequence,
  output = {},
  inputOverrides = {},
  requiredInspectionPaths = null,
  now = '2026-05-14T00:00:00.000Z',
} = {}) {
  const outputContract = outputContractFor(unitTypeId, {
    ...output,
    runId: context.runId,
    livingDocPath: context.livingDocPath,
  });
  const unit = await runContractBoundInferenceUnit({
    runDir: context.runDir,
    iteration: context.iteration,
    sequence,
    unitId: unitTypeId,
    role: roleFor(unitTypeId),
    unitTypeId,
    allowedUnitTypes: context.allowedUnitTypes,
    prompt: `Fixture prompt for ${unitTypeId}.`,
    inputContract: buildInputContract({
      unitTypeId,
      context,
      output,
      requiredInspectionPaths,
      inputOverrides,
    }),
    fixtureResult: rawInferenceOutputFor(unitTypeId, outputContract),
    execute: false,
    now,
  });
  assert.equal(unit.validation.ok, true, `${unitTypeId} fixture result validates`);
  return unit;
}

export async function assertUnitArtifacts(context, unit) {
  for (const artifactRef of [
    unit.result.promptPath,
    unit.result.inputContractPath,
    unit.result.codexEventsPath,
    unit.result.lastMessagePath,
    unit.result.stderrPath,
    path.relative(context.runDir, unit.resultPath),
    path.relative(context.runDir, unit.validationPath),
  ]) {
    const absolute = path.resolve(context.runDir, artifactRef);
    const text = await readFile(absolute, 'utf8');
    assert.equal(typeof text, 'string', `artifact exists: ${artifactRef}`);
  }
  const result = await readJson(unit.resultPath);
  const validation = await readJson(unit.validationPath);
  assert.equal(result.schema, 'living-doc-contract-bound-inference-result/v1');
  assert.equal(result.promptContract?.schema, 'living-doc-harness-prompt-contract/v1');
  assert.equal(result.promptContract.promptPath, result.promptPath);
  assert.match(result.promptContract.promptSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.promptContract.unitTypeId, result.unitType.unitTypeId);
  assert.equal(result.promptContract.template, result.unitType.promptContract.template);
  assert.equal(validation.ok, true);
}

export function assertLegalTransition({
  currentUnitTypeId,
  selectedUnitTypeId,
  allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
  ok = true,
  reasonCode = null,
}) {
  const validation = validateNextUnitSelection({
    currentUnitTypeId,
    selectedUnitTypeId,
    allowedUnitTypes,
  });
  assert.equal(validation.ok, ok, `${currentUnitTypeId} -> ${selectedUnitTypeId} legality`);
  if (reasonCode) assert.equal(validation.reasonCode, reasonCode);
  return validation;
}

export async function writeAuthorizedTerminalState(context, closureReviewUnit, {
  classification = 'closed',
  reasonCode = 'fixture-terminal-authorized',
} = {}) {
  assert.equal(closureReviewUnit.result.unitId, 'closure-review');
  assert.equal(closureReviewUnit.result.outputContract.terminalAllowed, true);
  return writeTerminalState({
    runDir: context.runDir,
    iteration: context.iteration,
    now: '2026-05-14T00:01:00.000Z',
    evidence: {
      runId: context.runId,
      objectiveState: {
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
      },
    },
    verdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification,
        reasonCode,
        confidence: 'high',
        closureAllowed: true,
        basis: ['Fixture closure-review authorized terminal state.'],
      },
      nextIteration: {
        allowed: false,
        mode: 'none',
      },
    },
  });
}

export function assertTerminalNotAuthorizedBy(unit) {
  assert.notEqual(unit.result.unitId, 'closure-review');
  assert.throws(() => {
    if (unit.result.unitId !== 'closure-review') {
      throw new Error(`terminal closure requires closure-review, got ${unit.result.unitId}`);
    }
  }, /terminal closure requires closure-review/);
}
