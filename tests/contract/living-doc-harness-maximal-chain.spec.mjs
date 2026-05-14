import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertLegalTransition,
  assertTerminalNotAuthorizedBy,
  assertUnitArtifacts,
  createInferenceUnitChainContext,
  mockInferenceUnit,
  writeAuthorizedTerminalState,
} from '../fixtures/inference-unit-chain-fixtures.mjs';

const reportPath = process.env.LIVING_DOC_MAXIMAL_CHAIN_REPORT_PATH || null;
const reportRunRoot = process.env.LIVING_DOC_MAXIMAL_CHAIN_RUN_ROOT || null;
const tmp = reportRunRoot
  ? path.resolve(reportRunRoot)
  : await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-maximal-chain-'));

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function rel(context, filePath) {
  return path.relative(context.runDir, filePath);
}

function unitArtifactPaths(context, unit) {
  return {
    promptPath: unit.result.promptPath,
    inputContractPath: unit.result.inputContractPath,
    resultPath: rel(context, unit.resultPath),
    validationPath: rel(context, unit.validationPath),
    outputContractPath: rel(context, unit.resultPath),
    codexEventsPath: unit.result.codexEventsPath,
    lastMessagePath: unit.result.lastMessagePath,
    stderrPath: unit.result.stderrPath,
  };
}

async function writeSelectionArtifact(context, {
  sequence,
  currentUnit,
  selectedUnitTypeId,
  gateBefore = {},
  gateAfter = {},
  reasonCode,
  requiredInputPaths = [],
}) {
  const validation = assertLegalTransition({
    currentUnitTypeId: currentUnit.result.unitId,
    selectedUnitTypeId,
    ok: true,
  });
  const artifact = {
    schema: 'living-doc-harness-maximal-chain-selection/v1',
    runId: context.runId,
    iteration: context.iteration,
    sequence,
    currentUnit: {
      unitId: currentUnit.result.unitId,
      resultPath: rel(context, currentUnit.resultPath),
      validationPath: rel(context, currentUnit.validationPath),
    },
    selectedNextUnit: {
      unitId: selectedUnitTypeId,
      reasonCode,
      requiredInputPaths,
    },
    validation,
    gateBefore,
    gateAfter,
  };
  const selectionPath = path.join(context.runDir, 'artifacts', `maximal-chain-selection-${String(sequence).padStart(2, '0')}.json`);
  await writeJson(selectionPath, artifact);
  return {
    artifact,
    selectionPath,
  };
}

async function runStep(context, timeline, {
  sequence,
  unitTypeId,
  output,
  selectedNextUnitTypeId = null,
  gateBefore = {},
  gateAfter = {},
  reasonCode = null,
  requiredInspectionPaths = null,
  inputOverrides = {},
}) {
  const unit = await mockInferenceUnit(context, {
    unitTypeId,
    sequence,
    output,
    requiredInspectionPaths,
    inputOverrides,
  });
  await assertUnitArtifacts(context, unit);

  let selection = null;
  if (selectedNextUnitTypeId) {
    selection = await writeSelectionArtifact(context, {
      sequence,
      currentUnit: unit,
      selectedUnitTypeId: selectedNextUnitTypeId,
      gateBefore,
      gateAfter,
      reasonCode,
      requiredInputPaths: requiredInspectionPaths || [context.evidencePath],
    });
  }

  const input = await readJson(path.join(context.runDir, unit.result.inputContractPath));
  const step = {
    sequence,
    unitTypeId,
    status: unit.result.status,
    selectedNextUnit: selectedNextUnitTypeId,
    reasonCode,
    gateBefore,
    gateAfter,
    artifacts: unitArtifactPaths(context, unit),
    selectionPath: selection ? rel(context, selection.selectionPath) : null,
    inputReferences: {
      requiredInspectionPaths: input.requiredInspectionPaths || [],
      previousUnitResultPath: input.previousUnitResultPath || null,
      previousSelectionPath: input.previousSelectionPath || null,
      consumedRepairResultPath: input.consumedRepairResultPath || null,
      consumedCommitResultPath: input.consumedCommitResultPath || null,
      consumedPrReviewResultPath: input.consumedPrReviewResultPath || null,
    },
  };
  timeline.push(step);
  return {
    unit,
    step,
    selection,
  };
}

