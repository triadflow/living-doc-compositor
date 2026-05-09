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
    '--file-changed',
    'scripts/living-doc-harness-iteration.mjs',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
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
