#!/usr/bin/env node
// Local backend/frontend dashboard for living-doc harness runs.
//
// The static evidence dashboard remains the committed proof artifact. This
// server is the local operator surface: it reads run directories, exposes
// sanitized JSON APIs, and serves a small frontend that refreshes while runs
// are being inspected.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHarnessRun } from './living-doc-harness-runner.mjs';
import { collectRunEvidence, writeEvidenceBundle } from './living-doc-harness-evidence-dashboard.mjs';
import { DEFAULT_PR_REVIEW_POLICY, normalizePrReviewPolicy } from './living-doc-harness-inference-unit-types.mjs';

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_PORT = 4334;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function arr(value) {
  return Array.isArray(value) ? value : [];
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

function parseArgs(argv) {
  const options = {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || DEFAULT_PORT),
    cwd: process.cwd(),
    runsDir: '.living-doc-runs',
    evidenceDir: 'evidence/living-doc-harness',
  };

  const args = [...argv];
  while (args.length) {
    const flag = args.shift();
    if (flag === '--host') {
      options.host = args.shift();
      if (!options.host) throw new Error('--host requires a value');
    } else if (flag === '--port') {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 1) throw new Error('--port requires an integer');
      options.port = value;
    } else if (flag === '--runs-dir') {
      options.runsDir = args.shift();
      if (!options.runsDir) throw new Error('--runs-dir requires a value');
    } else if (flag === '--evidence-dir') {
      options.evidenceDir = args.shift();
      if (!options.evidenceDir) throw new Error('--evidence-dir requires a value');
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }

  return options;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listRunDirs(runsDir) {
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(runsDir, entry.name));
    const withContracts = [];
    for (const dir of dirs) {
      if (await exists(path.join(dir, 'contract.json'))) withContracts.push(dir);
    }
    return withContracts;
  } catch {
    return [];
  }
}

async function listLifecycleDirs(runsDir) {
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(runsDir, entry.name));
    const withResults = [];
    for (const dir of dirs) {
      if (
        await exists(path.join(dir, 'lifecycle-result.json'))
        || await exists(path.join(dir, 'active-lifecycle.json'))
      ) withResults.push(dir);
    }
    return withResults;
  } catch {
    return [];
  }
}

async function tailTextFile(filePath, { lines = 80, maxBytes = 250000 } = {}) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const clipped = raw.length > maxBytes ? raw.slice(-maxBytes) : raw;
    return clipped.split('\n').filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

async function fileFingerprint(filePath) {
  try {
    const info = await stat(filePath);
    return {
      exists: true,
      size: info.size,
      mtimeMs: Math.trunc(info.mtimeMs),
    };
  } catch {
    return {
      exists: false,
      size: 0,
      mtimeMs: 0,
    };
  }
}

async function readJsonlTail(filePath, { lines = 120 } = {}) {
  const rawLines = await tailTextFile(filePath, { lines, maxBytes: 350000 });
  return rawLines.map((line, index) => {
    try {
      const parsed = JSON.parse(line);
      return {
        line,
        index,
        parsed,
        event: parsed.event || parsed.type || parsed.name || 'jsonl-entry',
        at: parsed.at || parsed.timestamp || null,
      };
    } catch {
      return {
        line,
        index,
        parsed: null,
        event: 'text-line',
        at: null,
      };
    }
  });
}

function eventHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
}

function streamEvent(type, payload = {}, { at = null, source = 'dashboard-server', ordinal = null } = {}) {
  const createdAt = at || payload.at || new Date().toISOString();
  const body = {
    schema: 'living-doc-harness-dashboard-event/v1',
    type,
    at: createdAt,
    source,
    ordinal,
    payload,
    privacy: {
      localOperatorOnly: true,
      rawPromptIncluded: false,
      rawNativeTraceIncluded: false,
      supervisingChatStateIncluded: false,
    },
  };
  body.eventId = `${type}:${eventHash({ type, source, payload, ordinal })}`;
  return body;
}

async function readRunTail(runDir, { lines = 80 } = {}) {
  const safeLines = Number.isInteger(lines) && lines > 0 && lines <= 300 ? lines : 80;
  return {
    schema: 'living-doc-harness-run-tail/v1',
    runId: path.basename(runDir),
    privacy: {
      committedEvidence: false,
      localOperatorOnly: true,
      rawWrapperEventTailIncluded: true,
      rawNativeTraceIncluded: false,
    },
    wrapperEvents: await tailTextFile(path.join(runDir, 'codex-turns', 'codex-events.jsonl'), { lines: safeLines }),
    stderr: await tailTextFile(path.join(runDir, 'codex-turns', 'codex-stderr.log'), { lines: Math.min(safeLines, 80) }),
    lastMessage: await tailTextFile(path.join(runDir, 'codex-turns', 'last-message.txt'), { lines: Math.min(safeLines, 80) }),
    runEvents: await tailTextFile(path.join(runDir, 'events.jsonl'), { lines: safeLines }),
  };
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function summarizeToolProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  return {
    name: profile.name || null,
    isolation: profile.isolation || null,
    sandboxMode: profile.sandboxMode || null,
    mcpMode: profile.mcpMode || null,
    mcpAllowlist: arr(profile.mcpAllowlist),
  };
}

function firstToolProfile(...candidates) {
  for (const candidate of candidates) {
    const profile = summarizeToolProfile(candidate?.toolProfile || candidate?.process?.toolProfile);
    if (profile?.name) return profile;
  }
  return null;
}

