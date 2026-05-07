import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  assert.deepEqual(contract.process.args.slice(0, 4), ['exec', '--json', '-C', process.cwd()]);
  assert.equal(typeof contract.process.env.CODEX_HOME, 'string');
  assert.ok(contract.process.env.CODEX_HOME.length > 0);
  assert.ok(contract.process.args.includes('-o'));
  assert.equal(contract.process.args.at(-1), '-');
  assert.equal(contract.process.stdin, 'prompt.md');
  assert.match(contract.livingDoc.sourceHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(contract.livingDoc.objectiveHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(contract.artifacts.nativeTraceRefs, []);

  assert.equal(state.schema, 'living-doc-harness-state/v1');
  assert.equal(state.lifecycleStage, 'initial-objective-bearing');
  assert.equal(state.status, 'prepared');
  assert.equal(state.nextAction, 'run with --execute to start codex exec');

  assert.match(events, /"event":"run-created"/);
  assert.match(events, /"event":"codex-command-prepared"/);
  assert.match(events, /"event":"execution-skipped"/);
  assert.match(prompt, /You are running inside the standalone agentic living-doc harness/);

  const fakeBin = path.join(tmp, 'fake-codex');
  const fakeCodexHome = path.join(tmp, 'fake-codex-home');
  await writeFile(fakeBin, `#!/bin/sh
mkdir -p "$CODEX_HOME/sessions/2026/05/07"
cat > "$CODEX_HOME/sessions/2026/05/07/rollout-live.jsonl" <<'EOF'
{"timestamp":"2026-05-07T06:31:00.000Z","type":"session_meta","payload":{"id":"live-test","source":"codex-cli","cli_version":"test","model_provider":"openai","cwd":"/private/path"}}
{"timestamp":"2026-05-07T06:31:01.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"PRIVATE_LIVE_TRACE_CONTENT"}]}}
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
  assert.equal(executed.contract.artifacts.nativeTraceRefs.length, 1);
  assert.equal(executed.contract.artifacts.nativeTraceRefs[0].rawPayloadIncluded, false);
  assert.equal(JSON.stringify(executed.contract).includes('PRIVATE_LIVE_TRACE_CONTENT'), false);
  const executeEvents = await readFile(path.join(executed.runDir, 'events.jsonl'), 'utf8');
  assert.match(executeEvents, /"event":"native-trace-discovery-written"/);
  assert.match(executeEvents, /"event":"native-trace-summary-attached"/);
  const traceDiscovery = JSON.parse(await readFile(path.join(executed.runDir, 'trace-discovery.json'), 'utf8'));
  assert.match(traceDiscovery.codexHomeHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(traceDiscovery).includes(fakeCodexHome), false);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness runner contract spec: all assertions passed');
