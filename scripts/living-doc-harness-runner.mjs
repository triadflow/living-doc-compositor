// Standalone living-doc harness runner.
//
// This is the command boundary for running Codex headless from a living-doc
// objective. By default it creates the durable run directory without launching
// Codex; pass --execute to spawn `codex exec` as a separate process.

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { attachTraceSummaryToRun, discoverCodexTraceFiles, summarizeCodexTrace } from './living-doc-harness-trace-reader.mjs';
import {
  validateInferenceUnitResult,
  writeContractBoundInferenceUnitSnapshot,
} from './living-doc-harness-inference-unit.mjs';
import { resolveInferenceToolProfile } from './living-doc-harness-tool-profile.mjs';
import {
  DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
  DEFAULT_PR_REVIEW_POLICY,
  getInferenceUnitType,
  normalizeAllowedInferenceUnitTypes,
  normalizePrReviewPolicy,
  prReviewRequiredForEvidence,
  validateAllowedInferenceUnitRunConfig,
} from './living-doc-harness-inference-unit-types.mjs';
import {
  artifactRefDisplayPath,
  artifactRefFromPath,
  resolveArtifactRef,
  validateArtifactRef,
} from './living-doc-harness-artifact-ref.mjs';

const __filename = fileURLToPath(import.meta.url);
const execFileAsync = promisify(execFile);

const DEFAULT_RUNS_DIR = '.living-doc-runs';
const DEFAULT_STARTUP_EVIDENCE_TIMEOUT_MS = 120000;
const STARTUP_EVIDENCE_POLL_MS = 1000;
const STARTUP_TRACE_DISCOVERY_TIMEOUT_MS = 750;
const STARTUP_DIAGNOSTIC_TIMEOUT_MS = 2500;

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function renderedHtmlSiblingForLivingDoc(docPath) {
  if (!docPath || path.extname(docPath) !== '.json') return null;
  return `${docPath.slice(0, -'.json'.length)}.html`;
}

function livingDocStateCommitScope({ files, forbiddenFiles = [], livingDocPath, renderedHtmlPath }) {
  const baseFiles = unique(arr(files));
  const docPath = livingDocPath || null;
  const htmlPath = renderedHtmlPath || renderedHtmlSiblingForLivingDoc(docPath);
  const allowed = [...baseFiles];
  if (docPath && htmlPath && baseFiles.includes(docPath) && !allowed.includes(htmlPath)) {
    allowed.push(htmlPath);
  }
  const allowedSet = new Set(allowed);
  return {
    allowedCommitFiles: unique(allowed),
    forbiddenCommitFiles: unique(arr(forbiddenFiles)).filter((filePath) => !allowedSet.has(filePath)),
    livingDocStateFiles: [docPath, htmlPath].filter(Boolean),
    livingDocPath: docPath,
    renderedHtmlPath: htmlPath,
  };
}

function extractJson(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(value.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function outputHasRegisteredVerdict({ rawResult, unitTypeId }) {
  if (!rawResult || typeof rawResult !== 'object') return false;
  const type = getInferenceUnitType(unitTypeId);
  const output = rawResult.outputContract && typeof rawResult.outputContract === 'object'
    ? rawResult.outputContract
    : rawResult;
  return output?.schema === type.outputContract.schema && type.outputVerdicts.includes(output?.status);
}

function unitArtifactFromSnapshot({ runId, runDir, unitId, role, snapshot }) {
  return {
    unitId,
    role,
    result: path.relative(runDir, snapshot.resultPath),
    resultRef: artifactRefFromPath({ runId, runDir, filePath: snapshot.resultPath, kind: `${unitId}-result` }),
    validation: path.relative(runDir, snapshot.validationPath),
    validationRef: artifactRefFromPath({ runId, runDir, filePath: snapshot.validationPath, kind: `${unitId}-validation` }),
    inputContract: path.relative(runDir, snapshot.inputContractPath),
    inputContractRef: artifactRefFromPath({ runId, runDir, filePath: snapshot.inputContractPath, kind: `${unitId}-input-contract` }),
    prompt: path.relative(runDir, snapshot.promptPath),
    promptRef: artifactRefFromPath({ runId, runDir, filePath: snapshot.promptPath, kind: `${unitId}-prompt` }),
    codexEvents: path.relative(runDir, snapshot.codexEventsPath),
    codexEventsRef: artifactRefFromPath({ runId, runDir, filePath: snapshot.codexEventsPath, kind: `${unitId}-codex-events` }),
    lastMessage: path.relative(runDir, snapshot.lastMessagePath),
    lastMessageRef: artifactRefFromPath({ runId, runDir, filePath: snapshot.lastMessagePath, kind: `${unitId}-last-message` }),
    stderr: path.relative(runDir, snapshot.stderrPath),
    stderrRef: artifactRefFromPath({ runId, runDir, filePath: snapshot.stderrPath, kind: `${unitId}-stderr` }),
  };
}

async function readValidatedUnitResultAtPath({ resultPath, unitTypeId, allowFixture = true }) {
  if (!resultPath) return null;
  let result;
  try {
    result = JSON.parse(await readFile(resultPath, 'utf8'));
  } catch {
    return null;
  }
  if (result?.unitId !== unitTypeId) return null;
  if (!allowFixture && result?.mode === 'fixture') return null;
  if (!outputHasRegisteredVerdict({ rawResult: result, unitTypeId })) return null;
  const validation = validateInferenceUnitResult(result);
  if (!validation.ok) return null;
  return {
    result,
    resultPath,
    validation,
  };
}

async function readSelfAuthoredUnitResult({ runDir, artifact, unitTypeId }) {
  if (!artifact?.result) return null;
  return readValidatedUnitResultAtPath({
    resultPath: path.join(runDir, artifact.result),
    unitTypeId,
    allowFixture: false,
  });
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

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function appendJsonl(filePath, event) {
  await writeFile(filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
}

function unique(values) {
  return [...new Set(arr(values).filter(Boolean))];
}

async function fileContentHash(cwd, filePath) {
  try {
    const content = await readFile(path.resolve(cwd, filePath));
    return sha256(content);
  } catch {
    return null;
  }
}

function parsePorcelainStatus(raw) {
  const parts = String(raw || '').split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < parts.length; index += 1) {
    const record = parts[index];
    const status = record.slice(0, 2);
    const filePath = record.slice(3);
    if (!filePath) continue;
    entries.push({ status, path: filePath });
    if (/^[RC]/.test(status.trim()) || /^[RC]/.test(status[0] || '')) {
      index += 1;
    }
  }
  return entries;
}

async function gitWorktreeSnapshot(cwd) {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd }));
  } catch {
    return { available: false, entries: [] };
  }
  const entries = [];
  for (const entry of parsePorcelainStatus(stdout)) {
    entries.push({
      ...entry,
      contentHash: await fileContentHash(cwd, entry.path),
    });
  }
  return { available: true, entries: entries.sort((left, right) => left.path.localeCompare(right.path)) };
}

function worktreeSnapshotDelta(before, after) {
  if (!before?.available || !after?.available) return [];
  const beforeMap = new Map(arr(before.entries).map((entry) => [entry.path, entry]));
  const afterMap = new Map(arr(after.entries).map((entry) => [entry.path, entry]));
  const paths = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();
  const changed = [];
  for (const filePath of paths) {
    const left = beforeMap.get(filePath) || null;
    const right = afterMap.get(filePath) || null;
    if (left?.status !== right?.status || left?.contentHash !== right?.contentHash) {
      changed.push({
        path: filePath,
        beforeStatus: left?.status || null,
        afterStatus: right?.status || null,
        beforeHash: left?.contentHash || null,
        afterHash: right?.contentHash || null,
      });
    }
  }
  return changed;
}

function unitArtifactKey(unitTypeId) {
  if (unitTypeId === 'worker') return 'workerInferenceUnit';
  return `${String(unitTypeId).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}InferenceUnit`;
}

function sequenceForUnit(unitTypeId) {
  return {
    worker: 1,
    'reviewer-inference': 2,
    'closure-review': 3,
    'living-doc-balance-scan': 4,
    'commit-intent': 4,
    'pr-review': 5,
    'repair-skill': 6,
    'post-flight-summary': 8,
  }[unitTypeId] || 1;
}

function initialUnitRootDir(unitTypeId) {
  return unitTypeId === 'worker' ? 'inference-units' : 'initial-inference-units';
}

async function listFiles(rootDir, baseDir = rootDir) {
  let entries = [];
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath, baseDir));
    } else if (entry.isFile()) {
      files.push(path.relative(baseDir, entryPath));
    }
  }
  return files;
}

async function workerControllerArtifactViolations(runDir) {
  const controllerOwnedRoots = [
    'artifacts',
    'handovers',
    'initial-inference-units',
    'output-input',
    'repair-skills',
    'reviewer-inference',
    'traces',
  ];
  const violations = [];
  for (const root of controllerOwnedRoots) {
    const files = await listFiles(path.join(runDir, root));
    violations.push(...files.map((filePath) => path.join(root, filePath)));
  }
  return violations.sort();
}

async function fileSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

async function withTimeout(promise, timeoutMs, fallback) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function httpsProbe({ hostname = 'api.openai.com', pathName = '/', timeoutMs = STARTUP_DIAGNOSTIC_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const req = httpsRequest({
      hostname,
      path: pathName,
      method: 'HEAD',
      timeout: timeoutMs,
    }, (res) => {
      res.resume();
      resolve({
        ok: true,
        hostname,
        statusCode: res.statusCode || null,
        elapsedMs: Date.now() - startedAt,
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error(`https probe timed out after ${timeoutMs}ms`));
    });
    req.on('error', (err) => {
      resolve({
        ok: false,
        hostname,
        error: err.code || err.message,
        elapsedMs: Date.now() - startedAt,
      });
    });
    req.end();
  });
}

async function startupDiagnostics({ codexBin, cwd, absoluteCodexHome }) {
  const diagnostics = {
    schema: 'living-doc-harness-startup-diagnostics/v1',
    bounded: true,
    timeoutMs: STARTUP_DIAGNOSTIC_TIMEOUT_MS,
    codexExecutable: null,
    codexHome: {
      present: false,
      sessionsPresent: false,
      archivedSessionsPresent: false,
    },
    network: {
      dns: null,
      https: null,
    },
    classification: 'startup-cause-unknown',
  };
  diagnostics.codexExecutable = await withTimeout(
    execFileAsync(codexBin, ['--version'], { cwd, timeout: STARTUP_DIAGNOSTIC_TIMEOUT_MS })
      .then(({ stdout, stderr }) => ({
        ok: true,
        command: codexBin,
        version: String(stdout || stderr || '').trim().split('\n')[0] || null,
      }))
      .catch((err) => ({
        ok: false,
        command: codexBin,
        error: err.code || err.message,
      })),
    STARTUP_DIAGNOSTIC_TIMEOUT_MS + 250,
    {
      ok: false,
      command: codexBin,
      error: 'codex-version-timeout',
    },
  );
  try {
    const codexHomeStat = await stat(absoluteCodexHome);
    diagnostics.codexHome.present = codexHomeStat.isDirectory();
  } catch {
    diagnostics.codexHome.present = false;
  }
  for (const [key, dirName] of [['sessionsPresent', 'sessions'], ['archivedSessionsPresent', 'archived_sessions']]) {
    try {
      const info = await stat(path.join(absoluteCodexHome, dirName));
      diagnostics.codexHome[key] = info.isDirectory();
    } catch {
      diagnostics.codexHome[key] = false;
    }
  }
  diagnostics.network.dns = await withTimeout(
    lookup('api.openai.com')
      .then((result) => ({
        ok: true,
        hostname: 'api.openai.com',
        family: result.family,
      }))
      .catch((err) => ({
        ok: false,
        hostname: 'api.openai.com',
        error: err.code || err.message,
      })),
    STARTUP_DIAGNOSTIC_TIMEOUT_MS,
    {
      ok: false,
      hostname: 'api.openai.com',
      error: 'dns-timeout',
    },
  );
  diagnostics.network.https = await withTimeout(
    httpsProbe({ hostname: 'api.openai.com', timeoutMs: STARTUP_DIAGNOSTIC_TIMEOUT_MS }),
    STARTUP_DIAGNOSTIC_TIMEOUT_MS + 250,
    {
      ok: false,
      hostname: 'api.openai.com',
      error: 'https-timeout',
    },
  );
  if (diagnostics.codexExecutable?.ok === false) {
    diagnostics.classification = diagnostics.codexExecutable.error === 'ENOENT'
      ? 'codex-cli-unavailable'
      : 'codex-cli-unresponsive';
  } else if (diagnostics.network.dns?.ok === false || diagnostics.network.https?.ok === false) {
    diagnostics.classification = 'network-unreachable';
  }
  return diagnostics;
}

