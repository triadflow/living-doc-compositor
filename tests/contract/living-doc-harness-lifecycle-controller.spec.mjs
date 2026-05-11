import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { deriveGitWorktreeEvidence, runHarnessLifecycle } from '../../scripts/living-doc-harness-lifecycle.mjs';

function minimalDoc(docPath) {
  return {
    docId: 'test:lifecycle-controller',
    title: 'Lifecycle Controller Fixture',
    subtitle: 'Fixture',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: docPath,
    sourceCoverage: 'fixture',
    updated: '2026-05-07T12:40:00.000Z',
    objective: 'Prove the lifecycle controller owns output-input iterations.',
    successCondition: 'The controller reaches terminal state without manual runner/finalizer commands between iterations.',
    sections: [],
  };
}

function sourceClosureDoc(docPath) {
  return {
    docId: 'test:source-derived-closure',
    title: 'Source Derived Closure Fixture',
    subtitle: 'Fixture',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: docPath,
    sourceCoverage: 'fixture',
    updated: '2026-05-07T13:20:00.000Z',
    objective: 'Close only after the second worker iteration updates source and living-doc state.',
    successCondition: 'The lifecycle finalizer derives closure from objectiveReady, completed criteria, rendered HTML, and trace refs.',
    runState: {
      currentPhase: 'phase-1-ready',
      documentReady: true,
      objectiveReady: false,
      nextObjectiveAction: 'run phase 1',
    },
    sections: [
      {
        id: 'acceptance-criteria',
        title: 'Acceptance Criteria',
        convergenceType: 'acceptance-criteria',
        updated: '2026-05-07T13:20:00.000Z',
        data: [
          {
            id: 'criterion-phase-one',
            name: 'Phase one completed',
            status: 'pending',
            updated: '2026-05-07T13:20:00.000Z',
          },
          {
            id: 'criterion-phase-two',
            name: 'Phase two completed',
            status: 'pending',
            updated: '2026-05-07T13:20:00.000Z',
          },
        ],
      },
    ],
  };
}

function reviewerVerdict(classification, {
  closureAllowed = false,
  reasonCode = classification === 'closed' ? 'objective-proven' : classification === 'true-block' ? 'missing-source' : 'proof-or-objective-unsatisfied',
  mode = classification === 'closed' ? 'none' : classification === 'user-stopped' ? 'user-stop' : classification === 'true-block' ? 'block' : 'repair',
  instruction = 'Run the appropriate repair or proof-producing action for the unresolved objective state.',
  terminal = null,
} = {}) {
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification,
      reasonCode,
      confidence: 'high',
      closureAllowed,
      basis: ['Reviewer inference fixture read the frozen evidence and emitted this lifecycle verdict.'],
    },
    nextIteration: {
      allowed: !['closed', 'user-stopped'].includes(classification),
      mode,
      instruction,
      mustNotDo: classification === 'closed' ? [] : ['Do not stop before objective closure or explicit user stop.'],
    },
    ...(terminal ? { terminal } : {}),
  };
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-lifecycle-controller-'));

