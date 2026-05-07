import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHarnessRun } from '../../scripts/living-doc-harness-runner.mjs';
import { attachTraceSummaryToRun, discoverCodexTraceFiles, summarizeCodexTrace } from '../../scripts/living-doc-harness-trace-reader.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-trace-reader-'));

try {
  const codexHome = path.join(tmp, '.codex');
  const sessionsDir = path.join(codexHome, 'sessions', '2026', '05', '07');
  await mkdir(sessionsDir, { recursive: true });
  const tracePath = path.join(sessionsDir, 'rollout-test.jsonl');
  const privatePrompt = 'PRIVATE_OBJECTIVE_SHOULD_NOT_APPEAR';
  const privateCwd = '/Users/example/private/project';
  const lines = [
    {
      timestamp: '2026-05-07T06:40:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'session-1',
        cwd: privateCwd,
        source: 'codex-cli',
        cli_version: 'test',
        model_provider: 'openai',
      },
    },
    {
      timestamp: '2026-05-07T06:40:01.000Z',
      type: 'turn_context',
      payload: {
        turn_id: 'turn-1',
        model: 'gpt-test',
        user_instructions: privatePrompt,
      },
    },
    {
      timestamp: '2026-05-07T06:40:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: privatePrompt }],
      },
    },
    {
      timestamp: '2026-05-07T06:40:03.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell',
        arguments: privatePrompt,
      },
    },
  ];
  await writeFile(tracePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

  const discovered = await discoverCodexTraceFiles({ codexHome, limit: 5 });
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].path, tracePath);

  const summary = await summarizeCodexTrace(tracePath);
  assert.equal(summary.schema, 'living-doc-harness-native-trace-summary/v1');
  assert.equal(summary.traceRef, tracePath);
  assert.match(summary.traceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(summary.lineCount, 4);
  assert.equal(summary.invalidJsonLines.length, 0);
  assert.equal(summary.session.id, 'session-1');
  assert.equal(summary.session.source, 'codex-cli');
  assert.match(summary.session.cwdHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(summary.eventTypes.session_meta, 1);
  assert.equal(summary.eventTypes.response_item, 2);
  assert.equal(summary.payloadTypes.message, 1);
  assert.equal(summary.responseItemTypes.function_call, 1);
  assert.equal(summary.toolCallNames.shell, 1);
  assert.equal(summary.turnModels['gpt-test'], 1);
  assert.equal(summary.privacy.rawPayloadIncluded, false);
  assert.equal(summary.privacy.contentFieldsOmitted, true);

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(privatePrompt), false);
  assert.equal(serialized.includes(privateCwd), false);

  const outPath = path.join(tmp, 'summary.json');
  await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const reread = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(reread.traceHash, summary.traceHash);

  const run = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir: path.join(tmp, 'runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T06:41:00.000Z',
  });
  const attached = await attachTraceSummaryToRun({
    runDir: run.runDir,
    tracePath,
    now: '2026-05-07T06:42:00.000Z',
  });
  const runContract = JSON.parse(await readFile(path.join(run.runDir, 'contract.json'), 'utf8'));
  const runState = JSON.parse(await readFile(path.join(run.runDir, 'state.json'), 'utf8'));
  const runEvents = await readFile(path.join(run.runDir, 'events.jsonl'), 'utf8');
  assert.equal(runContract.artifacts.nativeTraceRefs.length, 1);
  assert.equal(runContract.artifacts.nativeTraceRefs[0].traceHash, summary.traceHash);
  assert.equal(runContract.artifacts.nativeTraceRefs[0].rawPayloadIncluded, false);
  assert.equal(runState.nativeTraceRefs.length, 1);
  assert.match(runEvents, /"event":"native-trace-summary-attached"/);
  assert.equal(JSON.stringify(attached).includes(privatePrompt), false);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness trace reader contract spec: all assertions passed');