async function assertArtifactPathsExist(context, timeline) {
  for (const step of timeline) {
    for (const [key, artifactPath] of Object.entries(step.artifacts)) {
      const text = await readFile(path.join(context.runDir, artifactPath), 'utf8');
      assert.equal(typeof text, 'string', `${step.unitTypeId} ${key} exists`);
    }
    if (step.selectionPath) {
      const selection = await readJson(path.join(context.runDir, step.selectionPath));
      assert.equal(selection.validation.ok, true);
      assert.equal(selection.selectedNextUnit.unitId, step.selectedNextUnit);
    }
  }
}

function assertInputConsumes(inputReferences, artifactPath, label) {
  const references = [
    ...inputReferences.requiredInspectionPaths,
    inputReferences.previousUnitResultPath,
    inputReferences.previousSelectionPath,
    inputReferences.consumedRepairResultPath,
    inputReferences.consumedCommitResultPath,
    inputReferences.consumedPrReviewResultPath,
  ].filter(Boolean);
  assert.ok(
    references.some((item) => String(item).endsWith(artifactPath) || String(item).includes(artifactPath)),
    `${label} consumes ${artifactPath}`,
  );
}

async function runMaximalChain() {
  if (reportRunRoot) await rm(tmp, { recursive: true, force: true });
  const context = await createInferenceUnitChainContext({
    rootDir: tmp,
    name: 'maximal-controller-owned-chain',
  });
  const timeline = [];

  const firstWorker = await runStep(context, timeline, {
    sequence: 1,
    unitTypeId: 'worker',
    output: { status: 'finished' },
    selectedNextUnitTypeId: 'reviewer-inference',
    reasonCode: 'worker-output-requires-review',
    gateBefore: { objectiveState: 'unresolved' },
    gateAfter: { reviewRequired: true },
  });

  const firstReviewer = await runStep(context, timeline, {
    sequence: 2,
    unitTypeId: 'reviewer-inference',
    output: {
      classification: 'repairable',
      closureAllowed: false,
      nextMode: 'repair',
      reasonCode: 'maximal-chain-repair-required',
    },
    selectedNextUnitTypeId: 'living-doc-balance-scan',
    reasonCode: 'repairable-verdict-selects-balance-scan',
    gateBefore: { repairRequired: false },
    gateAfter: { repairRequired: true },
    requiredInspectionPaths: [firstWorker.step.artifacts.resultPath, firstWorker.step.selectionPath],
    inputOverrides: {
      previousUnitResultPath: firstWorker.step.artifacts.resultPath,
      previousSelectionPath: firstWorker.step.selectionPath,
    },
  });
  assertTerminalNotAuthorizedBy(firstReviewer.unit);

  const balanceScan = await runStep(context, timeline, {
    sequence: 3,
    unitTypeId: 'living-doc-balance-scan',
    output: {
      status: 'ordered',
      orderedSkills: ['objective-conservation-audit'],
    },
    selectedNextUnitTypeId: 'repair-skill',
    reasonCode: 'balance-scan-orders-repair-skill',
    gateBefore: { orderedSkills: [] },
    gateAfter: { orderedSkills: ['objective-conservation-audit'] },
    requiredInspectionPaths: [firstReviewer.step.artifacts.resultPath, firstReviewer.step.selectionPath],
    inputOverrides: {
      previousUnitResultPath: firstReviewer.step.artifacts.resultPath,
      previousSelectionPath: firstReviewer.step.selectionPath,
    },
  });

  const repair = await runStep(context, timeline, {
    sequence: 4,
    unitTypeId: 'repair-skill',
    output: {
      status: 'repaired',
      skill: 'objective-conservation-audit',
      changedFiles: ['docs/living-doc-inference-unit-chain-hard-proof.json'],
    },
    selectedNextUnitTypeId: 'worker',
    reasonCode: 'repair-output-routes-back-to-worker',
    gateBefore: { repairedStateObserved: false },
    gateAfter: { repairedStateObserved: true },
    requiredInspectionPaths: [balanceScan.step.artifacts.resultPath, balanceScan.step.selectionPath],
    inputOverrides: {
      previousUnitResultPath: balanceScan.step.artifacts.resultPath,
      previousSelectionPath: balanceScan.step.selectionPath,
    },
  });

  const secondWorker = await runStep(context, timeline, {
    sequence: 5,
    unitTypeId: 'worker',
    output: {
      status: 'finished',
      filesChanged: ['docs/living-doc-inference-unit-chain-hard-proof.json'],
    },
    selectedNextUnitTypeId: 'reviewer-inference',
    reasonCode: 'worker-reentry-after-repair',
    gateBefore: { repairOutputConsumed: false },
    gateAfter: { repairOutputConsumed: true },
    requiredInspectionPaths: [repair.step.artifacts.resultPath, repair.step.selectionPath],
    inputOverrides: {
      previousUnitResultPath: repair.step.artifacts.resultPath,
      previousSelectionPath: repair.step.selectionPath,
      consumedRepairResultPath: repair.step.artifacts.resultPath,
    },
  });

  const secondReviewer = await runStep(context, timeline, {
    sequence: 6,
    unitTypeId: 'reviewer-inference',
    output: {
      classification: 'closed',
      closureAllowed: true,
      filesChanged: ['docs/living-doc-inference-unit-chain-hard-proof.json'],
      requiredHardFacts: {
        sourceFilesChanged: true,
        currentRunChangedFiles: ['docs/living-doc-inference-unit-chain-hard-proof.json'],
        allowedCommitFiles: ['docs/living-doc-inference-unit-chain-hard-proof.json'],
        commitEvidencePresent: false,
        prReviewPolicy: {
          schema: 'living-doc-harness-pr-review-policy/v1',
          mode: 'required-before-closure',
        },
        prReviewRequired: true,
        prReviewEvidencePresent: false,
      },
      prReviewPolicy: {
        schema: 'living-doc-harness-pr-review-policy/v1',
        mode: 'required-before-closure',
      },
      prReviewRequired: true,
      reasonCode: 'maximal-chain-closed-but-side-effects-missing',
    },
    selectedNextUnitTypeId: 'commit-intent',
    reasonCode: 'missing-commit-evidence-selects-commit-intent',
    gateBefore: {
      commitEvidence: 'missing',
      prReviewEvidence: 'missing',
    },
    gateAfter: {
      commitGate: 'blocked',
      selectedGateUnit: 'commit-intent',
    },
    requiredInspectionPaths: [secondWorker.step.artifacts.resultPath, secondWorker.step.selectionPath, repair.step.artifacts.resultPath],
    inputOverrides: {
      previousUnitResultPath: secondWorker.step.artifacts.resultPath,
      previousSelectionPath: secondWorker.step.selectionPath,
      consumedRepairResultPath: repair.step.artifacts.resultPath,
    },
  });
  assertTerminalNotAuthorizedBy(secondReviewer.unit);

  const commitIntent = await runStep(context, timeline, {
    sequence: 7,
    unitTypeId: 'commit-intent',
    output: {
      status: 'approved',
      changedFiles: ['docs/living-doc-inference-unit-chain-hard-proof.json'],
      requiredHardFacts: {
        sourceFilesChanged: true,
        currentRunChangedFiles: ['docs/living-doc-inference-unit-chain-hard-proof.json'],
        allowedCommitFiles: ['docs/living-doc-inference-unit-chain-hard-proof.json'],
      },
    },
    selectedNextUnitTypeId: 'pr-review',
    reasonCode: 'commit-evidence-present-selects-pr-review',
    gateBefore: {
      commitEvidence: 'missing',
      prReviewEvidence: 'missing',
    },
    gateAfter: {
      commitEvidence: 'present',
      prReviewGate: 'blocked',
    },
    requiredInspectionPaths: [secondReviewer.step.artifacts.resultPath, secondReviewer.step.selectionPath],
    inputOverrides: {
      previousUnitResultPath: secondReviewer.step.artifacts.resultPath,
      previousSelectionPath: secondReviewer.step.selectionPath,
    },
  });

  const prReview = await runStep(context, timeline, {
    sequence: 8,
    unitTypeId: 'pr-review',
    output: {
      status: 'approved',
      prReviewPolicy: {
        schema: 'living-doc-harness-pr-review-policy/v1',
        mode: 'required-before-closure',
      },
      prReviewRequired: true,
      requiredHardFacts: {
        commitEvidencePresent: true,
        prReviewPolicy: {
          schema: 'living-doc-harness-pr-review-policy/v1',
          mode: 'required-before-closure',
        },
        prReviewRequired: true,
        prReviewEvidencePresent: false,
      },
    },
    selectedNextUnitTypeId: 'closure-review',
    reasonCode: 'pr-review-approved-selects-closure-review',
    gateBefore: {
      commitEvidence: 'present',
      prReviewEvidence: 'missing',
    },
    gateAfter: {
      commitEvidence: 'present',
      prReviewEvidence: 'approved',
    },
    requiredInspectionPaths: [commitIntent.step.artifacts.resultPath, commitIntent.step.selectionPath, secondReviewer.step.artifacts.resultPath],
    inputOverrides: {
      previousUnitResultPath: commitIntent.step.artifacts.resultPath,
      previousSelectionPath: commitIntent.step.selectionPath,
      consumedCommitResultPath: commitIntent.step.artifacts.resultPath,
    },
  });

  const closureReview = await runStep(context, timeline, {
    sequence: 9,
    unitTypeId: 'closure-review',
    output: {
      approved: true,
      terminalAllowed: true,
      requiredHardFacts: {
        sourceFilesChanged: true,
        currentRunChangedFiles: ['docs/living-doc-inference-unit-chain-hard-proof.json'],
        commitEvidencePresent: true,
        prReviewPolicy: {
          schema: 'living-doc-harness-pr-review-policy/v1',
          mode: 'required-before-closure',
        },
        prReviewRequired: true,
        prReviewEvidencePresent: true,
      },
      prReviewPolicy: {
        schema: 'living-doc-harness-pr-review-policy/v1',
        mode: 'required-before-closure',
      },
      prReviewRequired: true,
    },
    selectedNextUnitTypeId: null,
    reasonCode: 'closure-review-approves-terminal-closure',
    gateBefore: {
      commitEvidence: 'present',
      prReviewEvidence: 'approved',
      terminalAllowed: false,
    },
    gateAfter: {
      terminalAllowed: true,
    },
    requiredInspectionPaths: [prReview.step.artifacts.resultPath, prReview.step.selectionPath, commitIntent.step.artifacts.resultPath],
    inputOverrides: {
      previousUnitResultPath: prReview.step.artifacts.resultPath,
      previousSelectionPath: prReview.step.selectionPath,
      consumedCommitResultPath: commitIntent.step.artifacts.resultPath,
      consumedPrReviewResultPath: prReview.step.artifacts.resultPath,
    },
  });

  const terminal = await writeAuthorizedTerminalState(context, closureReview.unit, {
    reasonCode: 'maximal-chain-terminal-authorized',
  });
  assert.equal(terminal.record.kind, 'closed');
  assert.equal(terminal.record.loopMayContinue, false);

  await assertArtifactPathsExist(context, timeline);
  assertInputConsumes(secondWorker.step.inputReferences, repair.step.artifacts.resultPath, 'worker re-entry');
  assertInputConsumes(secondReviewer.step.inputReferences, repair.step.artifacts.resultPath, 'second reviewer');
  assertInputConsumes(prReview.step.inputReferences, commitIntent.step.artifacts.resultPath, 'pr-review');
  assertInputConsumes(closureReview.step.inputReferences, commitIntent.step.artifacts.resultPath, 'closure-review commit gate');
  assertInputConsumes(closureReview.step.inputReferences, prReview.step.artifacts.resultPath, 'closure-review pr gate');

  return {
    schema: 'living-doc-harness-maximal-chain-report/v1',
    status: 'passed',
    runId: context.runId,
    runDir: context.runDir,
    testName: 'maximal-controller-owned-chain',
    terminalStatePath: rel(context, terminal.terminalPath),
    terminalState: terminal.record,
    timeline,
  };
}