async function startupEvidenceSnapshot({
  codexEventsPath,
  codexStderrPath,
  lastMessagePath,
  absoluteCodexHome,
  processStartedAt,
  traceLimit,
}) {
  const files = {
    codexEventsBytes: await fileSize(codexEventsPath),
    codexStderrBytes: await fileSize(codexStderrPath),
    lastMessageBytes: await fileSize(lastMessagePath),
  };
  const startedMs = new Date(processStartedAt).getTime() - 2000;
  let modifiedTraceCount = 0;
  let traceDiscoveryTimedOut = false;
  try {
    const traces = await withTimeout(
      discoverCodexTraceFiles({
        codexHome: absoluteCodexHome,
        limit: Math.max(1, Math.min(traceLimit, 5)),
      }),
      STARTUP_TRACE_DISCOVERY_TIMEOUT_MS,
      { timedOut: true, traces: [] },
    );
    traceDiscoveryTimedOut = traces?.timedOut === true;
    const traceList = Array.isArray(traces) ? traces : traces.traces;
    modifiedTraceCount = arr(traceList).filter((trace) => new Date(trace.modifiedAt).getTime() >= startedMs && trace.sizeBytes > 0).length;
  } catch {
    modifiedTraceCount = 0;
  }
  return {
    ...files,
    modifiedTraceCount,
    traceDiscoveryTimedOut,
    hasEvidence: files.codexEventsBytes > 0
      || files.codexStderrBytes > 0
      || files.lastMessageBytes > 0
      || modifiedTraceCount > 0,
  };
}

async function waitForStartupEvidence({
  codexEventsPath,
  codexStderrPath,
  lastMessagePath,
  absoluteCodexHome,
  processStartedAt,
  traceLimit,
  timeoutMs,
  cancel = null,
}) {
  const started = Date.now();
  let snapshot = await startupEvidenceSnapshot({
    codexEventsPath,
    codexStderrPath,
    lastMessagePath,
    absoluteCodexHome,
    processStartedAt,
    traceLimit,
  });
  while (!cancel?.cancelled && !snapshot.hasEvidence && Date.now() - started < timeoutMs) {
    await delay(Math.min(STARTUP_EVIDENCE_POLL_MS, Math.max(10, timeoutMs - (Date.now() - started))));
    if (cancel?.cancelled) break;
    snapshot = await startupEvidenceSnapshot({
      codexEventsPath,
      codexStderrPath,
      lastMessagePath,
      absoluteCodexHome,
      processStartedAt,
      traceLimit,
    });
  }
  return {
    ok: snapshot.hasEvidence,
    cancelled: cancel?.cancelled === true,
    elapsedMs: Date.now() - started,
    timeoutMs,
    snapshot,
  };
}

async function terminateChildProcess(child, signal = 'SIGTERM') {
  if (!child || child.exitCode != null || child.killed) return;
  let closed = false;
  const closedPromise = new Promise((resolve) => {
    child.once('close', () => {
      closed = true;
      resolve();
    });
  });
  child.kill(signal);
  await Promise.race([
    closedPromise,
    delay(2000),
  ]);
  if (!closed && child.exitCode == null) child.kill('SIGKILL');
  await Promise.race([
    closedPromise,
    delay(2000),
  ]);
}

async function closeWritableStream(stream) {
  if (!stream || stream.destroyed || stream.closed || stream.writableEnded) return;
  await new Promise((resolve) => stream.end(resolve));
}

function selectedInitialUnit(lifecycleInput) {
  const unitId = lifecycleInput?.nextUnit?.unitId || lifecycleInput?.selectedUnitType || 'worker';
  const type = getInferenceUnitType(unitId);
  return {
    unitId: type.id,
    role: lifecycleInput?.nextUnit?.role || type.role || type.id,
    type,
  };
}

function initialUnitWorkInstruction(unitId) {
  if (unitId === 'living-doc-balance-scan') {
    return [
      'Scan-only role boundary:',
      '- Inspect the living doc, reviewer verdict, handover, required evidence paths, and raw/log summary paths named in the input contract.',
      '- Return imbalance classification, basis, ordered unit types, blockers, and next routing recommendation only.',
      '- Use balance-scan only for a structural living-doc imbalance; do not turn ordinary incomplete worker progress into a scan detour.',
      '- Route back toward worker progress after the narrow imbalance is diagnosed or after a named repair unit is ordered.',
      '- Do not edit source files, living doc JSON, rendered HTML, tests, scripts, or run artifacts.',
      '- Do not render the living doc, run implementation proof tests, commit, or run lifecycle/reviewer/finalizer/dashboard/proof-route commands.',
      '- If source changes or proof execution are needed, return blocked or order the next unit type; do not perform that work from balance-scan.',
    ];
  }
  if (unitId === 'pr-review') {
    return [
      'PR-review role boundary:',
      '- This unit is read-only over the repository source tree. Inspect evidence and return approved, not-required, blocked, or failed.',
      '- Treat PR review as an evidence gate, not an objective-progress engine. Do not solve the living-doc objective from this unit.',
      '- If PR evidence is missing or blocked, name the concrete gate condition so the controller can route back to productive work.',
      '- Do not edit source files, living doc JSON, rendered HTML, tests, scripts, or commits from this unit. If a defect needs source changes, return blocked with the required follow-up unit instead.',
    ];
  }
  if (unitId === 'commit-intent') {
    return [
      'Commit-intent role boundary:',
      '- This unit is proposal-only. Inspect the worktree, evidence snapshot, changed-file scope, commit policy, and required input refs, then return a commit-intent output contract.',
      '- Do not execute git commands that stage, commit, amend, reset, checkout, push, or otherwise mutate repository history or the git index.',
      '- Do not run git add, git commit, git reset, git checkout, git restore, git push, or git stash.',
      '- If the scoped commit should happen, return approved true, status approved, the exact changedFiles, a commit message, and sideEffect.executed false with reasonCode controller-commit-required.',
      '- If the scope is unsafe, return blocked with the exact missing or forbidden condition.',
      '- The lifecycle controller owns the deterministic git side effect after validating this contract.',
    ];
  }
  if (unitId === 'closure-review') {
    return [
      'Closure-review role boundary:',
      '- Inspect proof, acceptance criteria, reviewer verdicts, PR-review evidence, and controller hard facts.',
      '- Act only as the terminal guard. If closure is denied, return a concrete denial reason that can route to continuation or worker.',
      '- Return a closure verdict only; do not edit source files, living docs, rendered HTML, tests, scripts, or commits.',
    ];
  }
  return [
    'Worker role boundary:',
    '- You are the primary actuator of objective progress in this lifecycle.',
    '- If the next honest source-system or living-doc move is knowable and allowed, do it.',
    '- Keep the living doc and source system aligned: when source state changes, update the living doc truth or name the exact follow-up needed.',
    '- Only return a blocker after making the concrete local moves available to you, then name the exact missing evidence, decision, permission, or source-system condition.',
    '- Do not outsource solvable work to reviewer, balance-scan, repair, continuation, or gates.',
  ];
}

function buildPrompt(doc, { docPath, runId, lifecycleInput = null, initialUnit }) {
  const lines = [
    'You are running inside the standalone agentic living-doc harness.',
    `This run is a contract-bound inference unit of type: ${initialUnit.unitId}.`,
    `Role: ${initialUnit.role}.`,
    '',
    'Objective:',
    doc.objective || '(missing objective)',
    '',
    'Success condition:',
    doc.successCondition || '(missing success condition)',
    '',
    'Rules:',
    '- Treat the living doc JSON as the source of objective state.',
    '- Treat the living doc as the active working surface: it keeps the objective, source-system state, evidence, unresolved decisions, acceptance criteria, and current truth aligned.',
    '- Real progress means a concrete source-system change, a truthful living-doc update, satisfied gate evidence, or a named missing condition that could not be resolved locally.',
    '- Progress-shaped artifacts are invalid when they only create scans, summaries, blocker labels, report polish, or route churn without moving the objective or exposing a real missing condition.',
    '- Do not claim closure unless acceptance criteria and proof gates are satisfied.',
    '- If blocked, make the blocker explicit with required evidence or decision.',
    '- Do not run harness finalizer, reviewer, evidence-dashboard, or lifecycle-control commands from inside this inference unit; the lifecycle controller owns review, transition, proof, dashboard, and next-iteration decisions after the unit exits.',
    '- Do not execute proof-route commands that start living-doc-harness-lifecycle.mjs, living-doc-harness-runner.mjs, reviewer, closure-review, finalizer, dashboard, or proof-route scripts. Treat those as controller-owned contracts and leave them for the lifecycle controller.',
    '',
    'Run context:',
    `- runId: ${runId}`,
    `- livingDocPath: ${docPath}`,
    '',
    ...initialUnitWorkInstruction(initialUnit.unitId),
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
      `- selectedUnitType: ${lifecycleInput.selectedUnitType || lifecycleInput.nextUnit?.unitId || 'none'}`,
      '',
      'Use this controller handoff as historical evidence and current contract input. Do not resume or return to a previous unit; this is a fresh isolated unit.',
    );
    if (lifecycleInput.nextUnit) {
      lines.push(
        '',
        'Selected next unit contract:',
        JSON.stringify(lifecycleInput.nextUnit, null, 2),
      );
    }
  }
  return lines.join('\n');
}

function appendInputContractToPrompt(prompt, inputContract) {
  const refs = arr(inputContract?.requiredInputRefs);
  const resolutions = arr(inputContract?.resolvedRequiredInputRefs);
  if (!refs.length && !resolutions.length) return prompt;
  return `${prompt}

Resolved contract-bound evidence refs:
${JSON.stringify({
    requiredInputRefs: refs,
    resolvedRequiredInputRefs: resolutions,
  }, null, 2)}
`;
}

async function codexEventBoundaryViolations(filePath, unitTypeId) {
  if (unitTypeId !== 'living-doc-balance-scan') return [];
  let content = '';
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  const forbiddenCommandPattern = /\b(node\s+--test|node\s+tests\/|npm\s+(run\s+)?test|scripts\/render-living-doc\.mjs|living-doc-harness-(lifecycle|runner|reviewer|closure-review|finalizer)|proof-route)\b/;
  const violations = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let event = null;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const itemType = event?.item?.type || event?.type || null;
    if (itemType === 'file_change') {
      violations.push({
        type: 'file-change-event',
        message: 'balance-scan emitted a file_change event',
      });
      continue;
    }
    const command = event?.item?.command;
    if (typeof command === 'string' && forbiddenCommandPattern.test(command)) {
      violations.push({
        type: 'forbidden-command',
        command,
      });
    }
  }
  return violations;
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

