import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createHarnessRun } from '../../scripts/living-doc-harness-runner.mjs';
import { writeContractBoundInferenceUnitSnapshot } from '../../scripts/living-doc-harness-inference-unit.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-runner-'));

try {
  const result = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir: tmp,
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T06:30:00.000Z',
  });

  assert.equal(result.executed, false);
  assert.ok(result.runId.startsWith('ldh-20260507T063000Z-'));
  assert.ok(result.runDir.startsWith(tmp));

  const contract = JSON.parse(await readFile(path.join(result.runDir, 'contract.json'), 'utf8'));
  const state = JSON.parse(await readFile(path.join(result.runDir, 'state.json'), 'utf8'));
  const events = await readFile(path.join(result.runDir, 'events.jsonl'), 'utf8');
  const prompt = await readFile(path.join(result.runDir, 'prompt.md'), 'utf8');

  assert.equal(contract.schema, 'living-doc-harness-run/v1');
  assert.equal(contract.mode, 'standalone-headless');
  assert.equal(contract.status, 'prepared');
  assert.equal(contract.process.isolatedFromUserSession, true);
  assert.equal(contract.process.command, 'codex');
  assert.deepEqual(contract.process.args.slice(0, 3), ['exec', '--json', '--ignore-user-config']);
  assert.equal(contract.process.args[contract.process.args.indexOf('--sandbox') + 1], 'danger-full-access');
  assert.ok(contract.process.args.includes('-C'));
  assert.equal(contract.process.args[contract.process.args.indexOf('-C') + 1], process.cwd());
  assert.ok(contract.process.args.some((arg) => arg.includes('mcp_servers.living_doc_compositor.command')));
  assert.equal(typeof contract.process.env.CODEX_HOME, 'string');
  assert.ok(contract.process.env.CODEX_HOME.length > 0);
  assert.equal(contract.process.env.LIVING_DOC_HARNESS_ROLE, 'worker');
  assert.equal(contract.process.toolProfile.name, 'local-harness');
  assert.equal(contract.process.toolProfile.sandboxMode, 'danger-full-access');
  assert.deepEqual(contract.process.toolProfile.mcpAllowlist, ['living_doc_compositor']);
  assert.ok(contract.process.args.includes('-o'));
  assert.equal(contract.process.args.at(-1), '-');
  assert.equal(contract.process.stdin, 'prompt.md');
  assert.match(contract.livingDoc.sourceHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(contract.livingDoc.objectiveHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(contract.artifacts.nativeTraceRefs, []);
  assert.match(contract.artifacts.workerInferenceUnit.result, /inference-units\/iteration-1\/01-worker\/result\.json$/);
  assert.match(contract.artifacts.workerInferenceUnit.validation, /inference-units\/iteration-1\/01-worker\/validation\.json$/);
  const workerUnitResult = JSON.parse(await readFile(path.join(result.runDir, contract.artifacts.workerInferenceUnit.result), 'utf8'));
  assert.equal(workerUnitResult.schema, 'living-doc-contract-bound-inference-result/v1');
  assert.equal(workerUnitResult.unitId, 'worker');
  assert.equal(workerUnitResult.role, 'worker');
  assert.equal(workerUnitResult.status, 'prepared');
  assert.equal(workerUnitResult.outputContract.nextAuthority, 'reviewer-inference');
  const workerUnitInput = JSON.parse(await readFile(path.join(result.runDir, contract.artifacts.workerInferenceUnit.inputContract), 'utf8'));
  assert.equal(workerUnitInput.schema, 'living-doc-worker-inference-input/v1');
  assert.equal(workerUnitInput.runConfig.prReviewPolicy.mode, 'disabled');
  assert.deepEqual(workerUnitInput.requiredInspectionPaths, ['tests/fixtures/minimal-doc.json']);
  assert.equal(workerUnitInput.toolProfile.name, 'local-harness');
  assert.equal(workerUnitInput.toolProfile.sandboxMode, 'danger-full-access');

  await assert.rejects(
    () => createHarnessRun({
      docPath: 'tests/fixtures/minimal-doc.json',
      runsDir: path.join(tmp, 'invalid-pr-policy-runs'),
      execute: false,
      cwd: process.cwd(),
      now: '2026-05-07T06:30:30.000Z',
      allowedUnitTypes: ['worker', 'reviewer-inference', 'closure-review', 'continuation-inference', 'post-flight-summary'],
      prReviewPolicy: { mode: 'required-before-closure' },
    }),
    /invalid harness runner inference unit run config: .*prReviewPolicy required-before-closure requires pr-review/,
  );

  assert.equal(state.schema, 'living-doc-harness-state/v1');
  assert.equal(state.lifecycleStage, 'initial-objective-bearing');
  assert.equal(state.status, 'prepared');
  assert.equal(state.nextAction, 'run with --execute to start codex exec');

  assert.match(events, /"event":"run-created"/);
  assert.match(events, /"event":"codex-command-prepared"/);
  assert.match(events, /"event":"execution-skipped"/);
  assert.match(prompt, /You are running inside the standalone agentic living-doc harness/);
  assert.match(prompt, /Do not run harness finalizer, reviewer, evidence-dashboard, or lifecycle-control commands/);

  const fakeBin = path.join(tmp, 'fake-codex');
  const fakeCodexHome = path.join(tmp, 'fake-codex-home');
  await writeFile(fakeBin, `#!/bin/sh
mkdir -p "$CODEX_HOME/sessions/2026/05/07"
LIVE_TS="$(node -e 'console.log(new Date().toISOString())')"
cat > "$CODEX_HOME/sessions/2026/05/07/rollout-stale-but-touched.jsonl" <<'EOF'
{"timestamp":"2026-05-05T06:31:00.000Z","type":"session_meta","payload":{"id":"stale-test","source":"codex-cli","cli_version":"test","model_provider":"openai","cwd":"/private/path"}}
{"timestamp":"2026-05-05T06:31:01.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"PRIVATE_STALE_TRACE_CONTENT"}]}}
EOF
cat > "$CODEX_HOME/sessions/2026/05/07/rollout-live.jsonl" <<EOF
{"timestamp":"$LIVE_TS","type":"session_meta","payload":{"id":"live-test","source":"codex-cli","cli_version":"test","model_provider":"openai","cwd":"/private/path"}}
{"timestamp":"$LIVE_TS","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"PRIVATE_LIVE_TRACE_CONTENT"}]}}
EOF
printf '{"type":"done"}\\n'
exit 0
`, 'utf8');
  await chmod(fakeBin, 0o755);
  await mkdir(fakeCodexHome, { recursive: true });
  const executed = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir: path.join(tmp, 'execute-runs'),
    execute: true,
    cwd: process.cwd(),
    now: '2026-05-07T06:31:00.000Z',
    codexBin: fakeBin,
    codexHome: fakeCodexHome,
  });
  assert.equal(executed.executed, true);
  assert.equal(executed.exitCode, 0);
  assert.equal(executed.traceDiscovery.candidateCount, 1);
  assert.equal(executed.traceDiscovery.scannedModifiedCount, 2);
  assert.equal(executed.contract.artifacts.nativeTraceRefs.length, 1);
  assert.equal(executed.contract.artifacts.nativeTraceRefs[0].rawPayloadIncluded, false);
  const executedWorkerUnit = JSON.parse(await readFile(path.join(executed.runDir, executed.contract.artifacts.workerInferenceUnit.result), 'utf8'));
  assert.equal(executedWorkerUnit.schema, 'living-doc-contract-bound-inference-result/v1');
  assert.equal(executedWorkerUnit.unitId, 'worker');
  assert.equal(executedWorkerUnit.role, 'worker');
  assert.equal(executedWorkerUnit.mode, 'external-headless-codex');
  assert.equal(executedWorkerUnit.status, 'finished');
  assert.equal(executedWorkerUnit.outputContract.schema, 'living-doc-worker-output/v1');
  assert.equal(executedWorkerUnit.outputContract.nextAuthority, 'reviewer-inference');
  assert.equal(executedWorkerUnit.outputContract.nativeTraceRefs.length, 1);
  const executedWorkerValidation = JSON.parse(await readFile(path.join(executed.runDir, executed.contract.artifacts.workerInferenceUnit.validation), 'utf8'));
  assert.equal(executedWorkerValidation.ok, true);
  assert.equal(JSON.stringify(executed.contract).includes('PRIVATE_LIVE_TRACE_CONTENT'), false);
  assert.equal(JSON.stringify(executed.contract).includes('PRIVATE_STALE_TRACE_CONTENT'), false);
  const executeEvents = await readFile(path.join(executed.runDir, 'events.jsonl'), 'utf8');
  assert.match(executeEvents, /"event":"native-trace-discovery-written"/);
  assert.match(executeEvents, /"event":"native-trace-summary-attached"/);
  const traceDiscovery = JSON.parse(await readFile(path.join(executed.runDir, 'trace-discovery.json'), 'utf8'));
  assert.match(traceDiscovery.codexHomeHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(traceDiscovery).includes(fakeCodexHome), false);

  const previousPrRunDir = path.join(tmp, 'previous-pr-review-run');
  await mkdir(path.join(previousPrRunDir, 'artifacts'), { recursive: true });
  await mkdir(path.join(previousPrRunDir, 'reviewer-inference'), { recursive: true });
  await mkdir(path.join(previousPrRunDir, 'output-input'), { recursive: true });
  await writeFile(path.join(previousPrRunDir, 'reviewer-inference', 'iteration-1-verdict.json'), `${JSON.stringify({
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification: 'repairable',
      reasonCode: 'pr-review-policy-gate-missing',
      closureAllowed: false,
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(previousPrRunDir, 'artifacts', 'iteration-1-controller-evidence-snapshot.json'), `${JSON.stringify({
    schema: 'living-doc-harness-controller-evidence-snapshot/v1',
    hardFacts: {
      schema: 'living-doc-harness-required-hard-facts/v1',
      sourceFilesChanged: false,
      commitEvidencePresent: true,
      prReviewRequired: true,
      prReviewGate: { required: true, status: 'missing', evidencePresent: false },
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(previousPrRunDir, 'artifacts', 'iteration-1-evidence.json'), `${JSON.stringify({
    schema: 'living-doc-harness-iteration-evidence/v1',
    controllerEvidenceSnapshotPath: 'artifacts/iteration-1-controller-evidence-snapshot.json',
    requiredHardFacts: {
      schema: 'living-doc-harness-required-hard-facts/v1',
      sourceFilesChanged: false,
      commitEvidencePresent: true,
      prReviewRequired: true,
      prReviewGate: { required: true, status: 'missing', evidencePresent: false },
    },
    prReviewPolicy: {
      schema: 'living-doc-harness-pr-review-policy/v1',
      mode: 'required-before-closure',
    },
    sideEffectEvidence: {
      commit: {
        required: true,
        sha: '1234567890abcdef1234567890abcdef12345678',
        source: 'commit-intent-output-contract',
      },
    },
  }, null, 2)}\n`, 'utf8');
  const previousPrOutputInputPath = path.join(previousPrRunDir, 'output-input', 'iteration-1.json');
  await writeFile(previousPrOutputInputPath, `${JSON.stringify({
    schema: 'living-doc-harness-output-input/v1',
    previousOutput: {
      evidencePath: 'artifacts/iteration-1-evidence.json',
      reviewerVerdictPath: 'reviewer-inference/iteration-1-verdict.json',
      classification: 'repairable',
    },
  }, null, 2)}\n`, 'utf8');
  const fakePrReviewCodex = path.join(tmp, 'fake-pr-review-codex');
  const fakePrReviewCodexHome = path.join(tmp, 'fake-pr-review-codex-home');
  await writeFile(fakePrReviewCodex, `#!/bin/sh
set -eu
OUT=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    OUT="$1"
  fi
  shift || true
done
mkdir -p "$CODEX_HOME/sessions/2026/05/07"
LIVE_TS="$(node -e 'console.log(new Date().toISOString())')"
cat > "$CODEX_HOME/sessions/2026/05/07/rollout-pr-review-live.jsonl" <<EOF
{"timestamp":"$LIVE_TS","type":"session_meta","payload":{"id":"pr-review-live","source":"codex-cli","cli_version":"test","model_provider":"openai","cwd":"/private/path"}}
{"timestamp":"$LIVE_TS","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"pr-review non-verdict fixture"}]}}
EOF
cat > "$OUT" <<'EOF'
{
  "schema": "living-doc-harness-pr-review-result/v1",
  "status": "finished",
  "approvedActions": [],
  "sideEffect": {
    "type": "github-pr-review",
    "executed": false,
    "reasonCode": "unit-not-finalized"
  }
}
EOF
printf '{"type":"done"}\\n'
exit 0
`, 'utf8');
  await chmod(fakePrReviewCodex, 0o755);
  await mkdir(fakePrReviewCodexHome, { recursive: true });
  const prReviewRun = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir: path.join(tmp, 'pr-review-runs'),
    execute: true,
    cwd: process.cwd(),
    now: '2026-05-07T06:31:20.000Z',
    codexBin: fakePrReviewCodex,
    codexHome: fakePrReviewCodexHome,
    prReviewPolicy: { mode: 'required-before-closure' },
    iteration: 2,
    lifecycleInput: {
      mode: 'continuation',
      previousRunId: 'previous-pr-review-run',
      previousIteration: 1,
      instruction: 'Run the required PR-review gate.',
      outputInputPath: previousPrOutputInputPath,
      selectedUnitType: 'pr-review',
      nextUnit: {
        unitId: 'pr-review',
        role: 'pr-review',
        reasonCode: 'pr-review-policy-gate-missing',
      },
    },
  });
  const prReviewUnit = JSON.parse(await readFile(path.join(
    prReviewRun.runDir,
    prReviewRun.contract.artifacts.prReviewInferenceUnit.result,
  ), 'utf8'));
  assert.equal(prReviewUnit.mode, 'external-headless-codex');
  assert.equal(prReviewUnit.status, 'blocked');
  assert.equal(prReviewUnit.outputContract.status, 'blocked');
  assert.equal(prReviewUnit.outputContract.reasonCode, 'pr-review-non-verdict-output');
  assert.equal(prReviewUnit.outputContract.sideEffect.reasonCode, 'pr-review-non-verdict-output');
  const prReviewValidation = JSON.parse(await readFile(path.join(
    prReviewRun.runDir,
    prReviewRun.contract.artifacts.prReviewInferenceUnit.validation,
  ), 'utf8'));
  assert.equal(prReviewValidation.ok, true);

  const fakeSelfAuthoredPrReviewCodex = path.join(tmp, 'fake-self-authored-pr-review-codex');
  const fakeSelfAuthoredPrReviewCodexHome = path.join(tmp, 'fake-self-authored-pr-review-codex-home');
  await writeFile(fakeSelfAuthoredPrReviewCodex, `#!/bin/sh
set -eu
OUT=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    OUT="$1"
  fi
  shift || true
done
RUN_DIR="$(dirname "$(dirname "$OUT")")"
RESULT="$RUN_DIR/initial-inference-units/iteration-2/05-pr-review/result.json"
mkdir -p "$CODEX_HOME/sessions/2026/05/07"
LIVE_TS="$(node -e 'console.log(new Date().toISOString())')"
cat > "$CODEX_HOME/sessions/2026/05/07/rollout-pr-review-self-authored.jsonl" <<EOF
{"timestamp":"$LIVE_TS","type":"session_meta","payload":{"id":"pr-review-self-authored","source":"codex-cli","cli_version":"test","model_provider":"openai","cwd":"/private/path"}}
{"timestamp":"$LIVE_TS","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"self-authored pr-review verdict fixture"}]}}
EOF
node - "$RESULT" <<'NODE'
const fs = require('fs');
const resultPath = process.argv[2];
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
result.mode = 'external-headless-codex';
result.status = 'not-required';
result.basis = [
  'The PR-review unit inspected its contract and found no reviewable PR target.'
];
result.outputContract = {
  schema: 'living-doc-harness-pr-review-result/v1',
  status: 'not-required',
  reasonCode: 'no-reviewable-pr-target',
  approvedActions: [],
  sideEffect: {
    type: 'github-pr-review',
    executed: false,
    reasonCode: 'no-reviewable-pr-target'
  },
  basis: result.basis
};
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\\n');
NODE
cat > "$OUT" <<'EOF'
Completed the contract-bound PR-review unit and wrote the verdict to its unit artifact.
EOF
printf '{"type":"done"}\\n'
exit 0
`, 'utf8');
  await chmod(fakeSelfAuthoredPrReviewCodex, 0o755);
  await mkdir(fakeSelfAuthoredPrReviewCodexHome, { recursive: true });
  const selfAuthoredPrReviewRun = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir: path.join(tmp, 'self-authored-pr-review-runs'),
    execute: true,
    cwd: process.cwd(),
    now: '2026-05-07T06:31:21.000Z',
    codexBin: fakeSelfAuthoredPrReviewCodex,
    codexHome: fakeSelfAuthoredPrReviewCodexHome,
    prReviewPolicy: { mode: 'required-before-closure' },
    iteration: 2,
    lifecycleInput: {
      mode: 'continuation',
      previousRunId: 'previous-pr-review-run',
      previousIteration: 1,
      instruction: 'Run the required PR-review gate.',
      outputInputPath: previousPrOutputInputPath,
      selectedUnitType: 'pr-review',
      nextUnit: {
        unitId: 'pr-review',
        role: 'pr-review',
        reasonCode: 'pr-review-policy-gate-missing',
      },
    },
  });
  const selfAuthoredPrReviewUnit = JSON.parse(await readFile(path.join(
    selfAuthoredPrReviewRun.runDir,
    selfAuthoredPrReviewRun.contract.artifacts.prReviewInferenceUnit.result,
  ), 'utf8'));
  assert.equal(selfAuthoredPrReviewUnit.mode, 'external-headless-codex');
  assert.equal(selfAuthoredPrReviewUnit.status, 'not-required');
  assert.equal(selfAuthoredPrReviewUnit.outputContract.status, 'not-required');
  assert.equal(selfAuthoredPrReviewUnit.outputContract.reasonCode, 'no-reviewable-pr-target');
  const selfAuthoredEvents = await readFile(path.join(selfAuthoredPrReviewRun.runDir, 'events.jsonl'), 'utf8');
  assert.match(selfAuthoredEvents, /self-authored-inference-unit-result-recovered/);

  const fakeFixturePrReviewCodex = path.join(tmp, 'fake-fixture-pr-review-codex');
  const fakeFixturePrReviewCodexHome = path.join(tmp, 'fake-fixture-pr-review-codex-home');
  await writeFile(fakeFixturePrReviewCodex, `#!/bin/sh
set -eu
OUT=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    OUT="$1"
  fi
  shift || true
done
RUN_DIR="$(dirname "$(dirname "$OUT")")"
RESULT="$RUN_DIR/initial-inference-units/iteration-2/05-pr-review/result.json"
mkdir -p "$CODEX_HOME/sessions/2026/05/07"
LIVE_TS="$(node -e 'console.log(new Date().toISOString())')"
cat > "$CODEX_HOME/sessions/2026/05/07/rollout-pr-review-fixture-artifact.jsonl" <<EOF
{"timestamp":"$LIVE_TS","type":"session_meta","payload":{"id":"pr-review-fixture-artifact","source":"codex-cli","cli_version":"test","model_provider":"openai","cwd":"/private/path"}}
{"timestamp":"$LIVE_TS","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"fixture artifact should not be recovered"}]}}
EOF
node - "$RESULT" <<'NODE'
const fs = require('fs');
const resultPath = process.argv[2];
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
result.mode = 'fixture';
result.status = 'not-required';
result.basis = ['This fixture-looking result must not satisfy a live PR-review gate.'];
result.outputContract = {
  schema: 'living-doc-harness-pr-review-result/v1',
  status: 'not-required',
  reasonCode: 'fixture-not-required',
  approvedActions: [],
  sideEffect: {
    type: 'github-pr-review',
    executed: false,
    reasonCode: 'fixture-not-required'
  },
  basis: result.basis
};
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\\n');
NODE
cat > "$OUT" <<'EOF'
Completed the PR-review unit without a machine-readable verdict.
EOF
printf '{"type":"done"}\\n'
exit 0
`, 'utf8');
  await chmod(fakeFixturePrReviewCodex, 0o755);
  await mkdir(fakeFixturePrReviewCodexHome, { recursive: true });
  const fixturePrReviewRun = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir: path.join(tmp, 'fixture-pr-review-runs'),
    execute: true,
    cwd: process.cwd(),
    now: '2026-05-07T06:31:21.700Z',
    codexBin: fakeFixturePrReviewCodex,
    codexHome: fakeFixturePrReviewCodexHome,
    prReviewPolicy: { mode: 'required-before-closure' },
    iteration: 2,
    lifecycleInput: {
      mode: 'continuation',
      previousRunId: 'previous-pr-review-run',
      previousIteration: 1,
      instruction: 'Run the required PR-review gate.',
      outputInputPath: previousPrOutputInputPath,
      selectedUnitType: 'pr-review',
      nextUnit: {
        unitId: 'pr-review',
        role: 'pr-review',
        reasonCode: 'pr-review-policy-gate-missing',
      },
    },
  });
  const fixturePrReviewUnit = JSON.parse(await readFile(path.join(
    fixturePrReviewRun.runDir,
    fixturePrReviewRun.contract.artifacts.prReviewInferenceUnit.result,
  ), 'utf8'));
  assert.equal(fixturePrReviewUnit.status, 'blocked');
  assert.equal(fixturePrReviewUnit.outputContract.status, 'blocked');
  assert.equal(fixturePrReviewUnit.outputContract.reasonCode, 'pr-review-non-verdict-output');
  const fixtureEvents = await readFile(path.join(fixturePrReviewRun.runDir, 'events.jsonl'), 'utf8');
  assert.doesNotMatch(fixtureEvents, /self-authored-inference-unit-result-recovered/);

  const selectedHandoffRunsDir = path.join(tmp, 'selected-handoff-pr-review-runs');
  const selectedHandoffPreviousRunDir = path.join(selectedHandoffRunsDir, 'selected-handoff-previous-run');
  await mkdir(path.join(selectedHandoffPreviousRunDir, 'artifacts'), { recursive: true });
  await mkdir(path.join(selectedHandoffPreviousRunDir, 'reviewer-inference'), { recursive: true });
  await mkdir(path.join(selectedHandoffPreviousRunDir, 'output-input'), { recursive: true });
  await writeFile(path.join(selectedHandoffPreviousRunDir, 'reviewer-inference', 'iteration-1-verdict.json'), `${JSON.stringify({
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification: 'repairable',
      reasonCode: 'pr-review-policy-gate-missing',
      closureAllowed: false,
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(selectedHandoffPreviousRunDir, 'artifacts', 'iteration-1-controller-evidence-snapshot.json'), `${JSON.stringify({
    schema: 'living-doc-harness-controller-evidence-snapshot/v1',
    hardFacts: {
      schema: 'living-doc-harness-required-hard-facts/v1',
      sourceFilesChanged: false,
      commitEvidencePresent: true,
      prReviewRequired: true,
      prReviewGate: { required: true, status: 'missing', evidencePresent: false },
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(selectedHandoffPreviousRunDir, 'artifacts', 'iteration-1-evidence.json'), `${JSON.stringify({
    schema: 'living-doc-harness-iteration-evidence/v1',
    controllerEvidenceSnapshotPath: 'artifacts/iteration-1-controller-evidence-snapshot.json',
    requiredHardFacts: {
      schema: 'living-doc-harness-required-hard-facts/v1',
      sourceFilesChanged: false,
      commitEvidencePresent: true,
      prReviewRequired: true,
      prReviewGate: { required: true, status: 'missing', evidencePresent: false },
    },
    sideEffectEvidence: {
      commit: {
        required: true,
        sha: '1234567890abcdef1234567890abcdef12345678',
        source: 'commit-intent-output-contract',
      },
    },
  }, null, 2)}\n`, 'utf8');
  const selectedHandoffOutputInputPath = path.join(selectedHandoffPreviousRunDir, 'output-input', 'iteration-1.json');
  await writeFile(selectedHandoffOutputInputPath, `${JSON.stringify({
    schema: 'living-doc-harness-output-input/v1',
    previousOutput: {
      evidencePath: 'artifacts/iteration-1-evidence.json',
      reviewerVerdictPath: 'reviewer-inference/iteration-1-verdict.json',
      classification: 'repairable',
    },
  }, null, 2)}\n`, 'utf8');
  const selectedHandoffSnapshot = await writeContractBoundInferenceUnitSnapshot({
    runDir: selectedHandoffPreviousRunDir,
    rootDir: 'inference-units',
    iteration: 1,
    sequence: 5,
    unitId: 'pr-review',
    role: 'pr-review',
    unitTypeId: 'pr-review',
    prompt: 'Evaluate the PR-review gate before closure.',
    inputContract: {
      schema: 'living-doc-harness-pr-review-input/v1',
      runId: 'selected-handoff-previous-run',
      iteration: 1,
      livingDocPath: 'tests/fixtures/minimal-doc.json',
      reviewerVerdictPath: 'reviewer-inference/iteration-1-verdict.json',
      reviewTarget: 'configured-pr-review-target',
      evidenceSnapshotPath: 'artifacts/iteration-1-controller-evidence-snapshot.json',
      requiredHardFacts: {
        schema: 'living-doc-harness-required-hard-facts/v1',
        sourceFilesChanged: false,
        commitEvidencePresent: true,
        prReviewRequired: true,
        prReviewGate: { required: true, status: 'missing', evidencePresent: false },
      },
      prReviewPolicy: {
        schema: 'living-doc-harness-pr-review-policy/v1',
        mode: 'required-before-closure',
      },
      prReviewRequired: true,
      changedFiles: [],
      commitEvidence: {
        required: true,
        sha: '1234567890abcdef1234567890abcdef12345678',
        source: 'commit-intent-output-contract',
      },
      requiredInspectionPaths: ['tests/fixtures/minimal-doc.json'],
    },
    mode: 'fixture',
    status: 'blocked',
    basis: ['Fixture placeholder before the selected unit runs.'],
    outputContract: {
      schema: 'living-doc-harness-pr-review-result/v1',
      status: 'blocked',
      approvedActions: [],
      sideEffect: {
        type: 'github-pr-review',
        executed: false,
        reasonCode: 'pr-review-policy-gate-missing',
      },
    },
    now: '2026-05-07T06:31:21.500Z',
    cwd: process.cwd(),
  });
  const selectedHandoffResultPath = selectedHandoffSnapshot.resultPath;
  const selectedHandoffResultRel = path.relative(selectedHandoffPreviousRunDir, selectedHandoffResultPath);
  const fakeSelectedHandoffPrReviewCodex = path.join(tmp, 'fake-selected-handoff-pr-review-codex');
  const fakeSelectedHandoffPrReviewCodexHome = path.join(tmp, 'fake-selected-handoff-pr-review-codex-home');
  await writeFile(fakeSelectedHandoffPrReviewCodex, `#!/bin/sh
set -eu
OUT=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    OUT="$1"
  fi
  shift || true
done
SELECTED_RESULT="${selectedHandoffResultPath}"
mkdir -p "$CODEX_HOME/sessions/2026/05/07"
LIVE_TS="$(node -e 'console.log(new Date().toISOString())')"
cat > "$CODEX_HOME/sessions/2026/05/07/rollout-pr-review-selected-handoff.jsonl" <<EOF
{"timestamp":"$LIVE_TS","type":"session_meta","payload":{"id":"pr-review-selected-handoff","source":"codex-cli","cli_version":"test","model_provider":"openai","cwd":"/private/path"}}
{"timestamp":"$LIVE_TS","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"selected handoff artifact verdict fixture"}]}}
EOF
node - "$SELECTED_RESULT" <<'NODE'
const fs = require('fs');
const resultPath = process.argv[2];
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
result.mode = 'external-headless-codex';
result.status = 'not-required';
result.basis = [
  'The PR-review unit inspected the selected handoff contract and found no reviewable PR target.'
];
result.outputContract = {
  schema: 'living-doc-harness-pr-review-result/v1',
  status: 'not-required',
  reasonCode: 'no-reviewable-pr-target',
  approvedActions: [],
  sideEffect: {
    type: 'github-pr-review',
    executed: false,
    reasonCode: 'no-reviewable-pr-target'
  },
  basis: result.basis
};
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\\n');
NODE
cat > "$OUT" <<'EOF'
Completed the PR-review unit and wrote the verdict to the selected-unit handoff artifact.
EOF
printf '{"type":"done"}\\n'
exit 0
`, 'utf8');
  await chmod(fakeSelectedHandoffPrReviewCodex, 0o755);
  await mkdir(fakeSelectedHandoffPrReviewCodexHome, { recursive: true });
  const selectedHandoffPrReviewRun = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir: selectedHandoffRunsDir,
    execute: true,
    cwd: process.cwd(),
    now: '2026-05-07T06:31:22.000Z',
    codexBin: fakeSelectedHandoffPrReviewCodex,
    codexHome: fakeSelectedHandoffPrReviewCodexHome,
    prReviewPolicy: { mode: 'required-before-closure' },
    iteration: 2,
    lifecycleInput: {
      mode: 'continuation',
      previousRunId: 'selected-handoff-previous-run',
      previousIteration: 1,
      instruction: 'Run the required PR-review gate.',
      outputInputPath: selectedHandoffOutputInputPath,
      selectedUnitType: 'pr-review',
      nextUnit: {
        unitId: 'pr-review',
        role: 'pr-review',
        reasonCode: 'pr-review-policy-gate-missing',
        resultPath: selectedHandoffResultRel,
      },
    },
  });
  const selectedHandoffPrReviewUnit = JSON.parse(await readFile(path.join(
    selectedHandoffPrReviewRun.runDir,
    selectedHandoffPrReviewRun.contract.artifacts.prReviewInferenceUnit.result,
  ), 'utf8'));
  assert.equal(selectedHandoffPrReviewUnit.status, 'not-required');
  assert.equal(selectedHandoffPrReviewUnit.outputContract.status, 'not-required');
  assert.equal(selectedHandoffPrReviewUnit.outputContract.reasonCode, 'no-reviewable-pr-target');
  const selectedHandoffEvents = await readFile(path.join(selectedHandoffPrReviewRun.runDir, 'events.jsonl'), 'utf8');
  assert.match(selectedHandoffEvents, /selected-unit-handoff-artifact/);

  const previousContinuationRunDir = path.join(tmp, 'previous-continuation-run');
  await mkdir(path.join(previousContinuationRunDir, 'artifacts'), { recursive: true });
  await mkdir(path.join(previousContinuationRunDir, 'reviewer-inference'), { recursive: true });
  await mkdir(path.join(previousContinuationRunDir, 'output-input'), { recursive: true });
  await writeFile(path.join(previousContinuationRunDir, 'reviewer-inference', 'iteration-3-verdict.json'), `${JSON.stringify({
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification: 'repairable',
      reasonCode: 'pr-review-policy-gate-blocked',
      closureAllowed: false,
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(previousContinuationRunDir, 'artifacts', 'iteration-3-controller-evidence-snapshot.json'), `${JSON.stringify({
    schema: 'living-doc-harness-controller-evidence-snapshot/v1',
    hardFacts: {
      schema: 'living-doc-harness-required-hard-facts/v1',
      prReviewRequired: true,
      prReviewGate: {
        required: true,
        status: 'blocked',
        evidencePresent: false,
        reasonCode: 'pr-review-non-verdict-output',
      },
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(previousContinuationRunDir, 'artifacts', 'iteration-3-evidence.json'), `${JSON.stringify({
    schema: 'living-doc-harness-iteration-evidence/v1',
    controllerEvidenceSnapshotPath: 'artifacts/iteration-3-controller-evidence-snapshot.json',
    requiredHardFacts: {
      schema: 'living-doc-harness-required-hard-facts/v1',
      prReviewRequired: true,
      prReviewGate: {
        required: true,
        status: 'blocked',
        evidencePresent: false,
        reasonCode: 'pr-review-non-verdict-output',
      },
    },
    prReviewPolicy: {
      schema: 'living-doc-harness-pr-review-policy/v1',
      mode: 'required-before-closure',
    },
  }, null, 2)}\n`, 'utf8');
  const previousContinuationOutputInputPath = path.join(previousContinuationRunDir, 'output-input', 'iteration-3.json');
  await writeFile(previousContinuationOutputInputPath, `${JSON.stringify({
    schema: 'living-doc-harness-output-input/v1',
    previousOutput: {
      evidencePath: 'artifacts/iteration-3-evidence.json',
      reviewerVerdictPath: 'reviewer-inference/iteration-3-verdict.json',
      classification: 'repairable',
    },
  }, null, 2)}\n`, 'utf8');
  const fakeContinuationCodex = path.join(tmp, 'fake-continuation-codex');
  const fakeContinuationCodexHome = path.join(tmp, 'fake-continuation-codex-home');
  await writeFile(fakeContinuationCodex, `#!/bin/sh
set -eu
OUT=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    OUT="$1"
  fi
  shift || true
done
mkdir -p "$CODEX_HOME/sessions/2026/05/07"
LIVE_TS="$(node -e 'console.log(new Date().toISOString())')"
cat > "$CODEX_HOME/sessions/2026/05/07/rollout-continuation-live.jsonl" <<EOF
{"timestamp":"$LIVE_TS","type":"session_meta","payload":{"id":"continuation-live","source":"codex-cli","cli_version":"test","model_provider":"openai","cwd":"/private/path"}}
{"timestamp":"$LIVE_TS","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"continuation non-verdict fixture"}]}}
EOF
cat > "$OUT" <<'EOF'
{
  "schema": "living-doc-continuation-result/v1",
  "status": "finished",
  "basis": [
    "Continuation process finished but did not emit a registered continuation verdict."
  ],
  "nextRecommendedUnitType": "worker"
}
EOF
printf '{"type":"done"}\\n'
exit 0
`, 'utf8');
  await chmod(fakeContinuationCodex, 0o755);
  await mkdir(fakeContinuationCodexHome, { recursive: true });
  const continuationRun = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir: path.join(tmp, 'continuation-runs'),
    execute: true,
    cwd: process.cwd(),
    now: '2026-05-07T06:31:25.000Z',
    codexBin: fakeContinuationCodex,
    codexHome: fakeContinuationCodexHome,
    prReviewPolicy: { mode: 'required-before-closure' },
    iteration: 4,
    lifecycleInput: {
      mode: 'continuation',
      previousRunId: 'previous-continuation-run',
      previousIteration: 3,
      instruction: 'Continue after blocked PR-review gate.',
      outputInputPath: previousContinuationOutputInputPath,
      selectedUnitType: 'continuation-inference',
      nextUnit: {
        unitId: 'continuation-inference',
        role: 'continuation',
        reasonCode: 'pr-review-non-verdict-output',
      },
    },
  });
  const continuationUnit = JSON.parse(await readFile(path.join(
    continuationRun.runDir,
    continuationRun.contract.artifacts.initialInferenceUnit.result,
  ), 'utf8'));
  assert.equal(continuationUnit.mode, 'external-headless-codex');
  assert.equal(continuationUnit.status, 'blocked');
  assert.equal(continuationUnit.outputContract.status, 'blocked');
  assert.equal(continuationUnit.outputContract.reasonCode, 'continuation-non-verdict-output');
  assert.equal(continuationUnit.outputContract.nextRecommendedUnitType, 'worker');
  const continuationValidation = JSON.parse(await readFile(path.join(
    continuationRun.runDir,
    continuationRun.contract.artifacts.initialInferenceUnit.validation,
  ), 'utf8'));
  assert.equal(continuationValidation.ok, true);

  const previousBalanceScanRunDir = path.join(tmp, 'previous-balance-scan-run');
  await mkdir(path.join(previousBalanceScanRunDir, 'artifacts'), { recursive: true });
  await mkdir(path.join(previousBalanceScanRunDir, 'handovers'), { recursive: true });
  await mkdir(path.join(previousBalanceScanRunDir, 'reviewer-inference'), { recursive: true });
  await mkdir(path.join(previousBalanceScanRunDir, 'output-input'), { recursive: true });
  await writeFile(path.join(previousBalanceScanRunDir, 'reviewer-inference', 'iteration-5-verdict.json'), `${JSON.stringify({
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification: 'repairable',
      reasonCode: 'acceptance-criteria-unproven',
      closureAllowed: false,
      selectedUnitType: 'living-doc-balance-scan',
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(previousBalanceScanRunDir, 'handovers', 'iteration-5-handover.json'), `${JSON.stringify({
    schema: 'living-doc-harness-handover/v1',
    previousIteration: 5,
    reasonCode: 'acceptance-criteria-unproven',
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(previousBalanceScanRunDir, 'artifacts', 'iteration-5-evidence.json'), `${JSON.stringify({
    schema: 'living-doc-harness-iteration-evidence/v1',
    requiredHardFacts: {
      schema: 'living-doc-harness-required-hard-facts/v1',
      acceptanceCriteriaSatisfied: false,
      objectiveReady: false,
    },
  }, null, 2)}\n`, 'utf8');
  const previousBalanceScanOutputInputPath = path.join(previousBalanceScanRunDir, 'output-input', 'iteration-5.json');
  await writeFile(previousBalanceScanOutputInputPath, `${JSON.stringify({
    schema: 'living-doc-harness-output-input/v1',
    previousOutput: {
      evidencePath: 'artifacts/iteration-5-evidence.json',
      reviewerVerdictPath: 'reviewer-inference/iteration-5-verdict.json',
      handoverPath: 'handovers/iteration-5-handover.json',
      classification: 'repairable',
    },
  }, null, 2)}\n`, 'utf8');
  const fakeBalanceScanCodex = path.join(tmp, 'fake-balance-scan-codex');
  const fakeBalanceScanCodexHome = path.join(tmp, 'fake-balance-scan-codex-home');
  await writeFile(fakeBalanceScanCodex, `#!/bin/sh
set -eu
OUT=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    OUT="$1"
  fi
  shift || true
done
mkdir -p "$CODEX_HOME/sessions/2026/05/07"
LIVE_TS="$(node -e 'console.log(new Date().toISOString())')"
cat > "$CODEX_HOME/sessions/2026/05/07/rollout-balance-scan-live.jsonl" <<EOF
{"timestamp":"$LIVE_TS","type":"session_meta","payload":{"id":"balance-scan-live","source":"codex-cli","cli_version":"test","model_provider":"openai","cwd":"/private/path"}}
{"timestamp":"$LIVE_TS","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"balance-scan blocked verdict fixture"}]}}
EOF
cat > "$OUT" <<'EOF'
{
  "schema": "living-doc-balance-scan-result/v1",
  "status": "blocked",
  "basis": [
    "Controller-owned standalone proof is required before another repair unit can help."
  ],
  "orderedSkills": [],
  "blocker": {
    "reasonCode": "controller-owned-standalone-proof-required",
    "requiredEvidence": [
      "Run controller-owned standalone proof routes."
    ]
  }
}
EOF
printf '{"type":"done"}\\n'
exit 0
`, 'utf8');
  await chmod(fakeBalanceScanCodex, 0o755);
  await mkdir(fakeBalanceScanCodexHome, { recursive: true });
  const balanceScanRun = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir: path.join(tmp, 'balance-scan-runs'),
    execute: true,
    cwd: process.cwd(),
    now: '2026-05-07T06:31:27.000Z',
    codexBin: fakeBalanceScanCodex,
    codexHome: fakeBalanceScanCodexHome,
    iteration: 6,
    lifecycleInput: {
      mode: 'continuation',
      previousRunId: 'previous-balance-scan-run',
      previousIteration: 5,
      instruction: 'Diagnose the repair order.',
      outputInputPath: previousBalanceScanOutputInputPath,
      selectedUnitType: 'living-doc-balance-scan',
      nextUnit: {
        unitId: 'living-doc-balance-scan',
        role: 'balance-scan',
        reasonCode: 'acceptance-criteria-unproven',
      },
    },
  });
  const balanceScanUnit = JSON.parse(await readFile(path.join(
    balanceScanRun.runDir,
    balanceScanRun.contract.artifacts.initialInferenceUnit.result,
  ), 'utf8'));
  assert.equal(balanceScanUnit.mode, 'external-headless-codex');
  assert.equal(balanceScanUnit.status, 'blocked');
  assert.equal(balanceScanUnit.outputContract.status, 'blocked');
  assert.equal(balanceScanUnit.outputContract.blocker.reasonCode, 'controller-owned-standalone-proof-required');
  assert.deepEqual(balanceScanUnit.outputContract.orderedSkills, []);
  const balanceScanValidation = JSON.parse(await readFile(path.join(
    balanceScanRun.runDir,
    balanceScanRun.contract.artifacts.initialInferenceUnit.validation,
  ), 'utf8'));
  assert.equal(balanceScanValidation.ok, true);

  const fakeBoundaryCodex = path.join(tmp, 'fake-boundary-codex');
  const fakeBoundaryCodexHome = path.join(tmp, 'fake-boundary-codex-home');
  await writeFile(fakeBoundaryCodex, `#!/bin/sh
set -eu
OUT=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    OUT="$1"
  fi
  shift || true
done
while IFS= read -r _line; do :; done
RUN_DIR="$(dirname "$(dirname "$OUT")")"
mkdir -p "$RUN_DIR/reviewer-inference"
printf '{}\\n' > "$RUN_DIR/reviewer-inference/worker-authored-verdict.json"
printf 'worker attempted controller artifact write\\n' > "$OUT"
printf '{"type":"done"}\\n'
exit 0
`, 'utf8');
  await chmod(fakeBoundaryCodex, 0o755);
  await mkdir(fakeBoundaryCodexHome, { recursive: true });
  await assert.rejects(
    () => createHarnessRun({
      docPath: 'tests/fixtures/minimal-doc.json',
      runsDir: path.join(tmp, 'boundary-runs'),
      execute: true,
      cwd: process.cwd(),
      now: '2026-05-07T06:31:30.000Z',
      codexBin: fakeBoundaryCodex,
      codexHome: fakeBoundaryCodexHome,
    }),
    /worker inference wrote controller-owned harness artifact paths: reviewer-inference\/worker-authored-verdict\.json/,
  );

  const gitFixture = path.join(tmp, 'commit-intent-git-fixture');
  await mkdir(gitFixture, { recursive: true });
  const commitDocPath = path.join(gitFixture, 'doc.json');
  const commitHtmlPath = path.join(gitFixture, 'doc.html');
  await writeFile(commitDocPath, `${JSON.stringify({
    docId: 'test:commit-intent',
    title: 'Commit Intent Fixture',
    objective: 'Prove commit-intent records its git side effect.',
    successCondition: 'The commit-intent output contract carries the commit sha.',
    runState: { objectiveReady: true, documentReady: true },
    sections: [
      {
        id: 'acceptance-criteria',
        convergenceType: 'acceptance-criteria',
        data: [{ id: 'criterion', name: 'Criterion', status: 'complete' }],
      },
    ],
  }, null, 2)}\n`, 'utf8');
  await writeFile(commitHtmlPath, '<!doctype html><title>Commit Intent Fixture</title>\n', 'utf8');
  spawnSync('git', ['init'], { cwd: gitFixture, stdio: 'ignore' });
  spawnSync('git', ['add', 'doc.json', 'doc.html'], { cwd: gitFixture, stdio: 'ignore' });
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial fixture'], { cwd: gitFixture, stdio: 'ignore' });
  const changedDoc = JSON.parse(await readFile(commitDocPath, 'utf8'));
  changedDoc.updated = '2026-05-07T06:32:00.000Z';
  await writeFile(commitDocPath, `${JSON.stringify(changedDoc, null, 2)}\n`, 'utf8');
  const previousRunDir = path.join(tmp, 'previous-run');
  await mkdir(path.join(previousRunDir, 'artifacts'), { recursive: true });
  await mkdir(path.join(previousRunDir, 'output-input'), { recursive: true });
  await writeFile(path.join(previousRunDir, 'artifacts', 'iteration-1-controller-evidence-snapshot.json'), `${JSON.stringify({
    schema: 'living-doc-harness-controller-evidence-snapshot/v1',
    hardFacts: { sourceFilesChanged: true },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(previousRunDir, 'artifacts', 'iteration-1-evidence.json'), `${JSON.stringify({
    schema: 'living-doc-harness-iteration-evidence/v1',
    controllerEvidenceSnapshotPath: 'artifacts/iteration-1-controller-evidence-snapshot.json',
    requiredHardFacts: {
      schema: 'living-doc-harness-required-hard-facts/v1',
      sourceFilesChanged: true,
      dirtyTrackedFiles: ['doc.json'],
      relevantUntrackedFiles: [],
      commitEvidencePresent: false,
    },
    workerEvidence: { filesChanged: ['doc.json'] },
  }, null, 2)}\n`, 'utf8');
  const previousOutputInputPath = path.join(previousRunDir, 'output-input', 'iteration-1.json');
  await writeFile(previousOutputInputPath, `${JSON.stringify({
    schema: 'living-doc-harness-output-input/v1',
    previousOutput: {
      evidencePath: 'artifacts/iteration-1-evidence.json',
      classification: 'closure-candidate',
    },
  }, null, 2)}\n`, 'utf8');
  const fakeCommitCodex = path.join(tmp, 'fake-commit-codex');
  const fakeCommitCodexHome = path.join(tmp, 'fake-commit-codex-home');
  await writeFile(fakeCommitCodex, `#!/bin/sh
set -eu
OUT=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    OUT="$1"
  fi
  shift || true
done
git add doc.json
git -c user.name=CommitIntent -c user.email=commit-intent@example.com commit -m "commit-intent fixture commit"
mkdir -p "$CODEX_HOME/sessions/2026/05/07"
LIVE_TS="$(node -e 'console.log(new Date().toISOString())')"
cat > "$CODEX_HOME/sessions/2026/05/07/rollout-commit-intent-live.jsonl" <<EOF
{"timestamp":"$LIVE_TS","type":"session_meta","payload":{"id":"commit-intent-live","source":"codex-cli","cli_version":"test","model_provider":"openai","cwd":"/private/path"}}
{"timestamp":"$LIVE_TS","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"commit-intent side effect completed"}]}}
EOF
printf 'commit-intent side effect completed\\n' > "$OUT"
printf '{"type":"done"}\\n'
exit 0
`, 'utf8');
  await chmod(fakeCommitCodex, 0o755);
  await mkdir(fakeCommitCodexHome, { recursive: true });
  const commitIntentRun = await createHarnessRun({
    docPath: 'doc.json',
    runsDir: path.join(tmp, 'commit-intent-runs'),
    execute: true,
    cwd: gitFixture,
    now: '2026-05-07T06:32:00.000Z',
    codexBin: fakeCommitCodex,
    codexHome: fakeCommitCodexHome,
    iteration: 2,
    lifecycleInput: {
      mode: 'continuation',
      previousRunId: 'previous-run',
      previousIteration: 1,
      instruction: 'Run commit-intent.',
      outputInputPath: previousOutputInputPath,
      selectedUnitType: 'commit-intent',
      nextUnit: {
        unitId: 'commit-intent',
        role: 'commit-intent',
        changedFiles: ['doc.json'],
      },
    },
  });
  const commitIntentResult = JSON.parse(await readFile(path.join(
    commitIntentRun.runDir,
    commitIntentRun.contract.artifacts.commitIntentInferenceUnit.result,
  ), 'utf8'));
  assert.equal(commitIntentResult.outputContract.schema, 'living-doc-harness-commit-intent-result/v1');
  assert.equal(commitIntentResult.outputContract.approved, true);
  assert.equal(commitIntentResult.outputContract.status, 'approved');
  assert.equal(commitIntentResult.outputContract.sideEffect.executed, true);
  assert.match(commitIntentResult.outputContract.sideEffect.sha, /^[a-f0-9]{40}$/);
  assert.deepEqual(commitIntentResult.outputContract.sideEffect.requiredChangedFiles, ['doc.json']);
  assert.deepEqual(commitIntentResult.outputContract.sideEffect.missingChangedFiles, []);

  await writeFile(path.join(gitFixture, 'unrelated.md'), 'baseline unrelated\n', 'utf8');
  spawnSync('git', ['add', 'unrelated.md'], { cwd: gitFixture, stdio: 'ignore' });
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'add unrelated fixture'], { cwd: gitFixture, stdio: 'ignore' });
  const changedDocForScopedCommit = JSON.parse(await readFile(commitDocPath, 'utf8'));
  changedDocForScopedCommit.updated = '2026-05-07T06:33:00.000Z';
  await writeFile(commitDocPath, `${JSON.stringify(changedDocForScopedCommit, null, 2)}\n`, 'utf8');
  await writeFile(path.join(gitFixture, 'unrelated.md'), 'dirty unrelated should not be committed\n', 'utf8');
  const scopedPreviousRunDir = path.join(tmp, 'scoped-previous-run');
  await mkdir(path.join(scopedPreviousRunDir, 'artifacts'), { recursive: true });
  await mkdir(path.join(scopedPreviousRunDir, 'output-input'), { recursive: true });
  await writeFile(path.join(scopedPreviousRunDir, 'artifacts', 'iteration-1-controller-evidence-snapshot.json'), `${JSON.stringify({
    schema: 'living-doc-harness-controller-evidence-snapshot/v1',
    hardFacts: {
      schema: 'living-doc-harness-required-hard-facts/v1',
      sourceFilesChanged: true,
      dirtyTrackedFiles: ['doc.json', 'unrelated.md'],
      currentRunChangedFiles: ['doc.json'],
      preExistingDirtyFiles: ['unrelated.md'],
      allowedCommitFiles: ['doc.json'],
      forbiddenCommitFiles: ['unrelated.md'],
      commitEvidencePresent: false,
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(scopedPreviousRunDir, 'artifacts', 'iteration-1-evidence.json'), `${JSON.stringify({
    schema: 'living-doc-harness-iteration-evidence/v1',
    controllerEvidenceSnapshotPath: 'artifacts/iteration-1-controller-evidence-snapshot.json',
    requiredHardFacts: {
      schema: 'living-doc-harness-required-hard-facts/v1',
      sourceFilesChanged: true,
      dirtyTrackedFiles: ['doc.json', 'unrelated.md'],
      commitEvidencePresent: false,
    },
    commitScope: {
      schema: 'living-doc-harness-commit-scope/v1',
      currentRunChangedFiles: ['doc.json'],
      preExistingDirtyFiles: ['unrelated.md'],
      allowedCommitFiles: ['doc.json'],
      forbiddenCommitFiles: ['unrelated.md'],
    },
    commitIntent: {
      mode: 'required-before-closure',
      reason: 'scope commit to current objective delta',
      allowedCommitFiles: ['doc.json'],
      forbiddenCommitFiles: ['unrelated.md'],
    },
    workerEvidence: { filesChanged: ['doc.json', 'unrelated.md'] },
  }, null, 2)}\n`, 'utf8');
  const scopedOutputInputPath = path.join(scopedPreviousRunDir, 'output-input', 'iteration-1.json');
  await writeFile(scopedOutputInputPath, `${JSON.stringify({
    schema: 'living-doc-harness-output-input/v1',
    previousOutput: {
      evidencePath: 'artifacts/iteration-1-evidence.json',
      classification: 'closure-candidate',
    },
  }, null, 2)}\n`, 'utf8');
  const fakeBroadCommitCodex = path.join(tmp, 'fake-broad-commit-codex');
  const fakeBroadCommitCodexHome = path.join(tmp, 'fake-broad-commit-codex-home');
  await writeFile(fakeBroadCommitCodex, `#!/bin/sh
set -eu
OUT=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    OUT="$1"
  fi
  shift || true
done
git add doc.json unrelated.md
git -c user.name=CommitIntent -c user.email=commit-intent@example.com commit -m "broad commit should be blocked"
mkdir -p "$CODEX_HOME/sessions/2026/05/07"
LIVE_TS="$(node -e 'console.log(new Date().toISOString())')"
cat > "$CODEX_HOME/sessions/2026/05/07/rollout-broad-commit-live.jsonl" <<EOF
{"timestamp":"$LIVE_TS","type":"session_meta","payload":{"id":"broad-commit-live","source":"codex-cli","cli_version":"test","model_provider":"openai","cwd":"/private/path"}}
{"timestamp":"$LIVE_TS","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"broad commit side effect completed"}]}}
EOF
printf 'broad commit side effect completed\\n' > "$OUT"
printf '{"type":"done"}\\n'
exit 0
`, 'utf8');
  await chmod(fakeBroadCommitCodex, 0o755);
  await mkdir(fakeBroadCommitCodexHome, { recursive: true });
  const broadCommitRun = await createHarnessRun({
    docPath: 'doc.json',
    runsDir: path.join(tmp, 'broad-commit-runs'),
    execute: true,
    cwd: gitFixture,
    now: '2026-05-07T06:33:00.000Z',
    codexBin: fakeBroadCommitCodex,
    codexHome: fakeBroadCommitCodexHome,
    iteration: 2,
    lifecycleInput: {
      mode: 'continuation',
      previousRunId: 'scoped-previous-run',
      previousIteration: 1,
      instruction: 'Run scoped commit-intent.',
      outputInputPath: scopedOutputInputPath,
      selectedUnitType: 'commit-intent',
      nextUnit: {
        unitId: 'commit-intent',
        role: 'commit-intent',
      },
    },
  });
  const broadCommitResult = JSON.parse(await readFile(path.join(
    broadCommitRun.runDir,
    broadCommitRun.contract.artifacts.commitIntentInferenceUnit.result,
  ), 'utf8'));
  assert.equal(broadCommitResult.outputContract.schema, 'living-doc-harness-commit-intent-result/v1');
  assert.equal(broadCommitResult.outputContract.approved, false);
  assert.equal(broadCommitResult.outputContract.status, 'blocked');
  assert.equal(broadCommitResult.outputContract.sideEffect.executed, true);
  assert.deepEqual(broadCommitResult.outputContract.sideEffect.requiredChangedFiles, ['doc.json']);
  assert.deepEqual(broadCommitResult.outputContract.sideEffect.missingChangedFiles, []);
  assert.deepEqual(broadCommitResult.outputContract.sideEffect.extraCommittedFiles, ['unrelated.md']);
  assert.deepEqual(broadCommitResult.outputContract.sideEffect.forbiddenCommittedFiles, ['unrelated.md']);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness runner contract spec: all assertions passed');
