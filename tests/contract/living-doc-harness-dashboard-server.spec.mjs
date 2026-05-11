import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';

import { createHarnessRun } from '../../scripts/living-doc-harness-runner.mjs';
import { createDashboardServer } from '../../scripts/living-doc-harness-dashboard-server.mjs';

function request(server, pathname, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = Readable.from(body ? [Buffer.from(body)] : []);
    req.method = method;
    req.url = pathname;
    req.headers = headers;
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = (key, value) => {
      res.headers[String(key).toLowerCase()] = value;
    };
    res.getHeader = (key) => res.headers[String(key).toLowerCase()];
    res.writeHead = (status, responseHeaders = {}) => {
      res.statusCode = status;
      for (const [key, value] of Object.entries(responseHeaders)) res.setHeader(key, value);
    };
    res.end = (chunk) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      Writable.prototype.end.call(res);
    };
    res.on('finish', () => {
      resolve({
        status: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      });
    });
    res.on('error', reject);
    req.on('error', reject);
    server.emit('request', req, res);
  });
}

async function jsonFetch(server, pathname, options) {
  const result = await request(server, pathname, options);
  return { response: { status: result.status }, body: JSON.parse(result.text) };
}

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('timed out waiting for condition');
}

class FakeUpgradeSocket extends EventEmitter {
  chunks = [];
  destroyed = false;

  write(chunk) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return true;
  }

  end() {
    this.destroyed = true;
    this.emit('close');
  }

  destroy() {
    this.destroyed = true;
    this.emit('close');
  }
}

function parseServerWebSocketOutput(chunks) {
  let buffer = Buffer.concat(chunks);
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) return { header: '', messages: [] };
  const header = buffer.subarray(0, headerEnd).toString('utf8');
  buffer = buffer.subarray(headerEnd + 4);
  const messages = [];
  while (buffer.length >= 2) {
    const opcode = buffer[0] & 0x0f;
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) break;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) break;
      length = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }
    if (buffer.length < offset + length) break;
    const payload = buffer.subarray(offset, offset + length);
    buffer = buffer.subarray(offset + length);
    if (opcode === 1) messages.push(JSON.parse(payload.toString('utf8')));
  }
  return { header, messages };
}

