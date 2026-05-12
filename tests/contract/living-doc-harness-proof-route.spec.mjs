import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  const blockedRecursiveLifecycle = await runProofRoute({
    runDir,
    iteration: 1,
    route: {
      id: 'recursive-lifecycle',
      kind: 'command',
      command: `${process.execPath} scripts/living-doc-harness-lifecycle.mjs run tests/fixtures/minimal-doc.json --execute --execute-proof-routes`,
    },
    cwd: process.cwd(),
    docPath: 'tests/fixtures/minimal-doc.json',
    now: '2026-05-10T07:22:00.000Z',
  });

  assert.equal(blockedRecursiveLifecycle.status, 'blocked');
  assert.equal(blockedRecursiveLifecycle.failureClass, 'recursive-lifecycle-proof-route');
  assert.equal(blockedRecursiveLifecycle.reasonCode, 'recursive-lifecycle-proof-route');
  assert.equal(blockedRecursiveLifecycle.commandResult, null);
  assert.equal(blockedRecursiveLifecycle.controllerGuard.blocked, true);
  assert.match(await readFile(path.join(runDir, blockedRecursiveLifecycle.stderrPath), 'utf8'), /Blocked proof route before execution/);

  const fakeLifecycleScript = path.join(tmp, 'fake-living-doc-harness-lifecycle.mjs');
  await writeFile(fakeLifecycleScript, "console.log('finite-lifecycle-proof-ok');\n", 'utf8');

  const allowedFiniteLifecycleProof = await runProofRoute({
    runDir,
    iteration: 1,
    route: {
      id: 'finite-lifecycle-proof',
      kind: 'command',
      command: `${process.execPath} ${fakeLifecycleScript} run tests/fixtures/minimal-doc.json --execute`,
    },
    cwd: process.cwd(),
    docPath: 'tests/fixtures/minimal-doc.json',
    now: '2026-05-10T07:23:00.000Z',
  });

  assert.equal(allowedFiniteLifecycleProof.status, 'passed');
  assert.equal(allowedFiniteLifecycleProof.reasonCode, null);
  assert.equal(allowedFiniteLifecycleProof.controllerGuard, null);
  assert.equal(await readFile(path.join(runDir, allowedFiniteLifecycleProof.stdoutPath), 'utf8'), 'finite-lifecycle-proof-ok\n');

  const events = await readFile(path.join(runDir, 'events.jsonl'), 'utf8');
  assert.match(events, /proof-route-result-written/);
  assert.match(events, /fixture-command/);
  assert.match(events, /fixture-failure/);
  assert.match(events, /recursive-lifecycle/);
  assert.match(events, /finite-lifecycle-proof/);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness proof route contract spec: all assertions passed');