function assertGateFailure({
  name,
  gateBefore,
  expectedSelectedUnit,
  currentUnitTypeId = 'reviewer-inference',
}) {
  const current = {
    result: {
      unitId: currentUnitTypeId,
    },
  };
  const validation = assertLegalTransition({
    currentUnitTypeId: current.result.unitId,
    selectedUnitTypeId: expectedSelectedUnit,
    ok: true,
  });
  assert.equal(validation.ok, true, `${name} uses a legal controller-selected recovery unit`);
  return {
    name,
    status: 'passed',
    gateBefore,
    expectedSelectedUnit,
    validation,
  };
}

function runNegativeMatrix() {
  const cases = [
    assertGateFailure({
      name: 'commit-evidence-missing',
      gateBefore: { commitEvidence: 'missing' },
      expectedSelectedUnit: 'commit-intent',
    }),
    assertGateFailure({
      name: 'commit-evidence-outside-allowed-scope',
      gateBefore: {
        commitEvidence: 'present',
        forbiddenCommitFiles: ['scripts/unrelated-controller-change.mjs'],
      },
      expectedSelectedUnit: 'worker',
    }),
    assertGateFailure({
      name: 'pr-review-evidence-missing',
      gateBefore: { prReviewRequired: true, prReviewEvidence: 'missing' },
      expectedSelectedUnit: 'pr-review',
    }),
    assertGateFailure({
      name: 'pr-review-evidence-blocked',
      gateBefore: { prReviewRequired: true, prReviewEvidence: 'blocked' },
      expectedSelectedUnit: 'worker',
    }),
    assertGateFailure({
      name: 'closure-review-denied',
      currentUnitTypeId: 'closure-review',
      gateBefore: { terminalAllowed: false, reasonCode: 'closure-review-denied' },
      expectedSelectedUnit: 'worker',
    }),
    assertGateFailure({
      name: 'repair-skill-no-op-objective-unresolved',
      currentUnitTypeId: 'repair-skill',
      gateBefore: { repairStatus: 'no-op', objectiveState: 'unresolved' },
      expectedSelectedUnit: 'worker',
    }),
    assertGateFailure({
      name: 'invalid-next-unit-selected',
      currentUnitTypeId: 'worker',
      gateBefore: { selectedNextUnit: 'pr-review' },
      expectedSelectedUnit: 'reviewer-inference',
    }),
    assertGateFailure({
      name: 'stale-or-mismatched-iteration-evidence',
      gateBefore: { evidenceIteration: 1, selectedUnitIteration: 2 },
      expectedSelectedUnit: 'worker',
    }),
  ];

  const invalid = assertLegalTransition({
    currentUnitTypeId: 'worker',
    selectedUnitTypeId: 'pr-review',
    ok: false,
    reasonCode: 'selected-unit-type-not-allowed-by-current-contract',
  });
  assert.equal(invalid.ok, false);
  return cases;
}

try {
  const maximal = await runMaximalChain();
  const negativeMatrix = runNegativeMatrix();
  const report = {
    ...maximal,
    negativeMatrix,
  };
  if (reportPath) await writeJson(path.resolve(reportPath), report);
  console.log(`living-doc harness maximal inference unit chain spec: ${maximal.timeline.length} timeline steps, ${negativeMatrix.length} negative breakpoints passed`);
} finally {
  if (!reportRunRoot) await rm(tmp, { recursive: true, force: true });
}