function buildWorkerInputContract({ doc, docPath, runId, lifecycleInput = null, toolProfile = null, allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES, prReviewPolicy = DEFAULT_PR_REVIEW_POLICY }) {
  return {
    schema: 'living-doc-worker-inference-input/v1',
    runId,
    role: 'worker',
    runConfig: {
      schema: 'living-doc-harness-run-inference-config/v1',
      allowedUnitTypes,
      initialUnitType: 'worker',
      prReviewPolicy,
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
      handoverRef: lifecycleInput.handoverRef || null,
      outputInputPath: lifecycleInput.outputInputPath || null,
      outputInputRef: lifecycleInput.outputInputRef || null,
      selectedUnitType: lifecycleInput.selectedUnitType || lifecycleInput.nextUnit?.unitId || null,
      nextUnit: lifecycleInput.nextUnit || null,
    } : null,
    requiredInspectionPaths: [docPath],
    toolProfile,
    forbiddenActions: [
      'run lifecycle finalizer from inside worker inference',
      'run reviewer inference from inside worker inference',
      'execute runState.proofRoutes that start lifecycle, runner, reviewer, closure-review, finalizer, dashboard, or proof-route scripts',
      'decide terminal closure without reviewer inference',
    ],
  };
}

async function previousOutputInputContext({ cwd, lifecycleInput }) {
  const outputInputPath = lifecycleInput?.outputInputRef
    ? resolveArtifactRef({ cwd, ref: lifecycleInput.outputInputRef })
    : lifecycleInput?.outputInputPath
      ? path.resolve(cwd, lifecycleInput.outputInputPath)
      : null;
  const outputInput = outputInputPath ? await readJson(outputInputPath, null) : null;
  const previousRunDir = outputInputPath ? path.dirname(path.dirname(outputInputPath)) : null;
  const evidencePath = outputInput?.previousOutput?.evidenceRef
    ? resolveArtifactRef({ cwd, currentRunDir: previousRunDir, ref: outputInput.previousOutput.evidenceRef })
    : outputInput?.previousOutput?.evidencePath && previousRunDir
      ? path.resolve(previousRunDir, outputInput.previousOutput.evidencePath)
      : null;
  const outputInputRef = lifecycleInput?.outputInputRef || outputInput?.nextInput?.outputInputRef || null;
  const evidenceRef = outputInput?.previousOutput?.evidenceRef || null;
  const evidence = evidencePath ? await readJson(evidencePath, null) : null;
  return { outputInputPath, outputInputRef, outputInput, previousRunDir, evidencePath, evidenceRef, evidence };
}

function evidenceSnapshotRefFromPrevious(previous) {
  return previous?.evidence?.controllerEvidenceSnapshotRef
    || previous?.evidence?.controllerEvidence?.snapshotRef
    || null;
}

function previousControllerEvidenceSnapshotPath({ previous, cwd }) {
  const snapshotRef = evidenceSnapshotRefFromPrevious(previous);
  if (snapshotRef) {
    return artifactRefDisplayPath({ cwd, currentRunDir: previous?.previousRunDir || cwd, ref: snapshotRef });
  }
  const snapshotPath = previous?.evidence?.controllerEvidenceSnapshotPath
    || previous?.evidence?.controllerEvidence?.snapshotPath
    || null;
  if (!snapshotPath || !previous?.previousRunDir) return null;
  return path.relative(cwd, path.resolve(previous.previousRunDir, snapshotPath));
}

export function commonRequiredInspectionPaths({ docPath, lifecycleInput, previous, cwd }) {
  const requiredInputRefs = arr(lifecycleInput?.nextUnit?.requiredInputRefs);
  const refDisplayPaths = requiredInputRefs
    .map((ref) => artifactRefDisplayPath({ cwd, currentRunDir: previous?.previousRunDir || cwd, ref }));
  const legacyRequiredInputPaths = requiredInputRefs.length
    ? []
    : arr(lifecycleInput?.nextUnit?.requiredInputPaths);
  return unique([
    docPath,
    lifecycleInput?.outputInputPath || null,
    ...refDisplayPaths,
    ...legacyRequiredInputPaths,
    previous?.evidencePath ? path.relative(cwd, previous.evidencePath) : null,
    previousControllerEvidenceSnapshotPath({ previous, cwd }),
  ]);
}

async function resolvedRequiredInputRefs({ lifecycleInput, previous, cwd }) {
  const currentRunDir = previous?.previousRunDir || cwd;
  const refs = arr(lifecycleInput?.nextUnit?.requiredInputRefs);
  const validations = [];
  for (const ref of refs) {
    validations.push(await validateArtifactRef({ cwd, currentRunDir, ref, mustExist: true }));
  }
  return validations;
}

function commitScopeFromPreviousEvidence(previous) {
  const evidence = previous?.evidence || {};
  const commitIntent = evidence.commitIntent || {};
  const sideEffectCommit = evidence.sideEffectEvidence?.commit || {};
  const hardFacts = evidence.requiredHardFacts || {};
  const scope = evidence.commitScope || sideEffectCommit.commitScope || sideEffectCommit.scope || {};
  const fallbackChangedFiles = arr(evidence.workerEvidence?.filesChanged).length
    ? arr(evidence.workerEvidence.filesChanged)
    : arr(hardFacts.dirtyTrackedFiles);
  const allowedCommitFiles = unique([
    ...arr(scope.allowedCommitFiles),
    ...arr(commitIntent.allowedCommitFiles),
    ...arr(sideEffectCommit.allowedCommitFiles),
  ]);
  const currentRunChangedFiles = unique([
    ...arr(scope.currentRunChangedFiles),
    ...arr(commitIntent.currentRunChangedFiles),
    ...arr(sideEffectCommit.currentRunChangedFiles),
    ...(allowedCommitFiles.length ? [] : fallbackChangedFiles),
  ]);
  const preExistingDirtyFiles = unique([
    ...arr(scope.preExistingDirtyFiles),
    ...arr(commitIntent.preExistingDirtyFiles),
    ...arr(sideEffectCommit.preExistingDirtyFiles),
    ...arr(hardFacts.preExistingDirtyFiles),
  ]);
  const forbiddenCommitFiles = unique([
    ...arr(scope.forbiddenCommitFiles),
    ...arr(commitIntent.forbiddenCommitFiles),
    ...arr(sideEffectCommit.forbiddenCommitFiles),
    ...arr(hardFacts.forbiddenCommitFiles),
    ...preExistingDirtyFiles,
  ]);
  return {
    schema: 'living-doc-harness-commit-scope/v1',
    currentRunChangedFiles,
    preExistingDirtyFiles,
    allowedCommitFiles: allowedCommitFiles.length ? allowedCommitFiles : currentRunChangedFiles,
    forbiddenCommitFiles,
  };
}

async function buildInitialInputContract({
  doc,
  docPath,
  runId,
  iteration,
  lifecycleInput = null,
  toolProfile = null,
  allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
  prReviewPolicy = DEFAULT_PR_REVIEW_POLICY,
  initialUnit,
  cwd,
}) {
  const previous = lifecycleInput
    ? await previousOutputInputContext({ cwd, lifecycleInput })
    : { outputInputPath: null, outputInputRef: null, outputInput: null, previousRunDir: null, evidencePath: null, evidenceRef: null, evidence: null };
  const requiredInspectionPaths = commonRequiredInspectionPaths({ docPath, lifecycleInput, previous, cwd });
  const requiredInputRefResolutions = await resolvedRequiredInputRefs({ lifecycleInput, previous, cwd });
  const nextUnit = lifecycleInput?.nextUnit || {};
  const evidenceSnapshotRef = evidenceSnapshotRefFromPrevious(previous);

  if (initialUnit.unitId === 'worker') {
    return {
      ...buildWorkerInputContract({ doc, docPath, runId, lifecycleInput, toolProfile, allowedUnitTypes, prReviewPolicy }),
      outputInputRef: previous.outputInputRef || lifecycleInput?.outputInputRef || null,
      evidenceRef: previous.evidenceRef || null,
      requiredInspectionPaths,
      requiredInputRefs: arr(nextUnit.requiredInputRefs),
      resolvedRequiredInputRefs: requiredInputRefResolutions,
    };
  }

  if (initialUnit.unitId === 'commit-intent') {
    const evidenceSnapshotPath = previousControllerEvidenceSnapshotPath({ previous, cwd });
    const commitScope = commitScopeFromPreviousEvidence(previous);
    const rawChangedFiles = unique([...arr(commitScope.allowedCommitFiles), ...arr(nextUnit.changedFiles)]);
    const livingDocStateScope = livingDocStateCommitScope({
      files: rawChangedFiles,
      forbiddenFiles: commitScope.forbiddenCommitFiles,
      livingDocPath: docPath,
      renderedHtmlPath: renderedHtmlSiblingForLivingDoc(docPath),
    });
    const changedFiles = rawChangedFiles;
    const allowedCommitFiles = livingDocStateScope.allowedCommitFiles;
    const forbiddenCommitFiles = livingDocStateScope.forbiddenCommitFiles;
    return {
      schema: 'living-doc-harness-commit-intent-input/v1',
      runId,
      iteration,
      livingDocPath: livingDocStateScope.livingDocPath,
      renderedHtmlPath: livingDocStateScope.renderedHtmlPath,
      changedFiles,
      currentRunChangedFiles: commitScope.currentRunChangedFiles,
      preExistingDirtyFiles: commitScope.preExistingDirtyFiles,
      allowedCommitFiles,
      forbiddenCommitFiles,
      evidenceSnapshotPath,
      evidenceSnapshotRef,
      requiredHardFacts: previous.evidence?.requiredHardFacts || null,
      prReviewPolicy,
      commitIntent: {
        ...(previous.evidence?.commitIntent || previous.evidence?.sideEffectEvidence?.commit || {
          mode: 'required-before-closure',
          reason: nextUnit.reasonCode || 'commit-intent-selected-by-reviewer-contract',
        }),
        currentRunChangedFiles: commitScope.currentRunChangedFiles,
        preExistingDirtyFiles: commitScope.preExistingDirtyFiles,
        allowedCommitFiles,
        forbiddenCommitFiles,
        livingDocPath: livingDocStateScope.livingDocPath,
        renderedHtmlPath: livingDocStateScope.renderedHtmlPath,
      },
      commitScope: {
        ...commitScope,
        allowedCommitFiles,
        forbiddenCommitFiles,
        livingDocStateFiles: livingDocStateScope.livingDocStateFiles,
      },
      commitPolicy: {
        exactFilesOnly: true,
        forbidPreExistingDirtyFiles: true,
        allowRenderedLivingDocSibling: true,
        reason: 'Commit-intent may only approve files scoped to the current objective run.',
      },
      lifecycleInput,
      outputInputRef: previous.outputInputRef || lifecycleInput?.outputInputRef || null,
      evidenceRef: previous.evidenceRef || null,
      requiredInspectionPaths,
      requiredInputRefs: arr(nextUnit.requiredInputRefs),
      resolvedRequiredInputRefs: requiredInputRefResolutions,
    };
  }

  if (initialUnit.unitId === 'living-doc-balance-scan') {
    return {
      schema: 'living-doc-repair-skill-chain-input/v1',
      runId,
      iteration,
      livingDocPath: docPath,
      reviewerVerdictPath: previous.outputInput?.previousOutput?.reviewerVerdictPath || nextUnit.reviewerVerdictPath || null,
      reviewerVerdictRef: previous.outputInput?.previousOutput?.reviewerVerdictRef || nextUnit.reviewerVerdictRef || null,
      handoverPath: previous.outputInput?.previousOutput?.handoverPath || lifecycleInput?.handoverPath || null,
      handoverRef: previous.outputInput?.previousOutput?.handoverRef || lifecycleInput?.handoverRef || null,
      lifecycleInput,
      outputInputRef: previous.outputInputRef || lifecycleInput?.outputInputRef || null,
      evidenceRef: previous.evidenceRef || null,
      requiredInspectionPaths,
      requiredInputRefs: arr(nextUnit.requiredInputRefs),
      resolvedRequiredInputRefs: requiredInputRefResolutions,
    };
  }

  if (initialUnit.unitId === 'pr-review') {
    const evidenceSnapshotPath = previousControllerEvidenceSnapshotPath({ previous, cwd });
    const hardFacts = previous.evidence?.requiredHardFacts || {};
    const prReviewRequired = prReviewRequiredForEvidence({
      policy: prReviewPolicy,
      evidence: previous.evidence,
    });
    return {
      schema: 'living-doc-harness-pr-review-input/v1',
      runId,
      iteration,
      livingDocPath: docPath,
      reviewerVerdictPath: previous.outputInput?.previousOutput?.reviewerVerdictPath || nextUnit.reviewerVerdictPath || null,
      reviewTarget: previous.evidence?.prReview?.reviewTarget || previous.evidence?.prReview?.url || 'configured-pr-review-target',
      evidenceSnapshotPath,
      evidenceSnapshotRef,
      requiredHardFacts: hardFacts,
      prReviewPolicy,
      prReviewRequired,
      changedFiles: arr(hardFacts.currentRunChangedFiles).length
        ? arr(hardFacts.currentRunChangedFiles)
        : arr(previous.evidence?.workerEvidence?.filesChanged),
      commitEvidence: previous.evidence?.sideEffectEvidence?.commit || null,
      lifecycleInput,
      outputInputRef: previous.outputInputRef || lifecycleInput?.outputInputRef || null,
      evidenceRef: previous.evidenceRef || null,
      requiredInspectionPaths,
      requiredInputRefs: arr(nextUnit.requiredInputRefs),
      resolvedRequiredInputRefs: requiredInputRefResolutions,
    };
  }

  if (initialUnit.unitId === 'closure-review') {
    const evidenceSnapshotPath = previousControllerEvidenceSnapshotPath({ previous, cwd });
    const prReviewRequired = prReviewRequiredForEvidence({
      policy: prReviewPolicy,
      evidence: previous.evidence,
    });
    return {
      schema: 'living-doc-harness-closure-review-input/v1',
      runId,
      iteration,
      evidencePath: previous.outputInput?.previousOutput?.evidencePath || null,
      evidenceRef: previous.outputInput?.previousOutput?.evidenceRef || previous.evidenceRef || null,
      reviewerVerdictPath: previous.outputInput?.previousOutput?.reviewerVerdictPath || null,
      reviewerVerdictRef: previous.outputInput?.previousOutput?.reviewerVerdictRef || null,
      evidenceSnapshotPath,
      evidenceSnapshotRef,
      requiredHardFacts: previous.evidence?.requiredHardFacts || null,
      prReviewPolicy,
      prReviewRequired,
      proofGates: previous.evidence?.proofGates || {},
      stopVerdict: previous.outputInput?.previousOutput || {},
      lifecycleInput,
      outputInputRef: previous.outputInputRef || lifecycleInput?.outputInputRef || null,
      requiredInspectionPaths,
      requiredInputRefs: arr(nextUnit.requiredInputRefs),
      resolvedRequiredInputRefs: requiredInputRefResolutions,
    };
  }

  return {
    schema: initialUnit.type.inputContract.schema,
    runId,
    iteration,
    lifecycleInput,
    outputInputRef: previous.outputInputRef || lifecycleInput?.outputInputRef || null,
    evidenceRef: previous.evidenceRef || null,
    requiredInspectionPaths,
    requiredInputRefs: arr(nextUnit.requiredInputRefs),
    resolvedRequiredInputRefs: requiredInputRefResolutions,
  };
}