function iterationNumberFromDirName(name) {
  const match = String(name || '').match(/^iteration-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function sequenceNumberFromDirName(name) {
  const match = String(name || '').match(/^(\d+)-/);
  return match ? Number(match[1]) : null;
}

async function listRepairUnits(runDir, { cwd } = {}) {
  const repairRoot = path.join(runDir, 'repair-skills');
  let iterationEntries = [];
  try {
    iterationEntries = await readdir(repairRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const units = [];
  for (const iterationEntry of iterationEntries) {
    if (!iterationEntry.isDirectory()) continue;
    const iterationDir = path.join(repairRoot, iterationEntry.name);
    const iteration = iterationNumberFromDirName(iterationEntry.name);
    let unitEntries = [];
    try {
      unitEntries = await readdir(iterationDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const unitEntry of unitEntries) {
      if (!unitEntry.isDirectory()) continue;
      const unitDir = path.join(iterationDir, unitEntry.name);
      const inputPath = path.join(unitDir, 'input-contract.json');
      const resultPath = path.join(unitDir, 'result.json');
      const validationPath = path.join(unitDir, 'validation.json');
      const codexEventsPath = path.join(unitDir, 'codex-events.jsonl');
      const stderrPath = path.join(unitDir, 'stderr.log');
      const lastMessagePath = path.join(unitDir, 'last-message.txt');
      const input = await readJson(inputPath, {});
      const result = await readJson(resultPath, null);
      const validation = await readJson(validationPath, null);
      const outputContract = result?.outputContract || {};
      const hasCodexEvents = await exists(codexEventsPath);
      const hasResult = result !== null;
      const status = result?.status || (hasCodexEvents ? 'running' : 'prepared');
      units.push({
        schema: 'living-doc-harness-repair-unit-summary/v1',
        runId: path.basename(runDir),
        iteration,
        iterationDir: iterationEntry.name,
        unitDir: unitEntry.name,
        unitKey: `${iterationEntry.name}/${unitEntry.name}`,
        sequence: input.sequence ?? sequenceNumberFromDirName(unitEntry.name),
        unitId: result?.unitId || input.skill || unitEntry.name.replace(/^\d+-/, ''),
        role: result?.role || input.unitRole || null,
        status,
        mode: result?.mode || null,
        toolProfile: firstToolProfile(result, input),
        validationOk: validation?.ok ?? null,
        hasCodexEvents,
        hasResult,
        changedFiles: arr(outputContract.changedFiles),
        commit: outputContract.commit || outputContract.gitCommit || null,
        commitSha: outputContract.commitSha || outputContract.commitHash || outputContract.gitCommitSha || outputContract.commit?.sha || outputContract.gitCommit?.sha || null,
        commitMessage: outputContract.commitMessage || outputContract.commit?.message || outputContract.gitCommit?.message || null,
        commitPolicy: outputContract.commitPolicy || null,
        commitIntent: hasResult ? normalizeDashboardCommitIntent(outputContract.commitIntent, {
          changedFiles: arr(outputContract.changedFiles),
        }) : null,
        paths: {
          promptPath: relativeTo(cwd, path.join(unitDir, 'prompt.md')),
          inputContractPath: relativeTo(cwd, inputPath),
          codexEventsPath: relativeTo(cwd, codexEventsPath),
          stderrPath: relativeTo(cwd, stderrPath),
          lastMessagePath: relativeTo(cwd, lastMessagePath),
          resultPath: relativeTo(cwd, resultPath),
          validationPath: relativeTo(cwd, validationPath),
        },
      });
    }
  }
  return units.sort((a, b) => (a.iteration || 0) - (b.iteration || 0) || (a.sequence || 0) - (b.sequence || 0));
}

async function readRepairUnitTail(runDir, { iterationDir, unitDir, lines = 80 } = {}) {
  const safeLines = Number.isInteger(lines) && lines > 0 && lines <= 300 ? lines : 80;
  if (!/^iteration-\d+$/.test(iterationDir || '')) throw new Error('invalid repair iteration');
  if (!/^\d+-[a-z0-9-]+$/i.test(unitDir || '')) throw new Error('invalid repair unit');
  const target = path.join(runDir, 'repair-skills', iterationDir, unitDir);
  const input = await readJson(path.join(target, 'input-contract.json'), {});
  const result = await readJson(path.join(target, 'result.json'), null);
  const validation = await readJson(path.join(target, 'validation.json'), null);
  if (!input?.schema && !result?.schema && !await exists(path.join(target, 'prompt.md'))) {
    throw new Error(`repair unit not found: ${iterationDir}/${unitDir}`);
  }
  return {
    schema: 'living-doc-harness-repair-unit-tail/v1',
    runId: path.basename(runDir),
    unitKey: `${iterationDir}/${unitDir}`,
    iteration: iterationNumberFromDirName(iterationDir),
    sequence: input.sequence ?? sequenceNumberFromDirName(unitDir),
    unitId: result?.unitId || input.skill || unitDir.replace(/^\d+-/, ''),
    role: result?.role || input.unitRole || null,
    status: result?.status || (await exists(path.join(target, 'codex-events.jsonl')) ? 'running' : 'prepared'),
    mode: result?.mode || null,
    validationOk: validation?.ok ?? null,
    privacy: {
      committedEvidence: false,
      localOperatorOnly: true,
      rawRepairUnitEventTailIncluded: true,
      rawPromptIncluded: false,
      rawNativeTraceIncluded: false,
    },
    codexEvents: await tailTextFile(path.join(target, 'codex-events.jsonl'), { lines: safeLines }),
    stderr: await tailTextFile(path.join(target, 'stderr.log'), { lines: Math.min(safeLines, 80) }),
    lastMessage: await tailTextFile(path.join(target, 'last-message.txt'), { lines: Math.min(safeLines, 80) }),
    result: await tailTextFile(path.join(target, 'result.json'), { lines: Math.min(safeLines, 80) }),
    validation: await tailTextFile(path.join(target, 'validation.json'), { lines: Math.min(safeLines, 80) }),
  };
}

async function predictRunIdentity({ docPath, cwd, runsDir, now }) {
  const absoluteDocPath = path.resolve(cwd, docPath);
  const rawDoc = await readFile(absoluteDocPath, 'utf8');
  const doc = JSON.parse(rawDoc);
  const runId = `ldh-${timestampForId(now)}-${slug(doc.docId || doc.title || path.basename(docPath, '.json'))}`;
  return {
    runId,
    runDir: path.resolve(cwd, runsDir, runId),
  };
}

async function startBackgroundHarnessRun({
  docPath,
  cwd,
  runsDir,
  now,
  codexBin = 'codex',
  codexHome = null,
  traceLimit = 10,
} = {}) {
  const identity = await predictRunIdentity({ docPath, cwd, runsDir, now });
  const args = [
    'scripts/living-doc-harness-runner.mjs',
    'start',
    docPath,
    '--runs-dir',
    runsDir,
    '--execute',
    '--now',
    now,
    '--codex-bin',
    codexBin,
    '--trace-limit',
    String(traceLimit),
  ];
  if (codexHome) args.push('--codex-home', codexHome);
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  return {
    ...identity,
    supervisorPid: child.pid,
  };
}

function predictLifecycleIdentity({ docPath, cwd, runsDir, now }) {
  const resultId = `ldhl-${timestampForId(now)}-${path.basename(docPath, '.json').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  return {
    resultId,
    lifecycleDir: path.resolve(cwd, runsDir, resultId),
  };
}

async function writeActiveLifecycleSnapshot({
  lifecycleDir,
  resultId,
  docPath,
  createdAt,
  supervisorPid = null,
  toolProfile = null,
  executeProofRoutes = false,
  prReviewPolicy = DEFAULT_PR_REVIEW_POLICY,
  command = null,
} = {}) {
  const normalizedPrReviewPolicy = normalizePrReviewPolicy(prReviewPolicy);
  await mkdir(lifecycleDir, { recursive: true });
  const snapshot = {
    schema: 'living-doc-harness-active-lifecycle/v1',
    resultId,
    createdAt,
    updatedAt: new Date().toISOString(),
    docPath,
    status: 'running',
    finalState: { kind: 'running' },
    supervisorPid,
    executeProofRoutes: executeProofRoutes === true,
    runConfig: {
      prReviewPolicy: normalizedPrReviewPolicy,
    },
    prReviewPolicy: normalizedPrReviewPolicy,
    toolProfile,
    command,
  };
  await writeFile(path.join(lifecycleDir, 'active-lifecycle.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return snapshot;
}

async function startBackgroundLifecycle({
  docPath,
  cwd,
  runsDir,
  evidenceDir,
  dashboardPath,
  now,
  codexBin = 'codex',
  codexHome = null,
  traceLimit = 10,
  execute = false,
  executeReviewer = null,
  executeRepairSkills = false,
  executeRepairSkillUnits = false,
  executeProofRoutes = false,
  toolProfile = 'local-harness',
  evidenceSequencePath = null,
  prReviewPolicy = DEFAULT_PR_REVIEW_POLICY,
} = {}) {
  const normalizedPrReviewPolicy = normalizePrReviewPolicy(prReviewPolicy);
  const identity = predictLifecycleIdentity({ docPath, cwd, runsDir, now });
  const args = [
    'scripts/living-doc-harness-lifecycle.mjs',
    'run',
    docPath,
    '--runs-dir',
    runsDir,
    '--evidence-dir',
    evidenceDir,
    '--dashboard',
    dashboardPath,
    '--now',
    now,
    '--codex-bin',
    codexBin,
    '--trace-limit',
    String(traceLimit),
  ];
  if (codexHome) args.push('--codex-home', codexHome);
  if (evidenceSequencePath) args.push('--evidence-sequence', evidenceSequencePath);
  if (execute) args.push('--execute');
  if (executeReviewer === true) args.push('--execute-reviewer');
  if (executeReviewer === false) args.push('--no-execute-reviewer');
  if (executeRepairSkills) args.push('--execute-repair-skills');
  if (executeRepairSkillUnits) args.push('--execute-repair-skill-units');
  if (executeProofRoutes) args.push('--execute-proof-routes');
  if (toolProfile) args.push('--tool-profile', toolProfile);
  args.push('--pr-review-policy', normalizedPrReviewPolicy.mode);

  const child = spawn(process.execPath, args, {
    cwd,
    stdio: 'ignore',
    detached: true,
  });
  await writeActiveLifecycleSnapshot({
    lifecycleDir: identity.lifecycleDir,
    resultId: identity.resultId,
    docPath,
    createdAt: now,
    supervisorPid: child.pid,
    toolProfile,
    executeProofRoutes,
    prReviewPolicy: normalizedPrReviewPolicy,
    command: {
      command: process.execPath,
      args,
      cwd,
    },
  });
  child.unref();
  return {
    ...identity,
    supervisorPid: child.pid,
    toolProfile,
    executeProofRoutes,
    prReviewPolicy: normalizedPrReviewPolicy,
  };
}

function relativeTo(cwd, filePath) {
  if (!filePath) return null;
  const absolute = path.resolve(cwd, filePath);
  const relative = path.relative(cwd, absolute);
  return relative && !relative.startsWith('..') ? relative : absolute;
}

function samePath(cwd, left, right) {
  if (!left || !right) return false;
  return path.resolve(cwd, left) === path.resolve(cwd, right);
}

function htmlPathForDoc(docPath) {
  return docPath ? String(docPath).replace(/\.json$/i, '.html') : null;
}

function shortCommit(value) {
  const text = String(value || '');
  return text ? text.slice(0, 10) : '';
}

function normalizeDashboardCommitIntent(intent, { changedFiles = [] } = {}) {
  const files = arr(changedFiles);
  if (!intent || typeof intent !== 'object') {
    if (!files.length) {
      return {
        required: false,
        reason: 'No changed files were reported by the repair unit.',
        message: '',
        body: [],
        changedFiles: [],
      };
    }
    return null;
  }
  const intentFiles = Array.isArray(intent.changedFiles) ? intent.changedFiles : files;
  return {
    required: intent.required === true,
    reason: intent.reason || (intent.required === true ? 'Repair unit proposed a deferred commit.' : 'Repair unit did not require a commit.'),
    message: intent.message || '',
    body: Array.isArray(intent.body) ? intent.body : (intent.body ? [String(intent.body)] : []),
    changedFiles: intentFiles,
  };
}

function commitIntentForDashboard({ unit, chainSkillResult = null, changedFiles = [] } = {}) {
  const hasChainIntent = chainSkillResult?.commitIntent && typeof chainSkillResult.commitIntent === 'object';
  const hasUnitIntent = unit?.commitIntent && typeof unit.commitIntent === 'object';
  if (!hasChainIntent && !hasUnitIntent && !chainSkillResult && unit?.hasResult !== true) return null;
  const evidence = normalizeDashboardCommitIntent(
    hasChainIntent ? chainSkillResult.commitIntent : (hasUnitIntent ? unit.commitIntent : null),
    { changedFiles },
  );
  if (!evidence) return null;
  return {
    ...evidence,
    source: hasChainIntent ? 'repair-chain-result' : (hasUnitIntent ? 'repair-unit-result' : 'changed-files'),
  };
}

function resolveArtifactRef({ cwd, baseDir, ref }) {
  if (!ref) return null;
  if (path.isAbsolute(ref)) return ref;
  if (String(ref).startsWith('.')) return path.resolve(cwd, ref);
  return path.resolve(baseDir || cwd, ref);
}

function safeEntryName(value) {
  return /^[a-zA-Z0-9_.-]+$/.test(String(value || ''));
}

function repairChainSkillResultForUnit(repairChain, unit, { cwd } = {}) {
  const skillResults = arr(repairChain?.skillResults);
  return skillResults.find((item) =>
    (item.sequence ?? null) === (unit.sequence ?? null)
    || (item.skill && item.skill === unit.unitId)
    || (cwd && item.resultPath && unit.paths?.resultPath && samePath(cwd, item.resultPath, unit.paths.resultPath))
  ) || null;
}

function graphNode(id, fields = {}) {
  return {
    id,
    type: fields.type || 'artifact',
    role: fields.role || null,
    label: fields.label || id,
    status: fields.status || 'unknown',
    iteration: fields.iteration ?? null,
    artifactPaths: fields.artifactPaths || {},
    privacy: {
      localOperatorOnly: true,
      rawPromptIncluded: false,
      rawNativeTraceIncluded: false,
      ...(fields.privacy || {}),
    },
    meta: fields.meta || {},
  };
}

function graphEdge(id, from, to, fields = {}) {
  return {
    id,
    from,
    to,
    type: fields.type || 'contract-handoff',
    label: fields.label || id,
    status: fields.status || 'unknown',
    contract: fields.contract || {},
    gate: fields.gate || null,
    lifecycleEffect: fields.lifecycleEffect || null,
  };
}

export async function collectDashboardLifecycles({ runsDir, cwd }) {
  const lifecycleDirs = await listLifecycleDirs(runsDir);
  const lifecycles = [];
  const errors = [];
  for (const lifecycleDir of lifecycleDirs) {
    try {
      const resultPath = path.join(lifecycleDir, 'lifecycle-result.json');
      const activePath = path.join(lifecycleDir, 'active-lifecycle.json');
      const result = await readJson(resultPath, null);
      const active = result ? null : await readJson(activePath, {});
      const source = result || active;
      const activeRuntime = active ? activeLifecycleRuntime(active) : null;
      lifecycles.push({
        schema: 'living-doc-harness-dashboard-lifecycle/v1',
        resultId: source.resultId || path.basename(lifecycleDir),
        lifecycleDir: relativeTo(cwd, lifecycleDir),
        createdAt: source.createdAt || null,
        docPath: source.docPath || null,
        finalState: result?.finalState || activeRuntime?.finalState || (active?.status ? { kind: active.status } : null),
        iterationCount: result?.iterationCount ?? (result?.iterations || []).length,
        active: Boolean(activeRuntime?.active),
        supervisorPid: active?.supervisorPid ?? null,
        supervisorAlive: activeRuntime?.supervisorAlive ?? null,
        prReviewPolicy: source.runConfig?.prReviewPolicy || source.prReviewPolicy || null,
        toolProfile: active?.toolProfile || null,
      });
    } catch (err) {
      errors.push({
        lifecycleDir: relativeTo(cwd, lifecycleDir),
        error: String(err.message || err),
      });
    }
  }
  lifecycles.sort((a, b) => String(b.resultId).localeCompare(String(a.resultId)));
  return { lifecycles, errors };
}

function processIsAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function activeLifecycleRuntime(active) {
  const lifecycleKind = active?.finalState?.kind || active?.status || 'running';
  const running = isRunningLifecycleState(lifecycleKind);
  const supervisorPid = active?.supervisorPid ?? null;
  const supervisorAlive = processIsAlive(supervisorPid);
  const stale = Boolean(running && !supervisorAlive);
  const finalState = stale
    ? {
      kind: 'stale-active-lifecycle',
      reasonCode: supervisorPid ? 'supervisor-pid-not-running' : 'supervisor-pid-missing',
      previousKind: lifecycleKind,
      supervisorPid,
    }
    : active?.finalState || (active?.status ? { kind: active.status } : null);
  return {
    running,
    active: Boolean(running && supervisorAlive),
    stale,
    supervisorPid,
    supervisorAlive,
    finalState,
  };
}

async function findActiveLifecycleRuns({ runsDir, cwd, docPath, createdAt }) {
  const runDirs = await listRunDirs(runsDir);
  const startedAt = Date.parse(createdAt || '') || 0;
  const candidates = [];
  for (const runDir of runDirs) {
    const contract = await readJson(path.join(runDir, 'contract.json'), null);
    const state = await readJson(path.join(runDir, 'state.json'), {});
    const sourcePath = contract?.livingDoc?.sourcePath || state.docPath || null;
    if (docPath && sourcePath !== docPath) continue;
    const runCreatedAt = Date.parse(contract?.createdAt || state.updatedAt || '') || 0;
    if (startedAt && !runCreatedAt) continue;
    if (startedAt && runCreatedAt < startedAt - 15000) continue;
    if (startedAt && runCreatedAt > startedAt + 60 * 60 * 1000) continue;
    candidates.push({ runDir, contract, state, runCreatedAt });
  }
  candidates.sort((a, b) => a.runCreatedAt - b.runCreatedAt || String(a.runDir).localeCompare(String(b.runDir)));
  return candidates;
}

async function findActiveLifecycleRun(options) {
  const candidates = await findActiveLifecycleRuns(options);
  return candidates[candidates.length - 1] || null;
}

async function collectActiveLifecycleGraph(lifecycleDir, { cwd, runsDir, activePath }) {
  const active = await readJson(activePath || path.join(lifecycleDir, 'active-lifecycle.json'), null);
  if (!active?.schema) throw new Error(`lifecycle result not found: ${path.basename(lifecycleDir)}`);
  const runtime = activeLifecycleRuntime(active);

  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const addNode = (node) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };
  const addEdge = (edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return;
    edges.push(edge);
  };

  const livingDocNodeId = 'operated-living-doc';
  const livingDocPath = active.docPath || null;
  const renderedLivingDocPath = htmlPathForDoc(livingDocPath);
  const livingDoc = livingDocPath ? await readJson(path.resolve(cwd, livingDocPath), null) : null;
  addNode(graphNode(livingDocNodeId, {
    type: 'living-doc',
    role: 'living-doc',
    label: livingDoc?.title || path.basename(livingDocPath || 'living-doc', '.json'),
    status: livingDoc?.runState?.objectiveReady === true || livingDoc?.objectiveReady === true
      ? 'objective-ready'
      : (livingDoc?.runState?.currentPhase || livingDoc?.status?.currentPhase || livingDoc?.version || 'active'),
    artifactPaths: {
      livingDocPath: relativeTo(cwd, livingDocPath),
      renderedHtmlPath: relativeTo(cwd, renderedLivingDocPath),
    },
    meta: {
      docId: livingDoc?.docId || null,
      title: livingDoc?.title || null,
      objectiveReady: livingDoc?.runState?.objectiveReady ?? livingDoc?.objectiveReady ?? null,
      currentPhase: livingDoc?.runState?.currentPhase || livingDoc?.status?.currentPhase || null,
      objective: livingDoc?.objective || null,
      successCondition: livingDoc?.successCondition || null,
    },
  }));

  const lifecycleNodeId = 'lifecycle-controller';
  addNode(graphNode(lifecycleNodeId, {
    type: 'lifecycle',
    role: 'controller',
    label: active.resultId || path.basename(lifecycleDir),
    status: runtime.finalState?.kind || active.status || active.finalState?.kind || 'running',
    artifactPaths: {
      activeLifecyclePath: relativeTo(cwd, path.join(lifecycleDir, 'active-lifecycle.json')),
      lifecycleResultPath: relativeTo(cwd, path.join(lifecycleDir, 'lifecycle-result.json')),
    },
    meta: {
      createdAt: active.createdAt || null,
      docPath: active.docPath || null,
      supervisorPid: active.supervisorPid ?? null,
      supervisorAlive: runtime.supervisorAlive,
      toolProfile: active.toolProfile || null,
      executeProofRoutes: active.executeProofRoutes === true,
      runConfig: active.runConfig || null,
      prReviewPolicy: active.runConfig?.prReviewPolicy || active.prReviewPolicy || null,
    },
  }));

  if (runtime.stale) {
    const terminalNodeId = 'stale-active-lifecycle';
    addNode(graphNode(terminalNodeId, {
      type: 'terminal',
      role: 'terminal',
      label: 'Stale active lifecycle',
      status: 'stale-active-lifecycle',
      artifactPaths: {
        activeLifecyclePath: relativeTo(cwd, path.join(lifecycleDir, 'active-lifecycle.json')),
      },
      meta: {
        reasonCode: runtime.finalState?.reasonCode || null,
        supervisorPid: runtime.supervisorPid,
        previousKind: runtime.finalState?.previousKind || null,
      },
    }));
    addEdge(graphEdge('lifecycle-to-stale-active-lifecycle', lifecycleNodeId, terminalNodeId, {
      label: runtime.finalState?.reasonCode || 'supervisor not running',
      status: 'blocked',
      contract: {
        activeLifecyclePath: relativeTo(cwd, path.join(lifecycleDir, 'active-lifecycle.json')),
      },
      gate: 'supervisor-process-alive-required',
      lifecycleEffect: 'stale-active-lifecycle',
    }));
  }

  const activeRuns = !runtime.stale
    ? await findActiveLifecycleRuns({
      runsDir,
      cwd,
      docPath: active.docPath,
      createdAt: active.createdAt,
    })
    : [];
  const lifecycleRunning = runtime.active;
  const stoppedInferenceUnitId = active.finalState?.activeInferenceUnitAtStop || null;

  for (const [index, activeRun] of activeRuns.entries()) {
    const { runDir, contract, state } = activeRun;
    const runId = contract?.runId || path.basename(runDir);
    const previousIteration = Number(contract?.lifecycleInput?.previousIteration);
    const iteration = Number.isFinite(previousIteration) ? previousIteration + 1 : index + 1;
    const initialUnitType = contract?.runConfig?.initialUnitType || contract?.artifacts?.initialInferenceUnit?.unitId || 'worker';
    const initialUnitRole = contract?.runConfig?.initialUnitRole || contract?.artifacts?.initialInferenceUnit?.role || initialUnitType;
    const workerUnit = contract?.artifacts?.initialInferenceUnit || contract?.artifacts?.workerInferenceUnit || {};
    const workerId = `iteration-${iteration}-${initialUnitType}`;
    const workerStatus = !lifecycleRunning && stoppedInferenceUnitId === workerId
      ? active.finalState?.kind || active.status || 'stopped'
      : state.status || contract?.status || 'running';
    addNode(graphNode(workerId, {
      type: 'inference-unit',
      role: initialUnitRole,
      label: initialUnitType === 'worker' ? `Iteration ${iteration} worker` : `${initialUnitRole} iteration ${iteration}`,
      status: workerStatus,
      iteration,
      artifactPaths: {
        runDir: relativeTo(cwd, runDir),
        promptPath: workerUnit.prompt
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.prompt }))
          : relativeTo(cwd, path.join(runDir, 'prompt.md')),
        inputContractPath: workerUnit.inputContract
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.inputContract }))
          : relativeTo(cwd, path.join(runDir, 'contract.json')),
        statePath: relativeTo(cwd, path.join(runDir, 'state.json')),
        eventsPath: relativeTo(cwd, path.join(runDir, 'events.jsonl')),
        codexEventsPath: workerUnit.codexEvents
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.codexEvents }))
          : relativeTo(cwd, path.join(runDir, 'codex-turns', 'codex-events.jsonl')),
        stderrPath: workerUnit.stderr
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.stderr }))
          : relativeTo(cwd, path.join(runDir, 'codex-turns', 'codex-stderr.log')),
        lastMessagePath: workerUnit.lastMessage
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.lastMessage }))
          : relativeTo(cwd, path.join(runDir, 'codex-turns', 'last-message.txt')),
        resultPath: workerUnit.result
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.result }))
          : null,
        validationPath: workerUnit.validation
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.validation }))
          : null,
      },
      meta: {
        runId,
        prReviewPolicy: contract.runConfig?.prReviewPolicy || active.runConfig?.prReviewPolicy || null,
        toolProfile: summarizeToolProfile(contract?.process?.toolProfile),
        pid: contract?.process?.pid ?? null,
        exitCode: contract?.process?.exitCode ?? null,
      },
    }));
    addEdge(graphEdge(`lifecycle-to-${initialUnitType}-${iteration}`, lifecycleNodeId, workerId, {
      label: initialUnitType === 'worker' ? 'start worker iteration' : `start ${initialUnitType}`,
      status: 'recorded',
      contract: {
        inputContractPath: workerUnit.inputContract
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.inputContract }))
          : relativeTo(cwd, path.join(runDir, 'contract.json')),
        promptPath: workerUnit.prompt
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.prompt }))
          : relativeTo(cwd, path.join(runDir, 'prompt.md')),
      },
      gate: `${initialUnitType}-contract-required`,
      lifecycleEffect: initialUnitType === 'worker' ? 'start-worker' : `start-${initialUnitType}`,
    }));

    let previousNodeId = workerId;
    const reviewerVerdictPath = path.join(runDir, 'reviewer-inference', `iteration-${iteration}-verdict.json`);
    const reviewerVerdict = await readJson(reviewerVerdictPath, null);
    const reviewerUnitDir = path.join(runDir, 'inference-units', `iteration-${iteration}`, '02-reviewer-inference');
    const reviewerUnitResultPath = path.join(reviewerUnitDir, 'result.json');
    const reviewerUnitResult = await readJson(reviewerUnitResultPath, null);
    const reviewerInputPath = path.join(runDir, 'reviewer-inference', `iteration-${iteration}-input.json`);
    const reviewerInput = await readJson(reviewerInputPath, {});
    const reviewerExists = Boolean(
      reviewerVerdict
      || reviewerUnitResult
      || await exists(reviewerInputPath)
      || await exists(path.join(reviewerUnitDir, 'input-contract.json'))
    );
    if (reviewerExists) {
      const reviewerResult = reviewerVerdict?.inferenceUnitResultPath
        ? await readJson(resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerVerdict.inferenceUnitResultPath }), null)
        : reviewerUnitResult;
      const reviewerStopVerdict = reviewerVerdict?.verdict?.stopVerdict
        || reviewerUnitResult?.outputContract?.stopVerdict
        || {};
      const reviewerNextIteration = reviewerVerdict?.verdict?.nextIteration
        || reviewerUnitResult?.outputContract?.nextIteration
        || {};
      const reviewerPromptRef = reviewerVerdict?.promptPath
        || reviewerUnitResult?.promptPath
        || `reviewer-inference/iteration-${iteration}-prompt.md`;
      const reviewerCodexEventsRef = reviewerVerdict?.codexEventsPath
        || reviewerUnitResult?.codexEventsPath
        || path.join('inference-units', `iteration-${iteration}`, '02-reviewer-inference', 'codex-events.jsonl');
      const reviewerStderrRef = reviewerVerdict?.stderrPath
        || reviewerUnitResult?.stderrPath
        || path.join('inference-units', `iteration-${iteration}`, '02-reviewer-inference', 'stderr.log');
      const reviewerId = `iteration-${iteration}-reviewer`;
      addNode(graphNode(reviewerId, {
        type: 'inference-unit',
        role: 'reviewer',
        label: `Iteration ${iteration} reviewer`,
        status: reviewerStopVerdict.classification || reviewerUnitResult?.status || 'running',
        iteration,
        artifactPaths: {
          promptPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerPromptRef })),
          inputContractPath: relativeTo(cwd, reviewerInputPath),
          evidencePath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerVerdict?.evidencePath })),
          codexEventsPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerCodexEventsRef })),
          resultPath: reviewerVerdict ? relativeTo(cwd, reviewerVerdictPath) : relativeTo(cwd, reviewerUnitResultPath),
          stderrPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerStderrRef })),
        },
        meta: {
          reasonCode: reviewerStopVerdict.reasonCode || null,
          closureAllowed: reviewerStopVerdict.closureAllowed ?? null,
          rawWorkerJsonlPaths: reviewerInput.rawWorkerJsonlPaths || reviewerInput.workerEvidence?.rawWorkerJsonlPaths || [],
          toolProfile: firstToolProfile(reviewerResult, reviewerInput),
        },
      }));
      addEdge(graphEdge(`${initialUnitType}-to-reviewer-${iteration}`, workerId, reviewerId, {
        label: initialUnitType === 'worker' ? 'raw worker evidence review' : `raw ${initialUnitType} evidence review`,
        status: 'recorded',
        contract: {
          promptPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerPromptRef })),
          inputContractPath: relativeTo(cwd, reviewerInputPath),
          evidencePaths: reviewerInput.rawWorkerJsonlPaths || reviewerInput.workerEvidence?.rawWorkerJsonlPaths || [],
          resultPath: reviewerVerdict ? relativeTo(cwd, reviewerVerdictPath) : relativeTo(cwd, reviewerUnitResultPath),
          codexEventsPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerCodexEventsRef })),
        },
        gate: 'reviewer-verdict-required',
        lifecycleEffect: reviewerNextIteration.mode || reviewerStopVerdict.classification || null,
      }));
      previousNodeId = reviewerId;
    }

    const repairUnits = await listRepairUnits(runDir, { cwd });
    let lastRepairNodeId = null;
    for (const unit of repairUnits) {
      const changedFiles = arr(unit.changedFiles);
      const commitIntent = commitIntentForDashboard({ unit, chainSkillResult: null, changedFiles });
      const commitPolicy = unit.commitPolicy || null;
      const unitNodeId = `iteration-${iteration}-repair-${unit.sequence ?? unit.unitId}`;
      const role = unit.sequence === 0 || unit.unitId === 'living-doc-balance-scan' ? 'balance-scan' : 'repair-skill';
      addNode(graphNode(unitNodeId, {
        type: 'inference-unit',
        role,
        label: `${unit.sequence ?? '?'} · ${unit.unitId}`,
        status: unit.status,
        iteration,
        artifactPaths: unit.paths,
        meta: {
          runId,
          unitKey: unit.unitKey,
          sequence: unit.sequence ?? null,
          validationOk: unit.validationOk,
          hasResult: unit.hasResult,
          hasCodexEvents: unit.hasCodexEvents,
          commitPolicy,
          commitIntent,
          toolProfile: unit.toolProfile,
        },
      }));
      addEdge(graphEdge(`repair-chain-edge-${iteration}-${unit.sequence ?? unit.unitId}`, lastRepairNodeId || previousNodeId, unitNodeId, {
        label: role === 'balance-scan' ? 'diagnose repair order' : 'ordered repair handoff',
        status: unit.status,
        contract: {
          promptPath: unit.paths.promptPath,
          inputContractPath: unit.paths.inputContractPath,
          resultPath: unit.paths.resultPath,
          validationPath: unit.paths.validationPath,
          codexEventsPath: unit.paths.codexEventsPath,
        },
        gate: role === 'balance-scan' ? 'balance-scan-required' : 'ordered-repair-unit-required',
        lifecycleEffect: role === 'balance-scan' ? 'ordered-skill-list' : 'repair-skill-result',
      }));
      const changedLivingDoc = changedFiles.some((file) => samePath(cwd, file, livingDocPath) || samePath(cwd, file, renderedLivingDocPath));
      if (changedLivingDoc) {
        const commitSha = unit.commitSha || unit.commit?.sha || null;
        addEdge(graphEdge(`repair-unit-to-living-doc-${iteration}-${unit.sequence ?? unit.unitId}`, unitNodeId, livingDocNodeId, {
          label: commitSha ? `commit ${shortCommit(commitSha)}` : 'changed living doc',
          status: commitSha ? 'committed' : 'changed',
          contract: {
            changedFiles,
            commitSha,
            commitMessage: unit.commitMessage || unit.commit?.message || null,
            commitPolicy,
            commitIntent,
            resultPath: unit.paths.resultPath,
            validationPath: unit.paths.validationPath,
            codexEventsPath: unit.paths.codexEventsPath,
          },
          gate: 'living-doc-change-recorded',
          lifecycleEffect: 'living-doc-updated',
        }));
      }
      lastRepairNodeId = unitNodeId;
    }
  }

  const activeInferenceUnit = !lifecycleRunning
    ? null
    : [...nodes].reverse().find((node) =>
      node.type === 'inference-unit'
      && isActiveInferenceStatus(node.status)
    ) || null;

  return {
    schema: 'living-doc-harness-inference-graph/v1',
    resultId: active.resultId || path.basename(lifecycleDir),
    lifecycleDir: relativeTo(cwd, lifecycleDir),
    generatedAt: new Date().toISOString(),
    finalState: runtime.finalState || { kind: active.status || 'running' },
    activeInferenceUnitId: activeInferenceUnit?.id || null,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    privacy: {
      committedEvidence: false,
      localOperatorOnly: true,
      rawPromptIncluded: false,
      rawNativeTraceIncluded: false,
      rawLogPayloadIncluded: false,
      pathReferencesIncluded: true,
    },
  };
}

export async function collectLifecycleGraph(lifecycleDir, { cwd, runsDir }) {
  const resultPath = path.join(lifecycleDir, 'lifecycle-result.json');
  const activePath = path.join(lifecycleDir, 'active-lifecycle.json');
  if (!await exists(resultPath) && await exists(activePath)) {
    return collectActiveLifecycleGraph(lifecycleDir, { cwd, runsDir, activePath });
  }
  const lifecycle = await readJson(resultPath, null);
  if (!lifecycle?.schema) throw new Error(`lifecycle result not found: ${path.basename(lifecycleDir)}`);

  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const addNode = (node) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };
  const addEdge = (edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return;
    edges.push(edge);
  };

  const livingDocNodeId = 'operated-living-doc';
  const livingDocPath = lifecycle.docPath || null;
  const renderedLivingDocPath = htmlPathForDoc(livingDocPath);
  const livingDoc = livingDocPath ? await readJson(path.resolve(cwd, livingDocPath), null) : null;
  addNode(graphNode(livingDocNodeId, {
    type: 'living-doc',
    role: 'living-doc',
    label: livingDoc?.title || path.basename(livingDocPath || 'living-doc', '.json'),
    status: livingDoc?.objectiveReady === true ? 'objective-ready' : (livingDoc?.status?.currentPhase || livingDoc?.version || 'active'),
    artifactPaths: {
      livingDocPath: relativeTo(cwd, livingDocPath),
      renderedHtmlPath: relativeTo(cwd, renderedLivingDocPath),
    },
    meta: {
      docId: livingDoc?.docId || null,
      title: livingDoc?.title || null,
      objectiveReady: livingDoc?.objectiveReady ?? null,
      currentPhase: livingDoc?.status?.currentPhase || null,
      objective: livingDoc?.objective || null,
      successCondition: livingDoc?.successCondition || null,
    },
  }));

  const lifecycleNodeId = 'lifecycle-controller';
  addNode(graphNode(lifecycleNodeId, {
    type: 'lifecycle',
    role: 'controller',
    label: lifecycle.resultId || path.basename(lifecycleDir),
    status: lifecycle.finalState?.kind || 'running',
    artifactPaths: {
      lifecycleResultPath: relativeTo(cwd, resultPath),
    },
    meta: {
      createdAt: lifecycle.createdAt || null,
      docPath: lifecycle.docPath || null,
      iterationCount: lifecycle.iterationCount ?? null,
      runConfig: lifecycle.runConfig || null,
      prReviewPolicy: lifecycle.runConfig?.prReviewPolicy || null,
    },
  }));

  for (const iterationRecord of lifecycle.iterations || []) {
    const iteration = iterationRecord.iteration;
    const runDir = path.resolve(cwd, iterationRecord.runDir || path.join(runsDir, iterationRecord.runId || ''));
    const runId = iterationRecord.runId || path.basename(runDir);
    const contract = await readJson(path.join(runDir, 'contract.json'), {});
    const state = await readJson(path.join(runDir, 'state.json'), {});
    const facts = await collectRunEvidence(runDir).catch(() => ({}));
    const initialUnitType = contract?.runConfig?.initialUnitType || contract?.artifacts?.initialInferenceUnit?.unitId || 'worker';
    const initialUnitRole = contract?.runConfig?.initialUnitRole || contract?.artifacts?.initialInferenceUnit?.role || initialUnitType;
    const workerUnit = contract.artifacts?.initialInferenceUnit || contract.artifacts?.workerInferenceUnit || {};

    const workerId = `iteration-${iteration}-${initialUnitType}`;
    addNode(graphNode(workerId, {
      type: 'inference-unit',
      role: initialUnitRole,
      label: initialUnitType === 'worker' ? `Iteration ${iteration} worker` : `${initialUnitRole} iteration ${iteration}`,
      status: state.status || contract.status || iterationRecord.classification || 'unknown',
      iteration,
      artifactPaths: {
        runDir: relativeTo(cwd, runDir),
        promptPath: workerUnit.prompt
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.prompt }))
          : relativeTo(cwd, path.join(runDir, 'prompt.md')),
        inputContractPath: workerUnit.inputContract
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.inputContract }))
          : relativeTo(cwd, path.join(runDir, 'contract.json')),
        statePath: relativeTo(cwd, path.join(runDir, 'state.json')),
        eventsPath: relativeTo(cwd, path.join(runDir, 'events.jsonl')),
        codexEventsPath: workerUnit.codexEvents
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.codexEvents }))
          : relativeTo(cwd, path.join(runDir, 'codex-turns', 'codex-events.jsonl')),
        resultPath: workerUnit.result
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.result }))
          : null,
        validationPath: workerUnit.validation
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.validation }))
          : relativeTo(cwd, path.join(runDir, 'artifacts', `iteration-${iteration}-proof-validation.json`)),
      },
      meta: {
        runId,
        classification: iterationRecord.classification || null,
        terminalKind: iterationRecord.terminalKind || null,
        prReviewPolicy: facts.prReviewPolicy || contract.runConfig?.prReviewPolicy || lifecycle.runConfig?.prReviewPolicy || null,
        prReviewGate: {
          ...(facts.prReviewGate || {}),
          required: facts.prReviewGate?.required === true || facts.prReviewRequired === true,
          evidencePresent: facts.prReviewGate?.evidencePresent === true || facts.prReviewEvidencePresent === true,
          state: facts.prReviewGate?.status || facts.prReviewGate?.state || (facts.prReviewPolicy?.mode === 'disabled'
            ? 'disabled'
            : facts.prReviewRequired === true
              ? facts.prReviewEvidencePresent === true ? 'satisfied' : 'missing'
              : 'not-required'),
        },
        toolProfile: summarizeToolProfile(contract.process?.toolProfile),
      },
    }));
    addEdge(graphEdge(`lifecycle-to-${initialUnitType}-${iteration}`, lifecycleNodeId, workerId, {
      label: initialUnitType === 'worker' ? 'start worker iteration' : `start ${initialUnitType}`,
      status: 'recorded',
      contract: {
        inputContractPath: workerUnit.inputContract
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.inputContract }))
          : relativeTo(cwd, path.join(runDir, 'contract.json')),
        promptPath: workerUnit.prompt
          ? relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: workerUnit.prompt }))
          : relativeTo(cwd, path.join(runDir, 'prompt.md')),
      },
      lifecycleEffect: initialUnitType === 'worker' ? 'start-worker' : `start-${initialUnitType}`,
    }));

    let previousNodeId = workerId;
    const reviewerVerdictPath = resolveArtifactRef({ cwd, baseDir: runDir, ref: iterationRecord.reviewerVerdictPath });
    const reviewerVerdict = await readJson(reviewerVerdictPath, null);
    if (reviewerVerdict) {
      const reviewerInputPath = resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerVerdict.reviewerInputPath });
      const reviewerInput = await readJson(reviewerInputPath, {});
      const reviewerResult = reviewerVerdict.inferenceUnitResultPath
        ? await readJson(resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerVerdict.inferenceUnitResultPath }), null)
        : null;
      const reviewerId = `iteration-${iteration}-reviewer`;
      addNode(graphNode(reviewerId, {
        type: 'inference-unit',
        role: 'reviewer',
        label: `Iteration ${iteration} reviewer`,
        status: reviewerVerdict.verdict?.stopVerdict?.classification || iterationRecord.classification || 'unknown',
        iteration,
        artifactPaths: {
          promptPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerVerdict.promptPath })),
          inputContractPath: relativeTo(cwd, reviewerInputPath),
          evidencePath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerVerdict.evidencePath })),
          codexEventsPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerVerdict.codexEventsPath })),
          resultPath: relativeTo(cwd, reviewerVerdictPath),
          stderrPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerVerdict.stderrPath })),
        },
        meta: {
          reasonCode: reviewerVerdict.verdict?.stopVerdict?.reasonCode || null,
          closureAllowed: reviewerVerdict.verdict?.stopVerdict?.closureAllowed ?? null,
          rawWorkerJsonlPaths: reviewerInput.rawWorkerJsonlPaths || reviewerInput.workerEvidence?.rawWorkerJsonlPaths || [],
          toolProfile: firstToolProfile(reviewerResult, reviewerInput),
        },
      }));
      addEdge(graphEdge(`${initialUnitType}-to-reviewer-${iteration}`, workerId, reviewerId, {
        label: initialUnitType === 'worker' ? 'raw worker evidence review' : `raw ${initialUnitType} evidence review`,
        status: 'recorded',
        contract: {
          promptPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerVerdict.promptPath })),
          inputContractPath: relativeTo(cwd, reviewerInputPath),
          evidencePaths: reviewerInput.rawWorkerJsonlPaths || reviewerInput.workerEvidence?.rawWorkerJsonlPaths || [],
          resultPath: relativeTo(cwd, reviewerVerdictPath),
          codexEventsPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: reviewerVerdict.codexEventsPath })),
        },
        gate: 'reviewer-verdict-required',
        lifecycleEffect: reviewerVerdict.verdict?.nextIteration?.mode || iterationRecord.classification || null,
      }));
      previousNodeId = reviewerId;
    }

    const iterationProofPath = path.join(runDir, 'artifacts', `iteration-${iteration}-proof.json`);
    const iterationProof = await readJson(iterationProofPath, null);
    if (iterationProof?.closureReview?.inferenceUnitResultPath) {
      const closureReview = iterationProof.closureReview;
      const closureReviewInput = await readJson(resolveArtifactRef({ cwd, baseDir: runDir, ref: closureReview.inferenceUnitInputContractPath }), null);
      const closureReviewResult = await readJson(resolveArtifactRef({ cwd, baseDir: runDir, ref: closureReview.inferenceUnitResultPath }), null);
      const closureReviewId = `iteration-${iteration}-closure-review`;
      addNode(graphNode(closureReviewId, {
        type: 'inference-unit',
        role: 'closure-review',
        label: `Iteration ${iteration} closure review`,
        status: closureReview.approved ? 'approved' : 'blocked',
        iteration,
        artifactPaths: {
          promptPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: closureReview.inferenceUnitPromptPath })),
          inputContractPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: closureReview.inferenceUnitInputContractPath })),
          resultPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: closureReview.inferenceUnitResultPath })),
          validationPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: closureReview.inferenceUnitValidationPath })),
          proofPath: relativeTo(cwd, iterationProofPath),
        },
        meta: {
          approved: closureReview.approved,
          terminalAllowed: closureReview.terminalAllowed,
          reasonCode: closureReview.reasonCode,
          toolProfile: firstToolProfile(closureReviewResult, closureReviewInput),
        },
      }));
      addEdge(graphEdge(`reviewer-to-closure-review-${iteration}`, previousNodeId, closureReviewId, {
        label: 'terminal closure review',
        status: closureReview.approved ? 'approved' : 'blocked',
        contract: {
          promptPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: closureReview.inferenceUnitPromptPath })),
          inputContractPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: closureReview.inferenceUnitInputContractPath })),
          resultPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: closureReview.inferenceUnitResultPath })),
          validationPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: closureReview.inferenceUnitValidationPath })),
          proofPath: relativeTo(cwd, iterationProofPath),
        },
        gate: 'closure-review-required',
        lifecycleEffect: closureReview.terminalAllowed ? 'terminal-closure-allowed' : 'terminal-closure-blocked',
      }));
      previousNodeId = closureReviewId;
    }

    const repairUnits = await listRepairUnits(runDir, { cwd });
    const repairChainPath = resolveArtifactRef({ cwd, baseDir: runDir, ref: iterationRecord.repairSkillResultPath });
    const repairChain = await readJson(repairChainPath, null);
    let lastRepairNodeId = null;
    for (const unit of repairUnits) {
      const chainSkillResult = repairChainSkillResultForUnit(repairChain, unit, { cwd });
      const changedFiles = Array.isArray(chainSkillResult?.changedFiles)
        ? chainSkillResult.changedFiles
        : arr(unit.changedFiles);
      const commitIntent = commitIntentForDashboard({ unit, chainSkillResult, changedFiles });
      const commitPolicy = chainSkillResult?.commitPolicy || unit.commitPolicy || null;
      const unitNodeId = `iteration-${iteration}-repair-${unit.sequence ?? unit.unitId}`;
      const role = unit.sequence === 0 || unit.unitId === 'living-doc-balance-scan' ? 'balance-scan' : 'repair-skill';
      addNode(graphNode(unitNodeId, {
        type: 'inference-unit',
        role,
        label: `${unit.sequence ?? '?'} · ${unit.unitId}`,
        status: unit.status,
        iteration,
        artifactPaths: unit.paths,
        meta: {
          runId,
          unitKey: unit.unitKey,
          sequence: unit.sequence ?? null,
          validationOk: unit.validationOk,
          hasResult: unit.hasResult,
          hasCodexEvents: unit.hasCodexEvents,
          orderedSkills: role === 'balance-scan' ? repairChain?.balanceScan?.orderedSkills || [] : [],
          commitPolicy,
          commitIntent,
          toolProfile: unit.toolProfile,
        },
      }));
      addEdge(graphEdge(`repair-chain-edge-${iteration}-${unit.sequence ?? unit.unitId}`, lastRepairNodeId || previousNodeId, unitNodeId, {
        label: role === 'balance-scan' ? 'diagnose repair order' : 'ordered repair handoff',
        status: unit.status,
        contract: {
          promptPath: unit.paths.promptPath,
          inputContractPath: unit.paths.inputContractPath,
          resultPath: unit.paths.resultPath,
          validationPath: unit.paths.validationPath,
          codexEventsPath: unit.paths.codexEventsPath,
        },
        gate: role === 'balance-scan' ? 'balance-scan-required' : 'ordered-repair-unit-required',
        lifecycleEffect: role === 'balance-scan' ? 'ordered-skill-list' : 'repair-skill-result',
      }));
      const changedLivingDoc = changedFiles.some((file) => samePath(cwd, file, livingDocPath) || samePath(cwd, file, renderedLivingDocPath));
      if (changedLivingDoc) {
        const commitSha = unit.commitSha || unit.commit?.sha || null;
        addEdge(graphEdge(`repair-unit-to-living-doc-${iteration}-${unit.sequence ?? unit.unitId}`, unitNodeId, livingDocNodeId, {
          label: commitSha ? `commit ${shortCommit(commitSha)}` : 'changed living doc',
          status: commitSha ? 'committed' : 'changed',
          contract: {
            changedFiles,
            commitSha,
            commitMessage: unit.commitMessage || unit.commit?.message || null,
            commitPolicy,
            commitIntent,
            resultPath: unit.paths.resultPath,
            validationPath: unit.paths.validationPath,
            codexEventsPath: unit.paths.codexEventsPath,
          },
          gate: 'living-doc-change-recorded',
          lifecycleEffect: 'living-doc-updated',
        }));
      }
      lastRepairNodeId = unitNodeId;
    }
    if (repairChain) {
      const repairChainId = `iteration-${iteration}-repair-chain-result`;
      addNode(graphNode(repairChainId, {
        type: 'artifact',
        role: 'repair-chain-result',
        label: `Iteration ${iteration} repair chain result`,
        status: repairChain.status || 'unknown',
        iteration,
        artifactPaths: {
          resultPath: relativeTo(cwd, repairChainPath),
        },
        meta: {
          orderedSkills: repairChain.balanceScan?.orderedSkills || [],
          nextRecommendedAction: repairChain.nextRecommendedAction || null,
        },
      }));
      addEdge(graphEdge(`repair-units-to-chain-result-${iteration}`, lastRepairNodeId || previousNodeId, repairChainId, {
        label: 'aggregate repair chain result',
        status: repairChain.status || 'unknown',
        contract: {
          resultPath: relativeTo(cwd, repairChainPath),
        },
        lifecycleEffect: repairChain.nextRecommendedAction || null,
      }));
      previousNodeId = repairChainId;
    } else if (lastRepairNodeId) {
      previousNodeId = lastRepairNodeId;
    }

    const outputInputPath = resolveArtifactRef({ cwd, baseDir: runDir, ref: iterationRecord.outputInputPath });
    const outputInput = await readJson(outputInputPath, null);
    if (iterationRecord.terminalKind || outputInput?.nextAction?.action?.startsWith('stop') || lifecycle.finalState?.runId === runId) {
      const terminalId = `iteration-${iteration}-terminal`;
      addNode(graphNode(terminalId, {
        type: 'terminal-state',
        role: 'terminal',
        label: `Iteration ${iteration} terminal`,
        status: iterationRecord.terminalKind || lifecycle.finalState?.kind || 'unknown',
        iteration,
        artifactPaths: {
          outputInputPath: relativeTo(cwd, outputInputPath),
          terminalPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: outputInput?.previousOutput?.terminalPath })),
        },
        meta: {
          nextAction: iterationRecord.nextAction || outputInput?.nextAction || null,
          finalState: lifecycle.finalState || null,
        },
      }));
      addEdge(graphEdge(`to-terminal-${iteration}`, previousNodeId, terminalId, {
        label: 'terminal lifecycle decision',
        status: iterationRecord.terminalKind || lifecycle.finalState?.kind || 'unknown',
        contract: {
          outputInputPath: relativeTo(cwd, outputInputPath),
          terminalPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: outputInput?.previousOutput?.terminalPath })),
        },
        gate: 'terminal-state-gate',
        lifecycleEffect: iterationRecord.nextAction?.action || outputInput?.nextAction?.action || null,
      }));
      previousNodeId = terminalId;
    }

    for (const blocker of facts.blockers || []) {
      const blockerId = `iteration-${iteration}-blocker-${blocker.id || blocker.reasonCode || 'blocker'}`.replace(/[^a-zA-Z0-9_.-]+/g, '-');
      addNode(graphNode(blockerId, {
        type: 'blocker',
        role: 'blocker',
        label: blocker.reasonCode || blocker.id || 'blocker',
        status: 'open',
        iteration,
        artifactPaths: {
          blockerPath: relativeTo(cwd, resolveArtifactRef({ cwd, baseDir: runDir, ref: blocker.artifactPath || blocker.path })),
        },
        meta: {
          owningLayer: blocker.owningLayer || null,
          requiredDecision: blocker.requiredDecision || null,
          issueRef: blocker.issueRef || null,
          unblockCriteria: blocker.unblockCriteria || [],
        },
      }));
      addEdge(graphEdge(`terminal-to-blocker-${iteration}-${blockerId}`, previousNodeId, blockerId, {
        label: 'blocker record',
        status: blocker.reasonCode || 'blocked',
        lifecycleEffect: 'continuation-required',
      }));
      if (blocker.issueRef) {
        const issueId = `issue-${String(blocker.issueRef).replace(/^#/, '')}`;
        addNode(graphNode(issueId, {
          type: 'issue',
          role: 'github-issue',
          label: blocker.issueRef,
          status: 'open',
          iteration,
          meta: {
            issueRef: blocker.issueRef,
          },
        }));
        addEdge(graphEdge(`blocker-to-issue-${iteration}-${issueId}`, blockerId, issueId, {
          label: 'owned by issue',
          status: 'linked',
          lifecycleEffect: 'human-visible-blocker',
        }));
      }
    }
  }

  const lifecycleIsTerminal = ['closed', 'user-stopped'].includes(String(lifecycle.finalState?.kind || lifecycle.terminalKind || lifecycle.status || '').toLowerCase());
  const activeInferenceUnit = lifecycleIsTerminal
    ? null
    : [...nodes].reverse().find((node) =>
      node.type === 'inference-unit'
      && isActiveInferenceStatus(node.status)
    ) || null;

  return {
    schema: 'living-doc-harness-inference-graph/v1',
    resultId: lifecycle.resultId || path.basename(lifecycleDir),
    lifecycleDir: relativeTo(cwd, lifecycleDir),
    generatedAt: new Date().toISOString(),
    finalState: lifecycle.finalState || null,
    activeInferenceUnitId: activeInferenceUnit?.id || null,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    privacy: {
      committedEvidence: false,
      localOperatorOnly: true,
      rawPromptIncluded: false,
      rawNativeTraceIncluded: false,
      rawLogPayloadIncluded: false,
      pathReferencesIncluded: true,
    },
  };
}

function graphArtifactPaths(graph) {
  const refs = [];
  for (const node of graph?.nodes || []) {
    for (const [kind, ref] of Object.entries(node.artifactPaths || {})) {
      if (!ref) continue;
      refs.push({
        ownerType: 'node',
        ownerId: node.id,
        kind,
        path: ref,
      });
    }
  }
  for (const edge of graph?.edges || []) {
    for (const [kind, ref] of Object.entries(edge.contract || {})) {
      if (!ref || typeof ref !== 'string') continue;
      refs.push({
        ownerType: 'edge',
        ownerId: edge.id,
        kind,
        path: ref,
      });
    }
  }
  return refs;
}

function resolveDashboardPath(cwd, ref) {
  if (!ref || typeof ref !== 'string') return null;
  return path.isAbsolute(ref) ? ref : path.resolve(cwd, ref);
}

async function graphArtifactEvents(graph, { cwd }) {
  const events = [];
  for (const ref of graphArtifactPaths(graph)) {
    const absolutePath = resolveDashboardPath(cwd, ref.path);
    if (!absolutePath) continue;
    const fingerprint = await fileFingerprint(absolutePath);
    events.push(streamEvent('artifact_update', {
      resultId: graph.resultId,
      ownerType: ref.ownerType,
      ownerId: ref.ownerId,
      kind: ref.kind,
      path: ref.path,
      exists: fingerprint.exists,
      size: fingerprint.size,
      mtimeMs: fingerprint.mtimeMs,
    }, { source: 'local-artifact' }));
  }
  return events;
}

async function graphLogEvents(graph, { cwd, lines = 30 }) {
  const events = [];
  for (const node of graph?.nodes || []) {
    if (node.type !== 'inference-unit') continue;
    const paths = node.artifactPaths || {};
    const logRefs = [
      ['codexEvents', paths.codexEventsPath],
      ['stderr', paths.stderrPath],
      ['lastMessage', paths.lastMessagePath],
      ['result', paths.resultPath],
      ['validation', paths.validationPath],
    ].filter(([, ref]) => ref);
    for (const [kind, ref] of logRefs) {
      const absolutePath = resolveDashboardPath(cwd, ref);
      const tail = absolutePath ? await tailTextFile(absolutePath, { lines }) : [];
      if (!tail.length) continue;
      const fingerprint = await fileFingerprint(absolutePath);
      events.push(streamEvent('log_append', {
        resultId: graph.resultId,
        nodeId: node.id,
        role: node.role,
        runId: node.meta?.runId || null,
        unitKey: node.meta?.unitKey || null,
        kind,
        path: ref,
        lines: tail,
        size: fingerprint.size,
        mtimeMs: fingerprint.mtimeMs,
      }, { source: 'local-log-tail' }));
    }
  }
  return events;
}

function isActiveInferenceStatus(status) {
  return ['starting', 'running', 'prepared'].includes(String(status || '').toLowerCase());
}

function isRunningLifecycleState(status) {
  return ['running', 'starting', 'prepared'].includes(String(status || '').toLowerCase());
}

function isFinishedInferenceStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return normalized && !['unknown', 'starting', 'running', 'prepared'].includes(normalized);
}

function lifecycleTransitionEvents(graph) {
  const events = [];
  events.push(streamEvent('lifecycle_started', {
    resultId: graph.resultId,
    lifecycleDir: graph.lifecycleDir,
    finalState: graph.finalState,
    activeInferenceUnitId: graph.activeInferenceUnitId,
  }, { at: graph.nodes?.find((node) => node.id === 'lifecycle-controller')?.meta?.createdAt || null, source: 'persisted-lifecycle' }));

  for (const node of graph.nodes || []) {
    if (node.type !== 'inference-unit') continue;
    const payload = {
      resultId: graph.resultId,
      nodeId: node.id,
      role: node.role,
      status: node.status,
      iteration: node.iteration,
      artifactPaths: node.artifactPaths,
      contractPath: node.artifactPaths?.inputContractPath || null,
      logPath: node.artifactPaths?.codexEventsPath || node.artifactPaths?.stderrPath || null,
      meta: node.meta,
    };
    events.push(streamEvent('inference_unit_started', payload, { source: 'graph-artifact-state' }));
    if (isFinishedInferenceStatus(node.status)) {
      events.push(streamEvent('inference_unit_finished', payload, { source: 'graph-artifact-state' }));
    }
  }

  const finalKind = String(graph.finalState?.kind || '').toLowerCase();
  if (finalKind === 'closed') {
    events.push(streamEvent('lifecycle_closed', {
      resultId: graph.resultId,
      finalState: graph.finalState,
      activeInferenceUnitId: graph.activeInferenceUnitId,
    }, { source: 'persisted-lifecycle' }));
  } else if (finalKind.includes('error') || finalKind.includes('fail')) {
    events.push(streamEvent('lifecycle_error', {
      resultId: graph.resultId,
      finalState: graph.finalState,
      activeInferenceUnitId: graph.activeInferenceUnitId,
    }, { source: 'persisted-lifecycle' }));
  } else if (finalKind && finalKind !== 'running') {
    events.push(streamEvent('lifecycle_blocked', {
      resultId: graph.resultId,
      finalState: graph.finalState,
      activeInferenceUnitId: graph.activeInferenceUnitId,
      blockers: (graph.nodes || []).filter((node) => node.type === 'blocker').map((node) => ({
        nodeId: node.id,
        status: node.status,
        reasonCode: node.label,
        artifactPaths: node.artifactPaths,
        meta: node.meta,
      })),
    }, { source: 'persisted-lifecycle' }));
  }

  return events;
}

async function collectLifecycleEventHistory(lifecycleDir, { cwd, runsDir, includeLogs = true } = {}) {
  const graph = await collectLifecycleGraph(lifecycleDir, { cwd, runsDir });
  const graphSnapshot = { ...graph, generatedAt: null };
  const events = [];
  events.push(streamEvent('lifecycle_snapshot', {
    resultId: graph.resultId,
    lifecycleDir: graph.lifecycleDir,
    finalState: graph.finalState,
    activeInferenceUnitId: graph.activeInferenceUnitId,
    graph: graphSnapshot,
  }, { source: 'persisted-lifecycle' }));
  events.push(...lifecycleTransitionEvents(graph));

  const lifecycleEventPath = path.join(lifecycleDir, 'events.jsonl');
  for (const item of await readJsonlTail(lifecycleEventPath, { lines: 200 })) {
    events.push(streamEvent('lifecycle_event', {
      resultId: graph.resultId,
      path: relativeTo(cwd, lifecycleEventPath),
      event: item.event,
      record: item.parsed,
      line: item.line,
    }, { at: item.at, source: 'lifecycle-events-jsonl', ordinal: item.index }));
  }

  for (const iteration of await readJson(path.join(lifecycleDir, 'lifecycle-result.json'), {}).then((result) => arr(result.iterations))) {
    const runDir = path.resolve(cwd, iteration.runDir || path.join(runsDir, iteration.runId || ''));
    const runEventsPath = path.join(runDir, 'events.jsonl');
    for (const item of await readJsonlTail(runEventsPath, { lines: 160 })) {
      events.push(streamEvent('run_event', {
        resultId: graph.resultId,
        runId: iteration.runId || path.basename(runDir),
        iteration: iteration.iteration,
        path: relativeTo(cwd, runEventsPath),
        event: item.event,
        record: item.parsed,
        line: item.line,
      }, { at: item.at, source: 'run-events-jsonl', ordinal: item.index }));
    }
  }

  for (const node of graph.nodes || []) {
    if (node.type !== 'inference-unit') continue;
    events.push(streamEvent('inference_unit_state', {
      resultId: graph.resultId,
      nodeId: node.id,
      role: node.role,
      status: node.status,
      iteration: node.iteration,
      artifactPaths: node.artifactPaths,
      contractPath: node.artifactPaths?.inputContractPath || null,
      logPath: node.artifactPaths?.codexEventsPath || node.artifactPaths?.stderrPath || null,
      meta: node.meta,
    }, { source: 'graph-artifact-state' }));
  }

  for (const edge of graph.edges || []) {
    events.push(streamEvent('contract_handoff', {
      resultId: graph.resultId,
      edgeId: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      status: edge.status,
      gate: edge.gate,
      lifecycleEffect: edge.lifecycleEffect,
      contract: edge.contract,
    }, { source: 'graph-contract-edge' }));
  }

  events.push(...await graphArtifactEvents(graph, { cwd }));
  if (includeLogs) events.push(...await graphLogEvents(graph, { cwd }));
  events.push(streamEvent('graph_update', {
    resultId: graph.resultId,
    activeInferenceUnitId: graph.activeInferenceUnitId,
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    graph: graphSnapshot,
  }, { source: 'artifact-derived-graph' }));
  return {
    schema: 'living-doc-harness-dashboard-event-history/v1',
    resultId: graph.resultId,
    generatedAt: new Date().toISOString(),
    eventCount: events.length,
    events,
    privacy: {
      localOperatorOnly: true,
      rawPromptIncluded: false,
      rawNativeTraceIncluded: false,
      supervisingChatStateIncluded: false,
    },
  };
}

async function readGraphNodeTail(lifecycleDir, nodeId, { cwd, runsDir, lines = 80 } = {}) {
  const graph = await collectLifecycleGraph(lifecycleDir, { cwd, runsDir });
  const node = (graph.nodes || []).find((item) => item.id === nodeId);
  if (!node) throw new Error(`graph node not found: ${nodeId}`);
  const paths = node.artifactPaths || {};
  const safeLines = Number.isInteger(lines) && lines > 0 && lines <= 300 ? lines : 80;
  const read = (ref, max = safeLines) => ref
    ? tailTextFile(resolveDashboardPath(cwd, ref), { lines: Math.min(max, safeLines) })
    : [];
  return {
    schema: 'living-doc-harness-graph-node-tail/v1',
    resultId: graph.resultId,
    nodeId,
    role: node.role,
    status: node.status,
    artifactPaths: paths,
    privacy: {
      committedEvidence: false,
      localOperatorOnly: true,
      rawPromptIncluded: false,
      rawNativeTraceIncluded: false,
    },
    codexEvents: await read(paths.codexEventsPath),
    stderr: await read(paths.stderrPath, 80),
    lastMessage: await read(paths.lastMessagePath, 80),
    result: await read(paths.resultPath, 80),
    validation: await read(paths.validationPath, 80),
  };
}

function summarizeRunFacts(facts, { cwd }) {
  const objectiveRef = facts.contract?.livingDoc || {};
  const state = facts.state || {};
  const latestProof = facts.latestProof || {};
  const latestVerdict = facts.latestVerdict || {};
  return {
    schema: 'living-doc-harness-dashboard-run/v1',
    runId: facts.runId,
    runDir: relativeTo(cwd, facts.runDir),
    status: state.status || facts.contract?.status || 'unknown',
    lifecycleStage: state.lifecycleStage || facts.terminalState?.kind || 'unknown',
    recommendation: facts.recommendation,
    objective: {
      sourcePath: objectiveRef.sourcePath || state.docPath || null,
      renderedHtml: objectiveRef.renderedHtml || null,
      objectiveHash: objectiveRef.objectiveHash || state.objectiveHash || null,
      sourceHash: objectiveRef.sourceHash || null,
    },
    process: {
      mode: facts.contract?.mode || null,
      isolatedFromUserSession: facts.contract?.process?.isolatedFromUserSession === true,
      pid: facts.contract?.process?.pid || null,
      exitCode: facts.contract?.process?.exitCode ?? null,
      startedAt: facts.contract?.process?.startedAt || null,
      finishedAt: facts.contract?.process?.finishedAt || null,
    },
    proofGates: facts.proofGates || {},
    stopVerdict: facts.terminalState?.stopVerdict || latestVerdict.stopVerdict || facts.handover?.stopVerdict || null,
    stopMismatch: latestVerdict.mismatch || facts.handover?.mismatch || null,
    terminalState: facts.terminalState ? {
      kind: facts.terminalState.kind,
      status: facts.terminalState.status,
      loopMayContinue: facts.terminalState.loopMayContinue,
      nextAction: facts.terminalState.nextAction,
      blockerRef: facts.terminalState.blockerRef,
    } : null,
    blockers: (facts.blockers || []).map((blocker) => ({
      id: blocker.id,
      reasonCode: blocker.reasonCode,
      owningLayer: blocker.owningLayer,
      requiredDecision: blocker.requiredDecision,
      requiredSource: blocker.requiredSource,
      requiredProof: blocker.requiredProof,
      unblockCriteria: blocker.unblockCriteria,
      dashboardVisible: blocker.dashboardVisible === true,
    })),
    skillTimeline: (facts.skillInvocations || []).map((item) => ({
      at: item.at,
      skill: item.skill,
      status: item.status,
      reason: item.reason,
      stopClassification: item.stopClassification,
      stopReasonCode: item.stopReasonCode,
      handoverPath: item.handoverPath,
      resultPath: item.resultPath,
      rawJsonlLogPath: item.rawJsonlLogPath,
    })),
    traceRefs: (facts.traceRefs || []).map((ref) => ({
      summaryPath: ref.summaryPath || null,
      traceHash: ref.traceHash || null,
      lineCount: ref.lineCount || null,
      firstTimestamp: ref.firstTimestamp || null,
      lastTimestamp: ref.lastTimestamp || null,
      rawPayloadIncluded: false,
    })),
    proof: {
      path: facts.latestProofPath || null,
      validation: latestProof.validation || null,
      closureAllowed: latestProof.closureAllowed ?? null,
      unresolvedObjectiveTerms: latestProof.objectiveState?.unresolvedObjectiveTerms || [],
      unprovenAcceptanceCriteria: latestProof.objectiveState?.unprovenAcceptanceCriteria || [],
    },
    artifacts: {
      contract: 'contract.json',
      state: 'state.json',
      events: 'events.jsonl',
      latestHandover: facts.handover?.artifactPath || null,
      latestProof: facts.latestProofPath || null,
      latestStopVerdict: facts.latestVerdictPath || null,
      traceSummaries: (facts.traceSummaries || []).map((summary) => summary.summaryPath),
    },
    privacy: {
      rawPromptIncluded: false,
      rawWrapperLogIncluded: false,
      rawNativeTraceIncluded: false,
      rawMessageContentIncluded: false,
      sanitizedTraceSummariesOnly: true,
    },
  };
}

async function collectDashboardRuns({ runsDir, cwd }) {
  const runDirs = await listRunDirs(runsDir);
  const runs = [];
  const errors = [];
  for (const runDir of runDirs) {
    try {
      const facts = await collectRunEvidence(runDir);
      runs.push(summarizeRunFacts(facts, { cwd }));
    } catch (err) {
      errors.push({
        runDir: relativeTo(cwd, runDir),
        error: String(err.message || err),
      });
    }
  }
  runs.sort((a, b) => String(b.runId).localeCompare(String(a.runId)));
  return { runs, errors };
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendHtml(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(body);
}

function websocketAccept(key) {
  return createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
}

function websocketFrame(text) {
  const payload = Buffer.from(text);
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function websocketSend(socket, body) {
  if (socket.destroyed) return;
  socket.write(websocketFrame(JSON.stringify(body)));
}

function closeWebsocket(socket, code = 1000) {
  if (socket.destroyed) return;
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  socket.write(Buffer.from([0x88, payload.length, ...payload]));
  socket.end();
}

function startLifecycleWebsocketStream(socket, { lifecycleDir, cwd, runsDir }) {
  let seenEventIds = new Set();
  let lastGraphHash = null;
  let stopped = false;

  const publish = async () => {
    if (stopped || socket.destroyed) return;
    try {
      const history = await collectLifecycleEventHistory(lifecycleDir, { cwd, runsDir, includeLogs: true });
      const graphEvent = history.events.find((event) => event.type === 'graph_update');
      const graphHash = graphEvent ? eventHash(graphEvent.payload.graph) : null;
      if (graphHash && graphHash !== lastGraphHash) {
        lastGraphHash = graphHash;
        seenEventIds.delete(graphEvent.eventId);
      }
      for (const event of history.events) {
        if (seenEventIds.has(event.eventId)) continue;
        seenEventIds.add(event.eventId);
        websocketSend(socket, event);
      }
    } catch (err) {
      websocketSend(socket, streamEvent('stream_error', {
        error: String(err.message || err),
      }, { source: 'dashboard-websocket' }));
    }
  };

  websocketSend(socket, streamEvent('stream_opened', {
    lifecycleDir: relativeTo(cwd, lifecycleDir),
    eventSource: 'local-harness-artifacts',
  }, { source: 'dashboard-websocket' }));
  publish();
  const interval = setInterval(publish, 750);
  socket.on('close', () => {
    stopped = true;
    clearInterval(interval);
  });
  socket.on('end', () => {
    stopped = true;
    clearInterval(interval);
  });
  socket.on('error', () => {
    stopped = true;
    clearInterval(interval);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

export function dashboardHtml({ runsDir, evidenceDir }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Living Doc Harness Live Dashboard</title>
  <style>
    :root { color-scheme: light; --ink:#17202a; --muted:#607086; --line:#d9e0ea; --bg:#f6f7f9; --panel:#fff; --green:#0f766e; --blue:#1d4ed8; --amber:#a16207; --red:#b91c1c; --violet:#6d28d9; --slate:#334155; }
    * { box-sizing:border-box; }
    body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); background:#eef2f6; }
    main { width:100%; min-height:100vh; }
    h1,h2,h3 { margin:0; letter-spacing:0; }
    h1 { font-size:24px; }
    h2 { font-size:17px; margin-bottom:10px; }
    h3 { font-size:13px; margin:14px 0 6px; color:var(--muted); text-transform:uppercase; }
    code { overflow-wrap:anywhere; }
    button,input,label { font:inherit; }
    button { border:1px solid var(--line); border-radius:7px; background:#fff; color:var(--ink); padding:7px 10px; cursor:pointer; }
    button.primary { background:var(--green); border-color:var(--green); color:#fff; font-weight:700; }
    button:disabled { opacity:.55; cursor:not-allowed; }
    input[type="text"] { width:100%; border:1px solid var(--line); border-radius:7px; padding:8px 10px; background:#fff; color:var(--ink); }
    .sub { color:var(--muted); margin-top:4px; }
    .dashboard-app { display:grid; grid-template-columns:390px minmax(0,1fr); min-height:100vh; }
    .control-rail { border-right:1px solid var(--line); background:#fbfcfe; padding:18px; display:flex; flex-direction:column; gap:14px; min-height:100vh; }
    .brand-block { padding:4px 2px 8px; }
    .brand-kicker { color:var(--muted); font-size:12px; font-weight:700; text-transform:uppercase; }
    .brand-block h1 { margin-top:4px; }
    .workspace { min-width:0; padding:18px; display:grid; gap:14px; align-content:start; }
    .workspace-head { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; border:1px solid var(--line); border-radius:8px; background:#fff; padding:14px 16px; }
    .workspace-head h2 { font-size:20px; margin-bottom:4px; }
    .workspace-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
    .toolbar { display:grid; gap:10px; align-items:stretch; }
    .field span { display:block; font-size:12px; color:var(--muted); margin-bottom:4px; }
    .check { display:flex; align-items:center; gap:6px; min-height:38px; color:var(--muted); }
    .status-line { color:var(--muted); margin:0 0 10px; font-size:12px; }
    .rail-section { border:1px solid var(--line); border-radius:8px; background:#fff; padding:12px; flex:1; min-height:0; display:flex; flex-direction:column; }
    .rail-section h2 { font-size:14px; margin-bottom:8px; }
    .grid { display:grid; grid-template-columns:300px minmax(0,1fr); gap:14px; }
    .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    .run-list { display:grid; gap:8px; max-height:350px; overflow:auto; padding-right:3px; }
    .run-item { text-align:left; border:1px solid var(--line); border-left:4px solid var(--slate); border-radius:8px; padding:10px; background:#fbfcfe; }
    .run-item[data-rec="close"] { border-left-color:var(--green); }
    .run-item[data-rec="resume"] { border-left-color:var(--blue); }
    .run-item[data-rec="block"] { border-left-color:var(--red); }
    .run-item[data-rec="continuation"] { border-left-color:var(--amber); }
    .run-item.active { outline:2px solid #9dd6c8; }
    .run-title { font-weight:700; overflow-wrap:anywhere; }
    .run-meta { color:var(--muted); font-size:12px; margin-top:3px; }
    .pill-row { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
    .pill { border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; background:#fff; }
    .pill.pass { border-color:#9dd6c8; background:#ecfdf5; color:#047857; }
    .pill.fail { border-color:#fecaca; background:#fef2f2; color:var(--red); }
    .pill.pending, .pill.warn { border-color:#fed7aa; background:#fff7ed; color:var(--amber); }
    .detail-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
    .rec { display:inline-flex; border-radius:7px; padding:5px 9px; background:#e6f3f1; color:var(--green); font-weight:700; }
    .detail-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:12px; }
    .box { border:1px solid var(--line); border-radius:8px; padding:10px; background:#fbfcfe; min-height:86px; }
    .box ul { margin:0; padding-left:18px; }
    .tail { margin-top:12px; }
    .tail pre { margin:8px 0 0; max-height:260px; overflow:auto; border:1px solid var(--line); border-radius:8px; padding:10px; background:#17202a; color:#eef3f8; font-size:12px; line-height:1.45; white-space:pre-wrap; overflow-wrap:anywhere; }
    .tail-details { margin-top:12px; border:1px solid var(--line); border-radius:8px; background:#fbfcfe; padding:10px; }
    .tail-details summary { cursor:pointer; font-weight:700; color:var(--slate); }
    .unit-list { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0; }
    .unit-button { text-align:left; border-radius:8px; min-width:190px; }
    .unit-button.active { outline:2px solid #9dd6c8; }
    .unit-status { display:block; color:var(--muted); font-size:12px; margin-top:2px; }
    .lifecycle-list { display:grid; gap:8px; overflow:auto; padding-right:4px; align-content:start; min-height:0; }
    .lifecycle-item { text-align:left; border:1px solid var(--line); border-radius:8px; padding:10px 11px; background:#fff; box-shadow:0 1px 2px rgba(24,34,48,.04); }
    .lifecycle-item:hover { border-color:#b8c4d4; background:#fbfcfe; }
    .lifecycle-item.active { border-color:#7c3aed; box-shadow:0 0 0 2px rgba(124,58,237,.16), 0 6px 18px rgba(24,34,48,.08); background:#fdfcff; }
    .lifecycle-card-head { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
    .lifecycle-title { min-width:0; font-size:13px; font-weight:800; line-height:1.25; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
    .lifecycle-status { flex:none; max-width:118px; border:1px solid var(--line); border-radius:999px; padding:2px 7px; background:#eef2f7; color:var(--slate); font-size:10px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .lifecycle-status.closed { color:var(--green); background:#e7f6ef; border-color:#a8dec7; }
    .lifecycle-status.continuation-required { color:var(--amber); background:#fff4dc; border-color:#ffd98c; }
    .lifecycle-status.repair-resumed, .lifecycle-status.repairable, .lifecycle-status.running { color:var(--blue); background:#e8f0ff; border-color:#b8cbff; }
    .lifecycle-chip-row { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
    .lifecycle-chip { border:1px solid #d7dfeb; border-radius:999px; padding:2px 7px; color:var(--slate); background:#f8fafc; font-size:11px; font-weight:650; }
    .lifecycle-path { margin-top:8px; color:var(--muted); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .graph-shell { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:14px; align-items:start; }
    .graph-stage { min-width:0; border:1px solid var(--line); border-radius:8px; background:#fff; overflow:auto; }
    .graph-stage-head { display:flex; justify-content:space-between; gap:12px; padding:12px 14px; border-bottom:1px solid var(--line); background:#fff; }
    .graph-board { position:relative; width:2400px; height:1400px; min-height:1400px; min-width:2400px; overflow:hidden; background:linear-gradient(#edf1f6 1px, transparent 1px), linear-gradient(90deg, #edf1f6 1px, transparent 1px); background-size:32px 32px; }
    .graph-edge-layer { position:absolute; inset:0; width:100%; height:100%; pointer-events:auto; z-index:1; }
    .graph-edge-line { stroke:#8b99aa; stroke-width:2; fill:none; opacity:.86; marker-end:url(#graphArrow); pointer-events:none; }
    .graph-edge-line.active { stroke:var(--blue); stroke-width:3; marker-end:url(#graphArrowActive); }
    .graph-edge-line.to-living-doc { stroke-dasharray:4 5; }
    .graph-edge-hit { stroke:transparent; stroke-width:22; fill:none; pointer-events:stroke; cursor:pointer; }
    .graph-edge-label-group { cursor:pointer; }
    .graph-edge-label-box { fill:rgba(255,255,255,.96); stroke:var(--line); stroke-width:1; filter:drop-shadow(0 3px 8px rgba(24,34,48,.12)); }
    .graph-edge-label-text { fill:var(--slate); font-size:10px; font-weight:750; letter-spacing:0; pointer-events:none; }
    .graph-node-card { position:absolute; z-index:2; width:178px; height:72px; overflow:hidden; text-align:left; border:1px solid var(--line); border-top:3px solid var(--slate); border-radius:7px; background:#fff; padding:7px; box-shadow:0 7px 18px rgba(24,34,48,.1); opacity:1; transform:translateY(0); transition:box-shadow .18s ease, border-color .18s ease; cursor:grab; user-select:none; touch-action:none; }
    .graph-node-card.dragging { cursor:grabbing; box-shadow:0 0 0 3px rgba(29,78,216,.2), 0 16px 44px rgba(24,34,48,.22); }
    .graph-node-card.active { box-shadow:0 0 0 3px rgba(29,78,216,.18), 0 12px 34px rgba(24,34,48,.16); }
    .graph-node-card.current-unit { border-color:#1d4ed8; box-shadow:0 0 0 3px rgba(29,78,216,.22), 0 14px 34px rgba(29,78,216,.18); }
    .graph-node-card[data-role="worker"] { border-top-color:var(--blue); }
    .graph-node-card[data-role="reviewer"] { border-top-color:var(--violet); }
    .graph-node-card[data-role="balance-scan"] { border-top-color:var(--green); }
    .graph-node-card[data-role="living-doc"] { border-top-color:var(--green); background:#fbfffd; border-color:#9dd6c8; box-shadow:0 10px 28px rgba(15,118,110,.14); }
    .graph-node-card[data-role="living-doc"] .graph-node-role { color:var(--green); }
    .graph-node-card[data-role="living-doc"] .graph-card-title { font-size:14px; line-height:1.18; }
    .graph-node-card[data-role="living-doc"] .graph-card-proof { font-size:10.5px; }
    .graph-node-card[data-role="repair-skill"], .graph-node-card[data-role="repair-chain-result"] { border-top-color:var(--amber); }
    .graph-node-card[data-role="terminal"] { border-top-color:var(--red); }
    .graph-node-card[data-role="blocker"] { border-top-color:var(--red); }
    .graph-node-card[data-role="github-issue"] { border-top-color:var(--slate); }
    .graph-node-top { display:flex; align-items:center; justify-content:space-between; gap:7px; margin-bottom:3px; }
    .graph-node-role { color:var(--muted); font-size:8.5px; font-weight:800; text-transform:uppercase; letter-spacing:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .graph-node-head { display:block; min-width:0; }
    .graph-status { flex:none; max-width:72px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; border:1px solid var(--line); border-radius:999px; padding:1px 5px; font-size:9px; font-weight:750; color:var(--slate); background:#eef2f7; }
    .graph-status.running, .graph-status.prepared { color:var(--blue); background:#e8f0ff; border-color:#b8cbff; }
    .graph-status.closed, .graph-status.complete, .graph-status.satisfied { color:var(--green); background:#e7f6ef; border-color:#a8dec7; }
    .graph-status.blocked, .graph-status.open { color:var(--red); background:#ffebe8; border-color:#ffc0b9; }
    .graph-status.continuation-required { color:var(--amber); background:#fff4dc; border-color:#ffd98c; }
    .graph-card-title { font-size:11.5px; font-weight:800; line-height:1.18; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
    .graph-card-proof { margin-top:4px; color:var(--muted); font-size:9.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .graph-inspector { border:1px solid var(--line); border-radius:8px; background:#f8fafc; min-height:640px; max-height:780px; overflow:auto; }
    .inspector-header { border-bottom:1px solid var(--line); background:#fff; padding:14px; }
    .inspector-kicker { color:var(--muted); font-size:10px; font-weight:850; text-transform:uppercase; letter-spacing:.03em; }
    .inspector-title-row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-top:4px; }
    .inspector-title { min-width:0; font-size:16px; line-height:1.25; font-weight:850; overflow-wrap:anywhere; }
    .inspector-subtitle { color:var(--muted); font-size:12px; margin-top:6px; overflow-wrap:anywhere; }
    .inspector-body { display:grid; gap:10px; padding:12px; }
    .inspector-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
    .inspector-field { border:1px solid var(--line); border-radius:7px; background:#fff; padding:8px; min-width:0; }
    .inspector-field span { display:block; color:var(--muted); font-size:10px; font-weight:750; text-transform:uppercase; }
    .inspector-field strong { display:block; margin-top:2px; font-size:12px; overflow-wrap:anywhere; }
    .inspector-section { border:1px solid var(--line); border-radius:7px; background:#fff; padding:10px; }
    .inspector-section h3 { margin:0 0 8px; }
    .inspector-list { display:grid; gap:6px; margin:0; padding:0; list-style:none; }
    .inspector-list li { display:grid; gap:2px; border-top:1px solid #eef2f7; padding-top:6px; }
    .inspector-list li:first-child { border-top:0; padding-top:0; }
    .inspector-list strong { color:var(--slate); font-size:11px; }
    .inspector-list code { color:#41516a; font-size:11px; }
    .inspector-action { width:100%; margin-top:2px; border-color:#b8cbff; background:#eef6ff; color:var(--blue); font-weight:800; }
    #graphTailBox { margin:8px 0 0; max-height:260px; overflow:auto; border:1px solid var(--line); border-radius:7px; padding:10px; background:#17202a; color:#eef3f8; font-size:11px; line-height:1.45; white-space:pre-wrap; overflow-wrap:anywhere; }
    .graph-path-list { margin:8px 0 0; padding-left:18px; }
    .event-stream { max-height:150px; overflow:auto; display:grid; gap:6px; margin-top:8px; }
    .event-row { border-top:1px solid #eef2f7; padding-top:6px; color:var(--slate); font-size:11px; }
    .event-row:first-child { border-top:0; padding-top:0; }
    .muted { color:var(--muted); }
    .empty { color:var(--muted); padding:12px 0; }
    .error { color:var(--red); }
    @media (max-width: 1180px) { .dashboard-app { grid-template-columns:1fr; } .control-rail { min-height:auto; border-right:0; border-bottom:1px solid var(--line); } .graph-shell,.grid { grid-template-columns:1fr; } }
    @media (max-width: 920px) { .detail-grid { grid-template-columns:1fr; } .detail-head,.workspace-head { display:block; } .workspace-actions { justify-content:flex-start; margin-top:10px; } .rec { margin-top:8px; } .graph-board { min-height:auto; display:grid; gap:10px; padding:12px; min-width:0; } .graph-node-card { position:relative; left:auto !important; top:auto !important; width:100%; } .graph-edge-layer { display:none; } .inspector-grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <main class="dashboard-app">
    <aside class="control-rail">
      <div class="brand-block">
        <div class="brand-kicker">Living Doc Harness</div>
        <h1>Lifecycles</h1>
        <div class="sub">Select a lifecycle result and inspect its inference graph. Backend reads <code>${esc(runsDir)}</code>.</div>
      </div>
      <section class="rail-section">
        <h2>Lifecycles</h2>
        <div id="status" class="status-line">Loading lifecycles...</div>
        <div id="lifecycles" class="lifecycle-list">Loading lifecycles...</div>
      </section>
    </aside>

    <section class="workspace">
      <header class="workspace-head">
        <div>
          <h2>Lifecycle Graph</h2>
          <p class="muted">Standalone replacement dashboard for inference units, contract handoffs, lifecycle state, and local evidence inspection. Prompt and raw log payloads stay local.</p>
        </div>
        <div class="workspace-actions">
          <span id="graphStatus" class="rec">loading</span>
          <span class="pill">local-only evidence</span>
          <button id="refresh" type="button">Refresh</button>
          <button id="resetGraphLayout" type="button" title="Recompute the graph layout and show the active iteration lane">Re-layout</button>
        </div>
      </header>
      <section class="graph-shell">
        <section class="graph-stage">
          <div class="graph-stage-head">
            <div>
              <div id="graphSummary" class="run-id">Select a lifecycle.</div>
              <div class="sub">Cards appear from lifecycle artifacts. Arrows carry the controlling contract.</div>
            </div>
            <div class="state-chip"><span class="state-dot"></span><span id="graphStageState">waiting</span></div>
          </div>
          <div id="graphBoard" class="graph-board">
            <svg id="graphEdgeLayer" class="graph-edge-layer" viewBox="0 0 1120 690" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <marker id="graphArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#8b99aa"></path>
                </marker>
                <marker id="graphArrowActive" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#1d4ed8"></path>
                </marker>
              </defs>
            </svg>
            <div id="graphUnits"></div>
          </div>
        </section>
        <div id="graphInspector" class="graph-inspector">Select a graph node or contract arrow.</div>
      </section>
    </section>
  </main>
  <script>
    const state = { runs: [], lifecycles: [], lifecycleGraph: null, selectedLifecycleId: null, selectedGraphNodeId: null, selectedGraphEdgeId: null, selectedRunId: null, selectedRepairUnitKey: null, graphPositionOverrides: {}, graphDrag: null, graphClickSuppressedNodeId: null, loading: false, streamSocket: null, streamLifecycleId: null, streamEvents: [], graphNodeTails: {}, selectedTailNodeId: null };
    const el = (id) => document.getElementById(id);
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
    const listItems = (items, render = (x) => esc(x)) => items?.length ? '<ul>' + items.map((item) => '<li>' + render(item) + '</li>').join('') + '</ul>' : '<span class="muted">none</span>';

    function gateClass(value) {
      if (value === 'pass') return 'pass';
      if (value === 'fail') return 'fail';
      if (value === 'pending' || value === 'warn') return 'pending';
      return '';
    }

    function graphNodeById(id) {
      return (state.lifecycleGraph?.nodes || []).find((node) => node.id === id) || null;
    }

    function graphEdgeById(id) {
      return (state.lifecycleGraph?.edges || []).find((edge) => edge.id === id) || null;
    }

    function rememberStreamEvent(event) {
      if (!event?.eventId || state.streamEvents.some((item) => item.eventId === event.eventId)) return;
      state.streamEvents = [event, ...state.streamEvents].slice(0, 80);
    }

    function cacheStreamEventPayload(event) {
      if (event.type !== 'log_append') return;
      const nodeId = event.payload?.nodeId;
      if (!nodeId) return;
      state.graphNodeTails[nodeId] = state.graphNodeTails[nodeId] || {};
      state.graphNodeTails[nodeId][event.payload.kind || 'log'] = event.payload.lines || [];
    }

    function currentActiveUnitId() {
      return state.lifecycleGraph?.activeInferenceUnitId || null;
    }

    function applyStreamEvent(event) {
      rememberStreamEvent(event);
      cacheStreamEventPayload(event);
      if (event.type === 'lifecycle_snapshot' || event.type === 'graph_update') {
        const graph = event.payload?.graph;
        if (graph) {
          const previousActive = currentActiveUnitId();
          state.lifecycleGraph = graph;
          if (!state.graphPositionOverrides || state.streamLifecycleId !== state.selectedLifecycleId) state.graphPositionOverrides = loadGraphLayout();
          const activeId = graph.activeInferenceUnitId || null;
          if (activeId && (!state.selectedGraphNodeId || state.selectedGraphNodeId === previousActive)) {
            state.selectedGraphNodeId = activeId;
            state.selectedGraphEdgeId = null;
          }
          renderGraph();
          if (state.selectedGraphNodeId) refreshGraphNodeTail(state.selectedGraphNodeId);
        }
      } else if (event.type === 'log_append') {
        if (event.payload?.nodeId === state.selectedGraphNodeId) renderGraphInspector();
      } else {
        renderGraphInspector();
      }
    }

    function streamUrlForLifecycle(resultId) {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return protocol + '//' + location.host + '/ws/lifecycles/' + encodeURIComponent(resultId);
    }

    function connectLifecycleStream() {
      if (!state.selectedLifecycleId || typeof WebSocket === 'undefined') return;
      if (state.streamSocket && state.streamLifecycleId === state.selectedLifecycleId && state.streamSocket.readyState < 2) return;
      if (state.streamSocket) state.streamSocket.close();
      state.streamLifecycleId = state.selectedLifecycleId;
      const socket = new WebSocket(streamUrlForLifecycle(state.selectedLifecycleId));
      state.streamSocket = socket;
      const status = el('graphStatus');
      if (status) status.textContent = 'connecting';
      socket.addEventListener('open', () => {
        if (el('graphStatus')) el('graphStatus').textContent = 'live';
      });
      socket.addEventListener('message', (message) => {
        try {
          applyStreamEvent(JSON.parse(message.data));
        } catch (err) {
          rememberStreamEvent({ eventId: 'client-parse-error:' + Date.now(), type: 'stream_error', at: new Date().toISOString(), payload: { error: String(err.message || err) } });
          renderGraphInspector();
        }
      });
      socket.addEventListener('close', () => {
        if (state.streamSocket === socket && el('graphStatus')) el('graphStatus').textContent = 'offline';
      });
      socket.addEventListener('error', () => {
        if (el('graphStatus')) el('graphStatus').textContent = 'stream error';
      });
    }

    function graphRole(node) {
      return node?.role || node?.type || 'artifact';
    }

    function graphKind(node) {
      const role = graphRole(node);
      if (role === 'living-doc') return 'document';
      if (role === 'balance-scan') return 'scan';
      if (role === 'repair-skill' || role === 'repair-chain-result') return 'repair';
      if (role === 'terminal' || role === 'blocker') return 'terminal';
      return role;
    }

    function graphRoleLabel(node) {
      const role = graphRole(node);
      if (role === 'living-doc') return 'living doc';
      if (role === 'balance-scan') return 'balance scan';
      if (role === 'repair-skill') return 'repair';
      if (role === 'repair-chain-result') return 'chain result';
      if (role === 'github-issue') return 'issue';
      return role;
    }

    function graphNodeTitle(node) {
      const role = graphRole(node);
      if (role === 'living-doc') return node?.label || 'Operated living doc';
      if (role === 'controller') return 'Lifecycle controller';
      if (role === 'worker') return 'Worker iteration ' + (node.iteration ?? '');
      if (role === 'reviewer') return 'Reviewer iteration ' + (node.iteration ?? '');
      if (role === 'balance-scan') return 'Balance scan';
      if (role === 'repair-chain-result') return 'Repair chain result';
      if (role === 'terminal') return 'Terminal decision';
      const label = String(node?.label || node?.id || '');
      return label.replace(/^\d+\s*·\s*/, '');
    }

    function graphStatusClass(status) {
      return String(status || 'unknown').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    }

    function svgSafeId(value) {
      return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '-');
    }

    function graphLayoutStorageKey() {
      return state.selectedLifecycleId ? 'living-doc-harness-graph-layout:v8:' + state.selectedLifecycleId : null;
    }

    const DEFAULT_GRAPH_BOARD = { width: 2400, height: 1400 };

    function loadGraphLayout() {
      const key = graphLayoutStorageKey();
      if (!key) return {};
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }

    function saveGraphLayout() {
      const key = graphLayoutStorageKey();
      if (!key) return;
      localStorage.setItem(key, JSON.stringify(state.graphPositionOverrides || {}));
    }

    function focusGraphViewportOnNode(nodeId, { behavior = 'smooth' } = {}) {
      const stage = document.querySelector('.graph-stage');
      if (!stage || !nodeId || !state.lifecycleGraph) return;
      const positions = graphNodePositions(state.lifecycleGraph.nodes || []);
      const position = positions.get(nodeId);
      if (!position) return;
      const left = 0;
      const top = Math.max(0, Math.round(position.y - Math.max(80, stage.clientHeight * 0.28)));
      stage.scrollTo({ left, top, behavior });
    }

    function resetGraphLayout() {
      const key = graphLayoutStorageKey();
      if (key) localStorage.removeItem(key);
      state.graphPositionOverrides = {};
      state.selectedGraphEdgeId = null;
      const focusNodeId = state.lifecycleGraph?.activeInferenceUnitId || state.selectedGraphNodeId || state.lifecycleGraph?.nodes?.[0]?.id || null;
      if (focusNodeId) state.selectedGraphNodeId = focusNodeId;
      renderGraph();
      window.requestAnimationFrame(() => focusGraphViewportOnNode(focusNodeId));
    }

    function shortPath(value) {
      const text = String(value || '');
      if (!text) return '';
      const parts = text.split('/').filter(Boolean);
      return parts.length > 2 ? '...' + parts.slice(-2).join('/') : text;
    }

    function lifecycleTitle(item) {
      const docName = String(item?.docPath || '').split('/').filter(Boolean).pop();
      const fromDoc = docName ? docName.replace(/\\.json$/i, '') : '';
      const fromId = String(item?.resultId || '')
        .replace(/^ldhl-\\d{8}T\\d{6}Z-/, '')
        .replace(/-/g, ' ');
      return fromDoc || fromId || 'Lifecycle result';
    }

    function lifecycleCreatedLabel(item) {
      const raw = item?.createdAt || String(item?.resultId || '').match(/^ldhl-(\\d{8})T(\\d{6})Z-/)?.[0];
      if (item?.createdAt) {
        const date = new Date(item.createdAt);
        if (!Number.isNaN(date.getTime())) return date.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      }
      const match = String(item?.resultId || '').match(/^ldhl-(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z-/);
      if (match) return match[1] + '-' + match[2] + '-' + match[3] + ' ' + match[4] + ':' + match[5] + 'Z';
      return raw ? String(raw) : 'time unknown';
    }

    function lifecycleStatusClass(kind) {
      return String(kind || 'running').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    }

    function graphNodeSize(node) {
      return graphRole(node) === 'living-doc'
        ? { w: 250, h: 104 }
        : { w: 178, h: 72 };
    }

    function graphNodeIteration(node) {
      const value = Number(node?.iteration);
      return Number.isFinite(value) && value > 0 ? value : null;
    }

    function graphRepairSequence(node) {
      const match = String(node?.id || '').match(/-repair-(\\d+)$/);
      return match ? Number(match[1]) : 0;
    }

    function graphCompactLanePosition(role, iteration, repairSequence = 0, maxRepairSequence = 0) {
      const laneY = iteration ? 76 + (iteration - 1) * 356 : null;
      if (!iteration) return null;
      const laneGap = 146;
      const xStep = 280;
      const sequenced = (index) => ({ x: 300 + index * xStep, y: laneY + (index % 2) * laneGap });
      if (role === 'worker') return sequenced(0);
      if (role === 'reviewer') return sequenced(1);
      if (role === 'balance-scan') return sequenced(2);
      if (role === 'repair-skill') {
        const sequence = Math.max(1, repairSequence || 1);
        return sequenced(sequence + 2);
      }
      if (role === 'repair-chain-result') return sequenced(Math.max(3, maxRepairSequence + 3));
      const terminalIndex = maxRepairSequence > 0 ? maxRepairSequence + 4 : 3;
      if (role === 'terminal') return sequenced(terminalIndex);
      if (role === 'blocker') return { x: 300 + terminalIndex * xStep, y: laneY + laneGap + 118 };
      if (role === 'github-issue') return { x: 300 + terminalIndex * xStep, y: laneY + laneGap + 236 };
      return null;
    }

    function graphNodePositions(nodes) {
      const roleCounts = {};
      const repairMaxByIteration = new Map();
      for (const node of nodes || []) {
        if (graphRole(node) !== 'repair-skill') continue;
        const iteration = graphNodeIteration(node);
        if (!iteration) continue;
        repairMaxByIteration.set(iteration, Math.max(repairMaxByIteration.get(iteration) || 0, graphRepairSequence(node)));
      }
      const roleBase = {
        controller: { x: 36, y: 96 },
        'living-doc': { x: 36, y: 230 },
      };
      const positions = new Map();
      for (const node of nodes || []) {
        const role = graphRole(node);
        const iteration = graphNodeIteration(node);
        const count = roleCounts[role] || 0;
        roleCounts[role] = count + 1;
        const repairSequence = graphRepairSequence(node);
        const compact = graphCompactLanePosition(role, iteration, repairSequence, repairMaxByIteration.get(iteration) || 0);
        const base = compact || roleBase[role] || { x: 320, y: 500 + count * 190 };
        const override = state.graphPositionOverrides?.[node.id];
        const size = graphNodeSize(node);
        positions.set(node.id, {
          x: Number.isFinite(override?.x) ? override.x : base.x,
          y: Number.isFinite(override?.y) ? override.y : base.y,
          w: size.w,
          h: size.h,
        });
      }
      return positions;
    }

    function graphBoardBounds(positions) {
      let width = DEFAULT_GRAPH_BOARD.width;
      let height = DEFAULT_GRAPH_BOARD.height;
      for (const position of positions?.values?.() || []) {
        width = Math.max(width, position.x + position.w + 180);
        height = Math.max(height, position.y + position.h + 180);
      }
      return { width, height };
    }

    function renderGraphNodeCard(node, position) {
      if (!node) return '<div class="graph-node-card"><div class="muted">missing node</div></div>';
      const pos = position || { x: 0, y: 0 };
      const paths = node.artifactPaths || {};
      const meta = node.meta || {};
      const proofText = graphRole(node) === 'living-doc'
        ? shortPath(paths.livingDocPath || meta.docId || 'living doc')
        : 'it ' + (node.iteration ?? '-') + ' · val ' + (meta.validationOk ?? (paths.validationPath ? 'path' : '-')) + ' · log ' + (meta.hasCodexEvents ?? Boolean(paths.codexEventsPath));
      return '<button class="graph-node-card ' + (state.selectedGraphNodeId === node.id ? 'active' : '') + (state.lifecycleGraph?.activeInferenceUnitId === node.id ? ' current-unit' : '') + (state.graphDrag?.nodeId === node.id ? ' dragging' : '') + '" style="left:' + esc(pos.x) + 'px;top:' + esc(pos.y) + 'px;width:' + esc(pos.w) + 'px;height:' + esc(pos.h) + 'px" data-graph-node-id="' + esc(node.id) + '" data-role="' + esc(graphRole(node)) + '" data-kind="' + esc(graphKind(node)) + '">' +
        '<div class="graph-node-top"><span class="graph-node-role">' + esc(graphRoleLabel(node)) + '</span><span class="graph-status ' + esc(graphStatusClass(node.status)) + '">' + esc(node.status) + '</span></div>' +
        '<div class="graph-node-head"><div class="graph-card-title">' + esc(graphNodeTitle(node)) + '</div></div>' +
        '<div class="graph-card-proof">' + esc(proofText) + '</div>' +
      '</button>';
    }

    function graphEdgeRoute(from, to) {
      if (to.x + to.w < from.x - 16) {
        const sx = from.x;
        const sy = from.y + Math.round(from.h / 2);
        const tx = to.x + to.w;
        const ty = to.y + Math.round(to.h / 2);
        const bend = Math.max(96, Math.round((sx - tx) / 2));
        const sameRow = Math.abs(sy - ty) < 8;
        return {
          d: 'M ' + sx + ' ' + sy + ' C ' + (sx - bend) + ' ' + sy + ', ' + (tx + bend) + ' ' + ty + ', ' + tx + ' ' + ty,
          labelX: Math.round((sx + tx) / 2),
          labelY: Math.round((sy + ty) / 2),
        };
      }
      if (to.x <= from.x + from.w + 16) {
        const sx = from.x + Math.round(from.w / 2);
        const sy = from.y + from.h;
        const tx = to.x + Math.round(to.w / 2);
        const ty = to.y;
        const midY = sy + Math.max(42, Math.round((ty - sy) / 2));
        return {
          d: 'M ' + sx + ' ' + sy + ' C ' + sx + ' ' + midY + ', ' + tx + ' ' + midY + ', ' + tx + ' ' + ty,
          labelX: Math.round((from.x + from.w / 2 + to.x + to.w / 2) / 2),
          labelY: Math.round((from.y + from.h + to.y) / 2),
        };
      }
      const sx = from.x + from.w;
      const sy = from.y + Math.round(from.h / 2);
      const tx = to.x;
      const ty = to.y + Math.round(to.h / 2);
      if (Math.abs(sy - ty) < 4 && tx - sx < 96) {
        return {
          d: 'M ' + sx + ' ' + sy + ' L ' + tx + ' ' + ty,
          labelX: Math.round((sx + tx) / 2),
          labelY: Math.round((sy + ty) / 2),
        };
      }
      const bend = Math.max(42, Math.round((tx - sx) / 2));
      return {
        d: 'M ' + sx + ' ' + sy + ' C ' + (sx + bend) + ' ' + sy + ', ' + (tx - bend) + ' ' + ty + ', ' + tx + ' ' + ty,
        labelX: Math.round((sx + tx) / 2),
        labelY: Math.round((sy + ty) / 2),
      };
    }

    function renderGraphEdgeSvg(edge, positions) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) return '';
      const route = graphEdgeRoute(from, to);
      const active = state.selectedGraphEdgeId === edge.id ? ' active' : '';
      const livingDocEdge = edge.to === 'operated-living-doc' ? ' to-living-doc' : '';
      const pathId = 'graph-edge-path-' + svgSafeId(edge.id);
      const label = String(edge.label || edge.type || '');
      const labelWidth = Math.min(150, Math.max(62, Math.round(label.length * 5.9 + 18)));
      return '<path id="' + esc(pathId) + '" class="graph-edge-line' + active + livingDocEdge + '" d="' + esc(route.d) + '" data-graph-edge-id="' + esc(edge.id) + '"></path>' +
        '<path class="graph-edge-hit" d="' + esc(route.d) + '" data-graph-edge-id="' + esc(edge.id) + '"></path>' +
        '<g class="graph-edge-label-group" data-graph-edge-id="' + esc(edge.id) + '" transform="translate(' + esc(route.labelX) + ' ' + esc(route.labelY) + ')">' +
          '<rect class="graph-edge-label-box" x="' + esc(-Math.round(labelWidth / 2)) + '" y="-11" width="' + esc(labelWidth) + '" height="22" rx="11"></rect>' +
          '<text class="graph-edge-label-text" text-anchor="middle" dominant-baseline="middle">' + esc(label) + '</text>' +
        '</g>';
    }

    function inspectorValue(value) {
      if (Array.isArray(value)) return value.join(', ');
      if (value && typeof value === 'object') return JSON.stringify(value);
      return value ?? 'none';
    }

    function inspectorFields(rows) {
      return '<div class="inspector-grid">' + rows.map(([label, value]) =>
        '<div class="inspector-field"><span>' + esc(label) + '</span><strong>' + esc(inspectorValue(value)) + '</strong></div>'
      ).join('') + '</div>';
    }

    function inspectorList(rows, emptyText) {
      return rows.length
        ? '<ul class="inspector-list">' + rows.map(([key, value]) => '<li><strong>' + esc(key) + '</strong><code>' + esc(inspectorValue(value)) + '</code></li>').join('') + '</ul>'
        : '<p class="muted">' + esc(emptyText) + '</p>';
    }

    function renderCommitIntentSection(intent) {
      if (!intent) {
        return '<section class="inspector-section"><h3>Commit Intent</h3><p class="muted">No commit intent evidence recorded.</p></section>';
      }
      return '<section class="inspector-section"><h3>Commit Intent</h3>' +
        inspectorFields([
          ['Required', intent.required === true ? 'required' : 'not required'],
          ['Source', intent.source || 'artifact'],
          ['Reason', intent.reason || 'none'],
          ['Message', intent.message || 'none'],
        ]) +
        '<h3>Body</h3>' + listItems(intent.body || [], (item) => '<code>' + esc(item) + '</code>') +
        '<h3>Changed Files</h3>' + listItems(intent.changedFiles || [], (item) => '<code>' + esc(item) + '</code>') +
      '</section>';
    }

    function renderEventStreamSection() {
      const rows = state.streamEvents.slice(0, 18).map((event) => {
        const target = event.payload?.nodeId || event.payload?.edgeId || event.payload?.event || event.payload?.kind || event.payload?.resultId || '';
        return '<div class="event-row"><strong>' + esc(event.type) + '</strong> <span class="muted">' + esc(target) + '</span></div>';
      }).join('');
      return '<section class="inspector-section"><h3>Live Events</h3><div class="event-stream">' + (rows || '<p class="muted">No streamed events received yet.</p>') + '</div></section>';
    }

    function renderTailSectionsForNode(node) {
      const cached = state.graphNodeTails[node.id] || {};
      const sections = [
        ['codex events', cached.codexEvents],
        ['stderr', cached.stderr],
        ['last message', cached.lastMessage],
        ['result', cached.result],
        ['validation', cached.validation]
      ];
      return sections.map(([name, lines]) => '## ' + name + '\\n' + (lines?.length ? lines.join('\\n') : '(empty)')).join('\\n\\n');
    }

    function renderGraphInspector() {
      const target = el('graphInspector');
      if (!target) return;
      const edge = state.selectedGraphEdgeId ? graphEdgeById(state.selectedGraphEdgeId) : null;
      const node = !edge && state.selectedGraphNodeId ? graphNodeById(state.selectedGraphNodeId) : null;
      if (edge) {
        const contractRows = Object.entries(edge.contract || {}).filter(([, value]) => value !== null && value !== undefined && value !== '');
        const commitIntent = edge.contract?.commitIntent || null;
        target.innerHTML = '<div class="inspector-header">' +
          '<div class="inspector-kicker">Contract arrow</div>' +
          '<div class="inspector-title-row"><div class="inspector-title">' + esc(edge.label || edge.type || 'Contract handoff') + '</div><span class="graph-status ' + esc(graphStatusClass(edge.status)) + '">' + esc(edge.status || 'unknown') + '</span></div>' +
          '<div class="inspector-subtitle">' + esc(edge.from) + ' -> ' + esc(edge.to) + '</div>' +
        '</div>' +
        '<div class="inspector-body">' +
          inspectorFields([
            ['Gate', edge.gate || 'none'],
            ['Effect', edge.lifecycleEffect || 'none'],
            ['Type', edge.type || 'contract-handoff'],
            ['Status', edge.status || 'unknown'],
          ]) +
          renderCommitIntentSection(commitIntent) +
          '<section class="inspector-section"><h3>Contract Evidence</h3>' + inspectorList(contractRows, 'No contract evidence paths recorded.') + '</section>' +
          renderEventStreamSection() +
        '</div>';
        return;
      }
      if (node) {
        const pathRows = Object.entries(node.artifactPaths || {}).filter(([, value]) => value);
        const metaRows = Object.entries(node.meta || {}).filter(([, value]) => value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && !value.length));
        const hasTail = Boolean(node.artifactPaths?.codexEventsPath || node.artifactPaths?.stderrPath || node.artifactPaths?.lastMessagePath || node.artifactPaths?.resultPath || node.artifactPaths?.validationPath);
        const tailBox = hasTail ? '<button id="graphTailButton" class="inspector-action">Refresh selected unit log</button><pre id="graphTailBox">' + esc(renderTailSectionsForNode(node)) + '</pre>' : '';
        target.innerHTML = '<div class="inspector-header">' +
          '<div class="inspector-kicker">' + esc(graphRole(node) === 'living-doc' ? 'Operated living doc' : 'Inference unit') + '</div>' +
          '<div class="inspector-title-row"><div class="inspector-title">' + esc(graphNodeTitle(node)) + '</div><span class="graph-status ' + esc(graphStatusClass(node.status)) + '">' + esc(node.status || 'unknown') + '</span></div>' +
          '<div class="inspector-subtitle">' + esc(node.label || node.id) + '</div>' +
        '</div>' +
        '<div class="inspector-body">' +
          inspectorFields([
            ['Role', node.role || node.type || 'artifact'],
            ['Iteration', node.iteration ?? 'n/a'],
            ['Validation', node.meta?.validationOk ?? (node.artifactPaths?.validationPath ? 'path' : 'none')],
            ['Log', node.meta?.hasCodexEvents ?? Boolean(node.artifactPaths?.codexEventsPath)],
          ]) +
          (graphRole(node) === 'repair-skill' ? renderCommitIntentSection(node.meta?.commitIntent || null) : '') +
          '<section class="inspector-section"><h3>Artifact Paths</h3>' + inspectorList(pathRows, 'No artifact paths recorded.') + '</section>' +
          '<section class="inspector-section"><h3>Metadata</h3>' + inspectorList(metaRows, 'No metadata recorded.') + '</section>' +
          tailBox +
          renderEventStreamSection() +
        '</div>';
        const button = document.getElementById('graphTailButton');
        if (button) button.addEventListener('click', () => refreshGraphNodeTail(node.id));
        if (hasTail && state.selectedTailNodeId !== node.id) refreshGraphNodeTail(node.id);
        return;
      }
      target.innerHTML = '<div class="inspector-header"><div class="inspector-kicker">Inspector</div><div class="inspector-title">Select a card or arrow</div><div class="inspector-subtitle">Inference-unit cards and contract arrows open their evidence here.</div></div><div class="inspector-body">' + renderEventStreamSection() + '</div>';
    }

    async function refreshGraphNodeTail(nodeId) {
      if (!state.selectedLifecycleId || !nodeId) return;
      state.selectedTailNodeId = nodeId;
      const box = document.getElementById('graphTailBox');
      if (box) box.style.display = 'block';
      try {
        const response = await fetch('/api/lifecycles/' + encodeURIComponent(state.selectedLifecycleId) + '/nodes/' + encodeURIComponent(nodeId) + '/tail?lines=80');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'server error');
        state.graphNodeTails[nodeId] = {
          codexEvents: payload.codexEvents || [],
          stderr: payload.stderr || [],
          lastMessage: payload.lastMessage || [],
          result: payload.result || [],
          validation: payload.validation || []
        };
        if (box && state.selectedGraphNodeId === nodeId) box.textContent = renderTailSectionsForNode({ id: nodeId });
      } catch (err) {
        if (box) box.textContent = String(err.message || err);
      }
    }

    async function refreshGraphUnitTail(runId, unitKey) {
      const box = document.getElementById('graphTailBox');
      if (!box || !unitKey) return;
      box.style.display = 'block';
      const [iterationDir, unitDir] = unitKey.split('/');
      try {
        const response = await fetch('/api/runs/' + encodeURIComponent(runId) + '/repair-units/' + encodeURIComponent(iterationDir) + '/' + encodeURIComponent(unitDir) + '/tail?lines=60');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'server error');
        const sections = [
          ['codex events', payload.codexEvents],
          ['stderr', payload.stderr],
          ['last message', payload.lastMessage],
          ['result', payload.result],
          ['validation', payload.validation]
        ];
        box.textContent = sections.map(([name, lines]) => '## ' + name + '\\n' + (lines?.length ? lines.join('\\n') : '(empty)')).join('\\n\\n');
      } catch (err) {
        box.textContent = String(err.message || err);
      }
    }

    function startGraphNodeDrag(event) {
      if (event.button !== 0) return;
      const card = event.currentTarget;
      const board = el('graphBoard');
      if (!card || !board) return;
      const nodeId = card.dataset.graphNodeId;
      const pos = graphNodePositions(state.lifecycleGraph?.nodes || []).get(nodeId);
      if (!nodeId || !pos) return;
      event.preventDefault();
      card.setPointerCapture?.(event.pointerId);
      state.graphDrag = {
        nodeId,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: pos.x,
        startY: pos.y,
        moved: false,
      };
    }

    function moveGraphNodeDrag(event) {
      const drag = state.graphDrag;
      const board = el('graphBoard');
      if (!drag || !board) return;
      const scaleX = board.offsetWidth / Math.max(1, board.getBoundingClientRect().width);
      const scaleY = board.offsetHeight / Math.max(1, board.getBoundingClientRect().height);
      const nextX = Math.max(8, Math.round(drag.startX + (event.clientX - drag.startClientX) * scaleX));
      const nextY = Math.max(8, Math.round(drag.startY + (event.clientY - drag.startClientY) * scaleY));
      if (Math.abs(nextX - drag.startX) > 3 || Math.abs(nextY - drag.startY) > 3) drag.moved = true;
      state.graphPositionOverrides = {
        ...(state.graphPositionOverrides || {}),
        [drag.nodeId]: { x: nextX, y: nextY },
      };
      renderGraph();
    }

    function endGraphNodeDrag() {
      const drag = state.graphDrag;
      if (!drag) return;
      state.graphDrag = null;
      if (drag.moved) {
        state.graphClickSuppressedNodeId = drag.nodeId;
        saveGraphLayout();
        renderGraph();
      }
    }

    function renderGraph() {
      const graph = state.lifecycleGraph;
      const board = el('graphBoard');
      const units = el('graphUnits');
      const edgeLayer = el('graphEdgeLayer');
      const summary = el('graphSummary');
      const status = el('graphStatus');
      const stageState = el('graphStageState');
      if (!graph) {
        if (units) units.innerHTML = '<div class="empty" style="padding:12px">No graph loaded.</div>';
        if (edgeLayer) edgeLayer.innerHTML = edgeLayer.querySelector('defs')?.outerHTML || '';
        if (summary) summary.textContent = 'Select a lifecycle.';
        if (status) status.textContent = 'no graph';
        if (stageState) stageState.textContent = 'waiting';
        renderGraphInspector();
        return;
      }
      if (summary) summary.innerHTML = '<strong>' + esc(graph.resultId) + '</strong> · ' + esc(graph.finalState?.kind || 'running') + ' · ' + esc(graph.nodeCount) + ' nodes · ' + esc(graph.edgeCount) + ' edges';
      if (status) status.textContent = graph.finalState?.kind || 'loaded';
      if (stageState) stageState.textContent = graph.finalState?.kind || 'running';
      const graphNodes = graph.nodes || [];
      const graphEdges = graph.edges || [];
      if (!state.selectedGraphNodeId && !state.selectedGraphEdgeId && graphNodes.length) {
        state.selectedGraphNodeId = graphNodes[0].id;
      }
      const positions = graphNodePositions(graphNodes);
      const bounds = graphBoardBounds(positions);
      if (board) {
        board.style.width = bounds.width + 'px';
        board.style.height = bounds.height + 'px';
      }
      if (edgeLayer) {
        const defs = edgeLayer.querySelector('defs')?.outerHTML || '';
        edgeLayer.setAttribute('viewBox', '0 0 ' + bounds.width + ' ' + bounds.height);
        edgeLayer.style.width = bounds.width + 'px';
        edgeLayer.style.height = bounds.height + 'px';
        edgeLayer.innerHTML = defs + graphEdges.map((edge) => renderGraphEdgeSvg(edge, positions)).join('');
      }
      if (units) units.innerHTML = graphNodes.length
        ? graphNodes.map((node) => renderGraphNodeCard(node, positions.get(node.id))).join('')
        : '<div class="empty" style="padding:12px">No graph nodes found.</div>';
      for (const button of board.querySelectorAll('[data-graph-node-id]')) {
        button.addEventListener('pointerdown', startGraphNodeDrag);
        button.addEventListener('click', () => {
          if (state.graphClickSuppressedNodeId === button.dataset.graphNodeId) {
            state.graphClickSuppressedNodeId = null;
            return;
          }
          state.selectedGraphNodeId = button.dataset.graphNodeId;
          state.selectedGraphEdgeId = null;
          renderGraph();
        });
      }
      for (const button of document.querySelectorAll('[data-graph-edge-id]')) {
        button.addEventListener('click', () => {
          state.selectedGraphEdgeId = button.dataset.graphEdgeId;
          state.selectedGraphNodeId = null;
          renderGraph();
        });
      }
      renderGraphInspector();
    }

    async function loadSelectedGraph() {
      if (!state.selectedLifecycleId) {
        state.lifecycleGraph = null;
        renderGraph();
        return;
      }
      try {
        const response = await fetch('/api/lifecycles/' + encodeURIComponent(state.selectedLifecycleId) + '/graph');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'server error');
        state.lifecycleGraph = payload;
        state.graphPositionOverrides = loadGraphLayout();
        if (payload.activeInferenceUnitId && !state.selectedGraphNodeId && !state.selectedGraphEdgeId) state.selectedGraphNodeId = payload.activeInferenceUnitId;
        if (!payload.nodes?.some((node) => node.id === state.selectedGraphNodeId)) state.selectedGraphNodeId = null;
        if (!payload.edges?.some((edge) => edge.id === state.selectedGraphEdgeId)) state.selectedGraphEdgeId = null;
        await loadLifecycleEventHistory();
        renderGraph();
        connectLifecycleStream();
      } catch (err) {
        state.lifecycleGraph = null;
        el('graphBoard').innerHTML = '<div class="error">' + esc(err.message || err) + '</div>';
        el('graphStatus').textContent = 'error';
        renderGraphInspector();
      }
    }

    async function loadLifecycleEventHistory() {
      if (!state.selectedLifecycleId) return;
      if (state.streamLifecycleId !== state.selectedLifecycleId) state.streamEvents = [];
      try {
        const response = await fetch('/api/lifecycles/' + encodeURIComponent(state.selectedLifecycleId) + '/events');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'server error');
        for (const event of payload.events || []) {
          rememberStreamEvent(event);
          cacheStreamEventPayload(event);
        }
      } catch (err) {
        rememberStreamEvent({
          eventId: 'history-load-error:' + state.selectedLifecycleId + ':' + Date.now(),
          type: 'stream_error',
          at: new Date().toISOString(),
          payload: { error: String(err.message || err) }
        });
      }
    }

    function renderLifecycles() {
      const target = el('lifecycles');
      if (!target) return;
      if (!state.lifecycles.length) {
        target.innerHTML = '<div class="empty">No lifecycle results found.</div>';
        state.selectedLifecycleId = null;
        state.lifecycleGraph = null;
        renderGraph();
        return;
      }
      if (!state.selectedLifecycleId || !state.lifecycles.some((item) => item.resultId === state.selectedLifecycleId)) {
        state.selectedLifecycleId = state.lifecycles[0].resultId;
      }
      target.innerHTML = state.lifecycles.map((item) => {
        const status = item.finalState?.kind || 'running';
        return '<button class="lifecycle-item ' + (item.resultId === state.selectedLifecycleId ? 'active' : '') + '" data-lifecycle-id="' + esc(item.resultId) + '" title="' + esc(item.resultId) + '">' +
        '<div class="lifecycle-card-head">' +
          '<div class="lifecycle-title">' + esc(lifecycleTitle(item)) + '</div>' +
          '<span class="lifecycle-status ' + esc(lifecycleStatusClass(status)) + '">' + esc(status) + '</span>' +
        '</div>' +
        '<div class="lifecycle-chip-row">' +
          '<span class="lifecycle-chip">' + esc(lifecycleCreatedLabel(item)) + '</span>' +
          '<span class="lifecycle-chip">' + esc(item.iterationCount ?? 0) + ' iteration' + ((item.iterationCount ?? 0) === 1 ? '' : 's') + '</span>' +
        '</div>' +
        '<div class="lifecycle-path">' + esc(shortPath(item.docPath || 'unknown doc')) + '</div>' +
      '</button>';
      }).join('');
      for (const button of target.querySelectorAll('[data-lifecycle-id]')) {
        button.addEventListener('click', () => {
          state.selectedLifecycleId = button.dataset.lifecycleId;
          state.selectedGraphNodeId = null;
          state.selectedGraphEdgeId = null;
          renderLifecycles();
          loadSelectedGraph();
        });
      }
    }

    async function refreshLifecycles() {
      try {
        const response = await fetch('/api/lifecycles');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'server error');
        const previous = state.selectedLifecycleId;
        state.lifecycles = payload.lifecycles || [];
        el('status').textContent = 'Updated ' + payload.generatedAt + ' · ' + state.lifecycles.length + ' lifecycle(s)';
        renderLifecycles();
        if (state.selectedLifecycleId && (state.selectedLifecycleId !== previous || !state.lifecycleGraph)) {
          await loadSelectedGraph();
        } else if (state.selectedLifecycleId) {
          await loadSelectedGraph();
        }
      } catch (err) {
        el('lifecycles').innerHTML = '<span class="error">' + esc(err.message || err) + '</span>';
        el('status').innerHTML = '<span class="error">' + esc(err.message || err) + '</span>';
        el('graphStatus').textContent = 'error';
      }
    }

    function renderRuns() {
      const runs = el('runs');
      if (!state.runs.length) {
        runs.innerHTML = '<div class="empty">No runs found.</div>';
        return;
      }
      if (!state.selectedRunId || !state.runs.some((run) => run.runId === state.selectedRunId)) {
        state.selectedRunId = state.runs[0].runId;
      }
      runs.innerHTML = state.runs.map((run) => '<button class="run-item ' + (run.runId === state.selectedRunId ? 'active' : '') + '" data-run-id="' + esc(run.runId) + '" data-rec="' + esc(run.recommendation) + '">' +
        '<div class="run-title">' + esc(run.runId) + '</div>' +
        '<div class="run-meta">' + esc(run.lifecycleStage) + ' · ' + esc(run.status) + ' · ' + esc(run.recommendation) + '</div>' +
      '</button>').join('');
      for (const button of runs.querySelectorAll('[data-run-id]')) {
        button.addEventListener('click', () => {
          state.selectedRunId = button.dataset.runId;
          renderRuns();
        });
      }
    }

    function renderDetail() {
      if (!el('detail')) return;
      const run = state.runs.find((item) => item.runId === state.selectedRunId);
      if (!run) {
        el('detail').innerHTML = '<div class="empty">Select a run.</div>';
        return;
      }
      const gates = Object.entries(run.proofGates || {}).map(([key, value]) => '<span class="pill ' + gateClass(value) + '">' + esc(key) + ': ' + esc(value) + '</span>').join('');
      const stop = run.stopVerdict ? esc(run.stopVerdict.classification || 'unknown') + ' · ' + esc(run.stopVerdict.reasonCode || 'no reason') : 'none';
      const mismatch = run.stopMismatch ? '<p class="error"><strong>Wrapper/native mismatch:</strong> ' + esc(run.stopMismatch.wrapperClaim || 'wrapper') + ' -> ' + esc(run.stopMismatch.inferredClassification || 'inferred') + '</p>' : '<p class="muted">Wrapper/native mismatch: none recorded</p>';
      el('detail').innerHTML = '<div class="detail-head"><div><h2>' + esc(run.runId) + '</h2><p class="muted">' + esc(run.runDir) + '</p></div><span class="rec">' + esc(run.recommendation) + '</span></div>' +
        '<p><strong>Stage:</strong> ' + esc(run.lifecycleStage) + ' · <strong>Status:</strong> ' + esc(run.status) + '</p>' +
        '<p><strong>Objective:</strong> <code>' + esc(run.objective?.sourcePath || 'unknown') + '</code></p>' +
        '<p><strong>Stop:</strong> ' + stop + '</p>' +
        mismatch +
        '<div class="pill-row">' + gates + '</div>' +
        '<div class="detail-grid">' +
          '<div class="box"><h3>Process</h3><p>pid: ' + esc(run.process?.pid || 'none') + '</p><p>exit: ' + esc(run.process?.exitCode ?? 'none') + '</p><p>isolated: ' + esc(run.process?.isolatedFromUserSession) + '</p></div>' +
          '<div class="box"><h3>Blockers</h3>' + listItems(run.blockers, (item) => '<strong>' + esc(item.reasonCode) + '</strong> · ' + esc(item.owningLayer || 'unknown')) + '</div>' +
          '<div class="box"><h3>Skills</h3>' + listItems(run.skillTimeline, (item) => esc(item.skill) + ' · ' + esc(item.status) + ' · ' + esc(item.stopClassification)) + '</div>' +
          '<div class="box"><h3>Trace refs</h3>' + listItems(run.traceRefs, (item) => esc(item.summaryPath || item.traceHash) + ' · ' + esc(item.lineCount || 'unknown') + ' lines') + '</div>' +
          '<div class="box"><h3>Proof</h3><p>closure: ' + esc(run.proof?.closureAllowed ?? 'unknown') + '</p><p>path: <code>' + esc(run.proof?.path || 'none') + '</code></p></div>' +
          '<div class="box"><h3>Privacy</h3><p>raw prompt: false</p><p>raw native trace: false</p><p>message content: false</p></div>' +
        '</div>' +
        '<details class="tail-details"><summary>Repair unit inference logs</summary><div class="tail"><p class="muted">Direct local tails from each contract-bound repair inference unit. Prompt and input contract are referenced, not displayed.</p><div id="repairUnits" class="unit-list">Loading repair units...</div><pre id="repairUnitTail">Select a repair unit.</pre></div></details>' +
        '<details class="tail-details"><summary>Live local tail</summary><div class="tail"><p class="muted">Local operator tail from wrapper/run files. This is not written into committed evidence bundles.</p><button id="tailRefresh">Refresh tail</button><pre id="tailBox">Loading tail...</pre></div></details>';
      const tailButton = document.getElementById('tailRefresh');
      if (tailButton) tailButton.addEventListener('click', () => refreshTail(run.runId));
      refreshRepairUnits(run.runId);
      refreshTail(run.runId);
    }

    async function refreshRepairUnits(runId) {
      const target = document.getElementById('repairUnits');
      const tail = document.getElementById('repairUnitTail');
      if (!target || !tail) return;
      try {
        const response = await fetch('/api/runs/' + encodeURIComponent(runId) + '/repair-units');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'server error');
        const units = payload.units || [];
        if (!units.length) {
          target.innerHTML = '<span class="muted">none</span>';
          tail.textContent = 'No repair units recorded for this run.';
          return;
        }
        if (!state.selectedRepairUnitKey || !units.some((unit) => unit.unitKey === state.selectedRepairUnitKey)) {
          const running = units.find((unit) => unit.status === 'running' || unit.status === 'prepared');
          state.selectedRepairUnitKey = (running || units[units.length - 1]).unitKey;
        }
        target.innerHTML = units.map((unit) => '<button class="unit-button ' + (unit.unitKey === state.selectedRepairUnitKey ? 'active' : '') + '" data-unit-key="' + esc(unit.unitKey) + '">' +
          '<strong>' + esc(unit.sequence ?? '?') + ' · ' + esc(unit.unitId) + '</strong>' +
          '<span class="unit-status">' + esc(unit.status) + ' · events: ' + esc(unit.hasCodexEvents) + ' · validation: ' + esc(unit.validationOk ?? 'pending') + '</span>' +
        '</button>').join('');
        for (const button of target.querySelectorAll('[data-unit-key]')) {
          button.addEventListener('click', () => {
            state.selectedRepairUnitKey = button.dataset.unitKey;
            refreshRepairUnits(runId);
          });
        }
        await refreshRepairUnitTail(runId, state.selectedRepairUnitKey);
      } catch (err) {
        target.innerHTML = '<span class="error">' + esc(err.message || err) + '</span>';
        tail.textContent = String(err.message || err);
      }
    }

    async function refreshRepairUnitTail(runId, unitKey) {
      const box = document.getElementById('repairUnitTail');
      if (!box || !unitKey) return;
      const [iterationDir, unitDir] = unitKey.split('/');
      try {
        const response = await fetch('/api/runs/' + encodeURIComponent(runId) + '/repair-units/' + encodeURIComponent(iterationDir) + '/' + encodeURIComponent(unitDir) + '/tail?lines=80');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'server error');
        const sections = [
          ['codex events', payload.codexEvents],
          ['stderr', payload.stderr],
          ['last message', payload.lastMessage],
          ['result', payload.result],
          ['validation', payload.validation]
        ];
        box.textContent = sections.map(([name, lines]) => '## ' + name + '\\n' + (lines?.length ? lines.join('\\n') : '(empty)')).join('\\n\\n');
      } catch (err) {
        box.textContent = String(err.message || err);
      }
    }

    async function refreshTail(runId) {
      const box = document.getElementById('tailBox');
      if (!box) return;
      try {
        const response = await fetch('/api/runs/' + encodeURIComponent(runId) + '/tail?lines=60');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'server error');
        const sections = [
          ['run events', payload.runEvents],
          ['wrapper events', payload.wrapperEvents],
          ['stderr', payload.stderr],
          ['last message', payload.lastMessage]
        ];
        box.textContent = sections.map(([name, lines]) => '## ' + name + '\\n' + (lines?.length ? lines.join('\\n') : '(empty)')).join('\\n\\n');
      } catch (err) {
        box.textContent = String(err.message || err);
      }
    }

    async function refreshRuns() {
      if (state.loading) return;
      state.loading = true;
      try {
        const response = await fetch('/api/runs');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'server error');
        state.runs = payload.runs || [];
        el('status').textContent = 'Updated ' + payload.generatedAt + ' · ' + state.runs.length + ' run(s)';
        renderRuns();
      } catch (err) {
        el('status').innerHTML = '<span class="error">' + esc(err.message || err) + '</span>';
      } finally {
        state.loading = false;
      }
    }

    async function refreshDashboard() {
      await refreshLifecycles();
    }

    async function startRun() {
      const docPath = el('docPath').value.trim();
      if (!docPath) return;
      el('startRun').disabled = true;
      try {
        const lifecycle = el('lifecycleRun').checked;
        const evidenceSequencePath = el('evidenceSequencePath').value.trim();
        const response = await fetch(lifecycle ? '/api/lifecycles' : '/api/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            docPath,
            execute: el('executeRun').checked,
            evidenceSequencePath: evidenceSequencePath || undefined,
            executeRepairSkills: el('repairSkills').checked,
            executeRepairSkillUnits: el('repairSkills').checked && el('executeRun').checked,
            executeProofRoutes: lifecycle && el('executeRun').checked,
            toolProfile: 'local-harness'
          })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'server error');
        state.selectedRunId = payload.runId || state.selectedRunId;
        el('status').textContent = lifecycle
          ? 'Started lifecycle ' + payload.resultId + ' · watch runs as they appear'
          : 'Created run ' + payload.runId + (payload.executeWarning ? ' · ' + payload.executeWarning : '');
        if (payload.resultId) state.selectedLifecycleId = payload.resultId;
        await refreshDashboard();
      } catch (err) {
        el('status').innerHTML = '<span class="error">' + esc(err.message || err) + '</span>';
      } finally {
        el('startRun').disabled = false;
      }
    }

    el('refresh').addEventListener('click', refreshDashboard);
    el('resetGraphLayout').addEventListener('click', resetGraphLayout);
    document.addEventListener('pointermove', moveGraphNodeDrag);
    document.addEventListener('pointerup', endGraphNodeDrag);
    document.addEventListener('pointercancel', endGraphNodeDrag);
    refreshDashboard();
    setInterval(refreshDashboard, 5000);
  </script>
</body>
</html>`;
}

export function createDashboardServer({
  cwd = process.cwd(),
  runsDir = '.living-doc-runs',
  evidenceDir = 'evidence/living-doc-harness',
  startHarnessRun = startBackgroundHarnessRun,
  startLifecycle = startBackgroundLifecycle,
  writeBundle = writeEvidenceBundle,
} = {}) {
  const absoluteRunsDir = path.resolve(cwd, runsDir);
  const absoluteEvidenceDir = path.resolve(cwd, evidenceDir);

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/') {
        return sendHtml(res, 200, dashboardHtml({ runsDir, evidenceDir }));
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(res, 200, {
          ok: true,
          schema: 'living-doc-harness-dashboard-health/v1',
          runsDir: relativeTo(cwd, absoluteRunsDir),
          evidenceDir: relativeTo(cwd, absoluteEvidenceDir),
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/runs') {
        const { runs, errors } = await collectDashboardRuns({ runsDir: absoluteRunsDir, cwd });
        return sendJson(res, 200, {
          schema: 'living-doc-harness-dashboard-runs/v1',
          generatedAt: new Date().toISOString(),
          runsDir: relativeTo(cwd, absoluteRunsDir),
          runCount: runs.length,
          runs,
          errors,
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/lifecycles') {
        const { lifecycles, errors } = await collectDashboardLifecycles({ runsDir: absoluteRunsDir, cwd });
        return sendJson(res, 200, {
          schema: 'living-doc-harness-dashboard-lifecycles/v1',
          generatedAt: new Date().toISOString(),
          runsDir: relativeTo(cwd, absoluteRunsDir),
          lifecycleCount: lifecycles.length,
          lifecycles,
          errors,
        });
      }

      const lifecycleGraphMatch = url.pathname.match(/^\/api\/lifecycles\/([^/]+)\/graph$/);
      if (req.method === 'GET' && lifecycleGraphMatch) {
        const resultId = decodeURIComponent(lifecycleGraphMatch[1]);
        if (!safeEntryName(resultId)) return sendJson(res, 400, { error: 'invalid lifecycle result id' });
        const lifecycleDir = path.join(absoluteRunsDir, resultId);
        if (
          !await exists(path.join(lifecycleDir, 'lifecycle-result.json'))
          && !await exists(path.join(lifecycleDir, 'active-lifecycle.json'))
        ) {
          return sendJson(res, 404, { error: `lifecycle not found: ${resultId}` });
        }
        return sendJson(res, 200, await collectLifecycleGraph(lifecycleDir, { cwd, runsDir: absoluteRunsDir }));
      }

      const lifecycleEventsMatch = url.pathname.match(/^\/api\/lifecycles\/([^/]+)\/events$/);
      if (req.method === 'GET' && lifecycleEventsMatch) {
        const resultId = decodeURIComponent(lifecycleEventsMatch[1]);
        if (!safeEntryName(resultId)) return sendJson(res, 400, { error: 'invalid lifecycle result id' });
        const lifecycleDir = path.join(absoluteRunsDir, resultId);
        if (
          !await exists(path.join(lifecycleDir, 'lifecycle-result.json'))
          && !await exists(path.join(lifecycleDir, 'active-lifecycle.json'))
        ) {
          return sendJson(res, 404, { error: `lifecycle not found: ${resultId}` });
        }
        return sendJson(res, 200, await collectLifecycleEventHistory(lifecycleDir, { cwd, runsDir: absoluteRunsDir }));
      }

      const graphNodeTailMatch = url.pathname.match(/^\/api\/lifecycles\/([^/]+)\/nodes\/([^/]+)\/tail$/);
      if (req.method === 'GET' && graphNodeTailMatch) {
        const resultId = decodeURIComponent(graphNodeTailMatch[1]);
        const nodeId = decodeURIComponent(graphNodeTailMatch[2]);
        if (!safeEntryName(resultId)) return sendJson(res, 400, { error: 'invalid lifecycle result id' });
        if (!/^[a-zA-Z0-9_.-]+$/.test(nodeId)) return sendJson(res, 400, { error: 'invalid graph node id' });
        const lifecycleDir = path.join(absoluteRunsDir, resultId);
        if (
          !await exists(path.join(lifecycleDir, 'lifecycle-result.json'))
          && !await exists(path.join(lifecycleDir, 'active-lifecycle.json'))
        ) {
          return sendJson(res, 404, { error: `lifecycle not found: ${resultId}` });
        }
        const lines = Number(url.searchParams.get('lines') || 80);
        return sendJson(res, 200, await readGraphNodeTail(lifecycleDir, nodeId, { cwd, runsDir: absoluteRunsDir, lines }));
      }

      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (req.method === 'GET' && runMatch) {
        const runId = decodeURIComponent(runMatch[1]);
        const runDir = path.join(absoluteRunsDir, runId);
        if (!await exists(path.join(runDir, 'contract.json'))) {
          return sendJson(res, 404, { error: `run not found: ${runId}` });
        }
        const facts = await collectRunEvidence(runDir);
        return sendJson(res, 200, summarizeRunFacts(facts, { cwd }));
      }

      const runTailMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/tail$/);
      if (req.method === 'GET' && runTailMatch) {
        const runId = decodeURIComponent(runTailMatch[1]);
        const runDir = path.join(absoluteRunsDir, runId);
        if (!await exists(path.join(runDir, 'contract.json'))) {
          return sendJson(res, 404, { error: `run not found: ${runId}` });
        }
        const lines = Number(url.searchParams.get('lines') || 80);
        return sendJson(res, 200, await readRunTail(runDir, { lines }));
      }

      const repairUnitsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/repair-units$/);
      if (req.method === 'GET' && repairUnitsMatch) {
        const runId = decodeURIComponent(repairUnitsMatch[1]);
        const runDir = path.join(absoluteRunsDir, runId);
        if (!await exists(path.join(runDir, 'contract.json'))) {
          return sendJson(res, 404, { error: `run not found: ${runId}` });
        }
        const units = await listRepairUnits(runDir, { cwd });
        return sendJson(res, 200, {
          schema: 'living-doc-harness-repair-units/v1',
          runId,
          unitCount: units.length,
          units,
          privacy: {
            committedEvidence: false,
            localOperatorOnly: true,
            rawPromptIncluded: false,
            rawNativeTraceIncluded: false,
          },
        });
      }

      const repairUnitTailMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/repair-units\/([^/]+)\/([^/]+)\/tail$/);
      if (req.method === 'GET' && repairUnitTailMatch) {
        const runId = decodeURIComponent(repairUnitTailMatch[1]);
        const iterationDir = decodeURIComponent(repairUnitTailMatch[2]);
        const unitDir = decodeURIComponent(repairUnitTailMatch[3]);
        const runDir = path.join(absoluteRunsDir, runId);
        if (!await exists(path.join(runDir, 'contract.json'))) {
          return sendJson(res, 404, { error: `run not found: ${runId}` });
        }
        const lines = Number(url.searchParams.get('lines') || 80);
        return sendJson(res, 200, await readRepairUnitTail(runDir, { iterationDir, unitDir, lines }));
      }

      if (req.method === 'POST' && url.pathname === '/api/runs') {
        const body = await readBody(req);
        if (!body?.docPath) return sendJson(res, 400, { error: 'missing docPath' });
        const execute = body.execute === true;
        if (execute) {
          const now = body.now || new Date().toISOString();
          const result = await startHarnessRun({
            docPath: body.docPath,
            runsDir: absoluteRunsDir,
            cwd,
            now,
            codexBin: body.codexBin || 'codex',
            codexHome: body.codexHome,
            traceLimit: Number.isInteger(body.traceLimit) ? body.traceLimit : 10,
          });
          return sendJson(res, 202, {
            schema: 'living-doc-harness-dashboard-run-started/v1',
            runId: result.runId,
            runDir: relativeTo(cwd, result.runDir),
            executed: true,
            background: true,
            supervisorPid: result.supervisorPid,
            nextAction: 'watch /api/runs and /api/runs/:runId/tail until the run reaches finished, failed, or finalized state',
          });
        }
        const result = await createHarnessRun({
          docPath: body.docPath,
          runsDir: absoluteRunsDir,
          execute: false,
          cwd,
          codexBin: body.codexBin || 'codex',
          codexHome: body.codexHome,
          traceLimit: Number.isInteger(body.traceLimit) ? body.traceLimit : 10,
        });
        return sendJson(res, 201, {
          schema: 'living-doc-harness-dashboard-run-created/v1',
          runId: result.runId,
          runDir: relativeTo(cwd, result.runDir),
          executed: result.executed,
          exitCode: result.exitCode ?? null,
          executeWarning: null,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/lifecycles') {
        const body = await readBody(req);
        if (!body?.docPath) return sendJson(res, 400, { error: 'missing docPath' });
        const now = body.now || new Date().toISOString();
        const prReviewPolicy = normalizePrReviewPolicy(body.prReviewPolicy || DEFAULT_PR_REVIEW_POLICY);
        const result = await startLifecycle({
          docPath: body.docPath,
          runsDir: absoluteRunsDir,
          evidenceDir: absoluteEvidenceDir,
          dashboardPath: body.dashboardPath || 'docs/living-doc-harness-dashboard.html',
          cwd,
          now,
          codexBin: body.codexBin || 'codex',
          codexHome: body.codexHome,
          traceLimit: Number.isInteger(body.traceLimit) ? body.traceLimit : 10,
          execute: body.execute === true,
          executeReviewer: typeof body.executeReviewer === 'boolean' ? body.executeReviewer : null,
          executeRepairSkills: body.executeRepairSkills === true,
          executeRepairSkillUnits: body.executeRepairSkillUnits === true,
          executeProofRoutes: body.executeProofRoutes === true,
          toolProfile: body.toolProfile || 'local-harness',
          evidenceSequencePath: body.evidenceSequencePath || null,
          prReviewPolicy,
        });
        if (
          result.lifecycleDir
          && !await exists(path.join(result.lifecycleDir, 'lifecycle-result.json'))
          && !await exists(path.join(result.lifecycleDir, 'active-lifecycle.json'))
        ) {
          await writeActiveLifecycleSnapshot({
            lifecycleDir: result.lifecycleDir,
            resultId: result.resultId,
            docPath: body.docPath,
            createdAt: now,
            supervisorPid: result.supervisorPid ?? null,
            toolProfile: result.toolProfile || body.toolProfile || 'local-harness',
            executeProofRoutes: result.executeProofRoutes === true,
            prReviewPolicy: result.prReviewPolicy || prReviewPolicy,
          });
        }
        return sendJson(res, 202, {
          schema: 'living-doc-harness-dashboard-lifecycle-started/v1',
          resultId: result.resultId,
          lifecycleDir: relativeTo(cwd, result.lifecycleDir),
          executed: body.execute === true,
          background: true,
          supervisorPid: result.supervisorPid,
          toolProfile: result.toolProfile || body.toolProfile || 'local-harness',
          executeProofRoutes: result.executeProofRoutes === true,
          prReviewPolicy: result.prReviewPolicy || prReviewPolicy,
          nextAction: 'watch /api/runs, /api/runs/:runId/tail, and repair-unit tails until lifecycle-result.json appears',
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/evidence/bundle') {
        const body = await readBody(req);
        if (!body?.runId) return sendJson(res, 400, { error: 'missing runId' });
        const runDir = path.join(absoluteRunsDir, body.runId);
        if (!await exists(path.join(runDir, 'contract.json'))) {
          return sendJson(res, 404, { error: `run not found: ${body.runId}` });
        }
        const result = await writeBundle({ runDir, outDir: absoluteEvidenceDir });
        return sendJson(res, 200, {
          schema: 'living-doc-harness-dashboard-bundle-written/v1',
          runId: result.bundle.runId,
          bundlePath: relativeTo(cwd, result.bundlePath),
          summaryPath: relativeTo(cwd, result.summaryPath),
          recommendation: result.bundle.recommendation,
        });
      }

      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  });

  server.on('upgrade', async (req, socket) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const match = url.pathname.match(/^\/ws\/lifecycles\/([^/]+)$/);
      if (!match) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      const resultId = decodeURIComponent(match[1]);
      const key = req.headers['sec-websocket-key'];
      if (!safeEntryName(resultId) || !key) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
      const lifecycleDir = path.join(absoluteRunsDir, resultId);
      if (
        !await exists(path.join(lifecycleDir, 'lifecycle-result.json'))
        && !await exists(path.join(lifecycleDir, 'active-lifecycle.json'))
      ) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${websocketAccept(key)}`,
        '\r\n',
      ].join('\r\n'));
      startLifecycleWebsocketStream(socket, {
        lifecycleDir,
        cwd,
        runsDir: absoluteRunsDir,
      });
      socket.on('data', (chunk) => {
        if ((chunk[0] & 0x0f) === 0x8) closeWebsocket(socket);
      });
    } catch (err) {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  return server;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const server = createDashboardServer(options);
    server.listen(options.port, options.host, () => {
      console.log(`living-doc harness dashboard listening on http://${options.host}:${options.port}`);
      console.log(`  runs: ${path.resolve(options.cwd, options.runsDir)}`);
      console.log(`  evidence: ${path.resolve(options.cwd, options.evidenceDir)}`);
    });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
