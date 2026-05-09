import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runContractBoundInferenceUnit } from '../../scripts/living-doc-harness-inference-unit.mjs';

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

  const fakeCodex = path.join(tmp, 'fake-codex.mjs');
  await writeFile(fakeCodex, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const outputPath = args[args.indexOf('-o') + 1];
const inspectedPath = ${JSON.stringify(inspectedPath)};

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
      status: 'no-op',
      basis: ['fake codex inspected the required evidence path before exit'],
      outputContract: { schema: 'fake/v1', ok: true },
    }, null, 2));
    console.log(JSON.stringify({ type: 'turn.completed' }));
  }, 500);
});
`, 'utf8');
  await chmod(fakeCodex, 0o755);

  const runDir = path.join(tmp, 'run');
  const eventsPath = path.join(runDir, 'inference-units', 'iteration-1', '01-streaming-unit', 'codex-events.jsonl');
  let settled = false;
  const resultPromise = runContractBoundInferenceUnit({
    runDir,
    unitId: 'streaming-unit',
    role: 'repair-skill',
    prompt: 'Inspect the required path and return JSON.',
    inputContract: {
      schema: 'test/v1',
      requiredInspectionPaths: [inspectedPath],
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
  assert.equal(result.result.status, 'no-op');
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness inference unit contract spec: all assertions passed');