function preparedOutputContract({ unitTypeId, runId, docPath, inputContract, status }) {
  if (unitTypeId === 'worker') {
    return {
      schema: 'living-doc-worker-output/v1',
      status,
      runId,
      livingDocPath: docPath,
      lifecycleInput: inputContract.lifecycleInput,
      nextAuthority: 'reviewer-inference',
    };
  }
  if (unitTypeId === 'commit-intent') {
    return {
      schema: 'living-doc-harness-commit-intent-result/v1',
      approved: false,
      status,
      changedFiles: arr(inputContract.changedFiles),
      message: `${unitTypeId} unit ${status}; final verdict comes from its output contract after execution.`,
      sideEffect: { type: 'git-commit', executed: false, reasonCode: 'unit-not-finalized' },
    };
  }
  if (unitTypeId === 'pr-review') {
    return {
      schema: 'living-doc-harness-pr-review-result/v1',
      status,
      approvedActions: [],
      sideEffect: { type: 'github-pr-review', executed: false, reasonCode: 'unit-not-finalized' },
    };
  }
  if (unitTypeId === 'living-doc-balance-scan') {
    return {
      schema: 'living-doc-balance-scan-result/v1',
      status,
      basis: [`${unitTypeId} unit ${status}.`],
      orderedSkills: [],
    };
  }
  if (unitTypeId === 'closure-review') {
    return {
      schema: 'living-doc-harness-closure-review/v1',
      approved: false,
      reasonCode: 'unit-not-finalized',
      confidence: 'low',
      basis: [`${unitTypeId} unit ${status}.`],
      terminalAllowed: false,
    };
  }
  return {
    schema: getInferenceUnitType(unitTypeId).outputContract.schema,
    status,
    basis: [`${unitTypeId} unit ${status}.`],
  };
}

function normalizePrReviewExternalOutputContract({ output, exitCode, paths, traceRefs }) {
  const allowedStatuses = getInferenceUnitType('pr-review').outputVerdicts;
  const base = {
    ...(output && typeof output === 'object' ? output : {}),
    exitCode,
    ...paths,
    nativeTraceRefs: traceRefs,
  };
  if (allowedStatuses.includes(base.status)) return base;
  const previousReasonCode = base?.sideEffect?.reasonCode || base.reasonCode || null;
  const reasonCode = previousReasonCode === 'unit-not-finalized'
    ? 'pr-review-non-verdict-output'
    : previousReasonCode || 'pr-review-non-verdict-output';
  return {
    ...base,
    schema: 'living-doc-harness-pr-review-result/v1',
    status: 'blocked',
    reasonCode,
    basis: arr(base.basis).length
      ? base.basis
      : ['PR-review headless process exited without emitting an approved, not-required, blocked, or failed verdict.'],
    approvedActions: arr(base.approvedActions),
    sideEffect: {
      ...(base.sideEffect && typeof base.sideEffect === 'object' ? base.sideEffect : {}),
      type: base.sideEffect?.type || 'github-pr-review',
      executed: base.sideEffect?.executed === true,
      reasonCode,
    },
  };
}

function prReviewRoleBoundaryOutputContract({ base, violation, exitCode, paths, traceRefs }) {
  return {
    ...(base && typeof base === 'object' ? base : {}),
    schema: 'living-doc-harness-pr-review-result/v1',
    status: 'blocked',
    reasonCode: 'pr-review-role-boundary-violation',
    basis: [
      'PR-review inference changed repository files or git HEAD while evaluating the review gate.',
      'PR-review must return approved, changes-requested, blocked, or not-required from inspected evidence; source changes must be routed to worker/repair/commit-intent instead.',
      ...arr(base?.basis),
    ],
    approvedActions: [],
    sideEffect: {
      ...(base?.sideEffect && typeof base.sideEffect === 'object' ? base.sideEffect : {}),
      type: base?.sideEffect?.type || 'github-pr-review',
      executed: false,
      reasonCode: 'pr-review-role-boundary-violation',
    },
    roleBoundaryViolation: violation,
    exitCode,
    ...paths,
    nativeTraceRefs: traceRefs,
  };
}

function balanceScanRoleBoundaryOutputContract({ base, violation, exitCode, paths, traceRefs }) {
  return {
    ...(base && typeof base === 'object' ? base : {}),
    schema: 'living-doc-balance-scan-result/v1',
    status: 'blocked',
    reasonCode: 'balance-scan-role-boundary-violation',
    basis: [
      'Balance-scan inference changed files or ran commands outside its scan-only boundary.',
      'Balance-scan may inspect evidence and order the next unit; source changes, rendering, proof execution, and lifecycle control must be routed to another unit.',
      ...arr(base?.basis),
    ],
    orderedSkills: [],
    blocker: {
      ...(base?.blocker && typeof base.blocker === 'object' ? base.blocker : {}),
      reasonCode: 'balance-scan-role-boundary-violation',
      requiredEvidence: [
        'Regenerate the balance-scan prompt as scan-only and route source/proof work to worker, repair-skill, continuation, or controller-owned proof units.',
      ],
    },
    roleBoundaryViolation: violation,
    exitCode,
    ...paths,
    nativeTraceRefs: traceRefs,
  };
}

function normalizeBalanceScanExternalOutputContract({ output, exitCode, paths, traceRefs, roleBoundaryViolation = null }) {
  const allowedStatuses = getInferenceUnitType('living-doc-balance-scan').outputVerdicts;
  const base = {
    ...(output && typeof output === 'object' ? output : {}),
    exitCode,
    ...paths,
    nativeTraceRefs: traceRefs,
  };
  if (roleBoundaryViolation) {
    return balanceScanRoleBoundaryOutputContract({
      base,
      violation: roleBoundaryViolation,
      exitCode,
      paths,
      traceRefs,
    });
  }
  if (allowedStatuses.includes(base.status)) {
    return {
      ...base,
      schema: 'living-doc-balance-scan-result/v1',
      basis: arr(base.basis),
      orderedSkills: arr(base.orderedSkills),
    };
  }
  const reasonCode = base.reasonCode || base.blocker?.reasonCode || 'balance-scan-non-verdict-output';
  return {
    ...base,
    schema: 'living-doc-balance-scan-result/v1',
    status: exitCode === 0 ? 'blocked' : 'failed',
    reasonCode,
    basis: arr(base.basis).length
      ? base.basis
      : ['Balance-scan headless process exited without emitting ordered, no-op, blocked, or failed.'],
    orderedSkills: arr(base.orderedSkills),
  };
}

async function gitHead(cwd) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function gitCommitEvidence(cwd, sha) {
  if (!sha) return null;
  try {
    const [{ stdout: metadata }, { stdout: filesRaw }] = await Promise.all([
      execFileAsync('git', ['show', '-s', '--format=%H%n%s%n%aI', sha], { cwd }),
      execFileAsync('git', ['show', '--format=', '--name-only', '--no-renames', sha], { cwd }),
    ]);
    const [commitSha, subject, committedAt] = metadata.trim().split('\n');
    return {
      sha: commitSha || sha,
      subject: subject || null,
      committedAt: committedAt || null,
      files: filesRaw.split('\n').map((line) => line.trim()).filter(Boolean),
    };
  } catch {
    return null;
  }
}

function commitIntentProposal(rawResult) {
  const output = rawResult?.outputContract && typeof rawResult.outputContract === 'object'
    ? rawResult.outputContract
    : rawResult && typeof rawResult === 'object'
      ? rawResult
      : {};
  return output?.schema === 'living-doc-harness-commit-intent-result/v1' || output?.status || output?.approved != null
    ? output
    : {};
}

function normalizeCommitIntentMessage(value) {
  const message = String(value || '').trim();
  return message || 'Harness-managed commit-intent side effect.';
}

