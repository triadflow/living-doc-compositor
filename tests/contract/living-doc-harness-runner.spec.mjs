import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createHarnessRun } from '../../scripts/living-doc-harness-runner.mjs';

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
  assert.deepEqual(workerUnitInput.requiredInspectionPaths, ['tests/fixtures/minimal-doc.json']);
  assert.equal(workerUnitInput.toolProfile.name, 'local-harness');
  assert.equal(workerUnitInput.toolProfile.sandboxMode, 'danger-full-access');

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
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness runner contract spec: all assertions passed');
