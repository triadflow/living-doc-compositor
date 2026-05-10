// Standalone living-doc harness runner.
//
// This is the command boundary for running Codex headless from a living-doc
// objective. By default it creates the durable run directory without launching
// Codex; pass --execute to spawn `codex exec` as a separate process.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { attachTraceSummaryToRun, discoverCodexTraceFiles, summarizeCodexTrace } from './living-doc-harness-trace-reader.mjs';
import { writeContractBoundInferenceUnitSnapshot } from './living-doc-harness-inference-unit.mjs';
import { resolveInferenceToolProfile } from './living-doc-harness-tool-profile.mjs';
import { DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES, normalizeAllowedInferenceUnitTypes } from './living-doc-harness-inference-unit-types.mjs';

const __filename = fileURLToPath(import.meta.url);

const DEFAULT_RUNS_DIR = '.living-doc-runs';

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function slug(value) {
  return String(value || 'living-doc')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'living-doc';
}

function timestampForId(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function appendJsonl(filePath, event) {
  await writeFile(filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
}

function buildPrompt(doc, { docPath, runId, lifecycleInput = null }) {
  const lines = [
    'You are running inside the standalone agentic living-doc harness.',
    '',
    'Objective:',
    doc.objective || '(missing objective)',
    '',
    'Success condition:',
    doc.successCondition || '(missing success condition)',
    '',
    'Rules:',
    '- Treat the living doc JSON as the source of objective state.',
    '- Do not claim closure unless acceptance criteria and proof gates are satisfied.',
    '- If blocked, make the blocker explicit with required evidence or decision.',
    '- Do not run harness finalizer, reviewer, evidence-dashboard, or lifecycle-control commands from inside this worker process; the lifecycle controller owns review, transition, proof, dashboard, and next-iteration decisions after the worker exits.',
    '',
    'Run context:',
    `- runId: ${runId}`,
    `- livingDocPath: ${docPath}`,
    '',
    'Work from the living doc objective and produce concrete source-system changes or a clear blocker.',
  ];
  if (lifecycleInput) {
    lines.push(
      '',
      'Lifecycle input from previous iteration:',
      `- mode: ${lifecycleInput.mode || 'unknown'}`,
      `- previousRunId: ${lifecycleInput.previousRunId || 'none'}`,
      `- previousIteration: ${lifecycleInput.previousIteration || 'none'}`,
      `- instruction: ${lifecycleInput.instruction || 'none'}`,
      `- handoverPath: ${lifecycleInput.handoverPath || 'none'}`,
      `- outputInputPath: ${lifecycleInput.outputInputPath || 'none'}`,
      '',
      'Use this lifecycle input as the next controlled input. Continue while the lifecycle input is actionable.',
    );
  }
  return lines.join('\n');
}

function buildCodexCommand({ cwd, lastMessagePath, codexBin = 'codex', toolProfile }) {
  return {
    command: codexBin,
    args: [
      'exec',
      '--json',
      ...arr(toolProfile?.codexArgs),
      '-C',
      cwd,
      '-o',
      lastMessagePath,
      '-',
    ],
    stdin: 'prompt.md',
  };
}

function buildWorkerInputContract({ doc, docPath, runId, lifecycleInput = null, toolProfile = null, allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES }) {
  return {
    schema: 'living-doc-worker-inference-input/v1',
    runId,
    role: 'worker',
    runConfig: {
      schema: 'living-doc-harness-run-inference-config/v1',
      allowedUnitTypes,
      initialUnitType: 'worker',
    },
    livingDocPath: docPath,
    objective: doc.objective || null,
    successCondition: doc.successCondition || null,
    lifecycleInput: lifecycleInput ? {
      mode: lifecycleInput.mode || null,
      previousRunId: lifecycleInput.previousRunId || null,
      previousIteration: lifecycleInput.previousIteration || null,
      instruction: lifecycleInput.instruction || null,
      handoverPath: lifecycleInput.handoverPath || null,
      outputInputPath: lifecycleInput.outputInputPath || null,
    } : null,
    requiredInspectionPaths: [docPath],
    toolProfile,
    forbiddenActions: [
      'run lifecycle finalizer from inside worker inference',
      'run reviewer inference from inside worker inference',
      'decide terminal closure without reviewer inference',
    ],
  };
}

function timestampInWindow(value, { startedAt, finishedAt, skewMs = 5000 }) {
  const timestamp = new Date(value || '').getTime();
  if (!Number.isFinite(timestamp)) return false;
  const start = new Date(startedAt).getTime() - skewMs;
  const finish = new Date(finishedAt).getTime() + skewMs;
  return timestamp >= start && timestamp <= finish;
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (command !== 'start') {
    throw new Error('usage: living-doc-harness-runner.mjs start <doc.json> [--runs-dir <dir>] [--execute]');
  }
  const docPath = args.shift();
  if (!docPath) {
    throw new Error('usage: living-doc-harness-runner.mjs start <doc.json> [--runs-dir <dir>] [--execute]');
  }

  const options = {
    docPath,
    runsDir: DEFAULT_RUNS_DIR,
    execute: false,
    cwd: process.cwd(),
    now: new Date().toISOString(),
    codexBin: 'codex',
    codexHome: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    traceLimit: 10,
    iteration: 1,
    toolProfile: 'local-harness',
    allowedUnitTypes: DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
  };

  while (args.length) {
    const flag = args.shift();
    if (flag === '--runs-dir') {
      const value = args.shift();
      if (!value) throw new Error('--runs-dir requires a value');
      options.runsDir = value;
    } else if (flag === '--execute') {
      options.execute = true;
    } else if (flag === '--now') {
      const value = args.shift();
      if (!value) throw new Error('--now requires a value');
      options.now = value;
    } else if (flag === '--codex-bin') {
      const value = args.shift();
      if (!value) throw new Error('--codex-bin requires a value');
      options.codexBin = value;
    } else if (flag === '--codex-home') {
      const value = args.shift();
      if (!value) throw new Error('--codex-home requires a value');
      options.codexHome = value;
    } else if (flag === '--trace-limit') {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 1) throw new Error('--trace-limit requires an integer >= 1');
      options.traceLimit = value;
    } else if (flag === '--iteration') {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 1) throw new Error('--iteration requires an integer >= 1');
      options.iteration = value;
    } else if (flag === '--tool-profile') {
      const value = args.shift();
      if (!value) throw new Error('--tool-profile requires a value');
      options.toolProfile = value;
    } else if (flag === '--allowed-unit-types') {
      const value = args.shift();
      if (!value) throw new Error('--allowed-unit-types requires a comma-separated value');
      options.allowedUnitTypes = value.split(',').map((item) => item.trim()).filter(Boolean);
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }

  return options;
}

export async function createHarnessRun({
  docPath,
  runsDir = DEFAULT_RUNS_DIR,
  execute = false,
  cwd = process.cwd(),
  now = new Date().toISOString(),
  codexBin = 'codex',
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  traceLimit = 10,
  lifecycleInput = null,
  iteration = 1,
  toolProfile = 'local-harness',
  allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
} = {}) {
  if (!docPath) throw new Error('docPath is required');

  const absoluteDocPath = path.resolve(cwd, docPath);
  const rawDoc = await readFile(absoluteDocPath, 'utf8');
  const doc = JSON.parse(rawDoc);
  const runId = `ldh-${timestampForId(now)}-${slug(doc.docId || doc.title || path.basename(docPath, '.json'))}`;
  const runDir = path.resolve(cwd, runsDir, runId);
  const artifactsDir = path.join(runDir, 'artifacts');
  const turnsDir = path.join(runDir, 'codex-turns');
  const tracesDir = path.join(runDir, 'traces');

  await mkdir(artifactsDir, { recursive: true });
  await mkdir(turnsDir, { recursive: true });
  await mkdir(tracesDir, { recursive: true });

  const relativeDocPath = path.relative(cwd, absoluteDocPath) || docPath;
  const lastMessagePath = path.join(turnsDir, 'last-message.txt');
  const codexEventsPath = path.join(turnsDir, 'codex-events.jsonl');
  const codexStderrPath = path.join(turnsDir, 'codex-stderr.log');
  const resolvedToolProfile = resolveInferenceToolProfile(toolProfile, { cwd });
  const normalizedAllowedUnitTypes = normalizeAllowedInferenceUnitTypes(allowedUnitTypes);
  const prompt = `${buildPrompt(doc, { docPath: relativeDocPath, runId, lifecycleInput })}

Harness tool profile:
${JSON.stringify(resolvedToolProfile, null, 2)}
`;
  const workerInputContract = buildWorkerInputContract({
    doc,
    docPath: relativeDocPath,
    runId,
    lifecycleInput,
    toolProfile: resolvedToolProfile,
    allowedUnitTypes: normalizedAllowedUnitTypes,
  });
  const promptPath = path.join(runDir, 'prompt.md');
  const absoluteCodexHome = path.resolve(cwd, codexHome);
  const codexCommand = buildCodexCommand({ cwd, lastMessagePath, codexBin, toolProfile: resolvedToolProfile });

  const contract = {
    schema: 'living-doc-harness-run/v1',
    runId,
    createdAt: now,
    mode: 'standalone-headless',
    status: execute ? 'starting' : 'prepared',
    livingDoc: {
      sourcePath: relativeDocPath,
      sourceHash: sha256(rawDoc),
      objectiveHash: sha256(`${doc.objective || ''}\n${doc.successCondition || ''}`),
      renderedHtml: relativeDocPath.replace(/\.json$/i, '.html'),
    },
    process: {
      isolatedFromUserSession: true,
      command: codexCommand.command,
      args: codexCommand.args,
      stdin: codexCommand.stdin,
      cwd,
      env: {
        CODEX_HOME: absoluteCodexHome,
        LIVING_DOC_HARNESS_ROLE: 'worker',
      },
      toolProfile: {
        name: resolvedToolProfile.name,
        isolation: resolvedToolProfile.isolation,
        sandboxMode: resolvedToolProfile.sandboxMode,
        mcpMode: resolvedToolProfile.mcpMode,
        mcpAllowlist: resolvedToolProfile.mcpAllowlist,
        mcpDenylist: resolvedToolProfile.mcpDenylist,
        pluginDenylist: resolvedToolProfile.pluginDenylist,
      },
      pid: null,
      exitCode: null,
      startedAt: null,
      finishedAt: null,
    },
    runConfig: {
      schema: 'living-doc-harness-run-inference-config/v1',
      allowedUnitTypes: normalizedAllowedUnitTypes,
      initialUnitType: 'worker',
      registrySchema: 'living-doc-harness-inference-unit-type-registry/v1',
    },
    artifacts: {
      state: 'state.json',
      events: 'events.jsonl',
      prompt: 'prompt.md',
      codexEvents: path.relative(runDir, codexEventsPath),
      codexStderr: path.relative(runDir, codexStderrPath),
      lastMessage: path.relative(runDir, lastMessagePath),
      nativeTraceRefs: [],
      traceDiscovery: 'trace-discovery.json',
    },
    lifecycleInput: lifecycleInput ? {
      mode: lifecycleInput.mode || null,
      previousRunId: lifecycleInput.previousRunId || null,
      previousIteration: lifecycleInput.previousIteration || null,
      instruction: lifecycleInput.instruction || null,
      handoverPath: lifecycleInput.handoverPath || null,
      outputInputPath: lifecycleInput.outputInputPath || null,
    } : null,
  };

  const state = {
    schema: 'living-doc-harness-state/v1',
    runId,
    updatedAt: now,
    lifecycleStage: 'initial-objective-bearing',
    status: execute ? 'starting' : 'prepared',
    docPath: relativeDocPath,
    objectiveHash: contract.livingDoc.objectiveHash,
    latestIteration: 0,
    nextAction: execute ? 'wait-for-codex-process' : 'run with --execute to start codex exec',
  };

  await writeFile(promptPath, `${prompt}\n`, 'utf8');
  await writeJson(path.join(runDir, 'contract.json'), contract);
  await writeJson(path.join(runDir, 'state.json'), state);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'run-created',
    at: now,
    runId,
    docPath: relativeDocPath,
    objectiveHash: contract.livingDoc.objectiveHash,
  });
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: execute ? 'codex-process-starting' : 'codex-command-prepared',
    at: now,
    runId,
    command: codexCommand,
  });

  const initialWorkerUnit = await writeContractBoundInferenceUnitSnapshot({
    runDir,
    iteration,
    sequence: 1,
    unitId: 'worker',
    role: 'worker',
    unitTypeId: 'worker',
    allowedUnitTypes: normalizedAllowedUnitTypes,
    prompt,
    inputContract: workerInputContract,
    mode: execute ? 'external-headless-codex-starting' : 'prepared',
    status: execute ? 'starting' : 'prepared',
    basis: [
      execute
        ? 'Worker inference unit prepared before launching the externally managed headless Codex process.'
        : 'Worker inference unit prepared without launching Codex because execute is false.',
    ],
    outputContract: {
      schema: 'living-doc-worker-output/v1',
      status: execute ? 'starting' : 'prepared',
      runId,
      livingDocPath: relativeDocPath,
      lifecycleInput: workerInputContract.lifecycleInput,
      nextAuthority: 'reviewer-inference',
    },
    now,
    cwd,
    toolProfile: resolvedToolProfile,
  });
  contract.artifacts.workerInferenceUnit = {
    result: path.relative(runDir, initialWorkerUnit.resultPath),
    validation: path.relative(runDir, initialWorkerUnit.validationPath),
    inputContract: path.relative(runDir, initialWorkerUnit.inputContractPath),
    prompt: path.relative(runDir, initialWorkerUnit.promptPath),
    codexEvents: path.relative(runDir, initialWorkerUnit.codexEventsPath),
    lastMessage: path.relative(runDir, initialWorkerUnit.lastMessagePath),
    stderr: path.relative(runDir, initialWorkerUnit.stderrPath),
  };
  await writeJson(path.join(runDir, 'contract.json'), contract);

  if (!execute) {
    await appendJsonl(path.join(runDir, 'events.jsonl'), {
      event: 'execution-skipped',
      at: now,
      runId,
      reason: 'execute flag was false',
    });
    return { runId, runDir, contract, state, executed: false };
  }

  const processStartedAt = new Date().toISOString();
  const child = spawn(codexCommand.command, codexCommand.args, {
    cwd,
    env: {
      ...process.env,
      CODEX_HOME: absoluteCodexHome,
      LIVING_DOC_HARNESS_ROLE: 'worker',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  contract.process.pid = child.pid;
  contract.process.startedAt = processStartedAt;
  state.status = 'running';
  state.updatedAt = new Date().toISOString();
  await writeJson(path.join(runDir, 'contract.json'), contract);
  await writeJson(path.join(runDir, 'state.json'), state);
  child.stdin.end(prompt);
  child.stdout.pipe(await import('node:fs').then((fs) => fs.createWriteStream(codexEventsPath, { flags: 'a' })));
  child.stderr.pipe(await import('node:fs').then((fs) => fs.createWriteStream(codexStderrPath, { flags: 'a' })));

  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
  });
  const finishedAt = new Date().toISOString();
  contract.status = exitCode === 0 ? 'finished' : 'failed';
  contract.process.exitCode = exitCode;
  contract.process.finishedAt = finishedAt;
  state.status = contract.status;
  state.updatedAt = finishedAt;
  state.nextAction = 'inspect native inference logs and emit iteration proof handover';
  await writeJson(path.join(runDir, 'contract.json'), contract);
  await writeJson(path.join(runDir, 'state.json'), state);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'codex-process-finished',
    at: finishedAt,
    runId,
    exitCode,
  });

  const discovered = await discoverCodexTraceFiles({
    codexHome: absoluteCodexHome,
    limit: traceLimit,
  });
  const startedMs = new Date(processStartedAt).getTime() - 2000;
  const modifiedWindowTraces = discovered.filter((trace) => new Date(trace.modifiedAt).getTime() >= startedMs);
  const candidateTraces = [];
  for (const trace of modifiedWindowTraces) {
    const summary = await summarizeCodexTrace(trace.path);
    if (timestampInWindow(summary.firstTimestamp, { startedAt: processStartedAt, finishedAt })) {
      candidateTraces.push(trace);
    }
  }
  const traceDiscovery = {
    schema: 'living-doc-harness-trace-discovery/v1',
    runId,
    codexHomeHash: sha256(absoluteCodexHome),
    processStartedAt,
    processFinishedAt: finishedAt,
    scannedModifiedCount: modifiedWindowTraces.length,
    candidateCount: candidateTraces.length,
    candidates: candidateTraces.map((trace) => ({
      pathHash: sha256(trace.path),
      sizeBytes: trace.sizeBytes,
      modifiedAt: trace.modifiedAt,
    })),
  };
  await writeJson(path.join(runDir, 'trace-discovery.json'), traceDiscovery);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'native-trace-discovery-written',
    at: finishedAt,
    runId,
    candidateCount: candidateTraces.length,
  });
  for (const trace of candidateTraces) {
    await attachTraceSummaryToRun({ runDir, tracePath: trace.path, now: finishedAt });
  }
  const finalContract = JSON.parse(await readFile(path.join(runDir, 'contract.json'), 'utf8'));
  const finalWorkerUnit = await writeContractBoundInferenceUnitSnapshot({
    runDir,
    iteration,
    sequence: 1,
    unitId: 'worker',
    role: 'worker',
    unitTypeId: 'worker',
    allowedUnitTypes: normalizedAllowedUnitTypes,
    prompt,
    inputContract: workerInputContract,
    sourcePaths: {
      codexEventsPath,
      stderrPath: codexStderrPath,
      lastMessagePath,
    },
    mode: 'external-headless-codex',
    status: finalContract.status,
    basis: [
      `Worker headless Codex process exited with code ${exitCode}.`,
      'Reviewer inference remains the authority for closure, repair, resume, or block decisions.',
    ],
    outputContract: {
      schema: 'living-doc-worker-output/v1',
      status: finalContract.status,
      runId,
      exitCode,
      livingDocPath: relativeDocPath,
      lifecycleInput: workerInputContract.lifecycleInput,
      codexEventsPath: path.relative(runDir, codexEventsPath),
      lastMessagePath: path.relative(runDir, lastMessagePath),
      stderrPath: path.relative(runDir, codexStderrPath),
      nativeTraceRefs: finalContract.artifacts.nativeTraceRefs,
      nextAuthority: 'reviewer-inference',
    },
    now: finishedAt,
    cwd,
    toolProfile: resolvedToolProfile,
  });
  finalContract.artifacts.workerInferenceUnit = {
    result: path.relative(runDir, finalWorkerUnit.resultPath),
    validation: path.relative(runDir, finalWorkerUnit.validationPath),
    inputContract: path.relative(runDir, finalWorkerUnit.inputContractPath),
    prompt: path.relative(runDir, finalWorkerUnit.promptPath),
    codexEvents: path.relative(runDir, finalWorkerUnit.codexEventsPath),
    lastMessage: path.relative(runDir, finalWorkerUnit.lastMessagePath),
    stderr: path.relative(runDir, finalWorkerUnit.stderrPath),
  };
  await writeJson(path.join(runDir, 'contract.json'), finalContract);
  const finalState = JSON.parse(await readFile(path.join(runDir, 'state.json'), 'utf8'));
  finalState.nextAction = finalContract.artifacts.nativeTraceRefs.length
    ? 'emit iteration evidence template from attached native trace summaries'
    : 'attach native inference trace evidence before finalizing iteration';
  await writeJson(path.join(runDir, 'state.json'), finalState);

  return {
    runId,
    runDir,
    contract: finalContract,
    state: finalState,
    executed: true,
    exitCode,
    traceDiscovery,
  };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await createHarnessRun(options);
    console.log(JSON.stringify({
      runId: result.runId,
      runDir: result.runDir,
      executed: result.executed,
      exitCode: result.exitCode ?? null,
    }, null, 2));
    process.exit(result.exitCode && result.exitCode !== 0 ? result.exitCode : 0);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
