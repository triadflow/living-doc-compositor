import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  runContractBoundInferenceUnit,
  validateInferenceUnitInputContract,
  validateInferenceUnitResult,
  writeContractBoundInferenceUnitSnapshot,
} from '../../scripts/living-doc-harness-inference-unit.mjs';
import {
  createInferenceUnitChainContext,
  mockInferenceUnit,
} from '../fixtures/inference-unit-chain-fixtures.mjs';

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('timed out waiting for condition');
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-inference-unit-'));

try {
  const inspectedPath = path.join(tmp, 'required-evidence.json');
  await writeFile(inspectedPath, '{"ok":true}\n', 'utf8');

  const badInput = validateInferenceUnitInputContract({
    unitTypeId: 'closure-review',
    inputContract: {
      schema: 'wrong-schema/v1',
      runId: 'run-1',
    },
  });
  assert.equal(badInput.ok, false);
  assert.ok(badInput.violations.some((violation) => violation.path === '$.schema'));
  assert.ok(badInput.violations.some((violation) => violation.path === '$.iteration'));
  assert.ok(badInput.violations.some((violation) => violation.path === '$.evidencePath'));
  assert.ok(badInput.violations.some((violation) => violation.path === '$.evidenceSnapshotPath'));
  assert.ok(badInput.violations.some((violation) => violation.path === '$.requiredHardFacts'));

  const sideEffectWithoutSnapshot = validateInferenceUnitInputContract({
    unitTypeId: 'commit-intent',
    inputContract: {
      schema: 'living-doc-harness-commit-intent-input/v1',
      runId: 'run-1',
      iteration: 1,
      changedFiles: ['doc.json'],
      commitIntent: { mode: 'required-before-closure' },
      requiredInspectionPaths: ['doc.json'],
    },
  });
  assert.equal(sideEffectWithoutSnapshot.ok, false);
  assert.ok(sideEffectWithoutSnapshot.violations.some((violation) => violation.path === '$.evidenceSnapshotPath'));
  assert.ok(sideEffectWithoutSnapshot.violations.some((violation) => violation.path === '$.requiredHardFacts'));
  assert.ok(sideEffectWithoutSnapshot.violations.some((violation) => violation.path === '$.commitPolicy'));

  const prReviewWithoutPolicyContext = validateInferenceUnitInputContract({
    unitTypeId: 'pr-review',
    inputContract: {
      schema: 'living-doc-harness-pr-review-input/v1',
      runId: 'run-1',
      iteration: 1,
      reviewTarget: 'https://github.example/pr/1',
      requiredHardFacts: {
        schema: 'living-doc-harness-required-hard-facts/v1',
      },
    },
  });
  assert.equal(prReviewWithoutPolicyContext.ok, false);
  assert.ok(prReviewWithoutPolicyContext.violations.some((violation) => violation.path === '$.livingDocPath'));
  assert.ok(prReviewWithoutPolicyContext.violations.some((violation) => violation.path === '$.reviewerVerdictPath'));
  assert.ok(prReviewWithoutPolicyContext.violations.some((violation) => violation.path === '$.evidenceSnapshotPath'));
  assert.ok(prReviewWithoutPolicyContext.violations.some((violation) => violation.path === '$.prReviewPolicy'));
  assert.ok(prReviewWithoutPolicyContext.violations.some((violation) => violation.path === '$.prReviewRequired'));
  assert.ok(prReviewWithoutPolicyContext.violations.some((violation) => violation.path === '$.requiredInspectionPaths'));

  const workerWithoutRunConfig = validateInferenceUnitInputContract({
    unitTypeId: 'worker',
    inputContract: {
      schema: 'living-doc-worker-inference-input/v1',
      runId: 'run-1',
      livingDocPath: 'doc.json',
      objective: 'Do the work.',
      successCondition: 'The work is done.',
      requiredInspectionPaths: ['doc.json'],
    },
  });
  assert.equal(workerWithoutRunConfig.ok, false);
  assert.ok(workerWithoutRunConfig.violations.some((violation) => violation.path === '$.runConfig'));

  const invalidPrReviewFinalStatus = validateInferenceUnitResult({
    schema: 'living-doc-contract-bound-inference-result/v1',
    unitId: 'pr-review',
    role: 'pr-review',
    mode: 'external-headless-codex',
    status: 'finished',
    basis: ['Fixture captures the old non-verdict PR-review shape.'],
    unitType: {
      unitTypeId: 'pr-review',
      inputContractSchema: 'living-doc-harness-pr-review-input/v1',
      outputContractSchema: 'living-doc-harness-pr-review-result/v1',
      allowedNextUnitTypes: [],
      deterministicSideEffects: [],
      dashboard: {},
      closureImplications: {},
    },
    promptPath: 'prompt.md',
    inputContractPath: 'input-contract.json',
    codexEventsPath: 'codex-events.jsonl',
    lastMessagePath: 'last-message.txt',
    outputContract: {
      schema: 'living-doc-harness-pr-review-result/v1',
      status: 'finished',
      sideEffect: {
        type: 'github-pr-review',
        executed: false,
        reasonCode: 'unit-not-finalized',
      },
    },
  });
  assert.equal(invalidPrReviewFinalStatus.ok, false);
  assert.ok(invalidPrReviewFinalStatus.violations.some((violation) => violation.path === '$.status'));
  assert.ok(invalidPrReviewFinalStatus.violations.some((violation) => violation.path === '$.outputContract.status'));

  const postFlightWithoutLifecycleResult = validateInferenceUnitInputContract({
    unitTypeId: 'post-flight-summary',
    inputContract: {
      schema: 'living-doc-harness-post-flight-summary-input/v1',
      runId: 'run-1',
      iteration: 1,
      terminalPath: 'terminal.json',
      proofPath: 'proof.json',
      requiredInspectionPaths: ['terminal.json', 'proof.json'],
    },
  });
  assert.equal(postFlightWithoutLifecycleResult.ok, false);
  assert.ok(postFlightWithoutLifecycleResult.violations.some((violation) => violation.path === '$.lifecycleResultPath'));

  await assert.rejects(
    runContractBoundInferenceUnit({
      runDir: path.join(tmp, 'bad-input-run'),
      unitId: 'closure-review',
      role: 'closure-review',
      prompt: 'This should fail before any unit artifact is invoked.',
      inputContract: {
        schema: 'wrong-schema/v1',
        runId: 'run-1',
      },
      execute: false,
      now: '2026-05-08T07:39:00.000Z',
    }),
    /invalid closure-review input contract/,
  );

  await assert.rejects(
    writeContractBoundInferenceUnitSnapshot({
      runDir: path.join(tmp, 'bad-snapshot-run'),
      unitId: 'worker',
      role: 'worker',
      unitTypeId: 'worker',
      prompt: 'This snapshot should fail before any artifact is written.',
      inputContract: {
        schema: 'living-doc-worker-inference-input/v1',
        runId: 'run-1',
      },
      outputContract: {
        schema: 'living-doc-worker-output/v1',
        status: 'prepared',
        runId: 'run-1',
        livingDocPath: 'doc.json',
        nextAuthority: 'reviewer-inference',
      },
      now: '2026-05-08T07:39:30.000Z',
    }),
    /invalid worker input contract snapshot/,
  );

  const rawBoundaryContext = await createInferenceUnitChainContext({
    rootDir: tmp,
    name: 'raw-boundary-fixtures',
  });
  const rawBoundaryCases = [
    {
      unitTypeId: 'reviewer-inference',
      sequence: 1,
      output: { classification: 'repairable', closureAllowed: false },
      expectedStatus: 'repairable',
      assertRaw: (raw) => {
        assert.equal(raw.status, undefined);
        assert.equal(raw.stopVerdict.classification, 'repairable');
      },
    },
    {
      unitTypeId: 'closure-review',
      sequence: 2,
      output: {
        approved: false,
        terminalAllowed: false,
        reasonCode: 'fixture-closure-review-denied',
      },
      expectedStatus: 'blocked',
      assertRaw: (raw) => {
        assert.equal(raw.status, undefined);
        assert.equal(raw.outputContract, undefined);
        assert.equal(raw.approved, false);
        assert.equal(raw.terminalAllowed, false);
      },
    },
    {
      unitTypeId: 'closure-review',
      sequence: 3,
      output: {
        approved: true,
        terminalAllowed: true,
        reasonCode: 'fixture-closure-review-approved',
      },
      expectedStatus: 'approved',
      assertRaw: (raw) => {
        assert.equal(raw.status, undefined);
        assert.equal(raw.outputContract, undefined);
        assert.equal(raw.approved, true);
        assert.equal(raw.terminalAllowed, true);
      },
    },
    {
      unitTypeId: 'living-doc-balance-scan',
      sequence: 4,
      output: { status: 'ordered', orderedSkills: ['objective-conservation-audit'] },
      expectedStatus: 'ordered',
    },
    {
      unitTypeId: 'repair-skill',
      sequence: 5,
      output: { status: 'repaired', changedFiles: ['docs/fixture.json'] },
      expectedStatus: 'repaired',
    },
    {
      unitTypeId: 'commit-intent',
      sequence: 6,
      output: { status: 'approved', changedFiles: ['docs/fixture.json'] },
      expectedStatus: 'approved',
    },
    {
      unitTypeId: 'pr-review',
      sequence: 7,
      output: { status: 'approved' },
      expectedStatus: 'approved',
    },
    {
      unitTypeId: 'worker',
      sequence: 8,
      output: { status: 'finished' },
      expectedStatus: 'finished',
    },
    {
      unitTypeId: 'post-flight-summary',
      sequence: 9,
      output: { status: 'written', summaryPath: 'post-flight-summary.md' },
      expectedStatus: 'written',
    },
  ];
  for (const boundaryCase of rawBoundaryCases) {
    const unit = await mockInferenceUnit(rawBoundaryContext, boundaryCase);
    const raw = JSON.parse(await readFile(unit.lastMessagePath, 'utf8'));
    assert.equal(unit.validation.ok, true);
    assert.equal(unit.result.status, boundaryCase.expectedStatus);
    assert.equal(unit.result.outputContract.schema, raw.schema);
    if (raw.status != null) assert.equal(unit.result.outputContract.status, raw.status);
    if (boundaryCase.assertRaw) boundaryCase.assertRaw(raw);
  }

  const nonVerdictPrReviewRun = await runContractBoundInferenceUnit({
    runDir: path.join(tmp, 'non-verdict-pr-review-run'),
    unitId: 'pr-review',
    role: 'pr-review',
    prompt: 'Return the historical bad PR-review shape.',
    inputContract: {
      schema: 'living-doc-harness-pr-review-input/v1',
      runId: 'run-1',
      iteration: 1,
      livingDocPath: 'doc.json',
      reviewerVerdictPath: inspectedPath,
      reviewTarget: 'local-review-target',
      evidenceSnapshotPath: inspectedPath,
      requiredHardFacts: {
        schema: 'living-doc-harness-required-hard-facts/v1',
        prReviewRequired: true,
      },
      prReviewPolicy: {
        schema: 'living-doc-harness-pr-review-policy/v1',
        mode: 'required-before-closure',
      },
      prReviewRequired: true,
      requiredInspectionPaths: [inspectedPath],
    },
    fixtureResult: {
      status: 'finished',
      basis: ['This is the old non-verdict PR-review output.'],
      outputContract: {
        schema: 'living-doc-harness-pr-review-result/v1',
        status: 'finished',
        approvedActions: [],
        sideEffect: {
          type: 'github-pr-review',
          executed: false,
          reasonCode: 'unit-not-finalized',
        },
      },
    },
    execute: false,
    now: '2026-05-08T07:39:45.000Z',
  });
  assert.equal(nonVerdictPrReviewRun.validation.ok, true);
  assert.equal(nonVerdictPrReviewRun.result.promptContract.schema, 'living-doc-harness-prompt-contract/v1');
  assert.equal(nonVerdictPrReviewRun.result.promptContract.template, 'living-doc-harness-pr-review-prompt/v1');
  assert.equal(nonVerdictPrReviewRun.result.promptContract.promptPath, nonVerdictPrReviewRun.result.promptPath);
  assert.match(nonVerdictPrReviewRun.result.promptContract.promptSha256, /^[a-f0-9]{64}$/);
  assert.equal(nonVerdictPrReviewRun.result.status, 'blocked');
  assert.equal(nonVerdictPrReviewRun.result.outputContract.status, 'blocked');
  assert.equal(nonVerdictPrReviewRun.result.outputContract.reasonCode, 'pr-review-non-verdict-output');
  assert.equal(nonVerdictPrReviewRun.result.outputContract.sideEffect.reasonCode, 'pr-review-non-verdict-output');

  await assert.rejects(
    runContractBoundInferenceUnit({
      runDir: path.join(tmp, 'removed-continuation-unit-run'),
      unitId: 'continuation-inference',
      role: 'removed-unit',
      prompt: 'This removed unit type must not be invokable.',
      inputContract: {
        schema: 'living-doc-continuation-input/v1',
        runId: 'run-1',
        iteration: 1,
        requiredInspectionPaths: [inspectedPath],
      },
      execute: false,
      now: '2026-05-08T07:39:50.000Z',
    }),
    /unregistered inference unit type: continuation-inference/,
  );

  const rawDeniedClosureReviewRun = await runContractBoundInferenceUnit({
    runDir: path.join(tmp, 'raw-denied-closure-review-run'),
    unitId: 'closure-review',
    role: 'closure-review',
    prompt: 'Return the real closure-review contract shape without a controller verdict.',
    inputContract: {
      schema: 'living-doc-harness-closure-review-input/v1',
      runId: 'run-1',
      iteration: 1,
      evidencePath: inspectedPath,
      reviewerVerdictPath: inspectedPath,
      evidenceSnapshotPath: inspectedPath,
      requiredHardFacts: {
        schema: 'living-doc-harness-required-hard-facts/v1',
        sourceFilesChanged: false,
        commitEvidencePresent: true,
      },
      prReviewPolicy: {
        schema: 'living-doc-harness-pr-review-policy/v1',
        mode: 'disabled',
      },
      prReviewRequired: false,
      proofGates: {
        acceptanceCriteriaSatisfied: 'pending',
        closureAllowed: false,
      },
      stopVerdict: {
        classification: 'resumable',
        closureAllowed: false,
      },
      requiredInspectionPaths: [inspectedPath],
    },
    fixtureResult: {
      schema: 'living-doc-harness-closure-review/v1',
      approved: false,
      reasonCode: 'closure-forbidden-unproven-criteria',
      confidence: 'high',
      basis: ['Fixture matches the real closure-review denial shape without status.'],
      terminalAllowed: false,
    },
    execute: false,
    now: '2026-05-08T07:39:55.000Z',
  });
  assert.equal(rawDeniedClosureReviewRun.validation.ok, true);
  assert.equal(rawDeniedClosureReviewRun.result.status, 'blocked');
  assert.equal(rawDeniedClosureReviewRun.result.outputContract.status, 'blocked');
  assert.equal(rawDeniedClosureReviewRun.result.outputContract.approved, false);
  assert.equal(rawDeniedClosureReviewRun.result.outputContract.terminalAllowed, false);

  const wrappedDeniedClosureReviewRun = await runContractBoundInferenceUnit({
    runDir: path.join(tmp, 'wrapped-denied-closure-review-run'),
    unitId: 'closure-review',
    role: 'closure-review',
    prompt: 'Return the historical wrapper shape from issue 303.',
    inputContract: {
      schema: 'living-doc-harness-closure-review-input/v1',
      runId: 'run-1',
      iteration: 1,
      evidencePath: inspectedPath,
      reviewerVerdictPath: inspectedPath,
      evidenceSnapshotPath: inspectedPath,
      requiredHardFacts: {
        schema: 'living-doc-harness-required-hard-facts/v1',
        sourceFilesChanged: false,
        commitEvidencePresent: true,
      },
      prReviewPolicy: {
        schema: 'living-doc-harness-pr-review-policy/v1',
        mode: 'disabled',
      },
      prReviewRequired: false,
      proofGates: {
        acceptanceCriteriaSatisfied: 'pending',
        closureAllowed: false,
      },
      stopVerdict: {
        classification: 'resumable',
        closureAllowed: false,
      },
      requiredInspectionPaths: [inspectedPath],
    },
    fixtureResult: {
      status: 'finished',
      basis: ['Closure-review wrapper process exited cleanly.'],
      outputContract: {
        schema: 'living-doc-harness-closure-review/v1',
        approved: false,
        reasonCode: 'closure-forbidden-unproven-criteria',
        confidence: 'high',
        basis: ['The objective is not yet proven.'],
        terminalAllowed: false,
      },
    },
    execute: false,
    now: '2026-05-08T07:39:58.000Z',
  });
  assert.equal(wrappedDeniedClosureReviewRun.validation.ok, true);
  assert.equal(wrappedDeniedClosureReviewRun.result.status, 'blocked');
  assert.equal(wrappedDeniedClosureReviewRun.result.outputContract.status, 'blocked');
  assert.equal(wrappedDeniedClosureReviewRun.result.outputContract.reasonCode, 'closure-forbidden-unproven-criteria');

  const rawApprovedClosureReviewRun = await runContractBoundInferenceUnit({
    runDir: path.join(tmp, 'raw-approved-closure-review-run'),
    unitId: 'closure-review',
    role: 'closure-review',
    prompt: 'Return the real approved closure-review contract shape without a controller verdict.',
    inputContract: {
      schema: 'living-doc-harness-closure-review-input/v1',
      runId: 'run-1',
      iteration: 1,
      evidencePath: inspectedPath,
      reviewerVerdictPath: inspectedPath,
      evidenceSnapshotPath: inspectedPath,
      requiredHardFacts: {
        schema: 'living-doc-harness-required-hard-facts/v1',
        sourceFilesChanged: false,
        commitEvidencePresent: true,
      },
      prReviewPolicy: {
        schema: 'living-doc-harness-pr-review-policy/v1',
        mode: 'disabled',
      },
      prReviewRequired: false,
      proofGates: {
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
      },
      stopVerdict: {
        classification: 'closed',
        closureAllowed: true,
      },
      requiredInspectionPaths: [inspectedPath],
    },
    fixtureResult: {
      schema: 'living-doc-harness-closure-review/v1',
      approved: true,
      reasonCode: 'objective-proven',
      confidence: 'high',
      basis: ['Fixture matches the real closure-review approval shape without status.'],
      terminalAllowed: true,
    },
    execute: false,
    now: '2026-05-08T07:39:59.000Z',
  });
  assert.equal(rawApprovedClosureReviewRun.validation.ok, true);
  assert.equal(rawApprovedClosureReviewRun.result.status, 'approved');
  assert.equal(rawApprovedClosureReviewRun.result.outputContract.status, 'approved');
  assert.equal(rawApprovedClosureReviewRun.result.outputContract.approved, true);
  assert.equal(rawApprovedClosureReviewRun.result.outputContract.terminalAllowed, true);

  const fakeCodex = path.join(tmp, 'fake-codex.mjs');
  await writeFile(fakeCodex, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const outputPath = args[args.indexOf('-o') + 1];
const inspectedPath = ${JSON.stringify(inspectedPath)};
const hasIgnoreUserConfig = args.includes('--ignore-user-config');
const sandboxIndex = args.indexOf('--sandbox');
const sandboxMode = sandboxIndex >= 0 ? args[sandboxIndex + 1] : null;
const hasLocalMcpOverride = args.some((arg) => arg.includes('mcp_servers.living_doc_compositor.command'));

process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'streaming-test' }));
  console.log(JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'command_execution',
      command: 'cat ' + inspectedPath,
      status: 'completed',
      exit_code: 0,
    },
  }));
  setTimeout(() => {
    writeFileSync(outputPath, JSON.stringify({
      schema: 'living-doc-harness-closure-review/v1',
      approved: false,
      reasonCode: 'fake-streaming-proof',
      confidence: 'high',
      basis: ['fake codex inspected the required evidence path before exit'],
      terminalAllowed: false,
      hasIgnoreUserConfig,
      sandboxMode,
      hasLocalMcpOverride,
    }, null, 2));
    console.log(JSON.stringify({ type: 'turn.completed' }));
  }, 500);
});
`, 'utf8');
  await chmod(fakeCodex, 0o755);

  const runDir = path.join(tmp, 'run');
  const eventsPath = path.join(runDir, 'inference-units', 'iteration-1', '01-closure-review', 'codex-events.jsonl');
  let settled = false;
  const resultPromise = runContractBoundInferenceUnit({
    runDir,
    unitId: 'closure-review',
    role: 'closure-review',
    prompt: 'Inspect the required path and return JSON.',
    inputContract: {
      schema: 'living-doc-harness-closure-review-input/v1',
      runId: 'run-1',
      iteration: 1,
      evidencePath: inspectedPath,
      reviewerVerdictPath: inspectedPath,
      evidenceSnapshotPath: inspectedPath,
      requiredHardFacts: {
        schema: 'living-doc-harness-required-hard-facts/v1',
        sourceFilesChanged: false,
        commitEvidencePresent: false,
      },
      prReviewPolicy: {
        schema: 'living-doc-harness-pr-review-policy/v1',
        mode: 'disabled',
      },
      prReviewRequired: false,
      proofGates: { acceptanceCriteriaSatisfied: 'pass' },
      stopVerdict: { classification: 'closed' },
      requiredInspectionPaths: [inspectedPath],
    },
    outputContract: {
      schema: 'living-doc-harness-closure-review/v1',
    },
    execute: true,
    codexBin: fakeCodex,
    cwd: process.cwd(),
    now: '2026-05-08T07:40:00.000Z',
  }).finally(() => {
    settled = true;
  });

  const streamed = await waitFor(async () => {
    try {
      const text = await readFile(eventsPath, 'utf8');
      return text.includes(inspectedPath) ? text : null;
    } catch {
      return null;
    }
  });
  assert.match(streamed, /command_execution/);
  assert.equal(settled, false, 'codex-events.jsonl must be observable before the inference unit exits');

  const result = await resultPromise;
  assert.equal(result.validation.ok, true);
  assert.equal(result.result.mode, 'headless-codex');
  assert.equal(result.result.status, 'blocked');
  assert.equal(result.result.outputContract.hasIgnoreUserConfig, true);
  assert.equal(result.result.outputContract.sandboxMode, 'danger-full-access');
  assert.equal(result.result.outputContract.hasLocalMcpOverride, true);
  assert.equal(result.result.toolProfile.name, 'local-harness');
  assert.equal(result.result.toolProfile.sandboxMode, 'danger-full-access');
  assert.deepEqual(result.result.toolProfile.mcpAllowlist, ['living_doc_compositor']);
  assert.equal(result.result.promptContract.toolProfile.name, 'local-harness');
  assert.equal(result.result.promptContract.toolProfile.sandboxMode, 'danger-full-access');
  assert.equal(result.result.promptContract.promptBytes > 0, true);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness inference unit contract spec: all assertions passed');