async function controllerCommitFromIntent({ cwd, inputContract, proposal, allowedCommitFiles }) {
  if (proposal?.schema !== 'living-doc-harness-commit-intent-result/v1'
    || proposal?.approved !== true
    || proposal?.status !== 'approved') {
    return {
      attempted: false,
      executed: false,
      reasonCode: proposal?.reasonCode || proposal?.sideEffect?.reasonCode || 'commit-intent-not-approved',
      message: proposal?.message || null,
    };
  }
  if (proposal?.sideEffect?.executed === true) {
    return {
      attempted: false,
      executed: false,
      reasonCode: 'commit-intent-claimed-unit-side-effect',
      message: proposal.message || null,
    };
  }
  const proposedFiles = unique(arr(proposal.changedFiles).length ? arr(proposal.changedFiles) : arr(inputContract.changedFiles));
  const allowedSet = new Set(allowedCommitFiles);
  const forbiddenProposedFiles = proposedFiles.filter((filePath) => !allowedSet.has(filePath));
  if (forbiddenProposedFiles.length) {
    return {
      attempted: false,
      executed: false,
      reasonCode: 'commit-intent-proposed-unapproved-files',
      forbiddenProposedFiles,
      message: proposal.message || null,
    };
  }
  const filesToCommit = unique(allowedCommitFiles);
  if (!filesToCommit.length) {
    return {
      attempted: false,
      executed: false,
      reasonCode: 'commit-intent-approved-empty-scope',
      message: proposal.message || null,
    };
  }
  const beforeSha = await gitHead(cwd);
  try {
    await execFileAsync('git', ['add', '--', ...filesToCommit], { cwd });
    await execFileAsync('git', [
      '-c',
      'user.name=Living Doc Harness',
      '-c',
      'user.email=living-doc-harness@example.invalid',
      'commit',
      '-m',
      normalizeCommitIntentMessage(proposal.message),
      '--',
      ...filesToCommit,
    ], { cwd });
  } catch (err) {
    return {
      attempted: true,
      executed: false,
      reasonCode: 'controller-git-commit-failed',
      message: proposal.message || null,
      error: String(err?.stderr || err?.message || err),
      beforeSha,
      afterSha: await gitHead(cwd),
    };
  }
  const afterSha = await gitHead(cwd);
  const evidence = await gitCommitEvidence(cwd, afterSha);
  return {
    attempted: true,
    executed: Boolean(afterSha && beforeSha !== afterSha && evidence?.sha),
    reasonCode: afterSha && beforeSha !== afterSha && evidence?.sha
      ? 'controller-git-commit-created'
      : 'controller-git-head-unchanged',
    message: proposal.message || null,
    beforeSha,
    afterSha,
    evidence,
  };
}

function commitIntentRoleBoundaryOutputContract({ inputContract, status, exitCode, traceRefs, paths, commitBefore, commitAfter, commitEvidence }) {
  const committedFiles = arr(commitEvidence?.files);
  const sideEffect = {
    type: 'git-commit',
    executed: Boolean(commitAfter && commitBefore && commitBefore !== commitAfter),
    reasonCode: 'commit-intent-mutated-git-history',
    sha: commitEvidence?.sha || commitAfter || null,
    beforeSha: commitBefore,
    afterSha: commitAfter,
    committedAt: commitEvidence?.committedAt || null,
    committedFiles,
    requiredChangedFiles: arr(inputContract.changedFiles),
    allowedCommitFiles: arr(inputContract.allowedCommitFiles),
    forbiddenCommitFiles: arr(inputContract.forbiddenCommitFiles),
    currentRunChangedFiles: arr(inputContract.currentRunChangedFiles),
    preExistingDirtyFiles: arr(inputContract.preExistingDirtyFiles),
  };
  return {
    schema: 'living-doc-harness-commit-intent-result/v1',
    approved: false,
    status: 'blocked',
    changedFiles: unique(arr(inputContract.changedFiles).length ? arr(inputContract.changedFiles) : arr(inputContract.allowedCommitFiles)),
    message: 'Commit-intent unit mutated git history directly; the controller must own commit execution.',
    sideEffect,
    commitTransaction: commitTransactionContract({ inputContract, status: 'blocked', reasonCode: 'commit-intent-mutated-git-history', sideEffect }),
    roleBoundaryViolation: {
      schema: 'living-doc-harness-role-boundary-violation/v1',
      reasonCode: 'commit-intent-mutated-git-history',
      unitId: 'commit-intent',
      headBefore: commitBefore,
      headAfter: commitAfter,
      headChanged: Boolean(commitAfter && commitBefore && commitBefore !== commitAfter),
    },
    exitCode,
    ...paths,
    nativeTraceRefs: traceRefs,
  };
}

function commitTransactionContract({ inputContract, status, reasonCode = null, sideEffect = {}, proposal = null, commitKind = null }) {
  const executed = sideEffect.executed === true && Boolean(sideEffect.sha);
  const blocked = status === 'blocked' || status === 'failed' || sideEffect.reasonCode?.includes('blocked') || sideEffect.reasonCode?.includes('failed');
  const notRequired = status === 'not-required' || sideEffect.required === false;
  return {
    schema: 'living-doc-harness-commit-transaction/v1',
    status: executed ? 'executed' : notRequired ? 'not-required' : blocked ? 'blocked' : status || 'pending',
    commitKind: commitKind || null,
    preRunWorktree: {
      changedFiles: unique([
        ...arr(inputContract.currentRunChangedFiles),
        ...arr(inputContract.preExistingDirtyFiles),
      ]),
      preExistingDirtyFiles: arr(inputContract.preExistingDirtyFiles),
      beforeSha: sideEffect.beforeSha || null,
    },
    postWorkerScope: {
      changedFiles: arr(inputContract.changedFiles),
      currentRunChangedFiles: arr(inputContract.currentRunChangedFiles),
      allowedCommitFiles: arr(sideEffect.allowedCommitFiles).length
        ? arr(sideEffect.allowedCommitFiles)
        : arr(inputContract.allowedCommitFiles),
      forbiddenCommitFiles: arr(sideEffect.forbiddenCommitFiles).length
        ? arr(sideEffect.forbiddenCommitFiles)
        : arr(inputContract.forbiddenCommitFiles),
    },
    commitIntentVerdict: {
      approved: status === 'approved',
      status,
      reasonCode: reasonCode || sideEffect.reasonCode || null,
      message: proposal?.message || null,
    },
    controllerGitExecution: {
      attempted: sideEffect.executed === true || ['controller-git-commit-created', 'controller-git-commit-failed', 'controller-git-head-unchanged'].includes(sideEffect.reasonCode),
      executed,
      source: sideEffect.source || null,
      reasonCode: sideEffect.reasonCode || reasonCode || null,
      beforeSha: sideEffect.beforeSha || null,
      afterSha: sideEffect.afterSha || sideEffect.sha || null,
      error: sideEffect.error || null,
    },
    commitEvidence: executed ? {
      sha: sideEffect.sha,
      committedAt: sideEffect.committedAt || null,
      committedFiles: arr(sideEffect.committedFiles),
      missingRequiredFiles: arr(sideEffect.missingChangedFiles),
      extraCommittedFiles: arr(sideEffect.extraCommittedFiles),
      forbiddenCommittedFiles: arr(sideEffect.forbiddenCommittedFiles),
    } : null,
    blockedReason: executed || notRequired ? null : {
      reasonCode: reasonCode || sideEffect.reasonCode || 'commit-transaction-blocked',
      nextAction: sideEffect.error
        ? 'Repair the controller git execution failure before retrying commit-intent.'
        : 'Refresh the commit scope or resolve dirty worktree facts before closure.',
    },
    reviewerConsumption: {
      gate: executed || notRequired ? 'satisfied' : 'blocked',
      closureConsumable: executed || notRequired,
    },
  };
}