try {
  const gitFixture = path.join(tmp, 'git-fixture');
  await mkdir(gitFixture, { recursive: true });
  spawnSync('git', ['init'], { cwd: gitFixture, stdio: 'ignore' });
  await mkdir(path.join(gitFixture, 'scripts'), { recursive: true });
  await writeFile(path.join(gitFixture, 'scripts', 'example.mjs'), 'export const value = 1;\n', 'utf8');
  spawnSync('git', ['add', 'scripts/example.mjs'], { cwd: gitFixture, stdio: 'ignore' });
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'], { cwd: gitFixture, stdio: 'ignore' });
  await writeFile(path.join(gitFixture, 'scripts', 'example.mjs'), 'export const value = 2;\n', 'utf8');
  const worktreeEvidence = await deriveGitWorktreeEvidence({ cwd: gitFixture });
  assert.equal(worktreeEvidence.ok, true);
  assert.equal(worktreeEvidence.sourceFilesChanged, true);
  assert.deepEqual(worktreeEvidence.dirtyTrackedFiles, ['scripts/example.mjs']);

  const docPath = path.join(tmp, 'doc.json');
  await writeFile(docPath, `${JSON.stringify(minimalDoc(docPath), null, 2)}\n`, 'utf8');
  const sequencePath = path.join(tmp, 'evidence-sequence.json');
  await writeFile(sequencePath, `${JSON.stringify({
    schema: 'living-doc-harness-lifecycle-evidence-sequence/v1',
    iterations: [
      {
        stageAfter: 'worker-claimed-done',
        unresolvedObjectiveTerms: ['output-input channel must start the next iteration'],
        unprovenAcceptanceCriteria: ['criterion-owned-lifecycle-controller'],
        acceptanceCriteriaSatisfied: 'fail',
        closureAllowed: false,
        finalMessageSummary: 'Worker claims done, but output-input proof is missing.',
        wrapperSummary: { claimedStatus: 'done' },
        traceMessage: 'Iteration one produced a premature completion claim.',
        reviewerVerdict: reviewerVerdict('closure-candidate', {
          reasonCode: 'closure-proof-incomplete',
          mode: 'repair',
        }),
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        finalMessageSummary: 'Lifecycle controller proof is complete.',
        filesChanged: ['scripts/living-doc-harness-lifecycle.mjs'],
        sideEffectEvidence: {
          commit: {
            sha: 'abc1234',
            required: true,
          },
        },
        traceMessage: 'Iteration two produced terminal proof.',
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ],
  }, null, 2)}\n`, 'utf8');

  const result = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'runs'),
    evidenceDir: path.join(tmp, 'evidence'),
    dashboardPath: path.join(tmp, 'dashboard.html'),
    evidenceSequencePath: sequencePath,
    now: '2026-05-07T12:40:00.000Z',
  });

  assert.equal(result.schema, 'living-doc-harness-lifecycle-result/v1');
  assert.equal(result.iterationCount, 2);
  assert.equal(result.finalState.kind, 'closed');
  assert.match(result.finalState.postFlightSummaryPath, /iteration-2-post-flight-summary\.md$/);
  assert.match(result.finalState.postFlightUnitResultPath, /inference-units\/iteration-2\/04-post-flight-summary\/result\.json$/);
  assert.equal(result.iterations[0].classification, 'closure-candidate');
  assert.equal(result.iterations[0].terminalKind, 'repair-resumed');
  assert.equal(result.iterations[0].nextAction.action, 'start-next-worker-iteration');
  assert.equal(result.iterations[1].classification, 'closed');
  assert.equal(result.iterations[1].terminalKind, 'closed');
  assert.match(result.iterations[1].closureReviewResultPath, /inference-units\/iteration-2\/03-closure-review\/result\.json$/);
  const lifecycleEvents = await readFile(path.join(result.lifecycleDir, 'events.jsonl'), 'utf8');
  assert.match(lifecycleEvents, /closureReviewResultPath/);
  assert.match(lifecycleEvents, /03-closure-review/);
  const firstEvidence = JSON.parse(await readFile(path.resolve(process.cwd(), result.iterations[0].runDir, 'artifacts', 'iteration-1-evidence.json'), 'utf8'));
  assert.match(firstEvidence.controllerEvidenceSnapshotPath, /iteration-1-controller-evidence-snapshot\.json$/);
  assert.equal(firstEvidence.requiredHardFacts.schema, 'living-doc-harness-required-hard-facts/v1');
  const firstReviewerInput = JSON.parse(await readFile(path.resolve(process.cwd(), result.iterations[0].runDir, 'reviewer-inference', 'iteration-1-input.json'), 'utf8'));
  assert.equal(firstReviewerInput.evidenceSnapshotPath, firstEvidence.controllerEvidenceSnapshotPath);
  assert.equal(firstReviewerInput.requiredHardFacts.schema, 'living-doc-harness-required-hard-facts/v1');
  assert.equal(firstReviewerInput.controllerEvidence.schema, 'living-doc-harness-controller-evidence-summary/v1');
  assert.equal(firstReviewerInput.controllerEvidence.gitWorktree.schema, 'living-doc-harness-git-worktree-evidence-summary/v1');
  assert.equal(firstReviewerInput.controllerEvidence.gitWorktree.entries.omittedFromInlineContract, true);

  const firstOutputInput = JSON.parse(await readFile(path.resolve(process.cwd(), result.iterations[0].outputInputPath), 'utf8'));
  assert.equal(firstOutputInput.schema, 'living-doc-harness-output-input/v1');
  assert.equal(firstOutputInput.postReviewSelection.nextUnit.unitId, 'worker');
  assert.equal(firstOutputInput.nextUnit.unitId, 'worker');
  assert.match(firstOutputInput.previousOutput.postReviewSelectionPath, /iteration-1-post-review-selection\.json$/);
  assert.equal(firstOutputInput.nextInput.mode, 'repair');
  assert.equal(firstOutputInput.nextInput.previousRunId, result.iterations[0].runId);
  assert.match(firstOutputInput.nextInput.handoverPath, /iteration-1-handover\.json$/);
  const secondOutputInput = JSON.parse(await readFile(path.resolve(process.cwd(), result.iterations[1].outputInputPath), 'utf8'));
  assert.equal(secondOutputInput.postReviewSelection.nextUnit.unitId, 'closure-review');
  assert.equal(secondOutputInput.postReviewSelection.terminalAction.kind, 'closed');
  assert.equal(secondOutputInput.terminalAction.kind, 'closed');

  const secondContract = JSON.parse(await readFile(path.resolve(process.cwd(), result.iterations[1].runDir, 'contract.json'), 'utf8'));
  assert.equal(secondContract.lifecycleInput.previousRunId, result.iterations[0].runId);
  assert.equal(secondContract.lifecycleInput.mode, 'repair');
  const secondPrompt = await readFile(path.resolve(process.cwd(), result.iterations[1].runDir, 'prompt.md'), 'utf8');
  assert.match(secondPrompt, /Lifecycle input from previous iteration/);
  assert.match(secondPrompt, /previousRunId:/);

  const noisyGitFixture = path.join(tmp, 'noisy-git-fixture');
  await mkdir(path.join(noisyGitFixture, 'scripts'), { recursive: true });
  await mkdir(path.join(noisyGitFixture, 'docs'), { recursive: true });
  await mkdir(path.join(noisyGitFixture, 'evidence', 'living-doc-harness'), { recursive: true });
  const noisyDocPath = path.join(noisyGitFixture, 'docs', 'noisy-doc.json');
  spawnSync('git', ['init'], { cwd: noisyGitFixture, stdio: 'ignore' });
  await writeFile(path.join(noisyGitFixture, 'scripts', 'example.mjs'), 'export const value = 1;\n', 'utf8');
  await writeFile(noisyDocPath, `${JSON.stringify(minimalDoc(noisyDocPath), null, 2)}\n`, 'utf8');
  spawnSync('git', ['add', 'scripts/example.mjs', 'docs/noisy-doc.json'], { cwd: noisyGitFixture, stdio: 'ignore' });
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'], { cwd: noisyGitFixture, stdio: 'ignore' });
  await writeFile(path.join(noisyGitFixture, 'scripts', 'example.mjs'), 'export const value = 2;\n', 'utf8');
  for (let index = 0; index < 1200; index += 1) {
    await writeFile(
      path.join(noisyGitFixture, 'evidence', 'living-doc-harness', `historical-run-${String(index).padStart(4, '0')}-artifact-with-long-name.json`),
      '{"fixture":true}\n',
      'utf8',
    );
  }
  const noisySequencePath = path.join(noisyGitFixture, 'noisy-sequence.json');
  await writeFile(noisySequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'operator-stop-after-noisy-controller-snapshot',
        acceptanceCriteriaSatisfied: 'fail',
        closureAllowed: false,
        traceMessage: 'Noisy worktree fixture stops after reviewer input is written.',
        reviewerVerdict: reviewerVerdict('user-stopped', {
          reasonCode: 'operator-stop',
          mode: 'user-stop',
        }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const noisyLifecycle = await runHarnessLifecycle({
    docPath: noisyDocPath,
    runsDir: 'runs',
    evidenceDir: 'evidence-out',
    dashboardPath: 'dashboard.html',
    evidenceSequencePath: noisySequencePath,
    cwd: noisyGitFixture,
    gitWorktreeCwd: noisyGitFixture,
    enforceControllerWorktreeEvidence: true,
    now: '2026-05-07T12:41:30.000Z',
  });
  const noisyRunDir = path.resolve(noisyGitFixture, noisyLifecycle.iterations[0].runDir);
  const noisyReviewerInputPath = path.join(noisyRunDir, 'reviewer-inference', 'iteration-1-input.json');
  const noisyReviewerInputRaw = await readFile(noisyReviewerInputPath, 'utf8');
  const noisyReviewerInput = JSON.parse(noisyReviewerInputRaw);
  const noisyEvidence = JSON.parse(await readFile(path.join(noisyRunDir, 'artifacts', 'iteration-1-evidence.json'), 'utf8'));
  const noisySnapshotRaw = await readFile(path.join(noisyRunDir, noisyEvidence.controllerEvidenceSnapshotPath), 'utf8');
  assert.equal(noisyReviewerInput.requiredHardFacts.sourceFilesChanged, true);
  assert.deepEqual(noisyReviewerInput.requiredHardFacts.dirtyTrackedFiles, ['scripts/example.mjs']);
  assert.ok(noisyReviewerInput.controllerEvidence.gitWorktree.untrackedFiles.count >= 1200);
  assert.equal(noisyReviewerInput.controllerEvidence.gitWorktree.untrackedFiles.omittedFromInlineContract, true);
  assert.equal(Object.hasOwn(noisyReviewerInput.controllerEvidence.gitWorktree, 'entries') && Array.isArray(noisyReviewerInput.controllerEvidence.gitWorktree.entries), false);
  assert.ok(Buffer.byteLength(noisyReviewerInputRaw, 'utf8') < 120_000);
  assert.ok(Buffer.byteLength(noisySnapshotRaw, 'utf8') > Buffer.byteLength(noisyReviewerInputRaw, 'utf8'));

  const resumePostFlightSequencePath = path.join(tmp, 'resume-post-flight-sequence.json');
  await writeFile(resumePostFlightSequencePath, `${JSON.stringify({
    schema: 'living-doc-harness-lifecycle-evidence-sequence/v1',
    iterations: [
      {
        stageAfter: 'criteria-pending-after-routing-fix',
        unresolvedObjectiveTerms: ['objective proof must continue after routing fix'],
        unprovenAcceptanceCriteria: ['criterion-post-flight-summary'],
        acceptanceCriteriaSatisfied: 'pending',
        closureAllowed: false,
        finalMessageSummary: 'Worker stopped with pending criteria after the routing fix.',
        traceMessage: 'Iteration one produced resumable evidence and mentioned post-flight before closure.',
        reviewerVerdict: reviewerVerdict('resumable', {
          reasonCode: 'criteria-pending-after-routing-fix',
          mode: 'resume',
          instruction: 'Resume the harness after the controller-owned routing fix, rerun the objective proof path, and continue until post-flight summary can run after closure.',
        }),
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        finalMessageSummary: 'Lifecycle controller proof is complete after resume.',
        sideEffectEvidence: {
          commit: {
            sha: 'def5678',
            required: true,
          },
        },
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const resumePostFlight = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'resume-post-flight-runs'),
    evidenceDir: path.join(tmp, 'resume-post-flight-evidence'),
    dashboardPath: path.join(tmp, 'resume-post-flight-dashboard.html'),
    evidenceSequencePath: resumePostFlightSequencePath,
    now: '2026-05-07T12:41:00.000Z',
  });
  const resumeOutputInput = JSON.parse(await readFile(path.resolve(process.cwd(), resumePostFlight.iterations[0].outputInputPath), 'utf8'));
  assert.equal(resumePostFlight.iterations[0].classification, 'resumable');
  assert.equal(resumeOutputInput.postReviewSelection.nextUnit.unitId, 'worker');
  assert.equal(resumeOutputInput.nextUnit.unitId, 'worker');
  assert.equal(resumeOutputInput.nextAction.action, 'start-next-worker-iteration');
  assert.equal(resumeOutputInput.nextInput.mode, 'resume');
  assert.notEqual(resumeOutputInput.postReviewSelection.nextUnit.unitId, 'post-flight-summary');

  const commitPendingSequencePath = path.join(tmp, 'commit-pending-sequence.json');
  await writeFile(commitPendingSequencePath, `${JSON.stringify({
    schema: 'living-doc-harness-lifecycle-evidence-sequence/v1',
    iterations: [
      {
        stageAfter: 'input-contract-gate-implemented-source-and-tests-green-commit-evidence-pending',
        unresolvedObjectiveTerms: ['fresh current-run commit evidence must be produced before closure'],
        unprovenAcceptanceCriteria: ['criterion-side-effect-contracts', 'criterion-closure-gates'],
        acceptanceCriteriaSatisfied: 'pending',
        closureAllowed: false,
        finalMessageSummary: 'Worker stopped with source and test proof but commit evidence is pending.',
        traceMessage: 'Iteration one produced proof and mentioned commit evidence before closure review.',
        reviewerVerdict: reviewerVerdict('resumable', {
          reasonCode: 'commit-evidence-and-criteria-pending',
          mode: 'continuation',
          instruction: 'Continue by producing fresh current-run commit evidence, then run closure review and post-flight summary only after acceptance criteria pass.',
        }),
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        finalMessageSummary: 'Lifecycle controller proof is complete after commit evidence.',
        sideEffectEvidence: {
          commit: {
            sha: 'fedcba9',
            required: true,
          },
        },
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const commitPending = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'commit-pending-runs'),
    evidenceDir: path.join(tmp, 'commit-pending-evidence'),
    dashboardPath: path.join(tmp, 'commit-pending-dashboard.html'),
    evidenceSequencePath: commitPendingSequencePath,
    now: '2026-05-07T12:42:00.000Z',
  });
  const commitPendingOutputInput = JSON.parse(await readFile(path.resolve(process.cwd(), commitPending.iterations[0].outputInputPath), 'utf8'));
  assert.equal(commitPending.iterations[0].classification, 'resumable');
  assert.equal(commitPendingOutputInput.postReviewSelection.nextUnit.unitId, 'commit-intent');
  assert.equal(commitPendingOutputInput.nextUnit.unitId, 'commit-intent');
  assert.equal(commitPendingOutputInput.nextAction.action, 'continue-with-commit-intent');
  assert.equal(commitPendingOutputInput.nextAction.selectedUnitType, 'commit-intent');
  assert.equal(commitPendingOutputInput.nextInput.mode, 'continuation');
  assert.notEqual(commitPendingOutputInput.postReviewSelection.nextUnit.unitId, 'closure-review');
  assert.notEqual(commitPendingOutputInput.postReviewSelection.nextUnit.unitId, 'worker');
  assert.equal(commitPending.iterations[0].closureReviewResultPath, null);

  const closureCandidateCommitGateSequencePath = path.join(tmp, 'closure-candidate-commit-gate-sequence.json');
  await writeFile(closureCandidateCommitGateSequencePath, `${JSON.stringify({
    schema: 'living-doc-harness-lifecycle-evidence-sequence/v1',
    iterations: [
      {
        stageAfter: 'worker-verification-green-controller-rerun-and-commit-gates-pending',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: ['criterion-side-effect-contracts', 'criterion-closure-gates'],
        acceptanceCriteriaSatisfied: 'pending',
        closureAllowed: false,
        filesChanged: ['docs/living-doc-inference-unit-type-system.json'],
        finalMessageSummary: 'Worker verified source and tests but says commit-intent and closure gates are controller-owned.',
        traceMessage: 'Iteration one produced worker-side proof and deferred to controller-owned commit gates.',
        reviewerVerdict: reviewerVerdict('closure-candidate', {
          reasonCode: 'acceptance-criteria-pending',
          mode: 'continuation',
          instruction: 'Continue through controller rerun and commit-intent gates, then closure review and post-flight summary.',
        }),
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        finalMessageSummary: 'Lifecycle controller proof is complete after controller gate routing.',
        sideEffectEvidence: {
          commit: {
            sha: '0ddba11',
            required: true,
          },
        },
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const closureCandidateCommitGate = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'closure-candidate-commit-gate-runs'),
    evidenceDir: path.join(tmp, 'closure-candidate-commit-gate-evidence'),
    dashboardPath: path.join(tmp, 'closure-candidate-commit-gate-dashboard.html'),
    evidenceSequencePath: closureCandidateCommitGateSequencePath,
    now: '2026-05-07T13:24:00.000Z',
  });
  assert.equal(closureCandidateCommitGate.iterationCount, 2);
  assert.equal(closureCandidateCommitGate.iterations[0].classification, 'true-block');
  const closureCandidateCommitGateOutputInput = JSON.parse(await readFile(path.resolve(process.cwd(), closureCandidateCommitGate.iterations[0].outputInputPath), 'utf8'));
  const closureCandidateCommitGateSelection = JSON.parse(await readFile(path.resolve(process.cwd(), closureCandidateCommitGate.iterations[0].postReviewSelectionPath), 'utf8'));
  assert.equal(closureCandidateCommitGateSelection.classification, 'closure-candidate');
  assert.equal(closureCandidateCommitGateOutputInput.postReviewSelection.nextUnit.unitId, 'commit-intent');
  assert.notEqual(closureCandidateCommitGateOutputInput.postReviewSelection.nextUnit.unitId, 'worker');
  assert.match(closureCandidateCommitGateOutputInput.postReviewSelection.nextUnit.resultPath, /inference-units\/iteration-1\/04-commit-intent\/result\.json$/);
  assert.equal(closureCandidateCommitGateSelection.contractValidation.ok, true);
  const closureCandidateCommitGateContinuationContract = JSON.parse(await readFile(path.resolve(
    process.cwd(),
    closureCandidateCommitGate.iterations[1].runDir,
    'contract.json',
  ), 'utf8'));
  assert.equal(closureCandidateCommitGateContinuationContract.runConfig.initialUnitType, 'commit-intent');
  assert.equal(closureCandidateCommitGateContinuationContract.process.env.LIVING_DOC_HARNESS_ROLE, 'commit-intent');
  assert.equal(closureCandidateCommitGateContinuationContract.lifecycleInput.selectedUnitType, 'commit-intent');
  assert.equal(closureCandidateCommitGateContinuationContract.lifecycleInput.nextUnit.unitId, 'commit-intent');
  assert.equal(closureCandidateCommitGateContinuationContract.artifacts.initialInferenceUnit.unitId, 'commit-intent');
  assert.equal(closureCandidateCommitGateContinuationContract.artifacts.workerInferenceUnit, undefined);
  const closureCandidateCommitGateContinuationInput = JSON.parse(await readFile(path.resolve(
    process.cwd(),
    closureCandidateCommitGate.iterations[1].runDir,
    closureCandidateCommitGateContinuationContract.artifacts.initialInferenceUnit.inputContract,
  ), 'utf8'));
  assert.equal(closureCandidateCommitGateContinuationInput.schema, 'living-doc-harness-commit-intent-input/v1');
  assert.equal(closureCandidateCommitGateContinuationInput.lifecycleInput.nextUnit.unitId, 'commit-intent');
  assert.equal(closureCandidateCommitGate.iterations[1].classification, 'closed');
  assert.equal(closureCandidateCommitGate.finalState.kind, 'closed');

  const terminalSequencePath = path.join(tmp, 'terminal-sequence.json');
  await writeFile(terminalSequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'blocked',
        acceptanceCriteriaSatisfied: 'fail',
        closureAllowed: false,
        traceMessage: 'Missing source authority.',
        terminalSignal: {
          kind: 'true-block',
          reasonCode: 'missing-source',
          owningLayer: 'source-authority',
          requiredDecision: 'Provide the missing source.',
          unblockCriteria: ['source exists'],
          basis: ['The source required by the objective is unavailable.'],
        },
        reviewerVerdict: reviewerVerdict('true-block', {
          reasonCode: 'missing-source',
          mode: 'continuation',
          terminal: {
            kind: 'true-block',
            reasonCode: 'missing-source',
            owningLayer: 'source-authority',
            requiredDecision: 'Provide the missing source.',
            unblockCriteria: ['source exists'],
            basis: ['The source required by the objective is unavailable.'],
          },
        }),
      },
      {
        stageAfter: 'closed',
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const terminal = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'terminal-runs'),
    evidenceDir: path.join(tmp, 'terminal-evidence'),
    dashboardPath: path.join(tmp, 'terminal-dashboard.html'),
    evidenceSequencePath: terminalSequencePath,
    now: '2026-05-07T12:50:00.000Z',
  });
  assert.equal(terminal.iterationCount, 2);
  assert.equal(terminal.finalState.kind, 'closed');
  assert.equal(terminal.iterations[0].classification, 'true-block');
  assert.equal(terminal.iterations[0].terminalKind, 'continuation-required');
  assert.equal(terminal.iterations[0].nextAction.action, 'continue-with-continuation-inference');
  const trueBlockOutputInput = JSON.parse(await readFile(path.resolve(process.cwd(), terminal.iterations[0].outputInputPath), 'utf8'));
  assert.equal(trueBlockOutputInput.postReviewSelection.nextUnit.unitId, 'continuation-inference');
  assert.equal(trueBlockOutputInput.nextAction.selectedUnitType, 'continuation-inference');
  assert.equal(trueBlockOutputInput.terminalAction, null);

  const trueBlockBatchSequencePath = path.join(tmp, 'true-block-batch-sequence.json');
  await writeFile(trueBlockBatchSequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'blocked',
        acceptanceCriteriaSatisfied: 'fail',
        closureAllowed: false,
        traceMessage: 'Runtime proof surface unavailable in this worker batch.',
        terminalSignal: {
          kind: 'true-block',
          reasonCode: 'runtime-proof-surface-unavailable',
          owningLayer: 'runtime',
          requiredDecision: 'Resume in a runtime that can inspect the proof surface.',
          unblockCriteria: ['proof surface is available to a continuation worker'],
          basis: ['The current worker batch cannot inspect the runtime proof surface.'],
        },
        reviewerVerdict: reviewerVerdict('true-block', {
          reasonCode: 'runtime-proof-surface-unavailable',
          mode: 'continuation',
          terminal: {
            kind: 'true-block',
            reasonCode: 'runtime-proof-surface-unavailable',
            owningLayer: 'runtime',
            requiredDecision: 'Resume in a runtime that can inspect the proof surface.',
            unblockCriteria: ['proof surface is available to a continuation worker'],
            basis: ['The current worker batch cannot inspect the runtime proof surface.'],
          },
        }),
      },
      {
        stageAfter: 'closed',
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Continuation worker reached objective closure after the true block was carried forward.',
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const trueBlockBatch = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'true-block-batch-runs'),
    evidenceDir: path.join(tmp, 'true-block-batch-evidence'),
    dashboardPath: path.join(tmp, 'true-block-batch-dashboard.html'),
    evidenceSequencePath: trueBlockBatchSequencePath,
    now: '2026-05-07T12:52:00.000Z',
  });
  assert.equal(trueBlockBatch.iterationCount, 2);
  assert.equal(trueBlockBatch.finalState.kind, 'closed');
  assert.equal(trueBlockBatch.iterations[0].classification, 'true-block');
  assert.equal(trueBlockBatch.iterations[0].terminalKind, 'continuation-required');
  assert.equal(trueBlockBatch.iterations[0].nextAction.action, 'continue-with-continuation-inference');
  assert.equal(trueBlockBatch.iterations[0].nextAction.allowed, true);
  assert.equal(trueBlockBatch.iterations[1].classification, 'closed');
  const trueBlockBatchOutputInput = JSON.parse(await readFile(path.resolve(process.cwd(), trueBlockBatch.iterations[0].outputInputPath), 'utf8'));
  assert.equal(trueBlockBatchOutputInput.previousOutput.classification, 'true-block');
  assert.equal(trueBlockBatchOutputInput.previousOutput.terminalKind, 'continuation-required');
  assert.equal(trueBlockBatchOutputInput.postReviewSelection.nextUnit.unitId, 'continuation-inference');
  assert.equal(trueBlockBatchOutputInput.nextAction.selectedUnitType, 'continuation-inference');
  assert.equal(trueBlockBatchOutputInput.terminalAction, null);
  assert.equal(trueBlockBatchOutputInput.nextInput.mode, 'continuation');
  assert.match(trueBlockBatchOutputInput.nextAction.reason, /unresolved objective state/);

  const deniedClosureSequencePath = path.join(tmp, 'denied-closure-sequence.json');
  const fakeClosureReviewPath = path.join(tmp, 'fake-closure-review.mjs');
  const fakeClosureReviewCountPath = `${fakeClosureReviewPath}.count`;
  await writeFile(fakeClosureReviewPath, `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const outputPath = args[args.indexOf('-o') + 1];
const prompt = readFileSync(0, 'utf8');
const match = prompt.match(/"requiredInspectionPaths"\\s*:\\s*(\\[[\\s\\S]*?\\])/);
const required = match ? JSON.parse(match[1]) : [];
for (const requiredPath of required) {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'command_execution',
      command: "sed -n '1,20p' " + JSON.stringify(requiredPath),
      status: 'completed'
    }
  }));
}
const countPath = ${JSON.stringify(fakeClosureReviewCountPath)};
const current = existsSync(countPath) ? Number(readFileSync(countPath, 'utf8') || '0') || 0 : 0;
const next = current + 1;
writeFileSync(countPath, String(next));
writeFileSync(outputPath, JSON.stringify({
  schema: 'living-doc-harness-closure-review/v1',
  status: next > 1 ? 'approved' : 'blocked',
  approved: next > 1,
  reasonCode: next > 1 ? 'fixture-approved-closure' : 'fixture-denied-closure',
  confidence: 'high',
  basis: [next > 1 ? 'Fake closure-review inference approved closure on the resumed iteration.' : 'Fake closure-review inference denied closure after inspecting required paths.'],
  terminalAllowed: next > 1
}) + '\\n');
`, 'utf8');
  await chmod(fakeClosureReviewPath, 0o755);
  await writeFile(deniedClosureSequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Worker produced closure-shaped evidence, but closure review denies terminal closure.',
        reviewerVerdict: reviewerVerdict('closed', {
          closureAllowed: true,
          reasonCode: 'objective-proven-by-reviewer',
        }),
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Resumed worker preserved closure evidence and the closure review approves it.',
        reviewerVerdict: reviewerVerdict('closed', {
          closureAllowed: true,
          reasonCode: 'objective-proven-by-reviewer',
        }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const deniedClosure = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'denied-closure-runs'),
    evidenceDir: path.join(tmp, 'denied-closure-evidence'),
    dashboardPath: path.join(tmp, 'denied-closure-dashboard.html'),
    evidenceSequencePath: deniedClosureSequencePath,
    executeClosureReview: true,
    codexBin: fakeClosureReviewPath,
    now: '2026-05-07T12:55:00.000Z',
  });
  assert.equal(deniedClosure.iterationCount, 2);
  assert.equal(deniedClosure.finalState.kind, 'closed');
  assert.match(deniedClosure.iterations[0].closureReviewResultPath, /inference-units\/iteration-1\/03-closure-review\/result\.json$/);
  assert.match(deniedClosure.iterations[0].postReviewSelectionPath, /artifacts\/iteration-1-post-review-selection\.json$/);
  const deniedOutputInput = JSON.parse(await readFile(path.resolve(process.cwd(), deniedClosure.iterations[0].outputInputPath), 'utf8'));
  assert.equal(deniedOutputInput.nextUnit.unitId, 'continuation-inference');
  assert.equal(deniedOutputInput.terminalAction, null);
  assert.equal(deniedOutputInput.postReviewSelection.nextUnit.status, 'selected');

  const failingClosureReviewPath = path.join(tmp, 'failing-closure-review.mjs');
  const processDefectSequencePath = path.join(tmp, 'process-defect-sequence.json');
  await writeFile(failingClosureReviewPath, `#!/usr/bin/env node
console.error('fixture closure-review process failed before writing a result');
process.exit(2);
`, 'utf8');
  await chmod(failingClosureReviewPath, 0o755);
  await writeFile(processDefectSequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Closure-review command fails before returning a contract.',
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const processDefect = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'process-defect-runs'),
    evidenceDir: path.join(tmp, 'process-defect-evidence'),
    dashboardPath: path.join(tmp, 'process-defect-dashboard.html'),
    evidenceSequencePath: processDefectSequencePath,
    executeClosureReview: true,
    codexBin: failingClosureReviewPath,
    now: '2026-05-07T12:58:00.000Z',
  });
  assert.equal(processDefect.finalState.kind, 'process-defect');
  assert.equal(processDefect.finalState.reasonCode, 'lifecycle-controller-exception');
  assert.match(processDefect.finalState.reason, /exited 2/);
  const processDefectResult = JSON.parse(await readFile(processDefect.resultPath, 'utf8'));
  assert.equal(processDefectResult.finalState.kind, 'process-defect');
  assert.equal(processDefectResult.finalState.runId, processDefect.finalState.runId);

  const sourceClosureDocPath = path.join(tmp, 'source-closure-doc.json');
  const sourceClosureHtmlPath = sourceClosureDocPath.replace(/\.json$/i, '.html');
  const fakeCodexPath = path.join(tmp, 'fake-codex.mjs');
  const fakeCountPath = path.join(tmp, 'fake-codex-count.txt');
  await writeFile(sourceClosureDocPath, `${JSON.stringify(sourceClosureDoc(sourceClosureDocPath), null, 2)}\n`, 'utf8');
  await writeFile(sourceClosureHtmlPath, '<!doctype html><title>pending</title>\n', 'utf8');
  await writeFile(fakeCodexPath, `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const docPath = ${JSON.stringify(sourceClosureDocPath)};
const htmlPath = ${JSON.stringify(sourceClosureHtmlPath)};
const countPath = ${JSON.stringify(fakeCountPath)};
const args = process.argv.slice(2);
const outputPath = args[args.indexOf('-o') + 1];
const current = existsSync(countPath) ? Number(readFileSync(countPath, 'utf8') || '0') || 0 : 0;
const next = current + 1;
writeFileSync(countPath, String(next));
const doc = JSON.parse(readFileSync(docPath, 'utf8'));
if (next === 1) {
  doc.runState.currentPhase = 'phase-1-complete';
  doc.runState.objectiveReady = false;
  doc.runState.nextObjectiveAction = 'phase 2 requires lifecycle input';
  doc.sections[0].data[0].status = 'completed';
  doc.sections[0].data[0].updated = '2026-05-07T13:21:00.000Z';
  writeFileSync(outputPath, 'phase 1 complete; lifecycle input required');
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'phase 1 complete' } }));
} else {
  doc.runState.currentPhase = 'completed';
  doc.runState.objectiveReady = true;
  doc.runState.nextObjectiveAction = 'closed';
  for (const [index, criterion] of doc.sections[0].data.entries()) {
    criterion.status = index === 0 ? 'contract-proven' : 'browser-and-ui-proven';
    criterion.updated = '2026-05-07T13:22:00.000Z';
  }
  writeFileSync(outputPath, 'phase 2 complete; objectiveReady true');
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'phase 2 complete' } }));
}
doc.updated = next === 1 ? '2026-05-07T13:21:00.000Z' : '2026-05-07T13:22:00.000Z';
writeFileSync(docPath, JSON.stringify(doc, null, 2) + '\\n');
writeFileSync(htmlPath, '<!doctype html><title>' + doc.runState.currentPhase + '</title>\\n');
`, 'utf8');
  await chmod(fakeCodexPath, 0o755);

  const sourceClosure = await runHarnessLifecycle({
    docPath: sourceClosureDocPath,
    runsDir: path.join(tmp, 'source-closure-runs'),
    evidenceDir: path.join(tmp, 'source-closure-evidence'),
    dashboardPath: path.join(tmp, 'source-closure-dashboard.html'),
    execute: true,
    codexBin: fakeCodexPath,
    codexHome: tmp,
    executeReviewer: false,
    reviewerVerdictSequence: [
      reviewerVerdict('repairable', {
        reasonCode: 'proof-or-objective-unsatisfied',
        mode: 'repair',
      }),
      reviewerVerdict('closed', { closureAllowed: true }),
    ],
    now: '2026-05-07T13:20:00.000Z',
  });
  assert.equal(sourceClosure.iterationCount, 2);
  assert.equal(sourceClosure.finalState.kind, 'process-defect');
  assert.equal(sourceClosure.finalState.reasonCode, 'lifecycle-controller-exception');
  assert.equal(sourceClosure.iterations[0].classification, 'repairable');
  assert.equal(sourceClosure.iterations[1].classification, 'true-block');
  assert.equal(sourceClosure.iterations[1].terminalKind, 'continuation-required');
  const sourceClosureEvidence = JSON.parse(await readFile(path.resolve(
    process.cwd(),
    sourceClosure.iterations[1].runDir,
    'artifacts',
    'iteration-2-evidence.json',
  ), 'utf8'));
  assert.equal(sourceClosureEvidence.sourceState.objectiveReady, true);
  assert.equal(sourceClosureEvidence.sourceState.closureAllowed, true);
  assert.equal(sourceClosureEvidence.proofGates.acceptanceCriteriaSatisfied, 'pass');
  assert.equal(sourceClosureEvidence.proofGates.closureAllowed, true);
  assert.equal(sourceClosureEvidence.sourceFilesChanged, true);
  assert.match(sourceClosure.iterations[1].reviewerVerdictPath, /reviewer-inference\/iteration-2-verdict\.json$/);
  assert.equal(sourceClosure.iterations[1].closureReviewResultPath, null);
  const sourceClosureSelection = JSON.parse(await readFile(path.resolve(process.cwd(), sourceClosure.iterations[1].postReviewSelectionPath), 'utf8'));
  assert.equal(sourceClosureSelection.nextUnit.unitId, 'commit-intent');
  assert.match(sourceClosureSelection.nextUnit.resultPath, /inference-units\/iteration-2\/04-commit-intent\/result\.json$/);

  const inferredCommitSequencePath = path.join(tmp, 'inferred-commit-sequence.json');
  await writeFile(inferredCommitSequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        filesChanged: ['scripts/living-doc-harness-lifecycle.mjs'],
        traceMessage: 'Changed source file requires commit-intent before closure.',
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const inferredCommitGate = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'inferred-commit-runs'),
    evidenceDir: path.join(tmp, 'inferred-commit-evidence'),
    dashboardPath: path.join(tmp, 'inferred-commit-dashboard.html'),
    evidenceSequencePath: inferredCommitSequencePath,
    now: '2026-05-07T13:25:00.000Z',
  });
  assert.equal(inferredCommitGate.iterationCount, 1);
  assert.equal(inferredCommitGate.iterations[0].classification, 'true-block');
  const inferredCommitEvidence = JSON.parse(await readFile(path.resolve(
    process.cwd(),
    inferredCommitGate.iterations[0].runDir,
    'artifacts',
    'iteration-1-evidence.json',
  ), 'utf8'));
  assert.equal(inferredCommitEvidence.sourceFilesChanged, true);
  const inferredCommitSelection = JSON.parse(await readFile(path.resolve(process.cwd(), inferredCommitGate.iterations[0].postReviewSelectionPath), 'utf8'));
  assert.equal(inferredCommitSelection.nextUnit.unitId, 'commit-intent');

  const criteriaOnlyDocPath = path.join(tmp, 'criteria-only-doc.json');
  const criteriaOnlyHtmlPath = criteriaOnlyDocPath.replace(/\.json$/i, '.html');
  const fakeCriteriaOnlyCodexPath = path.join(tmp, 'fake-criteria-only-codex.mjs');
  await writeFile(criteriaOnlyDocPath, `${JSON.stringify(sourceClosureDoc(criteriaOnlyDocPath), null, 2)}\n`, 'utf8');
  await writeFile(criteriaOnlyHtmlPath, '<!doctype html><title>criteria-only</title>\n', 'utf8');
  await writeFile(fakeCriteriaOnlyCodexPath, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const docPath = ${JSON.stringify(criteriaOnlyDocPath)};
const outputPath = process.argv[process.argv.indexOf('-o') + 1];
const doc = JSON.parse(readFileSync(docPath, 'utf8'));
doc.runState.currentPhase = 'acceptance-criteria-satisfied-objective-pending';
doc.runState.objectiveReady = false;
doc.runState.nextObjectiveAction = 'objective proof still requires controller-owned side-effect evidence';
for (const criterion of doc.sections[0].data) {
  criterion.status = 'complete-source-test-proven-controller-closure-blocked';
  criterion.updated = '2026-05-07T13:27:00.000Z';
}
doc.updated = '2026-05-07T13:27:00.000Z';
writeFileSync(docPath, JSON.stringify(doc, null, 2) + '\\n');
writeFileSync(outputPath, 'acceptance criteria complete; objective not closure-ready');
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'criteria complete, objective pending' } }));
`, 'utf8');
  await chmod(fakeCriteriaOnlyCodexPath, 0o755);
  const criteriaOnlyLifecycle = await runHarnessLifecycle({
    docPath: criteriaOnlyDocPath,
    runsDir: path.join(tmp, 'criteria-only-runs'),
    evidenceDir: path.join(tmp, 'criteria-only-evidence'),
    dashboardPath: path.join(tmp, 'criteria-only-dashboard.html'),
    execute: true,
    codexBin: fakeCriteriaOnlyCodexPath,
    codexHome: tmp,
    executeReviewer: false,
    reviewerVerdictSequence: [
      reviewerVerdict('user-stopped', {
        reasonCode: 'operator-stop',
        mode: 'user-stop',
      }),
    ],
    now: '2026-05-07T13:26:00.000Z',
  });
  assert.equal(criteriaOnlyLifecycle.iterationCount, 1);
  const criteriaOnlyEvidence = JSON.parse(await readFile(path.resolve(
    process.cwd(),
    criteriaOnlyLifecycle.iterations[0].runDir,
    'artifacts',
    'iteration-1-evidence.json',
  ), 'utf8'));
  assert.equal(criteriaOnlyEvidence.sourceState.criteriaSatisfied, true);
  assert.deepEqual(criteriaOnlyEvidence.sourceState.incompleteCriteria, []);
  assert.equal(criteriaOnlyEvidence.sourceState.objectiveReady, false);
  assert.equal(criteriaOnlyEvidence.proofGates.acceptanceCriteriaSatisfied, 'pass');
  assert.equal(criteriaOnlyEvidence.proofGates.closureAllowed, false);

  const proofRouteSequencePath = path.join(tmp, 'proof-route-sequence.json');
  await writeFile(proofRouteSequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Controller-owned deterministic proof route passed before reviewer closure.',
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const proofRouteLifecycle = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'proof-route-runs'),
    evidenceDir: path.join(tmp, 'proof-route-evidence'),
    dashboardPath: path.join(tmp, 'proof-route-dashboard.html'),
    evidenceSequencePath: proofRouteSequencePath,
    executeProofRoutes: true,
    proofRoutes: [
      {
        id: 'controller-owned-fixture-proof',
        kind: 'command',
        command: `${process.execPath} -e "console.log('controller-proof-ok')"`,
        required: true,
        acceptanceCriteria: ['criterion-owned-controller-proof'],
      },
    ],
    now: '2026-05-07T13:05:00.000Z',
  });
  assert.equal(proofRouteLifecycle.iterationCount, 1);
  assert.equal(proofRouteLifecycle.finalState.kind, 'closed');
  const proofRouteEvidence = JSON.parse(await readFile(path.resolve(
    process.cwd(),
    proofRouteLifecycle.iterations[0].runDir,
    'artifacts',
    'iteration-1-evidence.json',
  ), 'utf8'));
  assert.equal(proofRouteEvidence.controllerProofRoutes.routeCount, 1);
  assert.equal(proofRouteEvidence.controllerProofRoutes.results[0].status, 'passed');
  assert.equal(proofRouteEvidence.proofGates.controllerProofRoutes, 'pass');
  const proofRouteProof = JSON.parse(await readFile(path.resolve(
    process.cwd(),
    proofRouteLifecycle.iterations[0].runDir,
    'artifacts',
    'iteration-1-proof.json',
  ), 'utf8'));
  assert.equal(proofRouteProof.controllerProofRoutes.results[0].routeId, 'controller-owned-fixture-proof');
  assert.equal(proofRouteProof.controllerProofRoutes.results[0].closureAllowedContribution, 'pass');

  const cliResultDir = path.join(tmp, 'cli-runs');
  const cli = spawnSync(process.execPath, [
    'scripts/living-doc-harness-lifecycle.mjs',
    'run',
    docPath,
    '--runs-dir',
    cliResultDir,
    '--evidence-dir',
    path.join(tmp, 'cli-evidence'),
    '--dashboard',
    path.join(tmp, 'cli-dashboard.html'),
    '--evidence-sequence',
    sequencePath,
    '--now',
    '2026-05-07T13:10:00.000Z',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /"kind": "closed"/);
  assert.match(cli.stdout, /"iterationCount": 2/);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness lifecycle controller contract spec: all assertions passed');
