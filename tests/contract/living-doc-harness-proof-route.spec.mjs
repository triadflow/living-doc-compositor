import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runProofRoute } from '../../scripts/living-doc-harness-proof-route.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-proof-route-'));

try {
  const runDir = path.join(tmp, 'ldh-proof-route');
  const passed = await runProofRoute({
    runDir,
    iteration: 1,
    route: {
      id: 'fixture-command',
      kind: 'command',
      command: `${process.execPath} -e "console.log('proof-ok')"`,
      required: true,
    },
    cwd: process.cwd(),
    now: '2026-05-10T07:20:00.000Z',
  });

  assert.equal(passed.schema, 'living-doc-harness-proof-route-result/v1');
  assert.equal(passed.status, 'passed');
  assert.equal(passed.proofRoute, 'command');
  assert.equal(passed.closureAllowedContribution, 'pass');
  assert.match(passed.resultPath, /proof-routes\/iteration-1\/fixture-command\/result\.json$/);
  const passedResult = JSON.parse(await readFile(passed.resultPath, 'utf8'));
  assert.equal(passedResult.commandResult.exitCode, 0);
  assert.equal(await readFile(path.join(runDir, passed.stdoutPath), 'utf8'), 'proof-ok\n');

  const failed = await runProofRoute({
    runDir,
    iteration: 1,
    route: {
      id: 'fixture-failure',
      kind: 'command',
      command: `${process.execPath} -e "process.exit(7)"`,
    },
    cwd: process.cwd(),
    now: '2026-05-10T07:21:00.000Z',
  });

  assert.equal(failed.status, 'failed');
  assert.equal(failed.failureClass, 'test-command-failed');
  assert.equal(failed.closureAllowedContribution, 'fail');

  const events = await readFile(path.join(runDir, 'events.jsonl'), 'utf8');
  assert.match(events, /proof-route-result-written/);
  assert.match(events, /fixture-command/);
  assert.match(events, /fixture-failure/);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness proof route contract spec: all assertions passed');