function commitIntentOutputContract({ inputContract, status, exitCode, traceRefs, paths, commitBefore, commitAfter, commitEvidence, rawResult = null, controllerCommit = null }) {
  const changedFiles = unique(arr(inputContract.changedFiles).length
    ? arr(inputContract.changedFiles)
    : arr(inputContract.allowedCommitFiles));
  const rawAllowedFiles = unique(arr(inputContract.allowedCommitFiles).length
    ? arr(inputContract.allowedCommitFiles)
    : changedFiles);
  const livingDocStateScope = livingDocStateCommitScope({
    files: rawAllowedFiles,
    forbiddenFiles: [
      ...arr(inputContract.forbiddenCommitFiles),
      ...arr(inputContract.commitIntent?.forbiddenCommitFiles),
    ],
    livingDocPath: inputContract.livingDocPath || inputContract.commitIntent?.livingDocPath || null,
    renderedHtmlPath: inputContract.renderedHtmlPath || inputContract.commitIntent?.renderedHtmlPath || null,
  });
  const allowedCommitFiles = livingDocStateScope.allowedCommitFiles;
  const forbiddenCommitFiles = livingDocStateScope.forbiddenCommitFiles;
  const proposal = commitIntentProposal(rawResult);
  if (commitBefore && commitAfter && commitBefore !== commitAfter && controllerCommit?.executed !== true) {
    return commitIntentRoleBoundaryOutputContract({
      inputContract,
      status,
      exitCode,
      traceRefs,
      paths,
      commitBefore,
      commitAfter,
      commitEvidence,
    });
  }
  if (commitEvidence?.sha && commitBefore && commitAfter && commitBefore !== commitAfter) {
    const committedFiles = arr(commitEvidence.files);
    const committedSet = new Set(committedFiles);
    const allowedSet = new Set(allowedCommitFiles);
    const forbiddenSet = new Set(forbiddenCommitFiles);
    const livingDocStateSet = new Set(livingDocStateScope.livingDocStateFiles);
    const missingChangedFiles = changedFiles.filter((filePath) => !committedSet.has(filePath));
    const extraCommittedFiles = committedFiles.filter((filePath) => !allowedSet.has(filePath));
    const forbiddenCommittedFiles = committedFiles.filter((filePath) => forbiddenSet.has(filePath));
    const livingDocStateCommittedFiles = committedFiles.filter((filePath) => livingDocStateSet.has(filePath));
    const nonLivingDocStateCommittedFiles = committedFiles.filter((filePath) => !livingDocStateSet.has(filePath));
    const commitKind = livingDocStateCommittedFiles.length > 0 && nonLivingDocStateCommittedFiles.length === 0
      ? 'living-doc-state'
      : 'objective-scope';
    const approved = missingChangedFiles.length === 0
      && extraCommittedFiles.length === 0
      && forbiddenCommittedFiles.length === 0;
    const resultStatus = approved ? 'approved' : 'blocked';
    const reasonCode = approved
      ? 'git-commit-created'
      : extraCommittedFiles.length || forbiddenCommittedFiles.length
        ? 'git-commit-contained-unapproved-files'
        : 'git-commit-missing-required-files';
    const sideEffect = {
      type: 'git-commit',
      executed: true,
      reasonCode,
      sha: commitEvidence.sha,
      beforeSha: commitBefore,
      committedAt: commitEvidence.committedAt,
      committedFiles,
      livingDocStateFiles: livingDocStateScope.livingDocStateFiles,
      livingDocStateCommittedFiles,
      nonLivingDocStateCommittedFiles,
      requiredChangedFiles: changedFiles,
      allowedCommitFiles,
      missingChangedFiles,
      extraCommittedFiles,
      forbiddenCommittedFiles,
      forbiddenCommitFiles,
      currentRunChangedFiles: arr(inputContract.currentRunChangedFiles),
      preExistingDirtyFiles: arr(inputContract.preExistingDirtyFiles),
      source: controllerCommit?.executed === true ? 'controller-deterministic-commit' : 'commit-intent-unit-side-effect',
    };
    return {
      schema: 'living-doc-harness-commit-intent-result/v1',
      approved,
      status: resultStatus,
      commitKind,
      changedFiles,
      message: commitEvidence.subject || inputContract.commitIntent?.message || 'Harness-managed commit-intent side effect.',
      sideEffect,
      commitTransaction: commitTransactionContract({ inputContract, status: resultStatus, reasonCode, sideEffect, proposal, commitKind }),
      exitCode,
      ...paths,
      nativeTraceRefs: traceRefs,
    };
  }
  if (controllerCommit?.attempted || proposal?.approved === true || proposal?.status === 'approved') {
    const sideEffect = {
      type: 'git-commit',
      executed: false,
      reasonCode: controllerCommit?.reasonCode || 'controller-git-commit-not-executed',
      beforeSha: controllerCommit?.beforeSha || commitBefore,
      afterSha: controllerCommit?.afterSha || commitAfter,
      requiredChangedFiles: changedFiles,
      allowedCommitFiles,
      forbiddenCommitFiles,
      forbiddenProposedFiles: arr(controllerCommit?.forbiddenProposedFiles),
      currentRunChangedFiles: arr(inputContract.currentRunChangedFiles),
      preExistingDirtyFiles: arr(inputContract.preExistingDirtyFiles),
      error: controllerCommit?.error || null,
    };
    return {
      schema: 'living-doc-harness-commit-intent-result/v1',
      approved: false,
      status: 'blocked',
      commitKind: 'objective-scope',
      changedFiles,
      message: proposal?.message || controllerCommit?.message || 'Commit-intent proposal could not be committed by the controller.',
      sideEffect,
      commitTransaction: commitTransactionContract({ inputContract, status: 'blocked', reasonCode: sideEffect.reasonCode, sideEffect, proposal, commitKind: 'objective-scope' }),
      exitCode,
      ...paths,
      nativeTraceRefs: traceRefs,
    };
  }
  if (proposal?.schema === 'living-doc-harness-commit-intent-result/v1'
    && ['blocked', 'failed'].includes(proposal.status)) {
    const reasonCode = proposal.sideEffect?.reasonCode || proposal.reasonCode || 'commit-intent-gate-blocked';
    const proposedForbiddenCommitFiles = unique([
      ...arr(proposal.sideEffect?.forbiddenCommitFiles),
      ...arr(proposal.blockedReason?.forbiddenCommitFiles),
      ...arr(proposal.commitTransaction?.postWorkerScope?.forbiddenCommitFiles),
      ...arr(proposal.commitTransaction?.scope?.forbiddenCommitFiles),
    ]);
    const sideEffect = {
      ...(proposal.sideEffect && typeof proposal.sideEffect === 'object' ? proposal.sideEffect : {}),
      type: proposal.sideEffect?.type || 'git-commit',
      executed: false,
      reasonCode,
      beforeSha: proposal.sideEffect?.beforeSha || commitBefore,
      afterSha: proposal.sideEffect?.afterSha || commitAfter,
      requiredChangedFiles: unique(arr(proposal.sideEffect?.requiredChangedFiles).length
        ? arr(proposal.sideEffect.requiredChangedFiles)
        : changedFiles),
      allowedCommitFiles: unique(arr(proposal.sideEffect?.allowedCommitFiles).length
        ? arr(proposal.sideEffect.allowedCommitFiles)
        : allowedCommitFiles),
      forbiddenCommitFiles: proposedForbiddenCommitFiles.length
        ? proposedForbiddenCommitFiles
        : forbiddenCommitFiles,
      currentRunChangedFiles: arr(proposal.sideEffect?.currentRunChangedFiles).length
        ? arr(proposal.sideEffect.currentRunChangedFiles)
        : arr(inputContract.currentRunChangedFiles),
      preExistingDirtyFiles: arr(proposal.sideEffect?.preExistingDirtyFiles).length
        ? arr(proposal.sideEffect.preExistingDirtyFiles)
        : arr(inputContract.preExistingDirtyFiles),
    };
    return {
      ...proposal,
      schema: 'living-doc-harness-commit-intent-result/v1',
      approved: false,
      status: proposal.status,
      commitKind: proposal.commitKind || 'objective-scope',
      changedFiles: unique(arr(proposal.changedFiles).length ? arr(proposal.changedFiles) : changedFiles),
      message: proposal.message || 'Commit-intent unit blocked the scoped commit.',
      sideEffect,
      commitTransaction: commitTransactionContract({ inputContract, status: proposal.status, reasonCode, sideEffect, proposal, commitKind: proposal.commitKind || 'objective-scope' }),
      reasonCode: proposal.reasonCode || reasonCode,
      exitCode,
      ...paths,
      nativeTraceRefs: traceRefs,
    };
  }
  const fallbackSideEffect = {
    type: 'git-commit',
    executed: false,
    reasonCode: commitBefore === commitAfter ? 'git-head-unchanged' : 'git-commit-not-detected',
    beforeSha: commitBefore,
    afterSha: commitAfter,
    requiredChangedFiles: changedFiles,
    forbiddenCommitFiles,
    currentRunChangedFiles: arr(inputContract.currentRunChangedFiles),
    preExistingDirtyFiles: arr(inputContract.preExistingDirtyFiles),
  };
  return {
    ...preparedOutputContract({
      unitTypeId: 'commit-intent',
      runId: inputContract.runId,
      docPath: null,
      inputContract,
      status,
    }),
    status: status === 'finished' ? 'blocked' : status,
    message: 'Commit-intent unit finished without a controller-detectable git commit.',
    sideEffect: fallbackSideEffect,
    commitTransaction: commitTransactionContract({ inputContract, status: 'blocked', reasonCode: fallbackSideEffect.reasonCode, sideEffect: fallbackSideEffect, commitKind: 'objective-scope' }),
    exitCode,
    ...paths,
    nativeTraceRefs: traceRefs,
  };
}

function commitTransactionStatus(outputContract) {
  const sideEffect = outputContract?.sideEffect || {};
  if (outputContract?.approved === true
    && outputContract?.status === 'approved'
    && sideEffect.executed === true
    && sideEffect.sha) {
    return 'approved-executed';
  }
  if (arr(outputContract?.changedFiles).length === 0
    && sideEffect.executed === false
    && sideEffect.reasonCode === 'git-head-unchanged') {
    return 'not-required';
  }
  if (['blocked', 'failed'].includes(outputContract?.status)) return 'blocked';
  if (outputContract?.status === 'approved') return 'approved-pending-controller';
  return 'unknown';
}

function commitTransactionReason(outputContract, controllerCommit = null) {
  return outputContract?.sideEffect?.reasonCode
    || outputContract?.reasonCode
    || controllerCommit?.reasonCode
    || null;
}

function buildCommitTransactionContract({
  runId,
  iteration,
  createdAt,
  inputContract,
  outputContract,
  controllerCommit,
  commitBefore,
  commitAfter,
  resultPath,
  resultRef,
  validationPath,
  validationRef,
}) {
  const sideEffect = outputContract?.sideEffect || {};
  const changedFiles = unique(arr(outputContract?.changedFiles).length
    ? arr(outputContract.changedFiles)
    : arr(inputContract?.changedFiles));
  const allowedCommitFiles = unique(arr(sideEffect.allowedCommitFiles).length
    ? arr(sideEffect.allowedCommitFiles)
    : arr(inputContract?.allowedCommitFiles));
  const forbiddenCommitFiles = unique(arr(sideEffect.forbiddenCommitFiles).length
    ? arr(sideEffect.forbiddenCommitFiles)
    : arr(inputContract?.forbiddenCommitFiles));
  const status = commitTransactionStatus(outputContract);
  const reasonCode = commitTransactionReason(outputContract, controllerCommit);
  return {
    schema: 'living-doc-harness-commit-transaction/v1',
    runId,
    iteration,
    unitId: 'commit-intent',
    createdAt,
    status,
    reasonCode,
    scope: {
      schema: 'living-doc-harness-commit-scope/v1',
      changedFiles,
      currentRunChangedFiles: unique(arr(sideEffect.currentRunChangedFiles).length
        ? arr(sideEffect.currentRunChangedFiles)
        : arr(inputContract?.currentRunChangedFiles)),
      preExistingDirtyFiles: unique(arr(sideEffect.preExistingDirtyFiles).length
        ? arr(sideEffect.preExistingDirtyFiles)
        : arr(inputContract?.preExistingDirtyFiles)),
      allowedCommitFiles,
      forbiddenCommitFiles,
      requiredChangedFiles: unique(arr(sideEffect.requiredChangedFiles).length
        ? arr(sideEffect.requiredChangedFiles)
        : changedFiles),
      missingChangedFiles: unique(arr(sideEffect.missingChangedFiles)),
      extraCommittedFiles: unique(arr(sideEffect.extraCommittedFiles)),
      forbiddenCommittedFiles: unique(arr(sideEffect.forbiddenCommittedFiles)),
    },
    intent: {
      schema: outputContract?.schema || null,
      approved: outputContract?.approved === true,
      status: outputContract?.status || null,
      reasonCode: outputContract?.reasonCode || sideEffect.reasonCode || null,
      message: outputContract?.message || null,
      basis: arr(outputContract?.basis),
      resultPath,
      resultRef,
      validationPath,
      validationRef,
    },
    controller: {
      owner: 'lifecycle-controller',
      attempted: controllerCommit?.attempted === true,
      executed: controllerCommit?.executed === true,
      reasonCode: controllerCommit?.reasonCode || null,
      beforeSha: controllerCommit?.beforeSha || commitBefore || sideEffect.beforeSha || null,
      afterSha: controllerCommit?.afterSha || commitAfter || sideEffect.afterSha || null,
      source: sideEffect.source || null,
      error: controllerCommit?.error || sideEffect.error || null,
    },
    evidence: {
      type: sideEffect.type || 'git-commit',
      executed: sideEffect.executed === true,
      sha: sideEffect.sha || null,
      beforeSha: sideEffect.beforeSha || commitBefore || null,
      afterSha: sideEffect.afterSha || commitAfter || null,
      committedAt: sideEffect.committedAt || null,
      committedFiles: unique(arr(sideEffect.committedFiles)),
      livingDocStateFiles: unique(arr(sideEffect.livingDocStateFiles)),
      livingDocStateCommittedFiles: unique(arr(sideEffect.livingDocStateCommittedFiles)),
      nonLivingDocStateCommittedFiles: unique(arr(sideEffect.nonLivingDocStateCommittedFiles)),
    },
    blockedCondition: outputContract?.blockedCondition || (status === 'blocked'
      ? {
        schema: 'living-doc-harness-commit-transaction-blocker/v1',
        reasonCode: reasonCode || 'commit-transaction-blocked',
      }
      : null),
  };
}

