import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-iteration-'));

try {
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
  });
  assert.equal(result.schema, 'living-doc-harness-iteration-finalization/v1');
  assert.equal(result.classification, 'closed');
  assert.equal(result.terminalKind, 'closed');
  assert.equal(result.proofValid, true);

  const proof = await readFile(result.proofPath, 'utf8');
  assert.match(proof, /living-doc-harness-iteration-proof\/v1/);
  assert.match(proof, /"evidenceBundleWritten": "pass"/);
  assert.match(proof, /"nativeTraceInspected": "pass"/);
  assert.match(proof, /native.summary.json/);
  const dashboard = await readFile(result.dashboardPath, 'utf8');
  assert.match(dashboard, /data-recommendation="close"/);
  assert.equal(dashboard.includes('PRIVATE_TRACE_CONTENT_SHOULD_NOT_LEAK'), false);
  const events = await readFile(path.join(run.runDir, 'events.jsonl'), 'utf8');
  assert.match(events, /harness-iteration-finalized/);

  const cliRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'cli-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T10:22:00.000Z',
  });
  const cliEvidencePath = path.join(tmp, 'cli-evidence.json');
  const cliTracePath = path.join(tmp, 'cli-native.jsonl');
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
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /"classification": "closed"/);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness iteration contract spec: all assertions passed');
