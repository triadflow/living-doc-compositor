import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHarnessRun } from '../../scripts/living-doc-harness-runner.mjs';
import { finalizeHarnessIteration, writeIterationEvidenceTemplate } from '../../scripts/living-doc-harness-iteration.mjs';

function minimalDoc(docPath) {
  return {
    docId: 'test:iteration-finalizer',
    title: 'Iteration Finalizer Fixture',
    subtitle: 'Fixture',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: docPath,
    sourceCoverage: 'fixture',
    updated: '2026-05-07T10:20:00.000Z',
    objective: 'Prove the iteration finalizer.',
    successCondition: 'The finalizer writes durable proof artifacts.',
    sections: [],
  };
}

function nativeTraceLine(text) {
  return JSON.stringify({
    timestamp: '2026-05-07T10:20:30.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text }],
    },
  });
}

function reviewerVerdict(classification, { closureAllowed = false, reasonCode = classification === 'closed' ? 'objective-proven' : 'proof-or-objective-unsatisfied' } = {}) {
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification,
      reasonCode,
      confidence: 'high',
      closureAllowed,
      basis: ['Reviewer inference fixture read the frozen evidence and emitted this verdict.'],
    },
    nextIteration: {
      allowed: classification !== 'closed',
      mode: classification === 'closed' ? 'none' : 'repair',
      instruction: classification === 'closed' ? undefined : 'Repair unresolved proof before closure.',
    },
  };
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-iteration-'));

function lifecycleCommandEnv() {
  const { LIVING_DOC_HARNESS_ROLE: _role, ...env } = process.env;
  return env;
}