async function readWebSocketMessages(server, pathname, { count = 6 } = {}) {
  const socket = new FakeUpgradeSocket();
  const req = new EventEmitter();
  req.url = pathname;
  req.headers = {
    'sec-websocket-key': 'ZGFzaGJvYXJkLXRlc3Qta2V5',
    upgrade: 'websocket',
    connection: 'Upgrade',
  };
  server.emit('upgrade', req, socket, Buffer.alloc(0));
  const parsed = await waitFor(() => {
    const result = parseServerWebSocketOutput(socket.chunks);
    return result.messages.length >= count ? result : null;
  });
  socket.end();
  assert.match(parsed.header, /^HTTP\/1\.1 101 /);
  return parsed.messages;
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-dashboard-server-'));
const runsDir = path.join(tmp, 'runs');
const evidenceDir = path.join(tmp, 'evidence');
let server;

try {
  const prepared = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir,
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-07T12:00:00.000Z',
  });

  server = createDashboardServer({
    cwd: process.cwd(),
    runsDir,
    evidenceDir,
    startHarnessRun: async ({ docPath, cwd, runsDir, now }) => {
      const runId = `ldh-${now.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${path.basename(docPath, '.json')}`;
      const runDir = path.resolve(cwd, runsDir, runId);
      await mkdir(runDir, { recursive: true });
      await writeFile(path.join(runDir, 'contract.json'), `${JSON.stringify({
        schema: 'living-doc-harness-contract/v1',
        runId,
        status: 'finished',
      }, null, 2)}\n`, 'utf8');
      return { runId, runDir, supervisorPid: 12345 };
    },
    startLifecycle: async ({ docPath, cwd, runsDir, now, executeProofRoutes, toolProfile }) => {
      const resultId = `ldhl-${now.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${path.basename(docPath, '.json')}`;
      const lifecycleDir = path.resolve(cwd, runsDir, resultId);
      await mkdir(lifecycleDir, { recursive: true });
      if (now === '2026-05-07T12:15:00.000Z') {
        const runId = 'ldh-20260507T121501Z-minimal-doc';
        const runDir = path.resolve(cwd, runsDir, runId);
        await mkdir(path.join(runDir, 'codex-turns'), { recursive: true });
        await writeFile(path.join(runDir, 'contract.json'), `${JSON.stringify({
          schema: 'living-doc-harness-run/v1',
          runId,
          createdAt: '2026-05-07T12:15:01.000Z',
          status: 'starting',
          livingDoc: {
            sourcePath: docPath,
            renderedHtml: 'tests/fixtures/minimal-doc.html',
          },
          process: {
            pid: 34567,
            exitCode: null,
            toolProfile: {
              name: toolProfile,
              isolation: 'ignore-user-config',
              sandboxMode: 'danger-full-access',
              mcpMode: 'allowlist',
              mcpAllowlist: ['living_doc_compositor'],
            },
          },
          artifacts: {
            workerInferenceUnit: {
              inputContract: 'contract.json',
              prompt: 'prompt.md',
              codexEvents: 'codex-turns/codex-events.jsonl',
              stderr: 'codex-turns/codex-stderr.log',
              lastMessage: 'codex-turns/last-message.txt',
            },
          },
        }, null, 2)}\n`, 'utf8');
        await writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
          schema: 'living-doc-harness-state/v1',
          runId,
          updatedAt: '2026-05-07T12:15:01.000Z',
          status: 'running',
          docPath,
          nextAction: 'wait-for-codex-process',
        }, null, 2)}\n`, 'utf8');
        await writeFile(path.join(runDir, 'prompt.md'), 'Fixture active lifecycle prompt.\n', 'utf8');
        await writeFile(path.join(runDir, 'codex-turns', 'codex-events.jsonl'), '{"type":"thread.started","thread_id":"active-lifecycle-fixture"}\n{"type":"item.started","item":{"type":"command_execution","status":"in_progress","command":"ACTIVE-LIFECYCLE-WORKER-MARKER"}}\n', 'utf8');
        await writeFile(path.join(runDir, 'codex-turns', 'codex-stderr.log'), '', 'utf8');
        return { resultId, lifecycleDir, supervisorPid: 23457, executeProofRoutes, toolProfile };
      }
      await writeFile(path.join(lifecycleDir, 'lifecycle-result.json'), `${JSON.stringify({
        schema: 'living-doc-harness-lifecycle-result/v1',
        resultId,
        createdAt: now,
        docPath,
        lifecycleDir,
        iterationCount: 1,
        finalState: { kind: 'closed', reason: 'dashboard route fixture' },
        iterations: [],
      }, null, 2)}\n`, 'utf8');
      return { resultId, lifecycleDir, supervisorPid: 23456, executeProofRoutes, toolProfile };
    },
    writeBundle: async ({ runDir, outDir }) => {
      await mkdir(path.join(outDir, path.basename(runDir)), { recursive: true });
      const bundlePath = path.join(outDir, path.basename(runDir), 'bundle.json');
      const summaryPath = path.join(outDir, path.basename(runDir), 'summary.md');
      const bundle = {
        schema: 'living-doc-harness-evidence-bundle/v1',
        runId: path.basename(runDir),
        recommendation: 'fixture',
      };
      await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
      await writeFile(summaryPath, '# Fixture bundle\n', 'utf8');
      return { bundle, bundlePath, summaryPath };
    },
  });

  const health = await jsonFetch(server, '/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.schema, 'living-doc-harness-dashboard-health/v1');

  const page = await request(server, '/');
  const html = page.text;
  assert.equal(page.status, 200);
  assert.match(html, /Living Doc Harness Live Dashboard/);
  assert.match(html, /\/api\/runs/);
  assert.match(html, /Lifecycle Graph/);
  assert.match(html, /Standalone replacement dashboard/);
  assert.match(html, /\/api\/lifecycles/);
  assert.match(html, /data-graph-node-id/);
  assert.match(html, /graph-edge-label-group/);
  assert.match(html, /graph-edge-label-box/);
  assert.match(html, /localStorage/);
  assert.match(html, /startGraphNodeDrag/);
  assert.match(html, /resetGraphLayout/);
  assert.match(html, /living-doc-harness-graph-layout:v8:/);
  assert.match(html, /DEFAULT_GRAPH_BOARD/);
  assert.match(html, /width:2400px/);
  assert.match(html, /height:1400px/);
  assert.match(html, /grid-template-columns:390px/);
  assert.match(html, /lifecycle-card-head/);
  assert.match(html, /lifecycle-status/);
  assert.match(html, /inspector-header/);
  assert.match(html, /inspector-action/);
  assert.match(html, /Operated living doc/);
  assert.doesNotMatch(html, /Run Control/);
  assert.doesNotMatch(html, /Start Lifecycle/);
  assert.doesNotMatch(html, /id="startRun"/);
  assert.doesNotMatch(html, /id="runs"/);
  assert.doesNotMatch(html, /id="detail"/);
  assert.doesNotMatch(html, /id="graphTimeline"/);
  assert.doesNotMatch(html, /graph-tick/);
  assert.doesNotMatch(html, /evidence-dock/);

  const runs = await jsonFetch(server, `/api/runs`);
  assert.equal(runs.response.status, 200);
  assert.equal(runs.body.schema, 'living-doc-harness-dashboard-runs/v1');
  assert.equal(runs.body.runCount, 1);
  assert.equal(runs.body.runs[0].runId, prepared.runId);
  assert.equal(runs.body.runs[0].process.isolatedFromUserSession, true);
  assert.equal(runs.body.runs[0].privacy.rawNativeTraceIncluded, false);

  const runDetail = await jsonFetch(server, `/api/runs/${encodeURIComponent(prepared.runId)}`);
  assert.equal(runDetail.response.status, 200);
  assert.equal(runDetail.body.runId, prepared.runId);
  assert.equal(runDetail.body.artifacts.contract, 'contract.json');

  const tail = await jsonFetch(server, `/api/runs/${encodeURIComponent(prepared.runId)}/tail?lines=20`);
  assert.equal(tail.response.status, 200);
  assert.equal(tail.body.schema, 'living-doc-harness-run-tail/v1');
  assert.equal(tail.body.privacy.localOperatorOnly, true);
  assert.equal(tail.body.privacy.rawNativeTraceIncluded, false);
  assert.equal(tail.body.runEvents.some((line) => line.includes('run-created')), true);

  const repairUnitDir = path.join(prepared.runDir, 'repair-skills', 'iteration-1', '01-live-repair-unit');
  const docUpdateUnitDir = path.join(prepared.runDir, 'repair-skills', 'iteration-1', '02-doc-update-unit');
  const readinessUnitDir = path.join(prepared.runDir, 'repair-skills', 'iteration-1', '03-objective-execution-readiness');
  await mkdir(repairUnitDir, { recursive: true });
  await mkdir(docUpdateUnitDir, { recursive: true });
  await mkdir(readinessUnitDir, { recursive: true });
  await writeFile(path.join(repairUnitDir, 'prompt.md'), 'hidden local prompt\n', 'utf8');
  await writeFile(path.join(repairUnitDir, 'input-contract.json'), `${JSON.stringify({
    schema: 'living-doc-repair-skill-chain-input/v1',
    unitRole: 'repair-skill',
    skill: 'live-repair-unit',
    sequence: 1,
    requiredInspectionPaths: ['/tmp/required-evidence.json'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(repairUnitDir, 'codex-events.jsonl'), '{"type":"thread.started"}\n', 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'prompt.md'), 'hidden local update prompt\n', 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'input-contract.json'), `${JSON.stringify({
    schema: 'living-doc-repair-skill-chain-input/v1',
    unitRole: 'repair-skill',
    skill: 'doc-update-unit',
    sequence: 2,
    requiredInspectionPaths: ['/tmp/required-evidence.json'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'codex-events.jsonl'), '{"type":"thread.started"}\n', 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'result.json'), `${JSON.stringify({
    schema: 'living-doc-harness-inference-unit-result/v1',
    unitId: 'doc-update-unit',
    role: 'repair-skill',
    status: 'repaired',
    outputContract: {
      schema: 'living-doc-repair-skill-result/v1',
      skill: 'doc-update-unit',
      sequence: 2,
      status: 'repaired',
      changedFiles: [
        'tests/fixtures/minimal-doc.json',
        'tests/fixtures/minimal-doc.html',
      ],
      commitSha: 'abcdef1234567890',
      commitMessage: 'Repair minimal living doc fixture',
      nextRecommendedAction: 'continue-repair-chain',
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'validation.json'), `${JSON.stringify({ ok: true }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(readinessUnitDir, 'prompt.md'), 'hidden local readiness prompt\n', 'utf8');
  await writeFile(path.join(readinessUnitDir, 'input-contract.json'), `${JSON.stringify({
    schema: 'living-doc-repair-skill-chain-input/v1',
    unitRole: 'repair-skill',
    skill: 'objective-execution-readiness',
    sequence: 3,
    requiredInspectionPaths: ['/tmp/required-evidence.json'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(readinessUnitDir, 'codex-events.jsonl'), '{"type":"thread.started"}\n', 'utf8');
  await writeFile(path.join(readinessUnitDir, 'result.json'), `${JSON.stringify({
    schema: 'living-doc-harness-inference-unit-result/v1',
    unitId: 'objective-execution-readiness',
    role: 'repair-skill',
    status: 'aligned',
    outputContract: {
      schema: 'living-doc-repair-skill-result/v1',
      skill: 'objective-execution-readiness',
      sequence: 3,
      status: 'aligned',
      changedFiles: [],
      commitIntent: {
        required: false,
        reason: 'Readiness inspection changed no files in the dashboard graph fixture.',
        message: '',
        body: [],
        changedFiles: [],
      },
      nextRecommendedAction: 'continue-repair-chain',
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(readinessUnitDir, 'validation.json'), `${JSON.stringify({ ok: true }, null, 2)}\n`, 'utf8');
  const repairChainResultPath = path.join(prepared.runDir, 'repair-skills', 'iteration-1', 'repair-chain-result.json');
  await writeFile(repairChainResultPath, `${JSON.stringify({
    schema: 'living-doc-repair-skill-chain-result/v1',
    runId: prepared.runId,
    iteration: 1,
    createdAt: '2026-05-07T12:00:08.000Z',
    status: 'complete',
    livingDocPath: 'tests/fixtures/minimal-doc.json',
    renderedHtmlPath: 'tests/fixtures/minimal-doc.html',
    skillResults: [
      {
        skill: 'doc-update-unit',
        sequence: 2,
        status: 'repaired',
        resultPath: 'repair-skills/iteration-1/02-doc-update-unit/result.json',
        validationPath: 'repair-skills/iteration-1/02-doc-update-unit/validation.json',
        changedFiles: [
          'tests/fixtures/minimal-doc.json',
          'tests/fixtures/minimal-doc.html',
        ],
        commitPolicy: {
          mode: 'commit-intent-only',
          gitCommitAllowed: false,
        },
        commitIntent: {
          required: true,
          reason: 'Repair-chain fixture deferred the commit because repair units run under commit-intent-only policy.',
          message: 'Repair minimal living doc fixture from repair chain',
          body: [
            'This body comes from repair-chain-result.json, not from the per-unit result fixture.',
          ],
          changedFiles: [
            'tests/fixtures/minimal-doc.json',
            'tests/fixtures/minimal-doc.html',
          ],
        },
      },
      {
        skill: 'objective-execution-readiness',
        sequence: 3,
        status: 'aligned',
        resultPath: 'repair-skills/iteration-1/03-objective-execution-readiness/result.json',
        validationPath: 'repair-skills/iteration-1/03-objective-execution-readiness/validation.json',
        changedFiles: [],
        commitPolicy: {
          mode: 'commit-intent-only',
          gitCommitAllowed: false,
        },
        commitIntent: {
          required: false,
          reason: 'No files changed during readiness in the repair-chain fixture.',
          message: '',
          body: [],
          changedFiles: [],
        },
      },
    ],
    nextRecommendedAction: 'continue-repair-chain',
  }, null, 2)}\n`, 'utf8');
  setTimeout(() => {
    writeFile(path.join(repairUnitDir, 'codex-events.jsonl'), '{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"command_execution","command":"cat /tmp/required-evidence.json","status":"completed","exit_code":0}}\n', 'utf8');
  }, 100);

  const repairUnits = await jsonFetch(server, `/api/runs/${encodeURIComponent(prepared.runId)}/repair-units`);
  assert.equal(repairUnits.response.status, 200);
  assert.equal(repairUnits.body.schema, 'living-doc-harness-repair-units/v1');
  assert.equal(repairUnits.body.unitCount, 3);
  assert.equal(repairUnits.body.units[0].unitKey, 'iteration-1/01-live-repair-unit');
  assert.equal(repairUnits.body.units[0].status, 'running');
  assert.equal(repairUnits.body.units[0].hasCodexEvents, true);
  assert.deepEqual(repairUnits.body.units[1].changedFiles, ['tests/fixtures/minimal-doc.json', 'tests/fixtures/minimal-doc.html']);
  assert.equal(repairUnits.body.units[1].commitSha, 'abcdef1234567890');
  assert.equal(repairUnits.body.units[2].commitIntent.required, false);
  assert.equal(repairUnits.body.privacy.rawPromptIncluded, false);

  const liveRepairTail = await waitFor(async () => {
    const result = await jsonFetch(server, `/api/runs/${encodeURIComponent(prepared.runId)}/repair-units/iteration-1/01-live-repair-unit/tail?lines=20`);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.schema, 'living-doc-harness-repair-unit-tail/v1');
    assert.equal(result.body.privacy.localOperatorOnly, true);
    assert.equal(result.body.privacy.rawPromptIncluded, false);
    return result.body.codexEvents.some((line) => line.includes('/tmp/required-evidence.json')) ? result.body : null;
  });
  assert.equal(liveRepairTail.status, 'running');
  assert.equal(liveRepairTail.result.length, 0);

  const reviewerDir = path.join(prepared.runDir, 'reviewer-inference');
  const outputInputDir = path.join(prepared.runDir, 'output-input');
  const terminalDir = path.join(prepared.runDir, 'terminal');
  await mkdir(reviewerDir, { recursive: true });
  await mkdir(outputInputDir, { recursive: true });
  await mkdir(terminalDir, { recursive: true });
  const reviewerInputPath = path.join(reviewerDir, 'iteration-1-input.json');
  const reviewerPromptPath = path.join(reviewerDir, 'iteration-1-prompt.md');
  const reviewerVerdictPath = path.join(reviewerDir, 'iteration-1-verdict.json');
  const terminalPath = path.join(terminalDir, 'iteration-1-continuation-required.json');
  const outputInputPath = path.join(outputInputDir, 'iteration-1.json');
  await writeFile(reviewerPromptPath, 'Inspect the raw worker JSONL and classify the lifecycle transition.\n', 'utf8');
  await writeFile(reviewerInputPath, `${JSON.stringify({
    schema: 'living-doc-harness-reviewer-input/v1',
    runId: prepared.runId,
    iteration: 1,
    rawWorkerJsonlPaths: ['/tmp/raw-worker.jsonl'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(reviewerVerdictPath, `${JSON.stringify({
    schema: 'living-doc-harness-reviewer-verdict/v1',
    runId: prepared.runId,
    iteration: 1,
    createdAt: '2026-05-07T12:00:10.000Z',
    mode: 'fixture',
    reviewerInputPath: 'reviewer-inference/iteration-1-input.json',
    promptPath: 'reviewer-inference/iteration-1-prompt.md',
    codexEventsPath: 'reviewer-inference/iteration-1-codex-events.jsonl',
    verdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification: 'repairable',
        reasonCode: 'graph-fixture-repairable',
        closureAllowed: false,
      },
      nextIteration: {
        allowed: true,
        mode: 'repair',
      },
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(terminalPath, `${JSON.stringify({
    id: 'blocker-graph-fixture',
    kind: 'continuation-required',
    status: 'repair-resumed',
    reasonCode: 'graph-fixture-blocked',
    loopMayContinue: true,
    nextAction: 'continue through the next contract-bound inference unit',
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(prepared.runDir, 'terminal-states.jsonl'), `${JSON.stringify({
    id: 'blocker-graph-fixture',
    kind: 'continuation-required',
    status: 'repair-resumed',
    reasonCode: 'graph-fixture-blocked',
    loopMayContinue: true,
    createdAt: '2026-05-07T12:00:20.000Z',
  })}\n`, 'utf8');
  await writeFile(path.join(prepared.runDir, 'blockers.jsonl'), `${JSON.stringify({
    id: 'blocker-graph-fixture',
    reasonCode: 'graph-fixture-blocked',
    owningLayer: 'dashboard-graph',
    issueRef: '#209',
    unblockCriteria: ['prove graph nodes are artifact-derived'],
  })}\n`, 'utf8');
  await writeFile(outputInputPath, `${JSON.stringify({
    schema: 'living-doc-harness-output-input/v1',
    runId: prepared.runId,
    iteration: 1,
    previousOutput: {
      classification: 'true-block',
      terminalKind: 'continuation-required',
      reviewerVerdictPath: 'reviewer-inference/iteration-1-verdict.json',
      terminalPath: 'terminal/iteration-1-continuation-required.json',
    },
    nextAction: {
      action: 'start-next-worker-iteration',
      allowed: true,
      reason: 'Graph fixture continuation state.',
    },
  }, null, 2)}\n`, 'utf8');
  const graphLifecycleId = 'ldhl-20260507T120030Z-dashboard-graph-fixture';
  const graphLifecycleDir = path.join(runsDir, graphLifecycleId);
  await mkdir(graphLifecycleDir, { recursive: true });
  await writeFile(path.join(graphLifecycleDir, 'lifecycle-result.json'), `${JSON.stringify({
    schema: 'living-doc-harness-lifecycle-result/v1',
    resultId: graphLifecycleId,
    createdAt: '2026-05-07T12:00:30.000Z',
    docPath: 'tests/fixtures/minimal-doc.json',
    lifecycleDir: graphLifecycleDir,
    iterationCount: 1,
    finalState: {
      kind: 'continuation-required',
      reason: 'Graph fixture continuation state.',
      runId: prepared.runId,
    },
    iterations: [
      {
        iteration: 1,
        runId: prepared.runId,
        runDir: prepared.runDir,
        classification: 'true-block',
        terminalKind: 'continuation-required',
        nextAction: {
          action: 'start-next-worker-iteration',
          allowed: true,
        },
        outputInputPath,
        reviewerVerdictPath,
        repairSkillResultPath: repairChainResultPath,
        proofValid: true,
      },
    ],
  }, null, 2)}\n`, 'utf8');

  const lifecycles = await jsonFetch(server, `/api/lifecycles`);
  assert.equal(lifecycles.response.status, 200);
  assert.equal(lifecycles.body.schema, 'living-doc-harness-dashboard-lifecycles/v1');
  assert.equal(lifecycles.body.lifecycles.some((item) => item.resultId === graphLifecycleId), true);

  const graph = await jsonFetch(server, `/api/lifecycles/${encodeURIComponent(graphLifecycleId)}/graph`);
  assert.equal(graph.response.status, 200);
  assert.equal(graph.body.schema, 'living-doc-harness-inference-graph/v1');
  assert.equal(graph.body.privacy.localOperatorOnly, true);
  assert.equal(graph.body.privacy.rawPromptIncluded, false);
  assert.equal(graph.body.nodes.some((node) => node.role === 'worker'), true);
  assert.equal(graph.body.nodes.some((node) => node.role === 'reviewer'), true);
  assert.equal(graph.body.nodes.some((node) => node.role === 'living-doc' && node.artifactPaths.livingDocPath === 'tests/fixtures/minimal-doc.json'), true);
  assert.equal(graph.body.nodes.some((node) => node.role === 'repair-skill' && node.status === 'running'), true);
  assert.equal(graph.body.nodes.some((node) => node.type === 'terminal-state'), true);
  assert.equal(graph.body.nodes.some((node) => node.type === 'blocker' && node.meta.issueRef === '#209'), true);
  assert.equal(graph.body.nodes.some((node) => node.type === 'issue' && node.label === '#209'), true);
  const workerGraphNode = graph.body.nodes.find((node) => node.id === 'iteration-1-worker');
  assert.equal(workerGraphNode.meta.toolProfile.name, 'local-harness');
  assert.equal(workerGraphNode.meta.toolProfile.sandboxMode, 'danger-full-access');
  assert.equal(graph.body.edges.some((edge) => edge.from.includes('worker') && edge.to.includes('reviewer') && edge.contract.inputContractPath && edge.contract.evidencePaths.includes('/tmp/raw-worker.jsonl')), true);
  assert.equal(graph.body.edges.some((edge) => edge.to.includes('repair') && edge.contract.codexEventsPath), true);
  assert.equal(graph.body.edges.some((edge) => edge.to === 'operated-living-doc' && edge.label === 'commit abcdef1234' && edge.contract.commitSha === 'abcdef1234567890' && edge.contract.changedFiles.includes('tests/fixtures/minimal-doc.json')), true);
  const docChangeEdge = graph.body.edges.find((edge) => edge.id === 'repair-unit-to-living-doc-1-2');
  assert.equal(docChangeEdge.contract.commitIntent.source, 'repair-chain-result');
  assert.equal(docChangeEdge.contract.commitIntent.required, true);
  assert.equal(docChangeEdge.contract.commitIntent.reason, 'Repair-chain fixture deferred the commit because repair units run under commit-intent-only policy.');
  assert.equal(docChangeEdge.contract.commitIntent.message, 'Repair minimal living doc fixture from repair chain');
  assert.deepEqual(docChangeEdge.contract.commitIntent.body, ['This body comes from repair-chain-result.json, not from the per-unit result fixture.']);
  assert.deepEqual(docChangeEdge.contract.commitIntent.changedFiles, ['tests/fixtures/minimal-doc.json', 'tests/fixtures/minimal-doc.html']);
  const readinessNode = graph.body.nodes.find((node) => node.id === 'iteration-1-repair-3');
  assert.equal(readinessNode.meta.commitIntent.source, 'repair-chain-result');
  assert.equal(readinessNode.meta.commitIntent.required, false);
  assert.equal(readinessNode.meta.commitIntent.reason, 'No files changed during readiness in the repair-chain fixture.');

  const graphTail = await jsonFetch(server, `/api/lifecycles/${encodeURIComponent(graphLifecycleId)}/nodes/iteration-1-repair-1/tail?lines=20`);
  assert.equal(graphTail.response.status, 200);
  assert.equal(graphTail.body.schema, 'living-doc-harness-graph-node-tail/v1');
  assert.equal(graphTail.body.nodeId, 'iteration-1-repair-1');
  assert.equal(graphTail.body.privacy.localOperatorOnly, true);
  assert.equal(graphTail.body.privacy.rawPromptIncluded, false);
  assert.equal(graphTail.body.codexEvents.some((line) => line.includes('/tmp/required-evidence.json')), true);

  const history = await jsonFetch(server, `/api/lifecycles/${encodeURIComponent(graphLifecycleId)}/events`);
  assert.equal(history.response.status, 200);
  assert.equal(history.body.schema, 'living-doc-harness-dashboard-event-history/v1');
  assert.equal(history.body.privacy.localOperatorOnly, true);
  assert.equal(history.body.privacy.supervisingChatStateIncluded, false);
  assert.equal(history.body.events.some((event) => event.type === 'lifecycle_snapshot'), true);
  assert.equal(history.body.events.some((event) => event.type === 'lifecycle_started'), true);
  assert.equal(history.body.events.some((event) => event.type === 'lifecycle_blocked' && event.payload.blockers?.some((blocker) => blocker.reasonCode === 'graph-fixture-blocked')), true);
  assert.equal(history.body.events.some((event) => event.type === 'inference_unit_started' && event.payload.nodeId === 'iteration-1-repair-1'), true);
  assert.equal(history.body.events.some((event) => event.type === 'inference_unit_finished' && event.payload.nodeId === 'iteration-1-reviewer'), true);
  assert.equal(history.body.events.some((event) => event.type === 'graph_update' && event.payload.graph.activeInferenceUnitId === 'iteration-1-repair-1'), true);
  assert.equal(history.body.events.some((event) => event.type === 'contract_handoff' && event.payload.contract.inputContractPath), true);
  assert.equal(history.body.events.some((event) => event.type === 'artifact_update' && event.payload.path), true);
  assert.equal(history.body.events.some((event) => event.type === 'log_append' && event.payload.nodeId === 'iteration-1-repair-1'), true);

  const wsMessages = await readWebSocketMessages(server, `/ws/lifecycles/${encodeURIComponent(graphLifecycleId)}`, { count: 16 });
  assert.equal(wsMessages[0].type, 'stream_opened');
  assert.equal(wsMessages[0].payload.eventSource, 'local-harness-artifacts');
  assert.equal(wsMessages.some((event) => event.type === 'lifecycle_snapshot'), true);
  assert.equal(wsMessages.some((event) => event.type === 'lifecycle_started'), true);
  assert.equal(wsMessages.some((event) => event.type === 'lifecycle_blocked'), true);
  assert.equal(wsMessages.some((event) => event.type === 'inference_unit_started'), true);
  assert.equal(wsMessages.some((event) => event.type === 'inference_unit_finished'), true);
  assert.equal(wsMessages.some((event) => event.type === 'graph_update'), true);
  assert.equal(wsMessages.every((event) => event.privacy?.localOperatorOnly === true), true);
  assert.equal(wsMessages.every((event) => event.privacy?.supervisingChatStateIncluded === false), true);

  const created = await jsonFetch(server, `/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      docPath: 'tests/fixtures/minimal-doc.json',
      execute: false,
    }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.schema, 'living-doc-harness-dashboard-run-created/v1');
  assert.equal(created.body.executed, false);
  assert.match(created.body.runId, /^ldh-/);

  const fakeBin = path.join(tmp, 'fake-codex');
  const fakeCodexHome = path.join(tmp, 'fake-codex-home');
  await writeFile(fakeBin, `#!/bin/sh
mkdir -p "$CODEX_HOME/sessions/2026/05/07"
LIVE_TS="$(node -e 'console.log(new Date().toISOString())')"
cat > "$CODEX_HOME/sessions/2026/05/07/rollout-dashboard-live.jsonl" <<EOF
{"timestamp":"$LIVE_TS","type":"session_meta","payload":{"id":"dashboard-live","source":"codex-cli","cli_version":"test","model_provider":"openai","cwd":"/private/path"}}
EOF
printf '{"type":"done"}\\n'
exit 0
`, 'utf8');
  await chmod(fakeBin, 0o755);
  await mkdir(fakeCodexHome, { recursive: true });

  const started = await jsonFetch(server, `/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      docPath: 'tests/fixtures/minimal-doc.json',
      execute: true,
      now: '2026-05-07T12:10:00.000Z',
      codexBin: fakeBin,
      codexHome: fakeCodexHome,
    }),
  });
  assert.equal(started.response.status, 202);
  assert.equal(started.body.schema, 'living-doc-harness-dashboard-run-started/v1');
  assert.equal(started.body.background, true);

  const backgroundContractPath = path.join(runsDir, started.body.runId, 'contract.json');
  await waitFor(async () => {
    try {
      const contract = JSON.parse(await readFile(backgroundContractPath, 'utf8'));
      return contract.status === 'finished' ? contract : null;
    } catch {
      return null;
    }
  });

  const activeLifecycle = await jsonFetch(server, `/api/lifecycles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      docPath: 'tests/fixtures/minimal-doc.json',
      now: '2026-05-07T12:15:00.000Z',
      execute: true,
      executeProofRoutes: true,
      toolProfile: 'local-harness',
    }),
  });
  assert.equal(activeLifecycle.response.status, 202);
  assert.equal(activeLifecycle.body.schema, 'living-doc-harness-dashboard-lifecycle-started/v1');
  assert.equal(activeLifecycle.body.resultId, 'ldhl-20260507T121500Z-minimal-doc');

  const activeLifecycles = await jsonFetch(server, `/api/lifecycles`);
  assert.equal(activeLifecycles.response.status, 200);
  const activeLifecycleListItem = activeLifecycles.body.lifecycles.find((item) => item.resultId === activeLifecycle.body.resultId);
  assert.equal(activeLifecycleListItem.active, true);
  assert.equal(activeLifecycleListItem.finalState.kind, 'running');
  assert.equal(activeLifecycleListItem.supervisorPid, 23457);

  const activeGraph = await jsonFetch(server, `/api/lifecycles/${encodeURIComponent(activeLifecycle.body.resultId)}/graph`);
  assert.equal(activeGraph.response.status, 200);
  assert.equal(activeGraph.body.schema, 'living-doc-harness-inference-graph/v1');
  assert.equal(activeGraph.body.finalState.kind, 'running');
  assert.equal(activeGraph.body.activeInferenceUnitId, 'iteration-1-worker');
  assert.equal(activeGraph.body.nodes.some((node) => node.id === 'lifecycle-controller' && node.status === 'running'), true);
  assert.equal(activeGraph.body.nodes.some((node) => node.id === 'iteration-1-worker' && ['starting', 'running', 'prepared'].includes(node.status)), true);
  assert.equal(activeGraph.body.edges.some((edge) => edge.id === 'lifecycle-to-worker-1'), true);

  const activeTail = await jsonFetch(server, `/api/lifecycles/${encodeURIComponent(activeLifecycle.body.resultId)}/nodes/iteration-1-worker/tail?lines=20`);
  assert.equal(activeTail.response.status, 200);
  assert.equal(activeTail.body.codexEvents.some((line) => line.includes('ACTIVE-LIFECYCLE-WORKER-MARKER')), true);

  const activeHistory = await jsonFetch(server, `/api/lifecycles/${encodeURIComponent(activeLifecycle.body.resultId)}/events`);
  assert.equal(activeHistory.response.status, 200);
  assert.equal(activeHistory.body.events.some((event) => event.type === 'lifecycle_snapshot'), true);
  assert.equal(activeHistory.body.events.some((event) => event.type === 'log_append' && event.payload.nodeId === 'iteration-1-worker'), true);

  const activeWsMessages = await readWebSocketMessages(server, `/ws/lifecycles/${encodeURIComponent(activeLifecycle.body.resultId)}`, { count: 5 });
  assert.equal(activeWsMessages[0].type, 'stream_opened');
  assert.equal(activeWsMessages.some((event) => event.type === 'lifecycle_snapshot'), true);
  assert.equal(activeWsMessages.some((event) => event.type === 'log_append' && event.payload.nodeId === 'iteration-1-worker'), true);

  const activeLifecyclePath = path.join(runsDir, activeLifecycle.body.resultId, 'active-lifecycle.json');
  const stoppedActiveLifecycle = JSON.parse(await readFile(activeLifecyclePath, 'utf8'));
  stoppedActiveLifecycle.status = 'stopped-by-supervisor';
  stoppedActiveLifecycle.finalState = {
    kind: 'process-defect-stopped',
    reasonCode: 'fixture-stopped',
    activeInferenceUnitAtStop: 'iteration-1-worker',
  };
  await writeFile(activeLifecyclePath, `${JSON.stringify(stoppedActiveLifecycle, null, 2)}\n`, 'utf8');
  const stoppedLifecycles = await jsonFetch(server, `/api/lifecycles`);
  const stoppedLifecycleListItem = stoppedLifecycles.body.lifecycles.find((item) => item.resultId === activeLifecycle.body.resultId);
  assert.equal(stoppedLifecycleListItem.active, false);
  assert.equal(stoppedLifecycleListItem.finalState.kind, 'process-defect-stopped');
  const stoppedGraph = await jsonFetch(server, `/api/lifecycles/${encodeURIComponent(activeLifecycle.body.resultId)}/graph`);
  assert.equal(stoppedGraph.body.activeInferenceUnitId, null);
  assert.equal(stoppedGraph.body.nodes.some((node) => node.id === 'iteration-1-worker' && node.status === 'process-defect-stopped'), true);

  const lifecycleSequencePath = path.join(tmp, 'dashboard-lifecycle-sequence.json');
  await writeFile(lifecycleSequencePath, `${JSON.stringify({
    schema: 'living-doc-harness-lifecycle-evidence-sequence/v1',
    iterations: [
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Dashboard lifecycle controller fixture reached closure.',
        reviewerVerdict: {
          schema: 'living-doc-harness-stop-verdict/v1',
          stopVerdict: {
            classification: 'closed',
            reasonCode: 'dashboard-lifecycle-fixture',
            confidence: 'high',
            closureAllowed: true,
            basis: ['Dashboard lifecycle fixture provided a closed verdict.'],
          },
          nextIteration: {
            allowed: false,
            mode: 'none',
            instruction: 'Stop.',
          },
        },
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const lifecycle = await jsonFetch(server, `/api/lifecycles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      docPath: 'tests/fixtures/minimal-doc.json',
      evidenceSequencePath: lifecycleSequencePath,
      now: '2026-05-07T12:20:00.000Z',
      execute: false,
      executeRepairSkills: false,
      executeProofRoutes: true,
      toolProfile: 'local-harness',
    }),
  });
  assert.equal(lifecycle.response.status, 202);
  assert.equal(lifecycle.body.schema, 'living-doc-harness-dashboard-lifecycle-started/v1');
  assert.match(lifecycle.body.resultId, /^ldhl-/);
  assert.equal(lifecycle.body.background, true);
  assert.equal(lifecycle.body.toolProfile, 'local-harness');
  assert.equal(lifecycle.body.executeProofRoutes, true);
  const lifecycleResultPath = path.join(runsDir, lifecycle.body.resultId, 'lifecycle-result.json');
  const lifecycleResult = await waitFor(async () => {
    try {
      return JSON.parse(await readFile(lifecycleResultPath, 'utf8'));
    } catch {
      return null;
    }
  });
  assert.equal(lifecycleResult.finalState.kind, 'closed');
  assert.equal(lifecycleResult.iterationCount, 1);
  const lifecycleHistory = await jsonFetch(server, `/api/lifecycles/${encodeURIComponent(lifecycle.body.resultId)}/events`);
  assert.equal(lifecycleHistory.response.status, 200);
  assert.equal(lifecycleHistory.body.events.some((event) => event.type === 'lifecycle_closed'), true);

  const bundle = await jsonFetch(server, `/api/evidence/bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: prepared.runId }),
  });
  assert.equal(bundle.response.status, 200);
  assert.equal(bundle.body.schema, 'living-doc-harness-dashboard-bundle-written/v1');
  assert.equal(bundle.body.runId, prepared.runId);
  assert.match(bundle.body.bundlePath, /bundle\.json$/);
} finally {
  if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness dashboard server contract spec: all assertions passed');
