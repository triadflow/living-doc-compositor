import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { writeTerminalState } from '../../scripts/living-doc-harness-terminal-state.mjs';
import {
  assertLegalTransition,
  assertTerminalNotAuthorizedBy,
  assertUnitArtifacts,
  createInferenceUnitChainContext,
  mockInferenceUnit,
  writeAuthorizedTerminalState,
} from '../fixtures/inference-unit-chain-fixtures.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-inference-unit-chaining-'));

async function runUnit(context, unitTypeId, sequence, output = {}, options = {}) {
  const unit = await mockInferenceUnit(context, {
    unitTypeId,
    sequence,
    output,
    ...options,
  });
  await assertUnitArtifacts(context, unit);
  return unit;
}

try {
  {
    const context = await createInferenceUnitChainContext({
      rootDir: tmp,
      name: 'closed-through-closure-review',
    });
    const worker = await runUnit(context, 'worker', 1, { status: 'finished' });
    const reviewer = await runUnit(context, 'reviewer-inference', 2, {
      classification: 'closed',
      closureAllowed: true,
    });
    const closureReview = await runUnit(context, 'closure-review', 3, {
      approved: true,
      terminalAllowed: true,
    });

    assertLegalTransition({ currentUnitTypeId: worker.result.unitId, selectedUnitTypeId: reviewer.result.unitId });
    assertLegalTransition({ currentUnitTypeId: reviewer.result.unitId, selectedUnitTypeId: closureReview.result.unitId });
    assertTerminalNotAuthorizedBy(reviewer);

    const terminal = await writeAuthorizedTerminalState(context, closureReview);
    assert.equal(terminal.record.kind, 'closed');
    assert.equal(terminal.record.loopMayContinue, false);
  }

  {
    const context = await createInferenceUnitChainContext({
      rootDir: tmp,
      name: 'commit-intent-before-closure-review',
    });
    const worker = await runUnit(context, 'worker', 1, {
      status: 'finished',
      filesChanged: ['docs/fixture.json'],
    });
    const reviewer = await runUnit(context, 'reviewer-inference', 2, {
      classification: 'closed',
      closureAllowed: true,
      requiredHardFacts: {
        sourceFilesChanged: true,
        currentRunChangedFiles: ['docs/fixture.json'],
        commitEvidencePresent: false,
      },
    });
    const commitIntent = await runUnit(context, 'commit-intent', 3, {
      status: 'approved',
      changedFiles: ['docs/fixture.json'],
    });
    const closureReview = await runUnit(context, 'closure-review', 4, {
      approved: true,
      terminalAllowed: true,
      requiredHardFacts: {
        sourceFilesChanged: true,
        currentRunChangedFiles: ['docs/fixture.json'],
        commitEvidencePresent: true,
      },
    });

    assertLegalTransition({ currentUnitTypeId: worker.result.unitId, selectedUnitTypeId: reviewer.result.unitId });
    assertLegalTransition({ currentUnitTypeId: reviewer.result.unitId, selectedUnitTypeId: commitIntent.result.unitId });
    assertLegalTransition({ currentUnitTypeId: commitIntent.result.unitId, selectedUnitTypeId: closureReview.result.unitId });
    assert.equal(commitIntent.result.outputContract.sideEffect.executed, false);

    const commitInput = JSON.parse(await readFile(path.join(context.runDir, commitIntent.result.inputContractPath), 'utf8'));
    assert.equal(commitInput.requiredHardFacts.sourceFilesChanged, true);
    assert.deepEqual(commitInput.changedFiles, ['docs/fixture.json']);

    const terminal = await writeAuthorizedTerminalState(context, closureReview);
    assert.equal(terminal.record.kind, 'closed');
  }

  {
    const context = await createInferenceUnitChainContext({
      rootDir: tmp,
      name: 'pr-review-before-closure-review',
    });
    const worker = await runUnit(context, 'worker', 1, { status: 'finished' });
    const reviewer = await runUnit(context, 'reviewer-inference', 2, {
      classification: 'closed',
      closureAllowed: true,
      prReviewPolicy: {
        schema: 'living-doc-harness-pr-review-policy/v1',
        mode: 'required-before-closure',
      },
      prReviewRequired: true,
      requiredHardFacts: {
        prReviewPolicy: {
          schema: 'living-doc-harness-pr-review-policy/v1',
          mode: 'required-before-closure',
        },
        prReviewRequired: true,
        prReviewEvidencePresent: false,
      },
    });
    const prReview = await runUnit(context, 'pr-review', 3, {
      status: 'approved',
      prReviewPolicy: {
        schema: 'living-doc-harness-pr-review-policy/v1',
        mode: 'required-before-closure',
      },
      prReviewRequired: true,
    });
    const closureReview = await runUnit(context, 'closure-review', 4, {
      approved: true,
      terminalAllowed: true,
      prReviewPolicy: {
        schema: 'living-doc-harness-pr-review-policy/v1',
        mode: 'required-before-closure',
      },
      prReviewRequired: true,
      requiredHardFacts: {
        prReviewPolicy: {
          schema: 'living-doc-harness-pr-review-policy/v1',
          mode: 'required-before-closure',
        },
        prReviewRequired: true,
        prReviewEvidencePresent: true,
      },
    });

    assertLegalTransition({ currentUnitTypeId: worker.result.unitId, selectedUnitTypeId: reviewer.result.unitId });
    assertLegalTransition({ currentUnitTypeId: reviewer.result.unitId, selectedUnitTypeId: prReview.result.unitId });
    assertLegalTransition({ currentUnitTypeId: prReview.result.unitId, selectedUnitTypeId: closureReview.result.unitId });
    assert.equal(prReview.result.outputContract.sideEffect.executed, false);

    const prInput = JSON.parse(await readFile(path.join(context.runDir, prReview.result.inputContractPath), 'utf8'));
    assert.equal(prInput.prReviewPolicy.mode, 'required-before-closure');
    assert.equal(prInput.prReviewRequired, true);
  }

  {
    const context = await createInferenceUnitChainContext({
      rootDir: tmp,
      name: 'repair-chain-returns-to-worker',
    });
    const worker = await runUnit(context, 'worker', 1, { status: 'finished' });
    const reviewer = await runUnit(context, 'reviewer-inference', 2, {
      classification: 'repairable',
      closureAllowed: false,
      nextMode: 'repair',
    });
    const balanceScan = await runUnit(context, 'living-doc-balance-scan', 3, {
      status: 'ordered',
      orderedSkills: ['objective-conservation-audit'],
    });
    const repairSkill = await runUnit(context, 'repair-skill', 4, {
      status: 'repaired',
      skill: 'objective-conservation-audit',
      changedFiles: [],
    });
    const nextWorker = await runUnit(context, 'worker', 5, { status: 'running' });

    assertLegalTransition({ currentUnitTypeId: worker.result.unitId, selectedUnitTypeId: reviewer.result.unitId });
    assertLegalTransition({ currentUnitTypeId: reviewer.result.unitId, selectedUnitTypeId: balanceScan.result.unitId });
    assertLegalTransition({ currentUnitTypeId: balanceScan.result.unitId, selectedUnitTypeId: repairSkill.result.unitId });
    assertLegalTransition({ currentUnitTypeId: repairSkill.result.unitId, selectedUnitTypeId: nextWorker.result.unitId });
  }

  {
    const context = await createInferenceUnitChainContext({
      rootDir: tmp,
      name: 'true-block-starts-fresh-worker',
    });
    const worker = await runUnit(context, 'worker', 1, { status: 'finished' });
    const reviewer = await runUnit(context, 'reviewer-inference', 2, {
      classification: 'true-block',
      closureAllowed: false,
      reasonCode: 'fixture-blocker',
    });
    const freshWorker = await runUnit(context, 'worker', 3, {
      status: 'running',
      reasonCode: 'fixture-blocker',
    });

    assertLegalTransition({ currentUnitTypeId: worker.result.unitId, selectedUnitTypeId: reviewer.result.unitId });
    assertLegalTransition({ currentUnitTypeId: reviewer.result.unitId, selectedUnitTypeId: freshWorker.result.unitId });

    const terminal = await writeTerminalState({
      runDir: context.runDir,
      iteration: context.iteration,
      now: '2026-05-14T00:02:00.000Z',
      evidence: {
        runId: context.runId,
        objectiveState: {
          stageAfter: 'blocked',
          unresolvedObjectiveTerms: ['fixture blocker'],
          unprovenAcceptanceCriteria: ['fixture fresh worker handoff'],
        },
      },
      verdict: reviewer.result.outputContract,
    });
    assert.equal(terminal.record.kind, 'continuation-required');
    assert.equal(terminal.record.loopMayContinue, true);
    assert.notEqual(terminal.record.kind, 'closed');
  }

  {
    const context = await createInferenceUnitChainContext({
      rootDir: tmp,
      name: 'closure-review-blocked-continues',
    });
    const reviewer = await runUnit(context, 'reviewer-inference', 1, {
      classification: 'closed',
      closureAllowed: true,
    });
    const closureReview = await runUnit(context, 'closure-review', 2, {
      approved: false,
      terminalAllowed: false,
      reasonCode: 'fixture-closure-review-denied',
    });
    const freshWorker = await runUnit(context, 'worker', 3, {
      status: 'running',
      reasonCode: 'fixture-closure-review-denied',
    });

    assertLegalTransition({ currentUnitTypeId: reviewer.result.unitId, selectedUnitTypeId: closureReview.result.unitId });
    assertLegalTransition({ currentUnitTypeId: closureReview.result.unitId, selectedUnitTypeId: freshWorker.result.unitId });
    assert.equal(closureReview.result.outputContract.terminalAllowed, false);
  }

  {
    assertLegalTransition({
      currentUnitTypeId: 'worker',
      selectedUnitTypeId: 'pr-review',
      ok: false,
      reasonCode: 'selected-unit-type-not-allowed-by-current-contract',
    });

    assertLegalTransition({
      currentUnitTypeId: 'reviewer-inference',
      selectedUnitTypeId: 'pr-review',
      allowedUnitTypes: ['worker', 'reviewer-inference', 'closure-review', 'worker', 'post-flight-summary'],
      ok: false,
      reasonCode: 'selected-unit-type-not-allowed-for-run',
    });
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness inference unit chaining spec: all assertions passed');