try {
  const workerOwnedFinalize = spawnSync(process.execPath, [
    'scripts/living-doc-harness-iteration.mjs',
    'evidence-template',
    tmp,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      LIVING_DOC_HARNESS_ROLE: 'worker',
    },
  });
  assert.equal(workerOwnedFinalize.status, 2);
  assert.match(workerOwnedFinalize.stderr, /cannot run from inside a worker inference process/);

  const docPath = path.join(tmp, 'doc.json');
  await writeFile(docPath, `${JSON.stringify(minimalDoc(docPath), null, 2)}\n`, 'utf8');
  const run = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:20:00.000Z',
  });
  const evidencePath = path.join(tmp, 'evidence.json');
  const tracePath = path.join(tmp, 'native.jsonl');
  await writeFile(tracePath, `${nativeTraceLine('PRIVATE_TRACE_CONTENT_SHOULD_NOT_LEAK')}\n`, 'utf8');
  const template = await writeIterationEvidenceTemplate({
    runDir: run.runDir,
    outPath: evidencePath,
    tracePaths: [tracePath],
    stageAfter: 'closed',
    acceptanceCriteriaSatisfied: 'pass',
    closureAllowed: true,
    finalMessageSummary: 'Objective complete with source-system evidence.',
    filesChanged: ['scripts/living-doc-harness-iteration.mjs'],
    now: '2026-05-07T10:20:45.000Z',
  });
  template.evidence.sideEffectEvidence = {
    commit: {
      sha: 'abc1234',
      required: true,
    },
  };
  await writeFile(evidencePath, `${JSON.stringify(template.evidence, null, 2)}\n`, 'utf8');
  assert.equal(template.evidence.workerEvidence.nativeInferenceTraceRefs.length, 1);

  const result = await finalizeHarnessIteration({
    runDir: run.runDir,
    evidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:00.000Z',
    evidenceDir: path.join(tmp, 'evidence-bundles'),
    dashboardPath: path.join(tmp, 'dashboard.html'),
    reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
  });
  assert.equal(result.schema, 'living-doc-harness-iteration-finalization/v1');
  assert.equal(result.classification, 'closed');
  assert.equal(result.terminalKind, 'closed');
  assert.equal(result.proofValid, true);
  assert.match(result.closureReviewResultPath, /inference-units\/iteration-1\/03-closure-review\/result\.json$/);

  const proof = await readFile(result.proofPath, 'utf8');
  assert.match(proof, /living-doc-harness-iteration-proof\/v1/);
  assert.match(proof, /"evidenceBundleWritten": "pass"/);
  assert.match(proof, /"nativeTraceInspected": "pass"/);
  assert.match(proof, /native.summary.json/);
  assert.match(proof, /inference-units\/iteration-1\/02-reviewer-inference\/result\.json/);
  assert.match(proof, /inference-units\/iteration-1\/03-closure-review\/result\.json/);
  const dashboard = await readFile(result.dashboardPath, 'utf8');
  assert.match(dashboard, /data-recommendation="close"/);
  assert.equal(dashboard.includes('PRIVATE_TRACE_CONTENT_SHOULD_NOT_LEAK'), false);
  const events = await readFile(path.join(run.runDir, 'events.jsonl'), 'utf8');
  assert.match(events, /harness-iteration-finalized/);
  assert.match(events, /reviewer-inference-verdict-written/);
  assert.match(events, /contract-bound-inference-unit-written/);
  assert.match(result.reviewerVerdictPath, /reviewer-inference\/iteration-1-verdict\.json$/);
  const reviewerArtifact = JSON.parse(await readFile(result.reviewerVerdictPath, 'utf8'));
  assert.match(reviewerArtifact.inferenceUnitResultPath, /inference-units\/iteration-1\/02-reviewer-inference\/result\.json$/);
  assert.match(reviewerArtifact.inferenceUnitValidationPath, /inference-units\/iteration-1\/02-reviewer-inference\/validation\.json$/);
  assert.match(reviewerArtifact.inferenceUnitInputContractPath, /inference-units\/iteration-1\/02-reviewer-inference\/input-contract\.json$/);
  assert.match(reviewerArtifact.inferenceUnitPromptPath, /inference-units\/iteration-1\/02-reviewer-inference\/prompt\.md$/);
  assert.match(reviewerArtifact.codexEventsPath, /inference-units\/iteration-1\/02-reviewer-inference\/codex-events\.jsonl$/);
  assert.match(reviewerArtifact.stderrPath, /inference-units\/iteration-1\/02-reviewer-inference\/stderr\.log$/);
  assert.equal(reviewerArtifact.verdict.schema, 'living-doc-harness-stop-verdict/v1');
  const reviewerUnitResult = JSON.parse(await readFile(path.join(run.runDir, reviewerArtifact.inferenceUnitResultPath), 'utf8'));
  assert.equal(reviewerUnitResult.schema, 'living-doc-contract-bound-inference-result/v1');
  assert.equal(reviewerUnitResult.unitId, 'reviewer-inference');
  assert.equal(reviewerUnitResult.role, 'reviewer');
  assert.equal(reviewerUnitResult.outputContract.schema, 'living-doc-harness-stop-verdict/v1');
  const reviewerUnitValidation = JSON.parse(await readFile(path.join(run.runDir, reviewerArtifact.inferenceUnitValidationPath), 'utf8'));
  assert.equal(reviewerUnitValidation.ok, true);
  const reviewerUnitInput = JSON.parse(await readFile(path.join(run.runDir, reviewerArtifact.inferenceUnitInputContractPath), 'utf8'));
  assert.deepEqual(reviewerUnitInput.requiredInspectionPaths, [tracePath]);
  const closureReviewResult = JSON.parse(await readFile(result.closureReviewResultPath, 'utf8'));
  assert.equal(closureReviewResult.schema, 'living-doc-contract-bound-inference-result/v1');
  assert.equal(closureReviewResult.unitId, 'closure-review');
  assert.equal(closureReviewResult.role, 'closure-review');
  assert.equal(closureReviewResult.outputContract.schema, 'living-doc-harness-closure-review/v1');
  assert.equal(closureReviewResult.outputContract.approved, true);
  assert.equal(closureReviewResult.outputContract.terminalAllowed, true);
  const closureReviewInput = JSON.parse(await readFile(path.join(run.runDir, closureReviewResult.inputContractPath), 'utf8'));
  assert.equal(closureReviewInput.schema, 'living-doc-harness-closure-review-input/v1');
  assert.ok(closureReviewInput.requiredInspectionPaths.some((entry) => entry.endsWith('evidence.json')));
  assert.ok(closureReviewInput.requiredInspectionPaths.some((entry) => entry.endsWith('reviewer-inference/iteration-1-verdict.json')));

  const commitGateRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'commit-gate-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:05.000Z',
  });
  const commitGateEvidencePath = path.join(tmp, 'commit-gate-evidence.json');
  const commitGateTemplate = await writeIterationEvidenceTemplate({
    runDir: commitGateRun.runDir,
    outPath: commitGateEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'closed',
    acceptanceCriteriaSatisfied: 'pass',
    closureAllowed: true,
    now: '2026-05-07T10:21:06.000Z',
  });
  commitGateTemplate.evidence.sourceFilesChanged = true;
  await writeFile(commitGateEvidencePath, `${JSON.stringify(commitGateTemplate.evidence, null, 2)}\n`, 'utf8');
  const commitGate = await finalizeHarnessIteration({
    runDir: commitGateRun.runDir,
    evidencePath: commitGateEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:07.000Z',
    evidenceDir: path.join(tmp, 'commit-gate-evidence-bundles'),
    dashboardPath: path.join(tmp, 'commit-gate-dashboard.html'),
    reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
  });
  assert.equal(commitGate.classification, 'true-block');
  assert.equal(commitGate.terminalKind, 'continuation-required');
  const commitSelection = JSON.parse(await readFile(commitGate.postReviewSelectionPath, 'utf8'));
  assert.equal(commitSelection.nextUnit.unitId, 'commit-intent');
  assert.equal(commitSelection.contractValidation.ok, true);
  assert.match(commitSelection.nextUnit.resultPath, /inference-units\/iteration-1\/04-commit-intent\/result\.json$/);
  assert.match(commitSelection.nextUnit.validationPath, /inference-units\/iteration-1\/04-commit-intent\/validation\.json$/);
  const commitIntentResult = JSON.parse(await readFile(path.join(commitGateRun.runDir, commitSelection.nextUnit.resultPath), 'utf8'));
  assert.equal(commitIntentResult.unitId, 'commit-intent');
  assert.equal(commitIntentResult.outputContract.schema, 'living-doc-harness-commit-intent-result/v1');
  assert.equal(commitIntentResult.outputContract.sideEffect.executed, false);

  const prGateRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'pr-gate-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:08.000Z',
  });
  const prGateEvidencePath = path.join(tmp, 'pr-gate-evidence.json');
  const prGateTemplate = await writeIterationEvidenceTemplate({
    runDir: prGateRun.runDir,
    outPath: prGateEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'closed',
    acceptanceCriteriaSatisfied: 'pass',
    closureAllowed: true,
    now: '2026-05-07T10:21:09.000Z',
  });
  prGateTemplate.evidence.prReviewPolicy = {
    schema: 'living-doc-harness-pr-review-policy/v1',
    mode: 'required-before-closure',
  };
  prGateTemplate.evidence.sideEffectEvidence = { commit: { sha: 'abc1234', required: false } };
  await writeFile(prGateEvidencePath, `${JSON.stringify(prGateTemplate.evidence, null, 2)}\n`, 'utf8');
  const prGate = await finalizeHarnessIteration({
    runDir: prGateRun.runDir,
    evidencePath: prGateEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:10.000Z',
    evidenceDir: path.join(tmp, 'pr-gate-evidence-bundles'),
    dashboardPath: path.join(tmp, 'pr-gate-dashboard.html'),
    reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
  });
  assert.equal(prGate.classification, 'true-block');
  const prSelection = JSON.parse(await readFile(prGate.postReviewSelectionPath, 'utf8'));
  assert.equal(prSelection.nextUnit.unitId, 'pr-review');
  assert.equal(prSelection.contractValidation.ok, true);
  assert.match(prSelection.nextUnit.resultPath, /inference-units\/iteration-1\/05-pr-review\/result\.json$/);
  assert.match(prSelection.nextUnit.validationPath, /inference-units\/iteration-1\/05-pr-review\/validation\.json$/);
  const prReviewResult = JSON.parse(await readFile(path.join(prGateRun.runDir, prSelection.nextUnit.resultPath), 'utf8'));
  assert.equal(prReviewResult.unitId, 'pr-review');
  assert.equal(prReviewResult.outputContract.schema, 'living-doc-harness-pr-review-result/v1');
  assert.equal(prReviewResult.outputContract.sideEffect.executed, false);

  const repairablePrGateRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'repairable-pr-gate-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:08.250Z',
  });
  const repairablePrGateEvidencePath = path.join(tmp, 'repairable-pr-gate-evidence.json');
  const repairablePrGateTemplate = await writeIterationEvidenceTemplate({
    runDir: repairablePrGateRun.runDir,
    outPath: repairablePrGateEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'repairable',
    acceptanceCriteriaSatisfied: 'fail',
    closureAllowed: false,
    now: '2026-05-07T10:21:08.500Z',
  });
  repairablePrGateTemplate.evidence.prReviewPolicy = {
    schema: 'living-doc-harness-pr-review-policy/v1',
    mode: 'required-before-closure',
  };
  repairablePrGateTemplate.evidence.sideEffectEvidence = { commit: { sha: 'abc1234', required: true } };
  await writeFile(repairablePrGateEvidencePath, `${JSON.stringify(repairablePrGateTemplate.evidence, null, 2)}\n`, 'utf8');
  const repairablePrGate = await finalizeHarnessIteration({
    runDir: repairablePrGateRun.runDir,
    evidencePath: repairablePrGateEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:08.750Z',
    evidenceDir: path.join(tmp, 'repairable-pr-gate-evidence-bundles'),
    dashboardPath: path.join(tmp, 'repairable-pr-gate-dashboard.html'),
    reviewerVerdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification: 'repairable',
        reasonCode: 'pr-review-policy-gate-missing',
        confidence: 'high',
        closureAllowed: false,
        basis: ['Controller hard facts require PR review before closure, but prReviewEvidencePresent is false.'],
      },
      nextIteration: {
        allowed: true,
        mode: 'continuation',
        instruction: 'Run the required pr-review policy gate and continue controller proof.',
      },
    },
  });
  const repairablePrGateSelection = JSON.parse(await readFile(repairablePrGate.postReviewSelectionPath, 'utf8'));
  assert.equal(repairablePrGateSelection.nextUnit.unitId, 'worker');
  assert.equal(repairablePrGateSelection.nextUnit.reasonCode, 'reviewer-authorized-continuation');
  assert.notEqual(repairablePrGateSelection.nextUnit.unitId, 'pr-review');

  const closureCandidatePrGateRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'closure-candidate-pr-gate-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:08.800Z',
  });
  const closureCandidatePrGateEvidencePath = path.join(tmp, 'closure-candidate-pr-gate-evidence.json');
  const closureCandidatePrGateTemplate = await writeIterationEvidenceTemplate({
    runDir: closureCandidatePrGateRun.runDir,
    outPath: closureCandidatePrGateEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'closure-candidate',
    acceptanceCriteriaSatisfied: 'pass',
    closureAllowed: false,
    now: '2026-05-07T10:21:08.820Z',
  });
  closureCandidatePrGateTemplate.evidence.prReviewPolicy = {
    schema: 'living-doc-harness-pr-review-policy/v1',
    mode: 'required-before-closure',
  };
  closureCandidatePrGateTemplate.evidence.sideEffectEvidence = { commit: { sha: 'abc1234', required: true } };
  await writeFile(closureCandidatePrGateEvidencePath, `${JSON.stringify(closureCandidatePrGateTemplate.evidence, null, 2)}\n`, 'utf8');
  const closureCandidatePrGate = await finalizeHarnessIteration({
    runDir: closureCandidatePrGateRun.runDir,
    evidencePath: closureCandidatePrGateEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:08.840Z',
    evidenceDir: path.join(tmp, 'closure-candidate-pr-gate-evidence-bundles'),
    dashboardPath: path.join(tmp, 'closure-candidate-pr-gate-dashboard.html'),
    reviewerVerdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification: 'closure-candidate',
        reasonCode: 'pr-review-policy-gate-missing',
        confidence: 'high',
        closureAllowed: false,
        basis: ['The living doc is otherwise ready for closure review, but required-before-closure PR review evidence is missing.'],
      },
      nextIteration: {
        allowed: true,
        mode: 'continuation',
        instruction: 'Run the required pr-review policy gate before closure review.',
      },
    },
  });
  const closureCandidatePrGateSelection = JSON.parse(await readFile(closureCandidatePrGate.postReviewSelectionPath, 'utf8'));
  assert.equal(closureCandidatePrGateSelection.prReviewPolicy.mode, 'required-before-closure');
  assert.equal(closureCandidatePrGateSelection.prReviewRequired, true);
  assert.equal(closureCandidatePrGateSelection.prReviewGate.status, 'missing');
  assert.equal(closureCandidatePrGateSelection.nextUnit.unitId, 'pr-review');
  assert.equal(closureCandidatePrGateSelection.nextUnit.reasonCode, 'pr-review-policy-gate-missing');
  assert.match(closureCandidatePrGateSelection.nextUnit.resultPath, /inference-units\/iteration-1\/05-pr-review\/result\.json$/);

  const blockedPrGateRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'blocked-pr-gate-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:08.900Z',
  });
  const blockedPrGateEvidencePath = path.join(tmp, 'blocked-pr-gate-evidence.json');
  const blockedPrGateTemplate = await writeIterationEvidenceTemplate({
    runDir: blockedPrGateRun.runDir,
    outPath: blockedPrGateEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'repairable',
    acceptanceCriteriaSatisfied: 'fail',
    closureAllowed: false,
    now: '2026-05-07T10:21:08.950Z',
  });
  blockedPrGateTemplate.evidence.prReviewPolicy = {
    schema: 'living-doc-harness-pr-review-policy/v1',
    mode: 'required-before-closure',
  };
  blockedPrGateTemplate.evidence.sideEffectEvidence = {
    commit: { sha: 'abc1234', required: true },
    prReview: {
      status: 'blocked',
      blocked: true,
      source: 'pr-review-output-contract',
      resultPath: 'inference-units/iteration-1/05-pr-review/result.json',
      validationPath: 'inference-units/iteration-1/05-pr-review/validation.json',
      reasonCode: 'pr-review-policy-gate-missing',
      basis: ['PR-review could not produce an approved gate result from the available evidence.'],
    },
  };
  await writeFile(blockedPrGateEvidencePath, `${JSON.stringify(blockedPrGateTemplate.evidence, null, 2)}\n`, 'utf8');
  const blockedPrGate = await finalizeHarnessIteration({
    runDir: blockedPrGateRun.runDir,
    evidencePath: blockedPrGateEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:09.000Z',
    evidenceDir: path.join(tmp, 'blocked-pr-gate-evidence-bundles'),
    dashboardPath: path.join(tmp, 'blocked-pr-gate-dashboard.html'),
    reviewerVerdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification: 'repairable',
        reasonCode: 'pr-review-policy-gate-missing',
        confidence: 'high',
        closureAllowed: false,
        basis: ['Controller hard facts require PR review before closure, but the PR-review unit returned blocked.'],
      },
      nextIteration: {
        allowed: true,
        mode: 'continuation',
        instruction: 'Resolve the blocked pr-review gate and continue controller proof.',
      },
    },
  });
  const blockedPrGateSelection = JSON.parse(await readFile(blockedPrGate.postReviewSelectionPath, 'utf8'));
  assert.equal(blockedPrGateSelection.nextUnit.unitId, 'continuation-inference');
  assert.notEqual(blockedPrGateSelection.nextUnit.unitId, 'pr-review');
  assert.equal(blockedPrGateSelection.nextUnit.prReviewGate.status, 'blocked');
  assert.equal(blockedPrGateSelection.nextUnit.prReviewGate.evidencePresent, false);
  assert.ok(blockedPrGateSelection.nextUnit.requiredInputPaths.includes('inference-units/iteration-1/05-pr-review/result.json'));

  const prUrlOnlyRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'pr-url-only-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:09.250Z',
  });
  const prUrlOnlyEvidencePath = path.join(tmp, 'pr-url-only-evidence.json');
  const prUrlOnlyTemplate = await writeIterationEvidenceTemplate({
    runDir: prUrlOnlyRun.runDir,
    outPath: prUrlOnlyEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'closed',
    acceptanceCriteriaSatisfied: 'pass',
    closureAllowed: true,
    now: '2026-05-07T10:21:09.500Z',
  });
  prUrlOnlyTemplate.evidence.prReviewPolicy = {
    schema: 'living-doc-harness-pr-review-policy/v1',
    mode: 'required-before-closure',
  };
  prUrlOnlyTemplate.evidence.sideEffectEvidence = {
    commit: { sha: 'abc1234', required: false },
    prReview: {
      approved: true,
      resultPath: 'inference-units/iteration-1/05-pr-review/result.json',
      url: 'https://github.example/pr/9',
    },
  };
  await writeFile(prUrlOnlyEvidencePath, `${JSON.stringify(prUrlOnlyTemplate.evidence, null, 2)}\n`, 'utf8');
  const prUrlOnly = await finalizeHarnessIteration({
    runDir: prUrlOnlyRun.runDir,
    evidencePath: prUrlOnlyEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:09.750Z',
    evidenceDir: path.join(tmp, 'pr-url-only-evidence-bundles'),
    dashboardPath: path.join(tmp, 'pr-url-only-dashboard.html'),
    reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
  });
  assert.equal(prUrlOnly.classification, 'true-block');
  const prUrlOnlySelection = JSON.parse(await readFile(prUrlOnly.postReviewSelectionPath, 'utf8'));
  assert.equal(prUrlOnlySelection.nextUnit.unitId, 'pr-review');

  const unvalidatedPrContractRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'unvalidated-pr-contract-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:09.800Z',
  });
  const unvalidatedPrContractEvidencePath = path.join(tmp, 'unvalidated-pr-contract-evidence.json');
  const unvalidatedPrContractTemplate = await writeIterationEvidenceTemplate({
    runDir: unvalidatedPrContractRun.runDir,
    outPath: unvalidatedPrContractEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'closed',
    acceptanceCriteriaSatisfied: 'pass',
    closureAllowed: true,
    now: '2026-05-07T10:21:09.850Z',
  });
  unvalidatedPrContractTemplate.evidence.prReviewPolicy = {
    schema: 'living-doc-harness-pr-review-policy/v1',
    mode: 'required-before-closure',
  };
  unvalidatedPrContractTemplate.evidence.sideEffectEvidence = {
    commit: { sha: 'abc1234', required: false },
    prReview: {
      status: 'approved',
      approved: true,
      source: 'pr-review-output-contract',
      resultPath: 'inference-units/iteration-1/05-pr-review/result.json',
    },
  };
  await writeFile(unvalidatedPrContractEvidencePath, `${JSON.stringify(unvalidatedPrContractTemplate.evidence, null, 2)}\n`, 'utf8');
  const unvalidatedPrContract = await finalizeHarnessIteration({
    runDir: unvalidatedPrContractRun.runDir,
    evidencePath: unvalidatedPrContractEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:09.900Z',
    evidenceDir: path.join(tmp, 'unvalidated-pr-contract-evidence-bundles'),
    dashboardPath: path.join(tmp, 'unvalidated-pr-contract-dashboard.html'),
    reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
  });
  assert.equal(unvalidatedPrContract.classification, 'true-block');
  const unvalidatedPrContractSelection = JSON.parse(await readFile(unvalidatedPrContract.postReviewSelectionPath, 'utf8'));
  assert.equal(unvalidatedPrContractSelection.prReviewGate.status, 'missing');
  assert.equal(unvalidatedPrContractSelection.prReviewGate.evidencePresent, false);
  assert.equal(unvalidatedPrContractSelection.nextUnit.unitId, 'pr-review');

  const disabledPrClosureRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'disabled-pr-closure-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:10.000Z',
  });
  const disabledPrClosureEvidencePath = path.join(tmp, 'disabled-pr-closure-evidence.json');
  const disabledPrClosureTemplate = await writeIterationEvidenceTemplate({
    runDir: disabledPrClosureRun.runDir,
    outPath: disabledPrClosureEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'closed',
    acceptanceCriteriaSatisfied: 'pass',
    closureAllowed: true,
    now: '2026-05-07T10:21:10.050Z',
  });
  disabledPrClosureTemplate.evidence.prReviewPolicy = {
    schema: 'living-doc-harness-pr-review-policy/v1',
    mode: 'disabled',
  };
  disabledPrClosureTemplate.evidence.sideEffectEvidence = {
    commit: { sha: 'abc1234', required: false },
    prReview: {
      status: 'approved',
      approved: true,
      source: 'pr-review-output-contract',
      resultPath: 'inference-units/iteration-1/05-pr-review/result.json',
      validationPath: 'inference-units/iteration-1/05-pr-review/validation.json',
    },
  };
  await writeFile(disabledPrClosureEvidencePath, `${JSON.stringify(disabledPrClosureTemplate.evidence, null, 2)}\n`, 'utf8');
  const disabledPrClosure = await finalizeHarnessIteration({
    runDir: disabledPrClosureRun.runDir,
    evidencePath: disabledPrClosureEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:10.100Z',
    evidenceDir: path.join(tmp, 'disabled-pr-closure-evidence-bundles'),
    dashboardPath: path.join(tmp, 'disabled-pr-closure-dashboard.html'),
    reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
  });
  const disabledPrClosureReviewResult = JSON.parse(await readFile(disabledPrClosure.closureReviewResultPath, 'utf8'));
  const disabledPrClosureReviewInput = JSON.parse(await readFile(path.join(disabledPrClosureRun.runDir, disabledPrClosureReviewResult.inputContractPath), 'utf8'));
  assert.equal(disabledPrClosureReviewInput.prReviewPolicy.mode, 'disabled');
  assert.equal(disabledPrClosureReviewInput.prReviewRequired, false);
  assert.equal(disabledPrClosureReviewInput.sideEffectEvidence.prReview, undefined);
  assert.equal(disabledPrClosureReviewInput.requiredInspectionPaths.some((entry) => entry.includes('05-pr-review')), false);
  const disabledPrClosureSelection = JSON.parse(await readFile(disabledPrClosure.postReviewSelectionPath, 'utf8'));
  assert.equal(disabledPrClosureSelection.prReviewPolicy.mode, 'disabled');
  assert.equal(disabledPrClosureSelection.prReviewRequired, false);
  assert.equal(disabledPrClosureSelection.prReviewGate.status, 'disabled');
  const disabledPrClosureProof = JSON.parse(await readFile(disabledPrClosure.proofPath, 'utf8'));
  assert.equal(disabledPrClosureProof.postReviewSelection.prReviewPolicy.mode, 'disabled');
  assert.equal(disabledPrClosureProof.postReviewSelection.prReviewRequired, false);
  assert.equal(disabledPrClosureProof.postReviewSelection.prReviewGate.status, 'disabled');

  const noSourceChangePrMentionRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'no-source-change-pr-mention-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:10.250Z',
  });
  const noSourceChangePrMentionEvidencePath = path.join(tmp, 'no-source-change-pr-mention-evidence.json');
  const noSourceChangePrMentionTemplate = await writeIterationEvidenceTemplate({
    runDir: noSourceChangePrMentionRun.runDir,
    outPath: noSourceChangePrMentionEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'closure-candidate',
    acceptanceCriteriaSatisfied: 'pass',
    closureAllowed: true,
    now: '2026-05-07T10:21:10.500Z',
  });
  noSourceChangePrMentionTemplate.evidence.sourceFilesChanged = false;
  noSourceChangePrMentionTemplate.evidence.prReviewPolicy = {
    schema: 'living-doc-harness-pr-review-policy/v1',
    mode: 'required-when-source-changes',
  };
  await writeFile(noSourceChangePrMentionEvidencePath, `${JSON.stringify(noSourceChangePrMentionTemplate.evidence, null, 2)}\n`, 'utf8');
  const noSourceChangePrMention = await finalizeHarnessIteration({
    runDir: noSourceChangePrMentionRun.runDir,
    evidencePath: noSourceChangePrMentionEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:10.750Z',
    evidenceDir: path.join(tmp, 'no-source-change-pr-mention-evidence-bundles'),
    dashboardPath: path.join(tmp, 'no-source-change-pr-mention-dashboard.html'),
    reviewerVerdict: reviewerVerdict('closure-candidate', {
      closureAllowed: true,
      reasonCode: 'pr-review-required-before-closure',
    }),
  });
  const noSourceChangePrMentionSelection = JSON.parse(await readFile(noSourceChangePrMention.postReviewSelectionPath, 'utf8'));
  assert.notEqual(noSourceChangePrMentionSelection.nextUnit.unitId, 'pr-review');

  const controllerOwnedRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'controller-owned-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:11.000Z',
  });
  const controllerOwnedEvidencePath = path.join(tmp, 'controller-owned-evidence.json');
  await writeIterationEvidenceTemplate({
    runDir: controllerOwnedRun.runDir,
    outPath: controllerOwnedEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'commit-evidence-recorded-awaiting-controller-closure-review',
    unprovenAcceptanceCriteria: ['criterion-closure-gates'],
    acceptanceCriteriaSatisfied: 'pending',
    closureAllowed: false,
    finalMessageSummary: 'Worker stopped because the next required work is controller-owned closure review.',
    now: '2026-05-07T10:21:12.000Z',
  });
  const controllerOwned = await finalizeHarnessIteration({
    runDir: controllerOwnedRun.runDir,
    evidencePath: controllerOwnedEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:13.000Z',
    evidenceDir: path.join(tmp, 'controller-owned-evidence-bundles'),
    dashboardPath: path.join(tmp, 'controller-owned-dashboard.html'),
    reviewerVerdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification: 'resumable',
        reasonCode: 'controller-evidence-pending',
        confidence: 'high',
        closureAllowed: false,
        basis: ['Closure review, dashboard artifact production, and post-flight summary are controller-owned.'],
      },
      nextIteration: {
        allowed: true,
        mode: 'continuation',
        instruction: 'Continue under the controller lifecycle: run the controller-owned closure review against recorded commit evidence, then produce dashboard artifacts and post-flight summary if closure is approved.',
        mustNotDo: [],
      },
    },
  });
  const controllerOwnedSelection = JSON.parse(await readFile(controllerOwned.postReviewSelectionPath, 'utf8'));
  assert.equal(controllerOwnedSelection.nextUnit.unitId, 'closure-review');
  assert.equal(controllerOwnedSelection.nextUnit.role, 'closure-review');
  assert.notEqual(controllerOwnedSelection.nextUnit.unitId, 'worker');
  assert.equal(controllerOwnedSelection.contractValidation.ok, true);
  assert.match(controllerOwned.closureReviewResultPath, /inference-units\/iteration-1\/03-closure-review\/result\.json$/);

  const postFlightBeforeClosureRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'post-flight-before-closure-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:14.000Z',
  });
  const postFlightBeforeClosureEvidencePath = path.join(tmp, 'post-flight-before-closure-evidence.json');
  await writeIterationEvidenceTemplate({
    runDir: postFlightBeforeClosureRun.runDir,
    outPath: postFlightBeforeClosureEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'criteria-pending-after-routing-fix',
    unprovenAcceptanceCriteria: ['criterion-post-flight-summary'],
    acceptanceCriteriaSatisfied: 'pending',
    closureAllowed: false,
    finalMessageSummary: 'Worker stopped with pending criteria and mentioned post-flight summary before closure.',
    now: '2026-05-07T10:21:15.000Z',
  });
  const postFlightBeforeClosure = await finalizeHarnessIteration({
    runDir: postFlightBeforeClosureRun.runDir,
    evidencePath: postFlightBeforeClosureEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:16.000Z',
    evidenceDir: path.join(tmp, 'post-flight-before-closure-evidence-bundles'),
    dashboardPath: path.join(tmp, 'post-flight-before-closure-dashboard.html'),
    reviewerVerdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification: 'resumable',
        reasonCode: 'criteria-pending-after-routing-fix',
        confidence: 'high',
        closureAllowed: false,
        basis: ['Post-flight summary remains pending and must only run after closure.'],
      },
      nextIteration: {
        allowed: true,
        mode: 'continuation',
        instruction: 'Continue until post-flight summary can run after closure.',
        mustNotDo: [],
      },
    },
  });
  const postFlightBeforeClosureSelection = JSON.parse(await readFile(postFlightBeforeClosure.postReviewSelectionPath, 'utf8'));
  assert.equal(postFlightBeforeClosureSelection.nextUnit.unitId, 'worker');
  assert.notEqual(postFlightBeforeClosureSelection.nextUnit.unitId, 'post-flight-summary');
  assert.equal(postFlightBeforeClosureSelection.contractValidation.ok, true);

  const resumablePostFlightRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'resumable-post-flight-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:17.000Z',
  });
  const resumablePostFlightEvidencePath = path.join(tmp, 'resumable-post-flight-evidence.json');
  await writeIterationEvidenceTemplate({
    runDir: resumablePostFlightRun.runDir,
    outPath: resumablePostFlightEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'criteria-pending-after-routing-fix',
    unprovenAcceptanceCriteria: ['criterion-post-flight-summary'],
    acceptanceCriteriaSatisfied: 'pending',
    closureAllowed: false,
    finalMessageSummary: 'Worker stopped with pending criteria after the routing fix.',
    now: '2026-05-07T10:21:18.000Z',
  });
  const resumablePostFlight = await finalizeHarnessIteration({
    runDir: resumablePostFlightRun.runDir,
    evidencePath: resumablePostFlightEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:19.000Z',
    evidenceDir: path.join(tmp, 'resumable-post-flight-evidence-bundles'),
    dashboardPath: path.join(tmp, 'resumable-post-flight-dashboard.html'),
    reviewerVerdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification: 'resumable',
        reasonCode: 'criteria-pending-after-routing-fix',
        confidence: 'high',
        closureAllowed: false,
        basis: ['Post-flight summary remains pending and must only run after closure.'],
      },
      nextIteration: {
        allowed: true,
        mode: 'resume',
        instruction: 'Resume the harness after the controller-owned routing fix, rerun the objective proof path, and continue until post-flight summary can run after closure.',
        mustNotDo: [],
      },
    },
  });
  const resumablePostFlightSelection = JSON.parse(await readFile(resumablePostFlight.postReviewSelectionPath, 'utf8'));
  assert.equal(resumablePostFlightSelection.classification, 'resumable');
  assert.equal(resumablePostFlightSelection.reasonCode, 'criteria-pending-after-routing-fix');
  assert.equal(resumablePostFlightSelection.nextUnit.unitId, 'worker');
  assert.notEqual(resumablePostFlightSelection.nextUnit.unitId, 'post-flight-summary');
  assert.equal(resumablePostFlightSelection.contractValidation.ok, true);

  const commitPendingBeforeClosureRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'commit-pending-before-closure-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:20.000Z',
  });
  const commitPendingBeforeClosureEvidencePath = path.join(tmp, 'commit-pending-before-closure-evidence.json');
  await writeIterationEvidenceTemplate({
    runDir: commitPendingBeforeClosureRun.runDir,
    outPath: commitPendingBeforeClosureEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'input-contract-gate-implemented-source-and-tests-green-commit-evidence-pending',
    unprovenAcceptanceCriteria: ['criterion-side-effect-contracts', 'criterion-closure-gates'],
    acceptanceCriteriaSatisfied: 'pending',
    closureAllowed: false,
    finalMessageSummary: 'Worker stopped with source and test proof but current-run commit evidence is still pending.',
    now: '2026-05-07T10:21:21.000Z',
  });
  const commitPendingBeforeClosure = await finalizeHarnessIteration({
    runDir: commitPendingBeforeClosureRun.runDir,
    evidencePath: commitPendingBeforeClosureEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:22.000Z',
    evidenceDir: path.join(tmp, 'commit-pending-before-closure-evidence-bundles'),
    dashboardPath: path.join(tmp, 'commit-pending-before-closure-dashboard.html'),
    reviewerVerdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification: 'resumable',
        reasonCode: 'commit-evidence-and-criteria-pending',
        confidence: 'high',
        closureAllowed: false,
        basis: ['Source files changed, but fresh commit evidence and acceptance criteria are still pending.'],
      },
      nextIteration: {
        allowed: true,
        mode: 'continuation',
        instruction: 'Continue by producing fresh current-run commit evidence, then run closure review and post-flight summary only after acceptance criteria pass.',
        mustNotDo: [],
      },
    },
  });
  const commitPendingBeforeClosureSelection = JSON.parse(await readFile(commitPendingBeforeClosure.postReviewSelectionPath, 'utf8'));
  assert.equal(commitPendingBeforeClosureSelection.classification, 'resumable');
  assert.equal(commitPendingBeforeClosureSelection.reasonCode, 'commit-evidence-and-criteria-pending');
  assert.equal(commitPendingBeforeClosureSelection.nextUnit.unitId, 'commit-intent');
  assert.notEqual(commitPendingBeforeClosureSelection.nextUnit.unitId, 'worker');
  assert.match(commitPendingBeforeClosureSelection.nextUnit.resultPath, /inference-units\/iteration-1\/04-commit-intent\/result\.json$/);
  assert.match(commitPendingBeforeClosureSelection.nextUnit.validationPath, /inference-units\/iteration-1\/04-commit-intent\/validation\.json$/);
  assert.equal(commitPendingBeforeClosureSelection.contractValidation.ok, true);
  assert.equal(commitPendingBeforeClosure.closureReviewResultPath, null);

  const repairableCommitGateRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'repairable-commit-gate-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:22.100Z',
  });
  const repairableCommitGateEvidencePath = path.join(tmp, 'repairable-commit-gate-evidence.json');
  const repairableCommitGateTemplate = await writeIterationEvidenceTemplate({
    runDir: repairableCommitGateRun.runDir,
    outPath: repairableCommitGateEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'repairable-source-changes-without-commit-evidence',
    acceptanceCriteriaSatisfied: 'pending',
    closureAllowed: false,
    filesChanged: ['docs/living-doc-inference-unit-type-system.json'],
    finalMessageSummary: 'Worker changed source and the reviewer marked the objective repairable.',
    now: '2026-05-07T10:21:22.200Z',
  });
  repairableCommitGateTemplate.evidence.sourceFilesChanged = true;
  repairableCommitGateTemplate.evidence.requiredHardFacts = {
    schema: 'living-doc-harness-required-hard-facts/v1',
    sourceFilesChanged: true,
    dirtyTrackedFiles: ['docs/living-doc-inference-unit-type-system.json'],
    relevantUntrackedFiles: [],
    commitEvidencePresent: false,
  };
  await writeFile(repairableCommitGateEvidencePath, `${JSON.stringify(repairableCommitGateTemplate.evidence, null, 2)}\n`, 'utf8');
  const repairableCommitGate = await finalizeHarnessIteration({
    runDir: repairableCommitGateRun.runDir,
    evidencePath: repairableCommitGateEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:22.300Z',
    evidenceDir: path.join(tmp, 'repairable-commit-gate-evidence-bundles'),
    dashboardPath: path.join(tmp, 'repairable-commit-gate-dashboard.html'),
    executeRepairSkills: true,
    reviewerVerdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification: 'repairable',
        reasonCode: 'repairable-source-changes-without-commit-evidence',
        confidence: 'high',
        closureAllowed: false,
        basis: ['Repair is needed, but source changes also lack controller-owned commit evidence.'],
      },
      nextIteration: {
        allowed: true,
        mode: 'repair',
        instruction: 'Run repair after commit evidence exists.',
        mustNotDo: [],
      },
    },
  });
  const repairableCommitGateSelection = JSON.parse(await readFile(repairableCommitGate.postReviewSelectionPath, 'utf8'));
  assert.equal(repairableCommitGateSelection.classification, 'repairable');
  assert.equal(repairableCommitGateSelection.nextUnit.unitId, 'commit-intent');
  assert.notEqual(repairableCommitGateSelection.nextUnit.unitId, 'living-doc-balance-scan');
  assert.equal(repairableCommitGateSelection.nextUnit.reasonCode, 'repairable-source-changes-require-commit-evidence');
  assert.match(repairableCommitGateSelection.nextUnit.resultPath, /inference-units\/iteration-1\/04-commit-intent\/result\.json$/);
  assert.match(repairableCommitGateSelection.nextUnit.validationPath, /inference-units\/iteration-1\/04-commit-intent\/validation\.json$/);
  assert.equal(repairableCommitGateSelection.contractValidation.ok, true);

  const closureCandidateCommitGateRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'closure-candidate-commit-gate-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:23.000Z',
  });
  const closureCandidateCommitGateEvidencePath = path.join(tmp, 'closure-candidate-commit-gate-evidence.json');
  await writeIterationEvidenceTemplate({
    runDir: closureCandidateCommitGateRun.runDir,
    outPath: closureCandidateCommitGateEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'worker-verification-green-controller-rerun-and-commit-gates-pending',
    unprovenAcceptanceCriteria: ['criterion-side-effect-contracts', 'criterion-closure-gates'],
    acceptanceCriteriaSatisfied: 'pending',
    closureAllowed: false,
    filesChanged: ['docs/living-doc-inference-unit-type-system.json'],
    finalMessageSummary: 'Worker verified source and tests; remaining work is controller-owned commit-intent and closure gates.',
    now: '2026-05-07T10:21:24.000Z',
  });
  const closureCandidateCommitGate = await finalizeHarnessIteration({
    runDir: closureCandidateCommitGateRun.runDir,
    evidencePath: closureCandidateCommitGateEvidencePath,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration: 1,
    now: '2026-05-07T10:21:25.000Z',
    evidenceDir: path.join(tmp, 'closure-candidate-commit-gate-evidence-bundles'),
    dashboardPath: path.join(tmp, 'closure-candidate-commit-gate-dashboard.html'),
    reviewerVerdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification: 'closure-candidate',
        reasonCode: 'acceptance-criteria-pending',
        confidence: 'high',
        closureAllowed: false,
        basis: [
          'Closure is blocked by controller-owned commit gates and pending acceptance criteria.',
          'Source state reports worker-verification-green-controller-rerun-and-commit-gates-pending.',
        ],
      },
      nextIteration: {
        allowed: true,
        mode: 'continuation',
        instruction: 'Continue through controller rerun and commit-intent gates, then closure review and post-flight summary.',
        mustNotDo: [],
      },
    },
  });
  assert.equal(closureCandidateCommitGate.classification, 'true-block');
  assert.equal(closureCandidateCommitGate.terminalKind, 'continuation-required');
  const closureCandidateCommitGateSelection = JSON.parse(await readFile(closureCandidateCommitGate.postReviewSelectionPath, 'utf8'));
  assert.equal(closureCandidateCommitGateSelection.classification, 'closure-candidate');
  assert.equal(closureCandidateCommitGateSelection.nextUnit.unitId, 'commit-intent');
  assert.notEqual(closureCandidateCommitGateSelection.nextUnit.unitId, 'worker');
  assert.match(closureCandidateCommitGateSelection.nextUnit.resultPath, /inference-units\/iteration-1\/04-commit-intent\/result\.json$/);
  assert.match(closureCandidateCommitGateSelection.nextUnit.validationPath, /inference-units\/iteration-1\/04-commit-intent\/validation\.json$/);
  assert.equal(closureCandidateCommitGateSelection.contractValidation.ok, true);

  const reviewerInput = JSON.parse(await readFile(result.reviewerInputPath, 'utf8'));
  assert.equal(reviewerInput.logInspection.schema, 'living-doc-harness-reviewer-log-inspection/v1');
  assert.equal(reviewerInput.logInspection.nativeTraceSummaries.length, 1);
  assert.equal(reviewerInput.logInspection.nativeTraceSummaries[0].lineCount, 1);
  assert.equal(reviewerInput.logInspection.nativeTraceSummaries[0].privacy.rawPayloadIncluded, false);
  assert.equal(reviewerInput.logInspection.nativeTraceSummaries[0].rawJsonlPath, tracePath);
  assert.equal(reviewerInput.logInspection.wrapperRunLogs.length, 0);
  assert.deepEqual(reviewerInput.logInspection.rawWorkerJsonlPaths, [{
    kind: 'native-codex-session-jsonl',
    path: tracePath,
    summaryPath: 'traces/native.summary.json',
    traceHash: reviewerInput.logInspection.nativeTraceSummaries[0].traceHash,
  }]);
  assert.equal(reviewerInput.logInspection.privacy.rawJsonlPathIncluded, true);
  assert.equal(reviewerInput.logInspection.privacy.reviewerMustInspectRawJsonlByPath, true);
  assert.equal(JSON.stringify(reviewerInput).includes('PRIVATE_TRACE_CONTENT_SHOULD_NOT_LEAK'), false);
  const reviewerPrompt = await readFile(path.join(run.runDir, 'reviewer-inference', 'iteration-1-prompt.md'), 'utf8');
  assert.match(reviewerPrompt, /Before emitting the verdict, run commands that inspect every raw JSONL file path/);

  const fakeReviewerNoInspection = path.join(tmp, 'fake-reviewer-no-inspection');
  await writeFile(fakeReviewerNoInspection, `#!/bin/sh
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    out="$1"
  fi
  shift
done
while IFS= read -r _line; do :; done
cat > "$out" <<'JSON'
{"schema":"living-doc-harness-stop-verdict/v1","stopVerdict":{"classification":"closed","reasonCode":"fake-no-log-inspection","confidence":"high","closureAllowed":true,"basis":["Fake reviewer skipped raw JSONL inspection."]},"nextIteration":{"allowed":false,"mode":"none","instruction":"none"}}
JSON
printf '{"type":"thread.started","thread_id":"fake-no-inspection"}\\n'
printf '{"type":"turn.started"}\\n'
printf '{"type":"turn.completed"}\\n'
`, 'utf8');
  await chmod(fakeReviewerNoInspection, 0o755);
  const noInspectionRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'no-inspection-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:21:30.000Z',
  });
  const noInspectionEvidencePath = path.join(tmp, 'no-inspection-evidence.json');
  await writeIterationEvidenceTemplate({
    runDir: noInspectionRun.runDir,
    outPath: noInspectionEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'closed',
    acceptanceCriteriaSatisfied: 'pass',
    closureAllowed: true,
    finalMessageSummary: 'This should still fail because reviewer did not inspect raw JSONL by path.',
    now: '2026-05-07T10:21:45.000Z',
  });
  await assert.rejects(
    finalizeHarnessIteration({
      runDir: noInspectionRun.runDir,
      evidencePath: noInspectionEvidencePath,
      livingDocPath: docPath,
      afterDocPath: docPath,
      iteration: 1,
      now: '2026-05-07T10:22:00.000Z',
      evidenceDir: path.join(tmp, 'no-inspection-evidence-bundles'),
      dashboardPath: path.join(tmp, 'no-inspection-dashboard.html'),
      executeReviewer: true,
      codexBin: fakeReviewerNoInspection,
    }),
    /inference unit did not inspect required path/,
  );

  const cliRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'cli-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:22:00.000Z',
  });
  const cliEvidencePath = path.join(tmp, 'cli-evidence.json');
  const cliReviewerPath = path.join(tmp, 'cli-reviewer-verdict.json');
  const cliTracePath = path.join(tmp, 'cli-native.jsonl');
  await writeFile(cliReviewerPath, `${JSON.stringify(reviewerVerdict('closed', { closureAllowed: true }), null, 2)}\n`, 'utf8');
  await writeFile(cliTracePath, `${nativeTraceLine('CLI_PRIVATE_TRACE_CONTENT_SHOULD_NOT_LEAK')}\n`, 'utf8');
  const cliTemplate = spawnSync(process.execPath, [
    'scripts/living-doc-harness-iteration.mjs',
    'evidence-template',
    cliRun.runDir,
    '--trace',
    cliTracePath,
    '--out',
    cliEvidencePath,
    '--stage-after',
    'closed',
    '--acceptance-pass',
    '--closure-allowed',
    '--final-summary',
    'Objective complete with source-system evidence.',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: lifecycleCommandEnv(),
  });
  assert.equal(cliTemplate.status, 0, cliTemplate.stderr);
  assert.match(cliTemplate.stdout, /living-doc-harness-iteration-evidence/);
  const cli = spawnSync(process.execPath, [
    'scripts/living-doc-harness-iteration.mjs',
    'finalize',
    cliRun.runDir,
    '--evidence',
    cliEvidencePath,
    '--living-doc',
    docPath,
    '--after-doc',
    docPath,
    '--evidence-dir',
    path.join(tmp, 'cli-evidence-bundles'),
    '--dashboard',
    path.join(tmp, 'cli-dashboard.html'),
    '--reviewer-verdict',
    cliReviewerPath,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: lifecycleCommandEnv(),
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /"classification": "closed"/);

  const missingReviewerRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'missing-reviewer-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:23:00.000Z',
  });
  const missingReviewerEvidencePath = path.join(tmp, 'missing-reviewer-evidence.json');
  await writeIterationEvidenceTemplate({
    runDir: missingReviewerRun.runDir,
    outPath: missingReviewerEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'closed',
    acceptanceCriteriaSatisfied: 'pass',
    closureAllowed: true,
    finalMessageSummary: 'Deterministic proxy checks look closed, but reviewer verdict is missing.',
    now: '2026-05-07T10:23:30.000Z',
  });
  await assert.rejects(
    finalizeHarnessIteration({
      runDir: missingReviewerRun.runDir,
      evidencePath: missingReviewerEvidencePath,
      livingDocPath: docPath,
      afterDocPath: docPath,
      iteration: 1,
      now: '2026-05-07T10:24:00.000Z',
      evidenceDir: path.join(tmp, 'missing-reviewer-evidence-bundles'),
      dashboardPath: path.join(tmp, 'missing-reviewer-dashboard.html'),
    }),
    /reviewer inference verdict is required/,
  );

  const hardGateRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'hard-gate-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:25:00.000Z',
  });
  const hardGateEvidencePath = path.join(tmp, 'hard-gate-evidence.json');
  await writeIterationEvidenceTemplate({
    runDir: hardGateRun.runDir,
    outPath: hardGateEvidencePath,
    tracePaths: [tracePath],
    stageAfter: 'worker-claimed-closed',
    unprovenAcceptanceCriteria: ['criterion-proof-missing'],
    acceptanceCriteriaSatisfied: 'fail',
    closureAllowed: false,
    finalMessageSummary: 'Worker claims closed, but proof is missing.',
    now: '2026-05-07T10:25:30.000Z',
  });
  await assert.rejects(
    finalizeHarnessIteration({
      runDir: hardGateRun.runDir,
      evidencePath: hardGateEvidencePath,
      livingDocPath: docPath,
      afterDocPath: docPath,
      iteration: 1,
      now: '2026-05-07T10:26:00.000Z',
      evidenceDir: path.join(tmp, 'hard-gate-evidence-bundles'),
      dashboardPath: path.join(tmp, 'hard-gate-dashboard.html'),
      reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
    }),
    /hard gates do not allow closure/,
  );
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness iteration contract spec: all assertions passed');
