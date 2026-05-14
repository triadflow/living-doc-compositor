// Standalone living-doc harness runner.
//
// This is the command boundary for running Codex headless from a living-doc
// objective. By default it creates the durable run directory without launching
// Codex; pass --execute to spawn `codex exec` as a separate process.

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
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

function arr(value) {
  return Array.isArray(value) ? value : [];
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

async function readSelectedUnitHandoffResult({ cwd, runsDir, lifecycleInput, unitTypeId }) {
  const resultPath = lifecycleInput?.nextUnit?.resultPath;
  const previousRunId = lifecycleInput?.previousRunId;
  if (!resultPath || !previousRunId) return null;
  const previousRunDir = path.resolve(cwd, runsDir, previousRunId);
  const absoluteResultPath = path.resolve(previousRunDir, resultPath);
  const relativeFromPreviousRun = path.relative(previousRunDir, absoluteResultPath);
  if (relativeFromPreviousRun.startsWith('..') || path.isAbsolute(relativeFromPreviousRun)) return null;
  return readValidatedUnitResultAtPath({
    resultPath: absoluteResultPath,
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
    'continuation-inference': 7,
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
  try {
    const traces = await discoverCodexTraceFiles({
      codexHome: absoluteCodexHome,
      limit: Math.max(1, Math.min(traceLimit, 5)),
    });
    modifiedTraceCount = traces.filter((trace) => new Date(trace.modifiedAt).getTime() >= startedMs && trace.sizeBytes > 0).length;
  } catch {
    modifiedTraceCount = 0;
  }
  return {
    ...files,
    modifiedTraceCount,
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
      '- Do not edit source files, living doc JSON, rendered HTML, tests, scripts, or run artifacts.',
      '- Do not render the living doc, run implementation proof tests, commit, or run lifecycle/reviewer/finalizer/dashboard/proof-route commands.',
      '- If source changes or proof execution are needed, return blocked or order the next unit type; do not perform that work from balance-scan.',
    ];
  }
  if (unitId === 'pr-review') {
    return [
      'PR-review role boundary:',
      '- This unit is read-only over the repository source tree. Inspect evidence and return approved, not-required, blocked, or failed.',
      '- Do not edit source files, living doc JSON, rendered HTML, tests, scripts, or commits from this unit. If a defect needs source changes, return blocked with the required follow-up unit instead.',
    ];
  }
  if (unitId === 'continuation-inference') {
    return [
      'Continuation role boundary:',
      '- Inspect the prior output/input contract and decide the next executable unit type.',
      '- Do not perform the implementation work yourself unless the selected unit contract explicitly grants that role.',
    ];
  }
  if (unitId === 'closure-review') {
    return [
      'Closure-review role boundary:',
      '- Inspect proof, acceptance criteria, reviewer verdicts, PR-review evidence, and controller hard facts.',
      '- Return a closure verdict only; do not edit source files, living docs, rendered HTML, tests, scripts, or commits.',
    ];
  }
  return [
    'Worker role boundary:',
    '- Work from the living doc objective and produce concrete source-system changes or a clear blocker.',
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
      'Use this lifecycle input as the next controlled input. Continue while the lifecycle input is actionable.',
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
    const changedFiles = unique([...arr(commitScope.allowedCommitFiles), ...arr(nextUnit.changedFiles)]);
    return {
      schema: 'living-doc-harness-commit-intent-input/v1',
      runId,
      iteration,
      changedFiles,
      currentRunChangedFiles: commitScope.currentRunChangedFiles,
      preExistingDirtyFiles: commitScope.preExistingDirtyFiles,
      allowedCommitFiles: changedFiles,
      forbiddenCommitFiles: commitScope.forbiddenCommitFiles,
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
        allowedCommitFiles: changedFiles,
        forbiddenCommitFiles: commitScope.forbiddenCommitFiles,
      },
      commitScope: {
        ...commitScope,
        allowedCommitFiles: changedFiles,
      },
      commitPolicy: {
        exactFilesOnly: true,
        forbidPreExistingDirtyFiles: true,
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

  if (initialUnit.unitId === 'continuation-inference') {
    return {
      schema: 'living-doc-continuation-input/v1',
      runId,
      iteration,
      reasonCode: nextUnit.reasonCode || previous.outputInput?.previousOutput?.classification || 'continuation-required',
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
  if (unitTypeId === 'continuation-inference') {
    return {
      schema: 'living-doc-continuation-result/v1',
      status,
      basis: [`${unitTypeId} unit ${status}.`],
      nextRecommendedUnitType: 'worker',
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

function normalizeContinuationExternalOutputContract({ output, exitCode, paths, traceRefs }) {
  const allowedStatuses = getInferenceUnitType('continuation-inference').outputVerdicts;
  const base = {
    ...(output && typeof output === 'object' ? output : {}),
    exitCode,
    ...paths,
    nativeTraceRefs: traceRefs,
  };
  if (allowedStatuses.includes(base.status)) return base;
  const reasonCode = base.reasonCode || 'continuation-non-verdict-output';
  return {
    ...base,
    schema: 'living-doc-continuation-result/v1',
    status: 'blocked',
    reasonCode,
    basis: arr(base.basis).length
      ? base.basis
      : ['Continuation headless process exited without emitting continuation-required, blocked, or ready.'],
    nextRecommendedUnitType: base.nextRecommendedUnitType || 'worker',
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

function commitIntentOutputContract({ inputContract, status, exitCode, traceRefs, paths, commitBefore, commitAfter, commitEvidence }) {
  const changedFiles = unique(arr(inputContract.allowedCommitFiles).length
    ? arr(inputContract.allowedCommitFiles)
    : arr(inputContract.changedFiles));
  const forbiddenCommitFiles = unique([
    ...arr(inputContract.forbiddenCommitFiles),
    ...arr(inputContract.commitIntent?.forbiddenCommitFiles),
  ]);
  if (commitEvidence?.sha && commitBefore && commitAfter && commitBefore !== commitAfter) {
    const committedFiles = arr(commitEvidence.files);
    const committedSet = new Set(committedFiles);
    const allowedSet = new Set(changedFiles);
    const forbiddenSet = new Set(forbiddenCommitFiles);
    const missingChangedFiles = changedFiles.filter((filePath) => !committedSet.has(filePath));
    const extraCommittedFiles = committedFiles.filter((filePath) => !allowedSet.has(filePath));
    const forbiddenCommittedFiles = committedFiles.filter((filePath) => forbiddenSet.has(filePath));
    const approved = missingChangedFiles.length === 0
      && extraCommittedFiles.length === 0
      && forbiddenCommittedFiles.length === 0;
    return {
      schema: 'living-doc-harness-commit-intent-result/v1',
      approved,
      status: approved ? 'approved' : 'blocked',
      changedFiles,
      message: commitEvidence.subject || inputContract.commitIntent?.message || 'Harness-managed commit-intent side effect.',
      sideEffect: {
        type: 'git-commit',
        executed: true,
        reasonCode: approved
          ? 'git-commit-created'
          : extraCommittedFiles.length || forbiddenCommittedFiles.length
            ? 'git-commit-contained-unapproved-files'
            : 'git-commit-missing-required-files',
        sha: commitEvidence.sha,
        beforeSha: commitBefore,
        committedAt: commitEvidence.committedAt,
        committedFiles,
        requiredChangedFiles: changedFiles,
        missingChangedFiles,
        extraCommittedFiles,
        forbiddenCommittedFiles,
        forbiddenCommitFiles,
        currentRunChangedFiles: arr(inputContract.currentRunChangedFiles),
        preExistingDirtyFiles: arr(inputContract.preExistingDirtyFiles),
      },
      exitCode,
      ...paths,
      nativeTraceRefs: traceRefs,
    };
  }
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
    sideEffect: {
      type: 'git-commit',
      executed: false,
      reasonCode: commitBefore === commitAfter ? 'git-head-unchanged' : 'git-commit-not-detected',
      beforeSha: commitBefore,
      afterSha: commitAfter,
      requiredChangedFiles: changedFiles,
      forbiddenCommitFiles,
      currentRunChangedFiles: arr(inputContract.currentRunChangedFiles),
      preExistingDirtyFiles: arr(inputContract.preExistingDirtyFiles),
    },
    exitCode,
    ...paths,
    nativeTraceRefs: traceRefs,
  };
}

function externalOutputContract({ unitTypeId, runId, docPath, inputContract, status, exitCode, traceRefs, paths, commitBefore, commitAfter, commitEvidence, rawResult = null, roleBoundaryViolation = null }) {
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
  if (unitTypeId === 'continuation-inference') {
    const output = rawResult?.outputContract && typeof rawResult.outputContract === 'object'
      ? rawResult.outputContract
      : rawResult;
    if (output?.schema === 'living-doc-continuation-result/v1') {
      return normalizeContinuationExternalOutputContract({ output, exitCode, paths, traceRefs });
    }
    return normalizeContinuationExternalOutputContract({
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
      },
    };
    contract.status = 'process-defect';
    contract.process.exitCode = null;
    contract.process.finishedAt = defectAt;
    contract.process.startupEvidence = {
      ok: false,
      elapsedMs: startupEvidence.elapsedMs,
      timeoutMs: normalizedStartupEvidenceTimeoutMs,
      snapshot: startupEvidence.snapshot,
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
  const commitAfter = initialUnit.unitId === 'commit-intent' ? await gitHead(cwd) : null;
  const commitEvidence = initialUnit.unitId === 'commit-intent' ? await gitCommitEvidence(cwd, commitAfter) : null;
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
  const selectedUnitHandoffResult = await readSelectedUnitHandoffResult({
    cwd,
    runsDir,
    lifecycleInput,
    unitTypeId: initialUnit.unitId,
  });
  const rawUnitResult = outputHasRegisteredVerdict({
    rawResult: rawLastMessageResult,
    unitTypeId: initialUnit.unitId,
  })
    ? rawLastMessageResult
    : selfAuthoredUnitResult?.result || selectedUnitHandoffResult?.result || rawLastMessageResult;
  const recoveredUnitResult = rawUnitResult === selfAuthoredUnitResult?.result
    ? { ...selfAuthoredUnitResult, source: 'current-initial-unit-artifact' }
    : rawUnitResult === selectedUnitHandoffResult?.result
      ? { ...selectedUnitHandoffResult, source: 'selected-unit-handoff-artifact' }
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
    status: ['commit-intent', 'pr-review', 'continuation-inference', 'living-doc-balance-scan'].includes(initialUnit.unitId) ? finalOutputContract.status : finalContract.status,
    basis: [
      `${initialUnit.unitId} headless Codex process exited with code ${exitCode}.`,
      'Reviewer inference remains the authority for closure, repair, resume, or block decisions.',
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
