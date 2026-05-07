import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness runner contract spec: all assertions passed');