function externalOutputContract({ unitTypeId, runId, docPath, inputContract, status, exitCode, traceRefs, paths, commitBefore, commitAfter, commitEvidence, rawResult = null, roleBoundaryViolation = null, controllerCommit = null }) {
  if (unitTypeId === 'commit-intent') {
    return commitIntentOutputContract({
      inputContract,
      status,
      exitCode,
      traceRefs,
      paths,
      commitBefore,
      commitAfter,
      commitEvidence,
      rawResult,
      controllerCommit,
    });
  }
  if (unitTypeId === 'pr-review') {
    const output = rawResult?.outputContract && typeof rawResult.outputContract === 'object'
      ? rawResult.outputContract
      : rawResult;
    const normalized = output?.schema === 'living-doc-harness-pr-review-result/v1'
      ? normalizePrReviewExternalOutputContract({ output, exitCode, paths, traceRefs })
      : normalizePrReviewExternalOutputContract({
        output: preparedOutputContract({
          unitTypeId,
          runId,
          docPath,
          inputContract,
          status,
        }),
        exitCode,
        paths,
        traceRefs,
      });
    if (roleBoundaryViolation) {
      return prReviewRoleBoundaryOutputContract({
        base: normalized,
        violation: roleBoundaryViolation,
        exitCode,
        paths,
        traceRefs,
      });
    }
    return normalized;
  }
  if (unitTypeId === 'living-doc-balance-scan') {
    const output = rawResult?.outputContract && typeof rawResult.outputContract === 'object'
      ? rawResult.outputContract
      : rawResult;
    if (output?.schema === 'living-doc-balance-scan-result/v1') {
      return normalizeBalanceScanExternalOutputContract({ output, exitCode, paths, traceRefs, roleBoundaryViolation });
    }
    return normalizeBalanceScanExternalOutputContract({
      output: preparedOutputContract({
        unitTypeId,
        runId,
        docPath,
        inputContract,
        status,
      }),
      exitCode,
      paths,
      traceRefs,
      roleBoundaryViolation,
    });
  }
  return {
    ...preparedOutputContract({
      unitTypeId,
      runId,
      docPath,
      inputContract,
      status,
    }),
    exitCode,
    ...paths,
    nativeTraceRefs: traceRefs,
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
    prReviewPolicy: DEFAULT_PR_REVIEW_POLICY,
    startupEvidenceTimeoutMs: Number(process.env.LIVING_DOC_HARNESS_STARTUP_EVIDENCE_TIMEOUT_MS || DEFAULT_STARTUP_EVIDENCE_TIMEOUT_MS),
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
    } else if (flag === '--pr-review-policy') {
      const value = args.shift();
      if (!value) throw new Error('--pr-review-policy requires a value');
      options.prReviewPolicy = normalizePrReviewPolicy(value);
    } else if (flag === '--startup-evidence-timeout-ms') {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 1) throw new Error('--startup-evidence-timeout-ms requires an integer >= 1');
      options.startupEvidenceTimeoutMs = value;
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
  prReviewPolicy = DEFAULT_PR_REVIEW_POLICY,
  startupEvidenceTimeoutMs = Number(process.env.LIVING_DOC_HARNESS_STARTUP_EVIDENCE_TIMEOUT_MS || DEFAULT_STARTUP_EVIDENCE_TIMEOUT_MS),
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
  const normalizedPrReviewPolicy = normalizePrReviewPolicy(prReviewPolicy);
  const normalizedStartupEvidenceTimeoutMs = Number(startupEvidenceTimeoutMs);
  if (!Number.isInteger(normalizedStartupEvidenceTimeoutMs) || normalizedStartupEvidenceTimeoutMs < 1) {
    throw new Error('startupEvidenceTimeoutMs must be an integer >= 1');
  }
  const initialUnit = selectedInitialUnit(lifecycleInput);
  const runConfigValidation = validateAllowedInferenceUnitRunConfig({
    allowedUnitTypes: normalizedAllowedUnitTypes,
    initialUnitType: initialUnit.unitId,
    prReviewPolicy: normalizedPrReviewPolicy,
  });
  if (!runConfigValidation.ok) {
    throw new Error(`invalid harness runner inference unit run config: ${runConfigValidation.violations.map((violation) => violation.message).join('; ')}`);
  }
  const initialInputContract = await buildInitialInputContract({
    doc,
    docPath: relativeDocPath,
    runId,
    iteration,
    lifecycleInput,
    toolProfile: resolvedToolProfile,
    allowedUnitTypes: normalizedAllowedUnitTypes,
    prReviewPolicy: normalizedPrReviewPolicy,
    initialUnit,
    cwd,
  });
  const prompt = `${appendInputContractToPrompt(
    buildPrompt(doc, { docPath: relativeDocPath, runId, lifecycleInput, initialUnit }),
    initialInputContract,
  )}

Harness tool profile:
${JSON.stringify(resolvedToolProfile, null, 2)}
`;
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
        LIVING_DOC_HARNESS_ROLE: initialUnit.unitId,
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
      initialUnitType: initialUnit.unitId,
      initialUnitRole: initialUnit.role,
      prReviewPolicy: normalizedPrReviewPolicy,
      startupEvidenceTimeoutMs: normalizedStartupEvidenceTimeoutMs,
      registrySchema: 'living-doc-harness-inference-unit-type-registry/v1',
    },
    artifacts: {
      state: 'state.json',
      stateRef: artifactRefFromPath({ runId, runDir, filePath: path.join(runDir, 'state.json'), kind: 'run-state' }),
      events: 'events.jsonl',
      eventsRef: artifactRefFromPath({ runId, runDir, filePath: path.join(runDir, 'events.jsonl'), kind: 'run-events' }),
      prompt: 'prompt.md',
      promptRef: artifactRefFromPath({ runId, runDir, filePath: promptPath, kind: 'runner-prompt' }),
      codexEvents: path.relative(runDir, codexEventsPath),
      codexEventsRef: artifactRefFromPath({ runId, runDir, filePath: codexEventsPath, kind: 'codex-events' }),
      codexStderr: path.relative(runDir, codexStderrPath),
      codexStderrRef: artifactRefFromPath({ runId, runDir, filePath: codexStderrPath, kind: 'codex-stderr' }),
      lastMessage: path.relative(runDir, lastMessagePath),
      lastMessageRef: artifactRefFromPath({ runId, runDir, filePath: lastMessagePath, kind: 'last-message' }),
      nativeTraceRefs: [],
      traceDiscovery: 'trace-discovery.json',
      traceDiscoveryRef: artifactRefFromPath({ runId, runDir, filePath: path.join(runDir, 'trace-discovery.json'), kind: 'trace-discovery' }),
    },
    lifecycleInput: lifecycleInput ? {
      mode: lifecycleInput.mode || null,
      previousRunId: lifecycleInput.previousRunId || null,
      previousIteration: lifecycleInput.previousIteration || null,
      instruction: lifecycleInput.instruction || null,
      handoverPath: lifecycleInput.handoverPath || null,
      handoverRef: lifecycleInput.handoverRef || null,
      outputInputPath: lifecycleInput.outputInputPath || null,
      outputInputRef: lifecycleInput.outputInputRef || null,
      selectedUnitType: lifecycleInput.selectedUnitType || lifecycleInput.nextUnit?.unitId || null,
      nextUnit: lifecycleInput.nextUnit || null,
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

  const initialUnitSnapshot = await writeContractBoundInferenceUnitSnapshot({
    runDir,
    rootDir: initialUnitRootDir(initialUnit.unitId),
    iteration,
    sequence: sequenceForUnit(initialUnit.unitId),
    unitId: initialUnit.unitId,
    role: initialUnit.role,
    unitTypeId: initialUnit.unitId,
    allowedUnitTypes: normalizedAllowedUnitTypes,
    prompt,
    inputContract: initialInputContract,
    mode: execute ? 'external-headless-codex-starting' : 'prepared',
    status: execute ? 'starting' : 'prepared',
    basis: [
      execute
        ? `${initialUnit.unitId} inference unit prepared before launching the externally managed headless Codex process.`
        : `${initialUnit.unitId} inference unit prepared without launching Codex because execute is false.`,
    ],
    outputContract: preparedOutputContract({
      unitTypeId: initialUnit.unitId,
      runId,
      docPath: relativeDocPath,
      inputContract: initialInputContract,
      status: execute ? 'starting' : 'prepared',
    }),
    now,
    cwd,
    toolProfile: resolvedToolProfile,
  });
  const initialUnitArtifact = unitArtifactFromSnapshot({
    runId,
    runDir,
    unitId: initialUnit.unitId,
    role: initialUnit.role,
    snapshot: initialUnitSnapshot,
  });
  contract.artifacts.initialInferenceUnit = initialUnitArtifact;
  contract.artifacts[unitArtifactKey(initialUnit.unitId)] = initialUnitArtifact;
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

  const commitBefore = initialUnit.unitId === 'commit-intent' ? await gitHead(cwd) : null;
  const readOnlyBoundaryUnits = ['pr-review', 'living-doc-balance-scan'];
  const hasReadOnlyRoleBoundary = readOnlyBoundaryUnits.includes(initialUnit.unitId);
  const roleBoundaryHeadBefore = hasReadOnlyRoleBoundary ? await gitHead(cwd) : null;
  const roleBoundarySnapshotBefore = hasReadOnlyRoleBoundary ? await gitWorktreeSnapshot(cwd) : null;
  const processStartedAt = new Date().toISOString();
  const child = spawn(codexCommand.command, codexCommand.args, {
    cwd,
    env: {
      ...process.env,
      CODEX_HOME: absoluteCodexHome,
      LIVING_DOC_HARNESS_ROLE: initialUnit.unitId,
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
  const codexEventsStream = createWriteStream(codexEventsPath, { flags: 'a' });
  const codexStderrStream = createWriteStream(codexStderrPath, { flags: 'a' });
  child.stdout.pipe(codexEventsStream);
  child.stderr.pipe(codexStderrStream);

  const closePromise = new Promise((resolve) => {
    child.on('close', resolve);
  });
  const startupEvidenceCancel = { cancelled: false };
  const startupEvidence = await Promise.race([
    closePromise.then((exitCode) => ({ closed: true, exitCode })),
    waitForStartupEvidence({
      codexEventsPath,
      codexStderrPath,
      lastMessagePath,
      absoluteCodexHome,
      processStartedAt,
      traceLimit,
      timeoutMs: normalizedStartupEvidenceTimeoutMs,
      cancel: startupEvidenceCancel,
    }).then((result) => ({ closed: false, ...result })),
  ]);
  if (startupEvidence.closed) startupEvidenceCancel.cancelled = true;
  if (!startupEvidence.closed && !startupEvidence.ok) {
    const defectAt = new Date().toISOString();
    await terminateChildProcess(child);
    await Promise.all([
      closeWritableStream(codexEventsStream),
      closeWritableStream(codexStderrStream),
    ]);
    const diagnostics = await startupDiagnostics({
      codexBin: codexCommand.command,
      cwd,
      absoluteCodexHome,
    });
    const defect = {
      schema: 'living-doc-harness-process-defect/v1',
      runId,
      unitId: initialUnit.unitId,
      role: initialUnit.role,
      reasonCode: 'headless-worker-no-startup-evidence',
      reason: 'Headless Codex process stayed alive without emitting stdout, stderr, last-message, or native trace evidence during the startup window.',
      process: {
        pid: child.pid,
        startedAt: processStartedAt,
        defectAt,
        startupEvidenceTimeoutMs: normalizedStartupEvidenceTimeoutMs,
      },
      missingEvidence: {
        codexEventsPath: path.relative(runDir, codexEventsPath),
        codexEventsBytes: startupEvidence.snapshot.codexEventsBytes,
        codexStderrPath: path.relative(runDir, codexStderrPath),
        codexStderrBytes: startupEvidence.snapshot.codexStderrBytes,
        lastMessagePath: path.relative(runDir, lastMessagePath),
        lastMessageBytes: startupEvidence.snapshot.lastMessageBytes,
        modifiedTraceCount: startupEvidence.snapshot.modifiedTraceCount,
        traceDiscoveryTimedOut: startupEvidence.snapshot.traceDiscoveryTimedOut === true,
      },
      diagnostics,
    };
    contract.status = 'process-defect';
    contract.process.exitCode = null;
    contract.process.finishedAt = defectAt;
    contract.process.startupEvidence = {
      ok: false,
      elapsedMs: startupEvidence.elapsedMs,
      timeoutMs: normalizedStartupEvidenceTimeoutMs,
      snapshot: startupEvidence.snapshot,
      diagnostics,
    };
    contract.artifacts.processDefect = 'process-defect.json';
    state.status = 'process-defect';
    state.updatedAt = defectAt;
    state.nextAction = 'inspect process-defect.json and fix the headless startup evidence boundary';
    await writeJson(path.join(runDir, 'process-defect.json'), defect);
    await writeJson(path.join(runDir, 'contract.json'), contract);
    await writeJson(path.join(runDir, 'state.json'), state);
    await appendJsonl(path.join(runDir, 'events.jsonl'), {
      event: 'headless-startup-evidence-timeout',
      at: defectAt,
      runId,
      unitId: initialUnit.unitId,
      pid: child.pid,
      elapsedMs: startupEvidence.elapsedMs,
      timeoutMs: normalizedStartupEvidenceTimeoutMs,
      processDefectPath: 'process-defect.json',
    });
    const failedUnitOutput = externalOutputContract({
      unitTypeId: initialUnit.unitId,
      runId,
      docPath: relativeDocPath,
      inputContract: initialInputContract,
      status: 'failed',
      exitCode: null,
      traceRefs: [],
      paths: {
        exitCode: null,
        codexEventsPath: path.relative(runDir, codexEventsPath),
        lastMessagePath: path.relative(runDir, lastMessagePath),
        stderrPath: path.relative(runDir, codexStderrPath),
        processDefectPath: 'process-defect.json',
      },
      commitBefore,
      commitAfter: commitBefore,
      commitEvidence: null,
      rawResult: null,
      roleBoundaryViolation: null,
    });
    const failedUnitSnapshot = await writeContractBoundInferenceUnitSnapshot({
      runDir,
      rootDir: initialUnitRootDir(initialUnit.unitId),
      iteration,
      sequence: sequenceForUnit(initialUnit.unitId),
      unitId: initialUnit.unitId,
      role: initialUnit.role,
      unitTypeId: initialUnit.unitId,
      allowedUnitTypes: normalizedAllowedUnitTypes,
      prompt,
      inputContract: initialInputContract,
      sourcePaths: {
        codexEventsPath,
        stderrPath: codexStderrPath,
        lastMessagePath,
      },
      mode: 'external-headless-codex',
      status: 'failed',
      basis: [
        'Headless Codex process did not emit startup evidence before the configured watchdog timeout.',
        'The lifecycle must treat this as a process defect, not as proof of work or objective progress.',
      ],
      outputContract: failedUnitOutput,
      now: defectAt,
      cwd,
      toolProfile: resolvedToolProfile,
    });
    const failedUnitArtifact = unitArtifactFromSnapshot({
      runId,
      runDir,
      unitId: initialUnit.unitId,
      role: initialUnit.role,
      snapshot: failedUnitSnapshot,
    });
    contract.artifacts.initialInferenceUnit = failedUnitArtifact;
    contract.artifacts[unitArtifactKey(initialUnit.unitId)] = failedUnitArtifact;
    await writeJson(path.join(runDir, 'contract.json'), contract);
    const err = new Error(`headless startup evidence timeout for ${initialUnit.unitId}: no stdout/stderr/last-message/native trace within ${normalizedStartupEvidenceTimeoutMs}ms`);
    err.code = 'LIVING_DOC_HARNESS_STARTUP_EVIDENCE_TIMEOUT';
    err.runId = runId;
    err.runDir = runDir;
    err.processDefectPath = path.join(runDir, 'process-defect.json');
    throw err;
  }
  const exitCode = startupEvidence.closed ? startupEvidence.exitCode : await closePromise;
  await Promise.all([
    closeWritableStream(codexEventsStream),
    closeWritableStream(codexStderrStream),
  ]);
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
  if (initialUnit.unitId === 'worker') {
    const controllerArtifactViolations = await workerControllerArtifactViolations(runDir);
    if (controllerArtifactViolations.length) {
      await appendJsonl(path.join(runDir, 'events.jsonl'), {
        event: 'worker-controller-artifact-boundary-violation',
        at: finishedAt,
        runId,
        paths: controllerArtifactViolations,
      });
      throw new Error(`worker inference wrote controller-owned harness artifact paths: ${controllerArtifactViolations.join(', ')}`);
    }
  }

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
  let commitAfter = initialUnit.unitId === 'commit-intent' ? await gitHead(cwd) : null;
  let commitEvidence = initialUnit.unitId === 'commit-intent' ? await gitCommitEvidence(cwd, commitAfter) : null;
  let roleBoundaryViolation = null;
  if (hasReadOnlyRoleBoundary) {
    const roleBoundaryHeadAfter = await gitHead(cwd);
    const roleBoundarySnapshotAfter = await gitWorktreeSnapshot(cwd);
    const worktreeChanges = worktreeSnapshotDelta(roleBoundarySnapshotBefore, roleBoundarySnapshotAfter);
    const commandViolations = await codexEventBoundaryViolations(codexEventsPath, initialUnit.unitId);
    if (roleBoundaryHeadBefore !== roleBoundaryHeadAfter || worktreeChanges.length || commandViolations.length) {
      roleBoundaryViolation = {
        schema: 'living-doc-harness-role-boundary-violation/v1',
        reasonCode: initialUnit.unitId === 'living-doc-balance-scan'
          ? 'balance-scan-side-effect-boundary-violation'
          : 'pr-review-mutated-repository',
        unitId: initialUnit.unitId,
        role: initialUnit.role,
        headBefore: roleBoundaryHeadBefore,
        headAfter: roleBoundaryHeadAfter,
        headChanged: roleBoundaryHeadBefore !== roleBoundaryHeadAfter,
        changedFiles: worktreeChanges.map((entry) => entry.path),
        changes: worktreeChanges,
        commandViolations,
      };
      await appendJsonl(path.join(runDir, 'events.jsonl'), {
        event: 'inference-unit-role-boundary-violation',
        at: finishedAt,
        runId,
        unitId: initialUnit.unitId,
        role: initialUnit.role,
        reasonCode: roleBoundaryViolation.reasonCode,
        headChanged: roleBoundaryViolation.headChanged,
        changedFiles: roleBoundaryViolation.changedFiles,
        commandViolations,
      });
    }
  }
  const outputPaths = {
    exitCode,
    codexEventsPath: path.relative(runDir, codexEventsPath),
    lastMessagePath: path.relative(runDir, lastMessagePath),
    stderrPath: path.relative(runDir, codexStderrPath),
  };
  const rawLastMessage = await readFile(lastMessagePath, 'utf8').catch(() => '');
  const rawLastMessageResult = extractJson(rawLastMessage);
  const selfAuthoredUnitResult = await readSelfAuthoredUnitResult({
    runDir,
    artifact: initialUnitArtifact,
    unitTypeId: initialUnit.unitId,
  });
  const rawUnitResult = outputHasRegisteredVerdict({
    rawResult: rawLastMessageResult,
    unitTypeId: initialUnit.unitId,
  })
    ? rawLastMessageResult
    : selfAuthoredUnitResult?.result || rawLastMessageResult;
  let controllerCommit = null;
  if (initialUnit.unitId === 'commit-intent' && commitBefore === commitAfter) {
    const rawAllowedFiles = unique(arr(initialInputContract.allowedCommitFiles).length
      ? arr(initialInputContract.allowedCommitFiles)
      : arr(initialInputContract.changedFiles));
    const livingDocStateScope = livingDocStateCommitScope({
      files: rawAllowedFiles,
      forbiddenFiles: [
        ...arr(initialInputContract.forbiddenCommitFiles),
        ...arr(initialInputContract.commitIntent?.forbiddenCommitFiles),
      ],
      livingDocPath: initialInputContract.livingDocPath || initialInputContract.commitIntent?.livingDocPath || null,
      renderedHtmlPath: initialInputContract.renderedHtmlPath || initialInputContract.commitIntent?.renderedHtmlPath || null,
    });
    controllerCommit = await controllerCommitFromIntent({
      cwd,
      inputContract: initialInputContract,
      proposal: commitIntentProposal(rawUnitResult),
      allowedCommitFiles: livingDocStateScope.allowedCommitFiles,
    });
    if (controllerCommit.executed === true) {
      commitAfter = controllerCommit.afterSha;
      commitEvidence = controllerCommit.evidence;
      await appendJsonl(path.join(runDir, 'events.jsonl'), {
        event: 'controller-deterministic-commit-created',
        at: new Date().toISOString(),
        runId,
        unitId: initialUnit.unitId,
        sha: controllerCommit.evidence?.sha || controllerCommit.afterSha,
        committedFiles: arr(controllerCommit.evidence?.files),
      });
    } else if (controllerCommit.attempted || commitIntentProposal(rawUnitResult)?.approved === true) {
      await appendJsonl(path.join(runDir, 'events.jsonl'), {
        event: 'controller-deterministic-commit-blocked',
        at: new Date().toISOString(),
        runId,
        unitId: initialUnit.unitId,
        reasonCode: controllerCommit.reasonCode,
      });
    }
  }
  const recoveredUnitResult = rawUnitResult === selfAuthoredUnitResult?.result
    ? { ...selfAuthoredUnitResult, source: 'current-initial-unit-artifact' }
    : null;
  if (recoveredUnitResult) {
    await appendJsonl(path.join(runDir, 'events.jsonl'), {
      event: 'self-authored-inference-unit-result-recovered',
      at: finishedAt,
      runId,
      unitId: initialUnit.unitId,
      source: recoveredUnitResult.source,
      resultPath: path.relative(runDir, recoveredUnitResult.resultPath),
      reasonCode: rawLastMessageResult
        ? 'last-message-output-did-not-carry-registered-verdict'
        : 'last-message-output-was-not-json',
    });
  }
  const finalOutputContract = externalOutputContract({
    unitTypeId: initialUnit.unitId,
    runId,
    docPath: relativeDocPath,
    inputContract: initialInputContract,
    status: finalContract.status,
    exitCode,
    traceRefs: finalContract.artifacts.nativeTraceRefs,
    paths: outputPaths,
    commitBefore,
    commitAfter,
    commitEvidence,
    rawResult: rawUnitResult,
    roleBoundaryViolation,
    controllerCommit,
  });
  const finalUnitSnapshot = await writeContractBoundInferenceUnitSnapshot({
    runDir,
    rootDir: initialUnitRootDir(initialUnit.unitId),
    iteration,
    sequence: sequenceForUnit(initialUnit.unitId),
    unitId: initialUnit.unitId,
    role: initialUnit.role,
    unitTypeId: initialUnit.unitId,
    allowedUnitTypes: normalizedAllowedUnitTypes,
    prompt,
    inputContract: initialInputContract,
    sourcePaths: {
      codexEventsPath,
      stderrPath: codexStderrPath,
      lastMessagePath,
    },
    mode: 'external-headless-codex',
    status: ['commit-intent', 'pr-review', 'living-doc-balance-scan'].includes(initialUnit.unitId) ? finalOutputContract.status : finalContract.status,
    basis: [
      `${initialUnit.unitId} headless Codex process exited with code ${exitCode}.`,
      'Reviewer inference remains the authority for closure, repair, fresh follow-up, or block decisions.',
    ],
    outputContract: finalOutputContract,
    now: finishedAt,
    cwd,
    toolProfile: resolvedToolProfile,
  });
  const finalUnitArtifact = unitArtifactFromSnapshot({
    runId,
    runDir,
    unitId: initialUnit.unitId,
    role: initialUnit.role,
    snapshot: finalUnitSnapshot,
  });
  finalContract.artifacts.initialInferenceUnit = finalUnitArtifact;
  finalContract.artifacts[unitArtifactKey(initialUnit.unitId)] = finalUnitArtifact;
  if (initialUnit.unitId === 'commit-intent') {
    const transactionPath = path.join(runDir, 'artifacts', `iteration-${iteration}-commit-transaction.json`);
    const transactionRef = artifactRefFromPath({
      runId,
      runDir,
      filePath: transactionPath,
      kind: 'commit-transaction',
    });
    const transaction = buildCommitTransactionContract({
      runId,
      iteration,
      createdAt: finishedAt,
      inputContract: initialInputContract,
      outputContract: finalOutputContract,
      controllerCommit,
      commitBefore,
      commitAfter,
      resultPath: finalUnitArtifact.result,
      resultRef: finalUnitArtifact.resultRef,
      validationPath: finalUnitArtifact.validation,
      validationRef: finalUnitArtifact.validationRef,
    });
    await writeJson(transactionPath, transaction);
    finalContract.artifacts.commitTransaction = {
      schema: 'living-doc-harness-commit-transaction-artifact/v1',
      path: path.relative(runDir, transactionPath),
      ref: transactionRef,
      status: transaction.status,
      reasonCode: transaction.reasonCode,
    };
    await appendJsonl(path.join(runDir, 'events.jsonl'), {
      event: 'commit-transaction-written',
      at: finishedAt,
      runId,
      unitId: initialUnit.unitId,
      path: path.relative(runDir, transactionPath),
      status: transaction.status,
      reasonCode: transaction.reasonCode,
    });
  }
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
