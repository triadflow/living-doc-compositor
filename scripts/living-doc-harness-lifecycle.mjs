#!/usr/bin/env node
// Lifecycle controller for the standalone living-doc harness.
//
// This is the output-input channel between iterations. It consumes one
// iteration's durable output, writes the next controlled input, and starts the
// next worker iteration when the stop verdict requires fresh follow-up work.

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createHarnessRun } from './living-doc-harness-runner.mjs';
import { finalizeHarnessIteration, writeIterationEvidenceTemplate } from './living-doc-harness-iteration.mjs';
import { loadProofRoutesFromDoc, runProofRoutes } from './living-doc-harness-proof-route.mjs';
import {
  DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
  DEFAULT_PR_REVIEW_POLICY,
  normalizePrReviewPolicy,
  normalizeAllowedInferenceUnitTypes,
  prReviewRequiredForEvidence,
  validateAllowedInferenceUnitRunConfig,
} from './living-doc-harness-inference-unit-types.mjs';
import { runContractBoundInferenceUnit } from './living-doc-harness-inference-unit.mjs';
import {
  artifactRefFromPath,
  resolveArtifactRef,
  artifactRefDisplayPath,
  isArtifactRef,
} from './living-doc-harness-artifact-ref.mjs';
import {
  commitEvidenceSatisfied,
  commitGateFromCommitEvidence,
} from './living-doc-harness-commit-gate.mjs';

const __filename = fileURLToPath(import.meta.url);
const execFileAsync = promisify(execFile);

const CONTROLLER_SOURCE_FILES = [
  'scripts/living-doc-harness-lifecycle.mjs',
  'scripts/living-doc-harness-iteration.mjs',
  'scripts/living-doc-harness-inference-unit.mjs',
  'scripts/living-doc-harness-inference-unit-types.mjs',
  'scripts/living-doc-harness-reviewer-inference.mjs',
  'scripts/living-doc-harness-closure-review.mjs',
  'scripts/living-doc-harness-skill-router.mjs',
  'scripts/living-doc-harness-runner.mjs',
  'scripts/living-doc-harness-commit-gate.mjs',
];

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function timestampForId(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function addMs(iso, ms) {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function validationArtifactOk(runDir, validationRef) {
  if (!validationRef) return false;
  const validation = await readJson(resolveArtifactRef({ currentRunDir: runDir, ref: validationRef }), null);
  return validation?.ok === true;
}

function runArtifactRef({ runDir, runId = null, filePath, kind }) {
  return filePath ? artifactRefFromPath({ runId, runDir, filePath, kind }) : null;
}

function cwdArtifactRef({ cwd = process.cwd(), filePath, kind }) {
  return filePath ? artifactRefFromPath({ cwd, runDir: cwd, filePath, kind }) : null;
}

function prReviewEvidenceFromOutput({ runDir, output, resultPath, validationPath, fallbackReasonCode = null }) {
  const sideEffect = output?.sideEffect || {};
  if (output?.schema !== 'living-doc-harness-pr-review-result/v1') return null;
  const allowedStatuses = ['approved', 'not-required', 'blocked', 'failed'];
  const statusAllowed = allowedStatuses.includes(output.status);
  const status = statusAllowed ? output.status : 'blocked';
  const reasonCode = statusAllowed
    ? sideEffect.reasonCode || output.reasonCode || fallbackReasonCode || null
    : 'pr-review-non-verdict-output';
  return {
    status,
    approved: status === 'approved',
    notRequired: status === 'not-required',
    blocked: status === 'blocked',
    failed: status === 'failed',
    invalidOriginalStatus: statusAllowed ? null : output.status || null,
    reasonCode,
    basis: arr(output.basis).length
      ? arr(output.basis)
      : statusAllowed
        ? []
        : ['PR-review artifact used the right schema but did not emit an approved, not-required, blocked, or failed verdict.'],
    url: sideEffect.url || sideEffect.prUrl || output.reviewTarget || null,
    source: 'pr-review-output-contract',
    resultPath: isArtifactRef(resultPath) ? artifactRefDisplayPath({ currentRunDir: runDir, ref: resultPath }) : path.relative(runDir, path.resolve(runDir, resultPath)),
    validationPath: validationPath
      ? isArtifactRef(validationPath)
        ? artifactRefDisplayPath({ currentRunDir: runDir, ref: validationPath })
        : path.relative(runDir, path.resolve(runDir, validationPath))
      : null,
    resultRef: isArtifactRef(resultPath) ? resultPath : artifactRefFromPath({ runDir, filePath: resultPath, kind: 'pr-review-result' }),
    validationRef: validationPath
      ? isArtifactRef(validationPath)
        ? validationPath
        : artifactRefFromPath({ runDir, filePath: validationPath, kind: 'pr-review-validation' })
      : null,
  };
}

function rebaseEvidenceArtifactRef({ fromDir, toDir, ref }) {
  if (!ref) return null;
  if (isArtifactRef(ref)) return ref;
  const absolute = path.isAbsolute(ref) ? ref : path.resolve(fromDir, ref);
  return path.relative(toDir, absolute);
}

function carriedEvidenceArtifactRef({ fromDir, ref, kind }) {
  if (!ref) return null;
  if (isArtifactRef(ref)) return ref;
  return artifactRefFromPath({ runDir: fromDir, filePath: ref, kind });
}

function carriedSideEffectEvidenceFromLifecycleInput({ lifecycleInput, cwd, runDir }) {
  const carried = lifecycleInput?.sideEffectEvidence;
  if (!carried || typeof carried !== 'object') return null;
  const baseDir = lifecycleInput.sideEffectEvidenceBaseDir
    ? path.resolve(cwd, lifecycleInput.sideEffectEvidenceBaseDir)
    : lifecycleInput.previousRunDir
      ? path.resolve(cwd, lifecycleInput.previousRunDir)
      : null;
  if (!baseDir) return carried;
  return {
    ...carried,
    ...(carried.commit ? {
      commit: {
        ...carried.commit,
        resultPath: rebaseEvidenceArtifactRef({
          fromDir: baseDir,
          toDir: runDir,
          ref: carried.commit.resultPath,
        }),
        resultRef: carriedEvidenceArtifactRef({
          fromDir: baseDir,
          ref: carried.commit.resultRef || lifecycleInput?.nextUnit?.commitGate?.resultRef || carried.commit.resultPath,
          kind: 'commit-intent-result',
        }),
        validationPath: rebaseEvidenceArtifactRef({
          fromDir: baseDir,
          toDir: runDir,
          ref: carried.commit.validationPath,
        }),
        validationRef: carriedEvidenceArtifactRef({
          fromDir: baseDir,
          ref: carried.commit.validationRef || lifecycleInput?.nextUnit?.commitGate?.validationRef || carried.commit.validationPath,
          kind: 'commit-intent-validation',
        }),
      },
    } : {}),
    ...(carried.prReview ? {
      prReview: {
        ...carried.prReview,
        resultPath: rebaseEvidenceArtifactRef({
          fromDir: baseDir,
          toDir: runDir,
          ref: carried.prReview.resultPath,
        }),
        resultRef: carriedEvidenceArtifactRef({
          fromDir: baseDir,
          ref: carried.prReview.resultRef || lifecycleInput?.nextUnit?.prReviewGate?.resultRef || carried.prReview.resultPath,
          kind: 'pr-review-result',
        }),
        validationPath: rebaseEvidenceArtifactRef({
          fromDir: baseDir,
          toDir: runDir,
          ref: carried.prReview.validationPath,
        }),
        validationRef: carriedEvidenceArtifactRef({
          fromDir: baseDir,
          ref: carried.prReview.validationRef || lifecycleInput?.nextUnit?.prReviewGate?.validationRef || carried.prReview.validationPath,
          kind: 'pr-review-validation',
        }),
      },
    } : {}),
  };
}

async function prReviewEvidenceFromContractArtifacts({ runDir, prReview }) {
  if (
    prReview?.source !== 'pr-review-output-contract'
    || !(prReview.resultRef || prReview.resultPath)
    || !(prReview.validationRef || prReview.validationPath)
  ) return null;
  const validationOk = await validationArtifactOk(runDir, prReview.validationRef || prReview.validationPath);
  if (!validationOk) return null;
  const result = await readJson(resolveArtifactRef({ currentRunDir: runDir, ref: prReview.resultRef || prReview.resultPath }), null);
  const output = result?.outputContract || result;
  const evidence = prReviewEvidenceFromOutput({
    runDir,
    output,
    resultPath: prReview.resultRef || prReview.resultPath,
    validationPath: prReview.validationRef || prReview.validationPath,
    fallbackReasonCode: prReview.reasonCode,
  });
  if (evidence && !evidence.url && prReview.url) evidence.url = prReview.url;
  return evidence;
}

async function initialInferenceUnitEvidenceFromRun({ run, runDir, plan }) {
  const initialUnit = run?.contract?.artifacts?.initialInferenceUnit || null;
  if (!initialUnit?.unitId) return null;
  const resultPath = initialUnit.result || null;
  const validationPath = initialUnit.validation || null;
  const resultRef = initialUnit.resultRef || (resultPath
    ? artifactRefFromPath({ runDir, filePath: resultPath, kind: `${initialUnit.unitId}-result` })
    : null);
  const validationRef = initialUnit.validationRef || (validationPath
    ? artifactRefFromPath({ runDir, filePath: validationPath, kind: `${initialUnit.unitId}-validation` })
    : null);
  const result = resultRef ? await readJson(resolveArtifactRef({ currentRunDir: runDir, ref: resultRef }), null) : null;
  const validation = validationRef ? await readJson(resolveArtifactRef({ currentRunDir: runDir, ref: validationRef }), null) : null;
  const plannedOutput = plan?.initialInferenceUnitOutputContract || plan?.initialUnitOutputContract || null;
  const outputContract = plannedOutput || result?.outputContract || result || null;
  if (!outputContract) return null;
  return {
    schema: 'living-doc-harness-initial-inference-unit-evidence/v1',
    unitId: initialUnit.unitId,
    role: initialUnit.role || initialUnit.unitId,
    resultPath,
    validationPath,
    resultRef,
    validationRef,
    validationOk: validation?.ok === true,
    status: result?.status || outputContract.status || null,
    outputContract,
  };
}

async function writePlanPrReviewFixture({ run, runDir, plan }) {
  const fixture = plan?.prReviewOutputContract || plan?.prReviewFixtureResult || null;
  if (!fixture) return;
  const initialUnit = run?.contract?.artifacts?.initialInferenceUnit || null;
  const prReview = plan?.sideEffectEvidence?.prReview || {};
  const resultRef = prReview.resultPath || (initialUnit?.unitId === 'pr-review' ? initialUnit.result : null);
  const validationRef = prReview.validationPath || (initialUnit?.unitId === 'pr-review' ? initialUnit.validation : null);
  if (!resultRef || !validationRef) {
    throw new Error('prReviewOutputContract fixtures require resultPath and validationPath PR-review artifact refs');
  }
  const outputContract = fixture.outputContract && typeof fixture.outputContract === 'object'
    ? fixture.outputContract
    : fixture;
  if (outputContract?.schema !== 'living-doc-harness-pr-review-result/v1') {
    throw new Error('prReviewOutputContract fixture must use schema living-doc-harness-pr-review-result/v1');
  }
  await writeJson(path.resolve(runDir, resultRef), {
    schema: 'living-doc-contract-bound-inference-result/v1',
    unitId: 'pr-review',
    role: 'pr-review',
    outputContract,
  });
  await writeJson(path.resolve(runDir, validationRef), {
    schema: 'living-doc-harness-inference-unit-validation/v1',
    ok: true,
    unitId: 'pr-review',
    outputSchema: 'living-doc-harness-pr-review-result/v1',
  });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function appendJsonl(filePath, event) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
}

async function writeActiveLifecycleSnapshot({
  lifecycleDir,
  resultId,
  docPath,
  createdAt,
  supervisorPid,
  executeProofRoutes,
  toolProfile,
  prReviewPolicy,
  command,
  status = 'running',
  finalState = { kind: 'running' },
} = {}) {
  const snapshot = {
    schema: 'living-doc-harness-active-lifecycle/v1',
    resultId,
    createdAt,
    updatedAt: new Date().toISOString(),
    docPath,
    status,
    finalState,
    supervisorPid,
    executeProofRoutes: executeProofRoutes === true,
    runConfig: {
      prReviewPolicy,
    },
    prReviewPolicy,
    toolProfile,
    command,
  };
  await writeJson(path.join(lifecycleDir, 'active-lifecycle.json'), snapshot);
  return snapshot;
}

async function fileHash(filePath) {
  try {
    return sha256(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(arr(values).filter(Boolean))];
}

function boundedList(values, limit = 80) {
  const items = arr(values).filter(Boolean);
  return {
    items: items.slice(0, limit),
    count: items.length,
    omitted: Math.max(0, items.length - limit),
  };
}

function parseGitStatusPorcelain(raw) {
  const entries = [];
  for (const line of String(raw || '').split('\n')) {
    if (!line) continue;
    const status = line.slice(0, 2);
    let filePath = line.slice(3);
    if (filePath.includes(' -> ')) filePath = filePath.split(' -> ').at(-1);
    entries.push({
      status,
      path: filePath,
      tracked: status !== '??',
      untracked: status === '??',
    });
  }
  return entries;
}

function isRelevantUntrackedPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  if (!normalized) return false;
  if (normalized.startsWith('.living-doc-runs/')) return false;
  if (normalized.startsWith('evidence/living-doc-harness/')) return false;
  if (normalized.startsWith('node_modules/')) return false;
  return /(^|\/)(scripts|tests|docs|src|app)\//.test(normalized)
    || /\.(mjs|js|ts|tsx|jsx|json|html|css|md)$/.test(normalized);
}

function relativizeGitPath({ gitWorktreeCwd, cwd, filePath }) {
  const absolute = path.resolve(gitWorktreeCwd, filePath);
  return path.relative(cwd, absolute) || '.';
}

function resultPathRef(cwd, filePath) {
  if (!filePath) return null;
  const absolute = path.resolve(filePath);
  const relative = path.relative(cwd, absolute) || '.';
  return relative.startsWith('..') ? absolute : relative;
}

export async function deriveGitWorktreeEvidence({ cwd = process.cwd(), gitWorktreeCwd = cwd } = {}) {
  const gitCwd = path.resolve(cwd, gitWorktreeCwd);
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: gitCwd,
      maxBuffer: 1024 * 1024 * 8,
    });
    const entries = parseGitStatusPorcelain(stdout)
      .map((entry) => ({
        ...entry,
        cwdPath: relativizeGitPath({ gitWorktreeCwd: gitCwd, cwd, filePath: entry.path }),
      }));
    const dirtyTrackedFiles = entries.filter((entry) => entry.tracked).map((entry) => entry.cwdPath);
    const untrackedFiles = entries.filter((entry) => entry.untracked).map((entry) => entry.cwdPath);
    const relevantUntrackedFiles = entries
      .filter((entry) => entry.untracked && isRelevantUntrackedPath(entry.cwdPath))
      .map((entry) => entry.cwdPath);
    return {
      schema: 'living-doc-harness-git-worktree-evidence/v1',
      detector: 'git-status-porcelain-v1',
      cwd: path.relative(cwd, gitCwd) || '.',
      ok: true,
      error: null,
      dirtyTrackedFiles,
      untrackedFiles,
      relevantUntrackedFiles,
      changedFiles: unique([...dirtyTrackedFiles, ...relevantUntrackedFiles]),
      sourceFilesChanged: dirtyTrackedFiles.length > 0 || relevantUntrackedFiles.length > 0,
      entries,
    };
  } catch (err) {
    return {
      schema: 'living-doc-harness-git-worktree-evidence/v1',
      detector: 'git-status-porcelain-v1',
      cwd: path.relative(cwd, gitCwd) || '.',
      ok: false,
      error: err?.message || String(err),
      dirtyTrackedFiles: [],
      untrackedFiles: [],
      relevantUntrackedFiles: [],
      changedFiles: [],
      sourceFilesChanged: false,
      entries: [],
    };
  }
}

async function deriveControllerSourceState({ cwd, startHashes = null }) {
  const files = [];
  for (const filePath of CONTROLLER_SOURCE_FILES) {
    const absolutePath = path.resolve(cwd, filePath);
    const currentHash = await fileHash(absolutePath);
    const startHash = startHashes?.[filePath] || currentHash;
    files.push({
      path: filePath,
      startHash,
      currentHash,
      changedDuringLifecycle: startHash !== currentHash,
    });
  }
  return {
    schema: 'living-doc-harness-controller-source-state/v1',
    files,
    changedDuringLifecycle: files.some((file) => file.changedDuringLifecycle),
  };
}

async function controllerStartHashes({ cwd }) {
  const hashes = {};
  for (const filePath of CONTROLLER_SOURCE_FILES) {
    hashes[filePath] = await fileHash(path.resolve(cwd, filePath));
  }
  return hashes;
}

function commitScopeFromWorktree({ before = null, after = null, explicitAllowedFiles = [] } = {}) {
  const beforeChanged = unique(arr(before?.changedFiles));
  const beforeSet = new Set(beforeChanged);
  const afterChanged = unique(arr(after?.changedFiles));
  const currentRunChangedFiles = afterChanged.filter((filePath) => !beforeSet.has(filePath));
  return {
    schema: 'living-doc-harness-commit-scope/v1',
    currentRunChangedFiles,
    preExistingDirtyFiles: beforeChanged,
    allowedCommitFiles: unique([...arr(explicitAllowedFiles), ...currentRunChangedFiles]),
    forbiddenCommitFiles: beforeChanged,
  };
}

async function gitHead({ cwd = process.cwd(), gitWorktreeCwd = cwd } = {}) {
  const gitCwd = path.resolve(cwd, gitWorktreeCwd);
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: gitCwd,
      maxBuffer: 1024 * 1024,
    });
    const sha = stdout.trim();
    return sha || null;
  } catch {
    return null;
  }
}

async function gitCommitRangeDetails({ cwd = process.cwd(), gitWorktreeCwd = cwd, beforeHead, afterHead } = {}) {
  if (!beforeHead || !afterHead || beforeHead === afterHead) return null;
  const gitCwd = path.resolve(cwd, gitWorktreeCwd);
  try {
    const [{ stdout: filesStdout }, { stdout: lastCommitStdout }, { stdout: commitCountStdout }] = await Promise.all([
      execFileAsync('git', ['diff', '--name-only', '--no-renames', beforeHead, afterHead], {
        cwd: gitCwd,
        maxBuffer: 1024 * 1024 * 8,
      }),
      execFileAsync('git', ['show', '-s', '--format=%H%x00%s%x00%aI', afterHead], {
        cwd: gitCwd,
        maxBuffer: 1024 * 1024,
      }),
      execFileAsync('git', ['rev-list', '--count', `${beforeHead}..${afterHead}`], {
        cwd: gitCwd,
        maxBuffer: 1024 * 1024,
      }),
    ]);
    const [sha, subject, committedAt] = lastCommitStdout.trim().split('\0');
    const committedFiles = unique(filesStdout
      .split(/\r?\n/)
      .map((filePath) => filePath.trim())
      .filter(Boolean)
      .map((filePath) => relativizeGitPath({ gitWorktreeCwd: gitCwd, cwd, filePath })));
    return {
      beforeHead,
      afterHead,
      sha: sha || afterHead,
      message: subject || null,
      committedAt: committedAt || null,
      commitCount: Number(commitCountStdout.trim()) || 0,
      committedFiles,
    };
  } catch {
    return null;
  }
}

async function scopedCommitEvidenceFromHeadChange({
  cwd,
  gitWorktreeCwd = cwd,
  beforeHead = null,
  commitScope = null,
  filesChanged = [],
} = {}) {
  const afterHead = await gitHead({ cwd, gitWorktreeCwd });
  const range = await gitCommitRangeDetails({ cwd, gitWorktreeCwd, beforeHead, afterHead });
  if (!range || !range.committedFiles.length) return null;

  const normalizeCommitPath = (filePath) => {
    if (!filePath) return null;
    const normalized = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath;
    return normalized || '.';
  };
  const requiredChangedFiles = unique([
    ...arr(commitScope?.allowedCommitFiles),
    ...arr(filesChanged),
  ].map(normalizeCommitPath).filter(Boolean));
  const allowedFiles = requiredChangedFiles.length ? requiredChangedFiles : arr(commitScope?.currentRunChangedFiles);
  const allowedSet = new Set(allowedFiles);
  const forbiddenSet = new Set(arr(commitScope?.forbiddenCommitFiles));
  const committedSet = new Set(range.committedFiles);
  const missingRequiredFiles = allowedFiles.filter((filePath) => !committedSet.has(filePath));
  const extraCommittedFiles = range.committedFiles.filter((filePath) => !allowedSet.has(filePath));
  const forbiddenCommittedFiles = range.committedFiles.filter((filePath) => forbiddenSet.has(filePath));
  const scoped = allowedFiles.length > 0
    && missingRequiredFiles.length === 0
    && extraCommittedFiles.length === 0
    && forbiddenCommittedFiles.length === 0;

  const base = {
    required: true,
    source: 'controller-detected-worker-commit',
    inspectedRange: {
      beforeHead: range.beforeHead,
      afterHead: range.afterHead,
      commitCount: range.commitCount,
    },
    changedFiles: allowedFiles,
    currentRunChangedFiles: arr(commitScope?.currentRunChangedFiles),
    preExistingDirtyFiles: arr(commitScope?.preExistingDirtyFiles),
    allowedCommitFiles: allowedFiles,
    forbiddenCommitFiles: arr(commitScope?.forbiddenCommitFiles),
    committedFiles: range.committedFiles,
    missingRequiredFiles,
    extraCommittedFiles,
    forbiddenCommittedFiles,
    scoped,
  };

  if (!scoped) {
    return {
      commit: {
        ...base,
        blocked: true,
        reasonCode: 'controller-detected-worker-commit-outside-scope',
      },
    };
  }

  return {
    commit: {
      ...base,
      sha: range.sha,
      message: range.message,
      committedAt: range.committedAt,
      reasonCode: 'controller-detected-scoped-worker-commit',
    },
  };
}

function prReviewGateFromEvidence({ sideEffectEvidence, prReviewRequired, prReviewPolicy }) {
  const prReview = sideEffectEvidence?.prReview || null;
  if (prReviewRequired !== true) {
    return {
      required: false,
      status: prReviewPolicy?.mode === 'disabled' ? 'disabled' : 'not-required',
      evidencePresent: false,
    };
  }
  const hasContractArtifactPair = prReview?.source === 'pr-review-output-contract'
    && prReview.resultPath
    && prReview.validationPath;
  if (hasContractArtifactPair) {
    const satisfied = prReview.approved === true || prReview.notRequired === true;
    const blocked = prReview.blocked === true || ['blocked', 'failed'].includes(prReview.status);
    return {
      required: true,
      status: satisfied ? 'satisfied' : blocked ? 'blocked' : 'requested',
      evidencePresent: satisfied,
      resultPath: prReview.resultPath,
      validationPath: prReview.validationPath || null,
      reasonCode: prReview.reasonCode || null,
      basis: arr(prReview.basis),
    };
  }
  return {
    required: true,
    status: 'missing',
    evidencePresent: false,
  };
}

function requiredHardFactsFromEvidence({ sourceState, gitWorktree, sourceFilesChanged, closureAllowed, sideEffectEvidence, commitScope = null, prReviewPolicy, prReviewRequired }) {
  const prReviewGate = prReviewGateFromEvidence({ sideEffectEvidence, prReviewRequired, prReviewPolicy });
  const commitGate = commitGateFromEvidence({ sideEffectEvidence, sourceFilesChanged });
  return {
    schema: 'living-doc-harness-required-hard-facts/v1',
    sourceFilesChanged,
    dirtyTrackedFiles: arr(gitWorktree?.dirtyTrackedFiles),
    relevantUntrackedFiles: arr(gitWorktree?.relevantUntrackedFiles),
    currentRunChangedFiles: arr(commitScope?.currentRunChangedFiles),
    preExistingDirtyFiles: arr(commitScope?.preExistingDirtyFiles),
    allowedCommitFiles: arr(commitScope?.allowedCommitFiles),
    forbiddenCommitFiles: arr(commitScope?.forbiddenCommitFiles),
    acceptanceCriteriaSatisfied: sourceState?.criteriaSatisfied === true,
    objectiveReady: sourceState?.objectiveReady === true,
    documentReady: sourceState?.documentReady === true,
    renderedHtmlExists: sourceState?.renderedHtmlExists === true,
    closureAllowed,
    commitEvidencePresent: commitEvidenceSatisfied(sideEffectEvidence?.commit || {}),
    commitGate,
    prReviewPolicy,
    prReviewRequired: prReviewRequired === true,
    prReviewEvidencePresent: prReviewGate.evidencePresent === true,
    prReviewGate,
  };
}

function commitGateFromEvidence({ sideEffectEvidence, sourceFilesChanged }) {
  const commit = sideEffectEvidence?.commit || {};
  return commitGateFromCommitEvidence({ commit, sourceChanged: sourceFilesChanged });
}

export async function sideEffectEvidenceFromRun({ run, runDir }) {
  const initialUnit = run?.contract?.artifacts?.initialInferenceUnit || null;
  const initialUnitResultRef = initialUnit?.unitId === 'commit-intent'
    ? run.contract.artifacts.initialInferenceUnit.result
    : null;
  const initialUnitValidationRef = initialUnit?.unitId === 'commit-intent'
    ? run.contract.artifacts.initialInferenceUnit.validation
    : null;
  const commitResultRef = run?.contract?.artifacts?.commitIntentInferenceUnit?.result || initialUnitResultRef;
  const commitValidationRef = run?.contract?.artifacts?.commitIntentInferenceUnit?.validation || initialUnitValidationRef;
  const initialPrReviewResultRef = initialUnit?.unitId === 'pr-review'
    ? run.contract.artifacts.initialInferenceUnit.result
    : null;
  const prReviewResultRef = run?.contract?.artifacts?.prReviewInferenceUnit?.result || initialPrReviewResultRef;
  const initialPrReviewValidationRef = initialUnit?.unitId === 'pr-review'
    ? run.contract.artifacts.initialInferenceUnit.validation
    : null;
  const prReviewValidationRef = run?.contract?.artifacts?.prReviewInferenceUnit?.validation || initialPrReviewValidationRef;
  const evidence = {};
  if (commitResultRef) {
    const commitResultArtifactRef = initialUnit?.unitId === 'commit-intent' && initialUnit?.resultRef
      ? initialUnit.resultRef
      : artifactRefFromPath({ runDir, filePath: commitResultRef, kind: 'commit-intent-result' });
    const commitValidationArtifactRef = commitValidationRef
      ? initialUnit?.unitId === 'commit-intent' && initialUnit?.validationRef
        ? initialUnit.validationRef
        : artifactRefFromPath({ runDir, filePath: commitValidationRef, kind: 'commit-intent-validation' })
      : null;
    const commitResult = await readJson(resolveArtifactRef({ currentRunDir: runDir, ref: commitResultArtifactRef }), null);
    const output = commitResult?.outputContract || commitResult;
    const sideEffect = output?.sideEffect || {};
    const validationOk = await validationArtifactOk(runDir, commitValidationArtifactRef);
    if (output?.schema === 'living-doc-harness-commit-intent-result/v1'
      && sideEffect.type === 'git-commit'
      && sideEffect.executed === true
      && sideEffect.sha
      && output.approved === true
      && output.status === 'approved'
      && validationOk) {
      evidence.commit = {
        required: arr(sideEffect.requiredChangedFiles).length > 0 || arr(output.changedFiles).length > 0,
        sha: sideEffect.sha,
        status: output.status,
        approved: true,
        validationOk,
        commitKind: output.commitKind || null,
        message: output.message || null,
        committedAt: sideEffect.committedAt || null,
        changedFiles: arr(output.changedFiles).length ? arr(output.changedFiles) : arr(sideEffect.requiredChangedFiles),
        committedFiles: arr(sideEffect.committedFiles),
        livingDocStateFiles: arr(sideEffect.livingDocStateFiles),
        livingDocStateCommittedFiles: arr(sideEffect.livingDocStateCommittedFiles),
        nonLivingDocStateCommittedFiles: arr(sideEffect.nonLivingDocStateCommittedFiles),
        source: 'commit-intent-output-contract',
        resultPath: path.relative(runDir, path.resolve(runDir, commitResultRef)),
        resultRef: commitResultArtifactRef,
        validationPath: commitValidationRef ? path.relative(runDir, path.resolve(runDir, commitValidationRef)) : null,
        validationRef: commitValidationArtifactRef,
      };
    } else if (output?.schema === 'living-doc-harness-commit-intent-result/v1'
      && (['blocked', 'failed'].includes(output.status) || sideEffect.executed === true || sideEffect.sha)) {
      evidence.commit = {
        required: arr(sideEffect.requiredChangedFiles).length > 0 || arr(output.changedFiles).length > 0 || output.status === 'blocked',
        status: output.status || 'blocked',
        approved: output.approved === true,
        validationOk,
        blocked: output.status !== 'approved' || validationOk !== true,
        reasonCode: sideEffect.reasonCode || output.reasonCode || 'commit-intent-gate-blocked',
        message: output.message || null,
        basis: arr(output.basis),
        changedFiles: arr(output.changedFiles).length ? arr(output.changedFiles) : arr(sideEffect.requiredChangedFiles),
        sha: sideEffect.sha || null,
        committedFiles: arr(sideEffect.committedFiles),
        currentRunChangedFiles: arr(sideEffect.currentRunChangedFiles),
        preExistingDirtyFiles: arr(sideEffect.preExistingDirtyFiles),
        allowedCommitFiles: arr(sideEffect.allowedCommitFiles),
        forbiddenCommitFiles: arr(sideEffect.forbiddenCommitFiles),
        source: 'commit-intent-output-contract',
        resultPath: path.relative(runDir, path.resolve(runDir, commitResultRef)),
        validationPath: commitValidationRef ? path.relative(runDir, path.resolve(runDir, commitValidationRef)) : null,
        resultRef: commitResultArtifactRef,
        validationRef: commitValidationArtifactRef,
      };
    }
  }
  if (prReviewResultRef) {
    const prResultArtifactRef = initialUnit?.unitId === 'pr-review' && initialUnit?.resultRef
      ? initialUnit.resultRef
      : artifactRefFromPath({ runDir, filePath: prReviewResultRef, kind: 'pr-review-result' });
    const prValidationArtifactRef = prReviewValidationRef
      ? initialUnit?.unitId === 'pr-review' && initialUnit?.validationRef
        ? initialUnit.validationRef
        : artifactRefFromPath({ runDir, filePath: prReviewValidationRef, kind: 'pr-review-validation' })
      : null;
    const prResult = await readJson(resolveArtifactRef({ currentRunDir: runDir, ref: prResultArtifactRef }), null);
    const output = prResult?.outputContract || prResult;
    const validationOk = await validationArtifactOk(runDir, prValidationArtifactRef);
    if (validationOk) {
      const prEvidence = prReviewEvidenceFromOutput({
        runDir,
        output,
        resultPath: prReviewResultRef,
        validationPath: prReviewValidationRef,
      });
      if (prEvidence) {
        prEvidence.resultRef = prResultArtifactRef;
        prEvidence.validationRef = prValidationArtifactRef;
      }
      if (prEvidence) evidence.prReview = prEvidence;
    }
  }
  return Object.keys(evidence).length ? evidence : null;
}

function compactGitWorktreeEvidence(gitWorktree) {
  return {
    schema: 'living-doc-harness-git-worktree-evidence-summary/v1',
    detector: gitWorktree?.detector || 'git-status-porcelain-v1',
    cwd: gitWorktree?.cwd || '.',
    ok: gitWorktree?.ok === true,
    error: gitWorktree?.error || null,
    sourceFilesChanged: gitWorktree?.sourceFilesChanged === true,
    dirtyTrackedFiles: boundedList(gitWorktree?.dirtyTrackedFiles),
    relevantUntrackedFiles: boundedList(gitWorktree?.relevantUntrackedFiles),
    changedFiles: boundedList(gitWorktree?.changedFiles),
    untrackedFiles: {
      count: arr(gitWorktree?.untrackedFiles).length,
      omittedFromInlineContract: true,
      reason: 'Full untracked-file list is durable in controller evidence snapshot; reviewer receives only relevant untracked files inline.',
    },
    entries: {
      count: arr(gitWorktree?.entries).length,
      omittedFromInlineContract: true,
      reason: 'Full git status entries are durable in controller evidence snapshot and can be inspected by path when needed.',
    },
  };
}

function compactControllerEvidence({ evidenceSnapshotPath, evidenceSnapshotRef, evidenceSnapshotHash, evidenceSnapshotBytes, gitWorktree, controllerState, requiredHardFacts }) {
  return {
    schema: 'living-doc-harness-controller-evidence-summary/v1',
    snapshotPath: evidenceSnapshotPath,
    snapshotRef: evidenceSnapshotRef || null,
    snapshotHash: evidenceSnapshotHash,
    snapshotBytes: evidenceSnapshotBytes,
    gitWorktree: compactGitWorktreeEvidence(gitWorktree),
    controllerState,
    hardFacts: requiredHardFacts,
  };
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function statusIsComplete(value) {
  const status = String(value || '').toLowerCase();
  return status === 'closed'
    || status === 'done'
    || status === 'pass'
    || status === 'passed'
    || status === 'complete'
    || status === 'completed'
    || status.endsWith('-proven')
    || status.endsWith('-green')
    || status.startsWith('satisfied')
    || status.startsWith('complete-');
}

function acceptanceCriteriaFromDoc(doc) {
  return arr(doc?.sections)
    .filter((section) => section?.id === 'acceptance-criteria' || section?.convergenceType === 'acceptance-criteria')
    .flatMap((section) => arr(section?.data));
}

async function deriveSourceStateEvidence({ docPath, cwd }) {
  const absoluteDocPath = path.resolve(cwd, docPath);
  const doc = await readJson(absoluteDocPath, null);
  if (!doc) return null;

  const renderedHtml = absoluteDocPath.replace(/\.json$/i, '.html');
  const criteria = acceptanceCriteriaFromDoc(doc);
  const incompleteCriteria = criteria
    .filter((criterion) => !statusIsComplete(criterion?.status))
    .map((criterion) => criterion?.id || criterion?.name || 'unnamed-criterion');
  const objectiveReady = doc.runState?.objectiveReady === true;
  const documentReady = doc.runState?.documentReady === true || doc.runState?.documentReady == null;
  const renderedHtmlExists = await fileExists(renderedHtml);
  const criteriaSatisfied = criteria.length > 0 && incompleteCriteria.length === 0;
  const closureAllowed = objectiveReady && documentReady && criteriaSatisfied && renderedHtmlExists;

  return {
    objectiveReady,
    documentReady,
    renderedHtml: path.relative(cwd, renderedHtml),
    renderedHtmlExists,
    criteriaCount: criteria.length,
    incompleteCriteria,
    criteriaSatisfied,
    currentPhase: doc.runState?.currentPhase || null,
    closureAllowed,
  };
}

async function writeSyntheticTrace({ runDir, iteration, now, message }) {
  const tracePath = path.join(runDir, 'native-fixtures', `iteration-${iteration}.jsonl`);
  const line = JSON.stringify({
    timestamp: now,
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: message || `Synthetic lifecycle trace for iteration ${iteration}.` }],
    },
  });
  await writeJsonlText(tracePath, `${line}\n`);
  return tracePath;
}

async function writeJsonlText(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, 'utf8');
}

function nextInputFromFinalization({ finalization, outputInputPath }) {
  const requestedMode = finalization.nextIteration?.mode || null;
  const mode = ['none', 'user-stop', 'resume', 'continuation'].includes(requestedMode)
    ? 'fresh-unit'
    : requestedMode || 'fresh-unit';
  const nextUnit = finalization.postReviewSelection?.nextUnit || null;
  const instruction = instructionForSelectedUnit({
    fallback: finalization.nextIteration?.instruction,
    nextUnit,
  });
  return {
    mode,
    previousRunId: finalization.runId,
    previousRunDir: finalization.runDir ? path.relative(process.cwd(), finalization.runDir) : null,
    previousIteration: finalization.iteration,
    instruction,
    handoverPath: finalization.handoverPath ? path.relative(process.cwd(), finalization.handoverPath) : null,
    handoverRef: runArtifactRef({
      runDir: finalization.runDir,
      runId: finalization.runId,
      filePath: finalization.handoverPath,
      kind: 'handover',
    }),
    repairSkillResultPath: finalization.repairSkillResultPath ? path.relative(process.cwd(), finalization.repairSkillResultPath) : null,
    repairSkillResultRef: runArtifactRef({
      runDir: finalization.runDir,
      runId: finalization.runId,
      filePath: finalization.repairSkillResultPath,
      kind: 'repair-skill-result',
    }),
    outputInputPath: path.relative(process.cwd(), outputInputPath),
    outputInputRef: runArtifactRef({
      runDir: finalization.runDir,
      runId: finalization.runId,
      filePath: outputInputPath,
      kind: 'output-input',
    }),
    selectedUnitType: nextUnit?.unitId || null,
    selectedUnitRole: nextUnit?.role || nextUnit?.unitId || null,
    nextUnit,
    sideEffectEvidence: finalization.sideEffectEvidence || null,
    sideEffectEvidenceBaseDir: finalization.runDir ? path.relative(process.cwd(), finalization.runDir) : null,
  };
}

function previousRouteDecisionFromLifecycleInput(lifecycleInput) {
  const nextUnit = lifecycleInput?.nextUnit || null;
  if (!nextUnit?.routeLoopGuard && !nextUnit?.routeAuthority) return null;
  return {
    schema: 'living-doc-harness-previous-route-decision/v1',
    previousRunId: lifecycleInput.previousRunId || null,
    previousIteration: lifecycleInput.previousIteration || null,
    selectedUnitType: nextUnit.unitId || lifecycleInput.selectedUnitType || null,
    selectedUnitRole: nextUnit.role || lifecycleInput.selectedUnitRole || null,
    reasonCode: nextUnit.reasonCode || null,
    policyRuleId: nextUnit.policyRuleId || null,
    selectedBy: nextUnit.selectedBy || null,
    routeAuthority: nextUnit.routeAuthority || null,
    routeLoopGuard: nextUnit.routeLoopGuard || null,
  };
}

function instructionForSelectedUnit({ fallback, nextUnit }) {
  const unitId = nextUnit?.unitId || null;
  if (unitId === 'commit-intent') {
    return 'Run the selected commit-intent unit and return scoped commit evidence before any PR-review or closure review.';
  }
  if (unitId === 'pr-review') {
    return 'Run the selected PR-review unit and return read-only PR gate evidence before any terminal closure review.';
  }
  if (unitId === 'closure-review') {
    return 'Run the selected closure-review unit against the controller evidence and return the terminal closure verdict.';
  }
  if (unitId === 'living-doc-balance-scan') {
    return 'Run the selected scan-only living-doc balance scan and return an ordered repair or fresh-worker recommendation.';
  }
  if (unitId === 'worker') {
    return 'Run the selected worker unit for the remaining source or living-doc objective work named by the controller evidence.';
  }
  return fallback || 'Start a fresh inference unit from the living doc and controller-approved contract evidence until the objective is reached.';
}

function lifecycleMayStop(finalization) {
  return finalization.terminalKind === 'closed' || finalization.terminalKind === 'user-stopped';
}

function nextActionFromFinalization(finalization) {
  if (lifecycleMayStop(finalization)) {
    return {
      action: 'stop-terminal-state',
      allowed: false,
      reason: finalization.terminalKind === 'closed'
        ? 'Objective closure reached.'
        : 'User explicitly stopped the lifecycle.',
      prReviewPolicy: finalization.prReviewPolicy || finalization.postReviewSelection?.prReviewPolicy || null,
      prReviewRequired: finalization.prReviewRequired === true || finalization.postReviewSelection?.prReviewRequired === true,
      prReviewGate: finalization.prReviewGate || finalization.postReviewSelection?.prReviewGate || null,
    };
  }

  const nextUnit = finalization.postReviewSelection?.nextUnit || null;
  const unitId = nextUnit?.unitId || 'worker';
  return {
    action: unitId === 'worker' ? 'start-next-worker-iteration' : `start-next-${unitId}`,
    allowed: true,
    reason: instructionForSelectedUnit({
      fallback: finalization.nextIteration?.instruction || 'Non-closure verdict requires a fresh next inference unit.',
      nextUnit,
    }),
    selectedUnitType: unitId,
    selectedUnitRole: nextUnit?.role || unitId,
    prReviewPolicy: finalization.prReviewPolicy || finalization.postReviewSelection?.prReviewPolicy || null,
    prReviewRequired: finalization.prReviewRequired === true || finalization.postReviewSelection?.prReviewRequired === true,
    prReviewGate: finalization.prReviewGate || finalization.postReviewSelection?.prReviewGate || null,
    contractValidation: finalization.postReviewSelection?.contractValidation || null,
  };
}

async function writeOutputInput({
  runDir,
  iteration,
  finalization,
  evidencePath,
  nextAction,
  nextInput = null,
  now,
}) {
  const evidenceRef = runArtifactRef({
    runDir,
    runId: finalization.runId,
    filePath: finalization.evidencePath || evidencePath,
    kind: 'iteration-evidence',
  });
  const verdictRef = runArtifactRef({
    runDir,
    runId: finalization.runId,
    filePath: finalization.verdictPath,
    kind: 'stop-verdict',
  });
  const reviewerVerdictRef = runArtifactRef({
    runDir,
    runId: finalization.runId,
    filePath: finalization.reviewerVerdictPath,
    kind: 'reviewer-verdict',
  });
  const proofRef = runArtifactRef({
    runDir,
    runId: finalization.runId,
    filePath: finalization.proofPath,
    kind: 'iteration-proof',
  });
  const handoverRef = runArtifactRef({
    runDir,
    runId: finalization.runId,
    filePath: finalization.handoverPath,
    kind: 'handover',
  });
  const terminalRef = runArtifactRef({
    runDir,
    runId: finalization.runId,
    filePath: finalization.terminalPath,
    kind: 'terminal-state',
  });
  const postReviewSelectionRef = runArtifactRef({
    runDir,
    runId: finalization.runId,
    filePath: finalization.postReviewSelectionPath,
    kind: 'post-review-selection',
  });
  const artifact = {
    schema: 'living-doc-harness-output-input/v1',
    runId: finalization.runId,
    iteration,
    createdAt: now,
    previousOutput: {
      classification: finalization.classification,
      terminalKind: finalization.terminalKind,
      proofValid: finalization.proofValid,
      evidencePath: path.relative(runDir, finalization.evidencePath || evidencePath),
      evidenceRef,
      verdictPath: path.relative(runDir, finalization.verdictPath),
      verdictRef,
      reviewerVerdictPath: finalization.reviewerVerdictPath ? path.relative(runDir, finalization.reviewerVerdictPath) : null,
      reviewerVerdictRef,
      proofPath: path.relative(runDir, finalization.proofPath),
      proofRef,
      handoverPath: finalization.handoverPath ? path.relative(runDir, finalization.handoverPath) : null,
      handoverRef,
      terminalPath: path.relative(runDir, finalization.terminalPath),
      terminalRef,
      bundlePath: path.relative(process.cwd(), finalization.bundlePath),
      bundleRef: cwdArtifactRef({ filePath: finalization.bundlePath, kind: 'evidence-bundle' }),
      postReviewSelectionPath: finalization.postReviewSelectionPath ? path.relative(runDir, finalization.postReviewSelectionPath) : null,
      postReviewSelectionRef,
    },
    postReviewSelection: finalization.postReviewSelection ? {
      prReviewPolicy: finalization.postReviewSelection.prReviewPolicy || null,
      prReviewRequired: finalization.postReviewSelection.prReviewRequired === true,
      prReviewGate: finalization.postReviewSelection.prReviewGate || null,
      nextUnit: finalization.postReviewSelection.nextUnit || null,
      terminalAction: finalization.postReviewSelection.terminalAction || null,
    } : null,
    nextUnit: finalization.postReviewSelection?.nextUnit || null,
    terminalAction: finalization.postReviewSelection?.terminalAction || null,
    nextAction,
    nextInput,
  };
  const outputInputPath = path.join(runDir, 'output-input', `iteration-${iteration}.json`);
  await writeJson(outputInputPath, artifact);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'output-input-written',
    at: now,
    runId: finalization.runId,
    iteration,
    nextAction: nextAction.action,
    outputInputPath: path.relative(runDir, outputInputPath),
  });
  return { outputInputPath, artifact };
}

async function buildEvidenceFromPlan({
  run,
  runDir,
  iteration,
  plan = {},
  docPath,
  cwd,
  gitWorktreeCwd = cwd,
  enforceControllerWorktreeEvidence = false,
  preRunGitWorktree = null,
  preRunGitHead = null,
  controllerStartFileHashes = null,
  now,
  proofRouteBundle = null,
  prReviewPolicy = DEFAULT_PR_REVIEW_POLICY,
  lifecycleInput = null,
}) {
  const normalizedPrReviewPolicy = normalizePrReviewPolicy(prReviewPolicy);
  const sourceState = await deriveSourceStateEvidence({ docPath, cwd });
  const gitWorktree = await deriveGitWorktreeEvidence({ cwd, gitWorktreeCwd });
  const commitScope = enforceControllerWorktreeEvidence
    ? commitScopeFromWorktree({ before: preRunGitWorktree, after: gitWorktree })
    : commitScopeFromWorktree({ before: null, after: gitWorktree, explicitAllowedFiles: arr(plan.allowedCommitFiles) });
  const controllerState = await deriveControllerSourceState({ cwd, startHashes: controllerStartFileHashes });
  const currentDocHash = await fileHash(path.resolve(cwd, docPath));
  const docChangedDuringRun = Boolean(run?.contract?.livingDoc?.sourceHash && currentDocHash && run.contract.livingDoc.sourceHash !== currentDocHash);
  const explicitFilesChanged = hasOwn(plan, 'filesChanged');
  const filesChanged = unique([
    ...(explicitFilesChanged ? arr(plan.filesChanged) : [docPath, sourceState?.renderedHtml].filter(Boolean)),
    ...(enforceControllerWorktreeEvidence ? arr(commitScope.currentRunChangedFiles) : []),
  ]);
  const sourceFilesChangedByPlan = hasOwn(plan, 'sourceFilesChanged')
    ? plan.sourceFilesChanged === true
    : docChangedDuringRun || (explicitFilesChanged && filesChanged.length > 0);
  const sourceFilesChanged = sourceFilesChangedByPlan
    || (enforceControllerWorktreeEvidence && commitScope.currentRunChangedFiles.length > 0);
  const sourceClosureAllowed = sourceState?.closureAllowed === true;
  const sourceUnprovenCriteria = sourceState ? sourceState.incompleteCriteria : [];
  const sourceCriteriaSatisfied = sourceState?.criteriaSatisfied === true;
  const sourceStageAfter = sourceClosureAllowed ? 'closed' : sourceState?.currentPhase || 'stopped';
  const sourceFinalMessage = sourceClosureAllowed
    ? 'Lifecycle evidence derived closure from post-worker living-doc state: objectiveReady true, acceptance criteria complete, and rendered HTML present.'
    : 'Lifecycle evidence derived non-closure from post-worker living-doc state.';
  const tracePaths = [...arr(plan.tracePaths)];
  if (plan.traceMessage || tracePaths.length === 0) {
    tracePaths.push(await writeSyntheticTrace({
      runDir,
      iteration,
      now,
      message: plan.traceMessage,
    }));
  }

  await writePlanPrReviewFixture({ run, runDir, plan });
  const runSideEffectEvidence = await sideEffectEvidenceFromRun({ run, runDir });
  const initialInferenceUnit = await initialInferenceUnitEvidenceFromRun({ run, runDir, plan });
  const carriedSideEffectEvidence = carriedSideEffectEvidenceFromLifecycleInput({
    lifecycleInput,
    cwd,
    runDir,
  });
  const detectedCommitSideEffectEvidence = enforceControllerWorktreeEvidence
    ? await scopedCommitEvidenceFromHeadChange({
      cwd,
      gitWorktreeCwd,
      beforeHead: preRunGitHead,
      commitScope,
      filesChanged,
    })
    : null;
  const fallbackSideEffectEvidence = sourceFilesChanged
    ? {
      commit: {
        required: true,
        reasonCode: gitWorktree.sourceFilesChanged
          ? 'controller-detected-dirty-worktree'
          : 'controller-detected-source-change',
        changedFiles: commitScope.allowedCommitFiles.length ? commitScope.allowedCommitFiles : filesChanged,
        currentRunChangedFiles: commitScope.currentRunChangedFiles,
        preExistingDirtyFiles: commitScope.preExistingDirtyFiles,
        allowedCommitFiles: commitScope.allowedCommitFiles.length ? commitScope.allowedCommitFiles : filesChanged,
        forbiddenCommitFiles: commitScope.forbiddenCommitFiles,
      },
    }
    : undefined;
  const sideEffectEvidence = (plan.sideEffectEvidence || runSideEffectEvidence || detectedCommitSideEffectEvidence || carriedSideEffectEvidence)
    ? {
      ...(fallbackSideEffectEvidence || {}),
      ...(carriedSideEffectEvidence || {}),
      ...(detectedCommitSideEffectEvidence || {}),
      ...(runSideEffectEvidence || {}),
      ...(plan.sideEffectEvidence || {}),
    }
    : fallbackSideEffectEvidence;
  if (normalizedPrReviewPolicy.mode === 'disabled' && sideEffectEvidence?.prReview) {
    delete sideEffectEvidence.prReview;
  }
  if (sideEffectEvidence?.commit?.resultPath && !sideEffectEvidence.commit.resultRef) {
    sideEffectEvidence.commit.resultRef = artifactRefFromPath({
      runDir,
      filePath: sideEffectEvidence.commit.resultPath,
      kind: 'commit-intent-result',
    });
  }
  if (sideEffectEvidence?.commit?.validationPath && !sideEffectEvidence.commit.validationRef) {
    sideEffectEvidence.commit.validationRef = artifactRefFromPath({
      runDir,
      filePath: sideEffectEvidence.commit.validationPath,
      kind: 'commit-intent-validation',
    });
  }
  if (sideEffectEvidence?.prReview?.resultPath && !sideEffectEvidence.prReview.resultRef) {
    sideEffectEvidence.prReview.resultRef = artifactRefFromPath({
      runDir,
      filePath: sideEffectEvidence.prReview.resultPath,
      kind: 'pr-review-result',
    });
  }
  if (sideEffectEvidence?.prReview?.validationPath && !sideEffectEvidence.prReview.validationRef) {
    sideEffectEvidence.prReview.validationRef = artifactRefFromPath({
      runDir,
      filePath: sideEffectEvidence.prReview.validationPath,
      kind: 'pr-review-validation',
    });
  }
  if (sideEffectEvidence?.prReview) {
    const contractPrReview = await prReviewEvidenceFromContractArtifacts({
      runDir,
      prReview: sideEffectEvidence.prReview,
    });
    if (contractPrReview) {
      sideEffectEvidence.prReview = contractPrReview;
    } else {
      delete sideEffectEvidence.prReview;
    }
  }
  const prReviewRequired = prReviewRequiredForEvidence({
    policy: normalizedPrReviewPolicy,
    evidence: {
      sourceFilesChanged,
      requiredHardFacts: {
        sourceFilesChanged,
        currentRunChangedFiles: arr(commitScope.currentRunChangedFiles),
      },
      workerEvidence: { filesChanged },
    },
    sourceFilesChanged,
  });
  const closureAllowed = hasOwn(plan, 'closureAllowed') ? plan.closureAllowed === true : sourceClosureAllowed;
  const requiredHardFacts = requiredHardFactsFromEvidence({
    sourceState,
    gitWorktree,
    sourceFilesChanged,
    closureAllowed,
    sideEffectEvidence,
    commitScope,
    prReviewPolicy: normalizedPrReviewPolicy,
    prReviewRequired,
  });
  const evidenceSnapshot = {
    schema: 'living-doc-harness-controller-evidence-snapshot/v1',
    runId: run.runId,
    iteration,
    createdAt: now,
    detectors: {
      gitWorktree,
      livingDocState: sourceState,
      artifactState: {
        renderedHtml: sourceState?.renderedHtml || null,
        renderedHtmlExists: sourceState?.renderedHtmlExists === true,
      },
      traceState: {
        tracePaths: tracePaths.map((tracePath) => path.relative(cwd, tracePath)),
      },
      sideEffectState: sideEffectEvidence || null,
      prReviewPolicy: normalizedPrReviewPolicy,
      prReviewGate: requiredHardFacts.prReviewGate,
      commitScope,
      controllerState,
    },
    hardFacts: requiredHardFacts,
  };
  const evidenceSnapshotPath = path.join(runDir, 'artifacts', `iteration-${iteration}-controller-evidence-snapshot.json`);
  const evidenceSnapshotText = `${JSON.stringify(evidenceSnapshot, null, 2)}\n`;
  await mkdir(path.dirname(evidenceSnapshotPath), { recursive: true });
  await writeFile(evidenceSnapshotPath, evidenceSnapshotText, 'utf8');
  const relativeEvidenceSnapshotPath = path.relative(runDir, evidenceSnapshotPath);
  const evidenceSnapshotRef = runArtifactRef({
    runDir,
    runId: run.runId,
    filePath: evidenceSnapshotPath,
    kind: 'controller-evidence-snapshot',
  });
  const evidenceSnapshotHash = sha256(evidenceSnapshotText);
  const evidenceSnapshotBytes = Buffer.byteLength(evidenceSnapshotText, 'utf8');
  const controllerEvidence = compactControllerEvidence({
    evidenceSnapshotPath: relativeEvidenceSnapshotPath,
    evidenceSnapshotRef,
    evidenceSnapshotHash,
    evidenceSnapshotBytes,
    gitWorktree,
    controllerState,
    requiredHardFacts,
  });
  const previousRouteDecision = previousRouteDecisionFromLifecycleInput(lifecycleInput);

  const evidencePath = path.join(runDir, 'artifacts', `lifecycle-iteration-${iteration}-evidence-input.json`);
  const template = await writeIterationEvidenceTemplate({
    runDir,
    outPath: evidencePath,
    tracePaths,
    stageBefore: plan.stageBefore || null,
    stageAfter: plan.stageAfter || sourceStageAfter,
    unresolvedObjectiveTerms: hasOwn(plan, 'unresolvedObjectiveTerms') ? arr(plan.unresolvedObjectiveTerms) : [],
    unprovenAcceptanceCriteria: hasOwn(plan, 'unprovenAcceptanceCriteria') ? arr(plan.unprovenAcceptanceCriteria) : sourceUnprovenCriteria,
    finalMessageSummary: plan.finalMessageSummary || sourceFinalMessage,
    toolFailures: arr(plan.toolFailures),
    filesChanged,
    acceptanceCriteriaSatisfied: plan.acceptanceCriteriaSatisfied || (sourceCriteriaSatisfied ? 'pass' : 'pending'),
    closureAllowed,
    now,
  });

  const evidence = {
    ...template.evidence,
    ...(plan.wrapperSummary ? { wrapperSummary: plan.wrapperSummary } : {}),
    ...(plan.availableNextActions ? { availableNextActions: arr(plan.availableNextActions) } : {}),
    ...(plan.terminalSignal ? { terminalSignal: plan.terminalSignal } : {}),
    ...(plan.requiredDecision ? { requiredDecision: plan.requiredDecision } : {}),
    ...(plan.requiredSource ? { requiredSource: plan.requiredSource } : {}),
    ...(plan.requiredProof ? { requiredProof: plan.requiredProof } : {}),
    ...(plan.issueRef ? { issueRef: plan.issueRef } : {}),
    ...(sourceState ? { sourceState } : {}),
    livingDocPath: docPath,
    controllerEvidenceSnapshotPath: relativeEvidenceSnapshotPath,
    controllerEvidenceSnapshotRef: evidenceSnapshotRef,
    controllerEvidence,
    requiredHardFacts,
    sourceFilesChanged,
    prReviewPolicy: normalizedPrReviewPolicy,
    prReviewRequired,
    prReviewGate: requiredHardFacts.prReviewGate,
    commitScope,
    ...(enforceControllerWorktreeEvidence && controllerState.changedDuringLifecycle ? {
      controllerSourceRestartRequired: {
        schema: 'living-doc-harness-controller-source-restart-required/v1',
        reasonCode: 'controller-source-changed-during-lifecycle',
        reason: 'Controller-owned harness source changed during this lifecycle iteration; restart before reviewer or closure routing.',
        changedControllerFiles: controllerState.files.filter((file) => file.changedDuringLifecycle),
      },
    } : {}),
    ...(sideEffectEvidence ? { sideEffectEvidence } : {}),
    ...(initialInferenceUnit ? { initialInferenceUnit } : {}),
    ...(previousRouteDecision ? { previousRouteDecision } : {}),
    ...(plan.commitIntent ? { commitIntent: plan.commitIntent } : {}),
    ...(plan.prReview ? { prReview: plan.prReview } : {}),
    ...(proofRouteBundle ? {
      controllerProofRoutes: {
        schema: proofRouteBundle.schema,
        routeCount: proofRouteBundle.routeCount,
        passed: proofRouteBundle.passed,
        failed: proofRouteBundle.failed,
        blocked: proofRouteBundle.blocked,
        results: proofRouteBundle.results.map((result) => ({
          routeId: result.routeId,
          proofRoute: result.proofRoute,
          status: result.status,
          required: result.required,
          failureClass: result.failureClass,
          command: result.command,
          resultPath: path.relative(runDir, result.resultPath),
          resultRef: runArtifactRef({
            runDir,
            runId: run.runId,
            filePath: result.resultPath,
            kind: 'proof-route-result',
          }),
          stdoutPath: result.stdoutPath,
          stderrPath: result.stderrPath,
          acceptanceCriteria: result.acceptanceCriteria,
          closureAllowedContribution: result.closureAllowedContribution,
        })),
      },
      proofGates: {
        ...template.evidence.proofGates,
        controllerProofRoutes: proofRouteBundle.failed === 0 && proofRouteBundle.blocked === 0 ? 'pass' : proofRouteBundle.blocked > 0 ? 'blocked' : 'fail',
      },
    } : {}),
  };
  await writeJson(evidencePath, evidence);
  return { evidence, evidencePath };
}

async function loadEvidenceSequence(filePath) {
  if (!filePath) return [];
  const raw = await readJson(filePath);
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.iterations)) return raw.iterations;
  throw new Error('evidence sequence must be an array or contain iterations[]');
}

async function runPostFlightSummaryUnit({
  runDir,
  runId,
  iteration,
  finalization,
  lifecycleResultPath,
  now,
  cwd,
  allowedUnitTypes,
}) {
  const summaryPath = path.join(runDir, 'artifacts', `iteration-${iteration}-post-flight-summary.md`);
  const summary = [
    `# Post-Flight Summary: ${runId}`,
    '',
    `Created: ${now}`,
    `Terminal kind: ${finalization.terminalKind}`,
    `Classification: ${finalization.classification}`,
    `Proof valid: ${finalization.proofValid === true ? 'true' : 'false'}`,
    `Terminal artifact: ${path.relative(runDir, finalization.terminalPath)}`,
    `Proof artifact: ${path.relative(runDir, finalization.proofPath)}`,
    '',
  ].join('\n');
  await writeFile(summaryPath, summary, 'utf8');
  const input = {
    schema: 'living-doc-harness-post-flight-summary-input/v1',
    runId,
    iteration,
    terminalPath: path.relative(runDir, finalization.terminalPath),
    terminalRef: runArtifactRef({ runDir, runId, filePath: finalization.terminalPath, kind: 'terminal-state' }),
    proofPath: path.relative(runDir, finalization.proofPath),
    proofRef: runArtifactRef({ runDir, runId, filePath: finalization.proofPath, kind: 'iteration-proof' }),
    lifecycleResultPath: path.relative(runDir, lifecycleResultPath),
    lifecycleResultRef: runArtifactRef({ runDir, runId, filePath: lifecycleResultPath, kind: 'lifecycle-result' }),
    requiredInspectionPaths: [finalization.terminalPath, finalization.proofPath, lifecycleResultPath],
    requiredInputRefs: [
      runArtifactRef({ runDir, runId, filePath: finalization.terminalPath, kind: 'terminal-state' }),
      runArtifactRef({ runDir, runId, filePath: finalization.proofPath, kind: 'iteration-proof' }),
      runArtifactRef({ runDir, runId, filePath: lifecycleResultPath, kind: 'lifecycle-result' }),
    ].filter(Boolean),
  };
  const unit = await runContractBoundInferenceUnit({
    runDir,
    rootDir: 'inference-units',
    iteration,
    sequence: 4,
    unitId: 'post-flight-summary',
    role: 'post-flight-summary',
    unitTypeId: 'post-flight-summary',
    allowedUnitTypes,
    prompt: `Write a post-flight summary from the closed run artifacts.

This unit runs only after terminal closure. It summarizes the receipts; it must not create a new progress claim, reopen objective work, edit source files, or change terminal state.
Treat the living doc as the closed objective record and summarize what was proven, what artifacts matter, and where the final evidence lives.

${JSON.stringify(input, null, 2)}`,
    inputContract: input,
    fixtureResult: {
      status: 'written',
      basis: ['Post-flight summary was written from terminal and proof artifacts after closure.'],
      outputContract: {
        schema: 'living-doc-harness-post-flight-summary/v1',
        status: 'written',
        summaryPath: path.relative(runDir, summaryPath),
        basis: ['Terminal closure was already persisted; this unit only summarizes closed-run artifacts.'],
      },
    },
    execute: false,
    cwd,
    now,
  });
  return {
    summaryPath,
    unit,
  };
}

async function writeControllerSourceRestartHandoff({
  lifecycleDir,
  run,
  runDir,
  iteration,
  evidence,
  evidencePath,
  now,
  cwd,
  docPath,
}) {
  const restart = evidence.controllerSourceRestartRequired || {};
  const handoff = {
    schema: 'living-doc-harness-controller-source-restart-handoff/v1',
    status: 'restart-required',
    reasonCode: restart.reasonCode || 'controller-source-changed-during-lifecycle',
    reason: restart.reason || 'Controller-owned harness source changed during this lifecycle iteration; restart before reviewer or closure routing.',
    runId: run.runId,
    iteration,
    docPath,
    evidencePath: path.relative(runDir, evidencePath),
    evidenceRef: runArtifactRef({ runDir, runId: run.runId, filePath: evidencePath, kind: 'iteration-evidence' }),
    evidenceSnapshotPath: evidence.controllerEvidenceSnapshotPath || null,
    evidenceSnapshotRef: evidence.controllerEvidenceSnapshotRef || evidence.controllerEvidence?.snapshotRef || null,
    requiredHardFacts: evidence.requiredHardFacts || null,
    commitScope: evidence.commitScope || null,
    sourceFilesChanged: evidence.sourceFilesChanged === true,
    sideEffectEvidence: evidence.sideEffectEvidence || null,
    changedControllerFiles: arr(restart.changedControllerFiles),
    nativeTraceRefs: arr(run.contract?.artifacts?.nativeTraceRefs),
    workerArtifacts: {
      state: run.contract?.artifacts?.state || null,
      events: run.contract?.artifacts?.events || null,
      lastMessage: run.contract?.artifacts?.lastMessage || null,
      lastMessageRef: run.contract?.artifacts?.lastMessageRef || null,
      codexEvents: run.contract?.artifacts?.codexEvents || null,
      codexEventsRef: run.contract?.artifacts?.codexEventsRef || null,
      codexStderr: run.contract?.artifacts?.codexStderr || null,
      codexStderrRef: run.contract?.artifacts?.codexStderrRef || null,
    },
    requiredAction: 'Commit or restore controller-owned source changes, then restart the standalone lifecycle from the new controller version.',
  };
  const handoffPath = path.join(runDir, 'artifacts', `iteration-${iteration}-controller-source-restart-required.json`);
  await writeJson(handoffPath, handoff);

  const outputInput = {
    schema: 'living-doc-harness-output-input/v1',
    runId: run.runId,
    iteration,
    createdAt: now,
    previousOutput: {
      classification: 'controller-source-changed-restart-required',
      terminalKind: 'restart-required',
      proofValid: false,
      evidencePath: path.relative(runDir, evidencePath),
      evidenceRef: runArtifactRef({ runDir, runId: run.runId, filePath: evidencePath, kind: 'iteration-evidence' }),
      restartHandoffPath: path.relative(runDir, handoffPath),
      restartHandoffRef: runArtifactRef({ runDir, runId: run.runId, filePath: handoffPath, kind: 'controller-source-restart-handoff' }),
    },
    postReviewSelection: null,
    nextUnit: null,
    terminalAction: {
      action: 'restart-required',
      reasonCode: handoff.reasonCode,
      reason: handoff.reason,
    },
    nextAction: {
      action: 'restart-after-controller-source-commit',
      allowed: false,
      reason: handoff.reason,
    },
    nextInput: null,
  };
  const outputInputPath = path.join(runDir, 'output-input', `iteration-${iteration}.json`);
  await writeJson(outputInputPath, outputInput);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'controller-source-restart-required',
    at: now,
    runId: run.runId,
    iteration,
    reasonCode: handoff.reasonCode,
    restartHandoffPath: path.relative(runDir, handoffPath),
    outputInputPath: path.relative(runDir, outputInputPath),
  });
  await appendJsonl(path.join(lifecycleDir, 'events.jsonl'), {
    event: 'lifecycle-controller-source-restart-required',
    at: now,
    runId: run.runId,
    iteration,
    reasonCode: handoff.reasonCode,
    restartHandoffPath: path.relative(lifecycleDir, handoffPath),
    outputInputPath: path.relative(lifecycleDir, outputInputPath),
  });
  return { handoffPath, outputInputPath, outputInput, handoff };
}

export async function runHarnessLifecycle({
  docPath,
  runsDir = '.living-doc-runs',
  evidenceDir = 'evidence/living-doc-harness',
  dashboardPath = 'docs/living-doc-harness-dashboard.html',
  execute = false,
  evidenceSequencePath = null,
  cwd = process.cwd(),
  now = new Date().toISOString(),
  codexBin = 'codex',
  codexHome = undefined,
  traceLimit = 10,
  executeReviewer = execute,
  executeClosureReview = executeReviewer,
  reviewerVerdictSequence = null,
  executeRepairSkills = false,
  executeRepairSkillUnits = false,
  executeProofRoutes = false,
  proofRoutes = null,
  toolProfile = 'local-harness',
  allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
  prReviewPolicy = DEFAULT_PR_REVIEW_POLICY,
  startupEvidenceTimeoutMs = undefined,
  gitWorktreeCwd = cwd,
  enforceControllerWorktreeEvidence = execute,
  command = null,
} = {}) {
  if (!docPath) throw new Error('docPath is required');

  const evidenceSequence = await loadEvidenceSequence(evidenceSequencePath);
  const reviewerSequence = reviewerVerdictSequence || evidenceSequence.map((item) => item?.reviewerVerdict || null);
  const absoluteRunsDir = path.resolve(cwd, runsDir);
  const absoluteEvidenceDir = path.resolve(cwd, evidenceDir);
  const absoluteDashboardPath = path.resolve(cwd, dashboardPath);
  const runConfigValidation = validateAllowedInferenceUnitRunConfig({
    allowedUnitTypes,
    initialUnitType: 'worker',
    prReviewPolicy,
  });
  if (!runConfigValidation.ok) {
    throw new Error(`invalid lifecycle inference unit run config: ${runConfigValidation.violations.map((violation) => violation.message).join('; ')}`);
  }
  const normalizedAllowedUnitTypes = normalizeAllowedInferenceUnitTypes(runConfigValidation.allowedUnitTypes);
  const normalizedPrReviewPolicy = normalizePrReviewPolicy(runConfigValidation.prReviewPolicy);
  const resultId = `ldhl-${timestampForId(now)}-${path.basename(docPath, '.json').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  const lifecycleDir = path.join(absoluteRunsDir, resultId);
  await mkdir(lifecycleDir, { recursive: true });
  const commandInfo = command || {
    command: process.execPath,
    args: process.argv.slice(1),
    cwd,
  };
  if (execute) {
    await writeActiveLifecycleSnapshot({
      lifecycleDir,
      resultId,
      docPath,
      createdAt: now,
      supervisorPid: process.pid,
      executeProofRoutes,
      toolProfile,
      prReviewPolicy: normalizedPrReviewPolicy,
      command: commandInfo,
    });
  }

  const iterations = [];
  let lifecycleInput = null;
  let finalState = null;
  let lastEvidence = null;
  let currentRun = null;
  let currentIteration = 0;
  let pendingPostFlight = null;
  const docProofRoutes = proofRoutes || await loadProofRoutesFromDoc(docPath, { cwd });
  const controllerStartFileHashes = await controllerStartHashes({ cwd });

  try {
    for (let iteration = 1; ; iteration += 1) {
      currentIteration = iteration;
      const iterationNow = addMs(now, iteration * 1000);
      const plan = evidenceSequence[iteration - 1] || {};
      const preRunGitWorktree = enforceControllerWorktreeEvidence
        ? await deriveGitWorktreeEvidence({ cwd, gitWorktreeCwd })
        : null;
      const preRunGitHead = enforceControllerWorktreeEvidence
        ? await gitHead({ cwd, gitWorktreeCwd })
        : null;
      const run = await createHarnessRun({
        docPath,
        runsDir: absoluteRunsDir,
        execute,
        cwd,
        now: iterationNow,
        codexBin,
        codexHome,
        traceLimit,
        lifecycleInput,
        iteration,
        toolProfile,
        allowedUnitTypes: normalizedAllowedUnitTypes,
        prReviewPolicy: normalizedPrReviewPolicy,
        startupEvidenceTimeoutMs,
      });
      currentRun = run;
      const iterationProofRoutes = arr(plan.proofRoutes).length ? plan.proofRoutes : docProofRoutes;
      const proofRouteBundle = executeProofRoutes && iterationProofRoutes.length
        ? await runProofRoutes({
          runDir: run.runDir,
          iteration,
          routes: iterationProofRoutes,
          cwd,
          docPath,
          now: addMs(iterationNow, 125),
        })
        : null;
      const { evidence, evidencePath } = await buildEvidenceFromPlan({
        run,
        runDir: run.runDir,
        iteration,
        plan,
        docPath,
        cwd,
        gitWorktreeCwd,
        enforceControllerWorktreeEvidence,
        preRunGitWorktree,
        preRunGitHead,
        controllerStartFileHashes,
        now: addMs(iterationNow, 250),
        proofRouteBundle,
        prReviewPolicy: normalizedPrReviewPolicy,
        lifecycleInput,
      });
      lastEvidence = evidence;
      if (evidence.controllerSourceRestartRequired) {
        const restartHandoff = await writeControllerSourceRestartHandoff({
          lifecycleDir,
          run,
          runDir: run.runDir,
          iteration,
          evidence,
          evidencePath,
          now: addMs(iterationNow, 500),
          cwd,
          docPath,
        });
        const nextAction = {
          action: 'restart-after-controller-source-commit',
          allowed: false,
          reason: evidence.controllerSourceRestartRequired.reason,
        };
        iterations.push({
          iteration,
          runId: run.runId,
          runDir: run.runDir,
          classification: 'controller-source-changed-restart-required',
          terminalKind: 'restart-required',
          nextAction,
          outputInputPath: restartHandoff.outputInputPath,
          outputInputRef: runArtifactRef({
            runDir: run.runDir,
            runId: run.runId,
            filePath: restartHandoff.outputInputPath,
            kind: 'output-input',
          }),
          reviewerVerdictPath: null,
          repairSkillResultPath: null,
          closureReviewResultPath: null,
          postReviewSelectionPath: null,
          restartHandoffPath: restartHandoff.handoffPath,
          restartHandoffRef: runArtifactRef({
            runDir: run.runDir,
            runId: run.runId,
            filePath: restartHandoff.handoffPath,
            kind: 'controller-source-restart-handoff',
          }),
          proofValid: false,
        });
        finalState = {
          kind: 'controller-source-changed-restart-required',
          reasonCode: evidence.controllerSourceRestartRequired.reasonCode,
          reason: evidence.controllerSourceRestartRequired.reason,
          runId: run.runId,
          iteration,
          restartHandoffPath: path.relative(cwd, restartHandoff.handoffPath),
          restartHandoffRef: runArtifactRef({
            cwd,
            runDir: run.runDir,
            runId: run.runId,
            filePath: restartHandoff.handoffPath,
            kind: 'controller-source-restart-handoff',
          }),
          outputInputPath: path.relative(cwd, restartHandoff.outputInputPath),
          outputInputRef: runArtifactRef({
            cwd,
            runDir: run.runDir,
            runId: run.runId,
            filePath: restartHandoff.outputInputPath,
            kind: 'output-input',
          }),
          evidencePath: path.relative(cwd, evidencePath),
          evidenceRef: runArtifactRef({
            cwd,
            runDir: run.runDir,
            runId: run.runId,
            filePath: evidencePath,
            kind: 'iteration-evidence',
          }),
        };
        break;
      }
      const finalization = await finalizeHarnessIteration({
        runDir: run.runDir,
        evidencePath,
        livingDocPath: docPath,
        afterDocPath: docPath,
        iteration,
        now: addMs(iterationNow, 500),
        evidenceDir: absoluteEvidenceDir,
        dashboardPath: absoluteDashboardPath,
        runsDir: absoluteRunsDir,
        reviewerVerdict: reviewerSequence[iteration - 1] || plan.reviewerVerdict || null,
        executeReviewer,
        executeClosureReview,
        executeRepairSkills,
        executeRepairSkillUnits: plan.executeRepairSkillUnits === true || executeRepairSkillUnits,
        repairSkillPlan: plan.repairSkillPlan || null,
        codexBin,
        allowedUnitTypes: normalizedAllowedUnitTypes,
        prReviewPolicy: normalizedPrReviewPolicy,
      });

      const mayStop = lifecycleMayStop(finalization);
      const nextAction = nextActionFromFinalization(finalization);

      const provisionalOutputInputPath = path.join(run.runDir, 'output-input', `iteration-${iteration}.json`);
      const nextInput = nextAction.allowed
        ? nextInputFromFinalization({ finalization, outputInputPath: provisionalOutputInputPath })
        : null;
      const outputInput = await writeOutputInput({
        runDir: run.runDir,
        iteration,
        finalization,
        evidencePath,
        nextAction,
        nextInput,
        now: addMs(iterationNow, 750),
      });
      if (nextInput) nextInput.outputInputPath = path.relative(cwd, outputInput.outputInputPath);

      iterations.push({
        iteration,
        runId: run.runId,
        runDir: run.runDir,
        classification: finalization.classification,
        terminalKind: finalization.terminalKind,
        nextAction,
        outputInputPath: outputInput.outputInputPath,
        outputInputRef: runArtifactRef({
          runDir: run.runDir,
          runId: run.runId,
          filePath: outputInput.outputInputPath,
          kind: 'output-input',
        }),
        reviewerVerdictPath: finalization.reviewerVerdictPath,
        reviewerVerdictRef: runArtifactRef({
          runDir: run.runDir,
          runId: run.runId,
          filePath: finalization.reviewerVerdictPath,
          kind: 'reviewer-verdict',
        }),
        repairSkillResultPath: finalization.repairSkillResultPath,
        repairSkillResultRef: runArtifactRef({
          runDir: run.runDir,
          runId: run.runId,
          filePath: finalization.repairSkillResultPath,
          kind: 'repair-skill-result',
        }),
        closureReviewResultPath: finalization.closureReviewResultPath,
        closureReviewResultRef: runArtifactRef({
          runDir: run.runDir,
          runId: run.runId,
          filePath: finalization.closureReviewResultPath,
          kind: 'closure-review-result',
        }),
        postReviewSelectionPath: finalization.postReviewSelectionPath,
        postReviewSelectionRef: runArtifactRef({
          runDir: run.runDir,
          runId: run.runId,
          filePath: finalization.postReviewSelectionPath,
          kind: 'post-review-selection',
        }),
        prReviewPolicy: finalization.prReviewPolicy || null,
        prReviewRequired: finalization.prReviewRequired === true,
        prReviewGate: finalization.prReviewGate || null,
        proofValid: finalization.proofValid,
      });

      await appendJsonl(path.join(lifecycleDir, 'events.jsonl'), {
        event: 'lifecycle-iteration-complete',
        at: addMs(iterationNow, 800),
        resultId,
        iteration,
        runId: run.runId,
        classification: finalization.classification,
        terminalKind: finalization.terminalKind,
        nextAction: nextAction.action,
        outputInputPath: path.relative(lifecycleDir, outputInput.outputInputPath),
        reviewerVerdictPath: path.relative(lifecycleDir, finalization.reviewerVerdictPath),
        repairSkillResultPath: finalization.repairSkillResultPath ? path.relative(lifecycleDir, finalization.repairSkillResultPath) : null,
        closureReviewResultPath: finalization.closureReviewResultPath ? path.relative(lifecycleDir, finalization.closureReviewResultPath) : null,
        postReviewSelectionPath: finalization.postReviewSelectionPath ? path.relative(lifecycleDir, finalization.postReviewSelectionPath) : null,
      });

      if (mayStop) {
        pendingPostFlight = finalization.terminalKind === 'closed'
          ? {
            runDir: run.runDir,
            runId: run.runId,
            iteration,
            finalization,
            now: addMs(iterationNow, 850),
            cwd,
            allowedUnitTypes: normalizedAllowedUnitTypes,
          }
          : null;
        finalState = {
          kind: finalization.terminalKind,
          reason: nextAction.reason,
          runId: run.runId,
          postFlightSummaryPath: null,
          postFlightSummaryRef: null,
          postFlightUnitResultPath: null,
          postFlightUnitResultRef: null,
        };
        break;
      }

      lifecycleInput = {
        ...nextInput,
        outputInputPath: path.relative(cwd, outputInput.outputInputPath),
      };
    }
  } catch (err) {
    finalState = {
      kind: 'process-defect',
      reasonCode: 'lifecycle-controller-exception',
      reason: err?.message || String(err),
      runId: currentRun?.runId || err?.runId || null,
      iteration: currentIteration || null,
      processDefectPath: err?.processDefectPath ? path.relative(cwd, err.processDefectPath) : null,
    };
    await appendJsonl(path.join(lifecycleDir, 'events.jsonl'), {
      event: 'lifecycle-process-defect',
      at: new Date().toISOString(),
      resultId,
      runId: currentRun?.runId || err?.runId || null,
      iteration: currentIteration || null,
      reasonCode: finalState.reasonCode,
      reason: finalState.reason,
      processDefectPath: finalState.processDefectPath,
    });
  }

  const resultPath = path.join(lifecycleDir, 'lifecycle-result.json');
  let result = {
    schema: 'living-doc-harness-lifecycle-result/v1',
    resultId,
    createdAt: now,
    docPath,
    docHash: await fileHash(path.resolve(cwd, docPath)),
    runConfig: {
      schema: 'living-doc-harness-run-inference-config/v1',
      allowedUnitTypes: normalizedAllowedUnitTypes,
      prReviewPolicy: normalizedPrReviewPolicy,
    },
    lifecycleDir,
    lifecycleRef: cwdArtifactRef({ cwd, filePath: lifecycleDir, kind: 'lifecycle-dir' }),
    iterationCount: iterations.length,
    finalState: finalState || {
      kind: 'unknown',
      reason: 'loop ended without final state',
      runId: iterations.at(-1)?.runId || null,
    },
    iterations: iterations.map((item) => ({
      ...item,
      runDir: resultPathRef(cwd, item.runDir),
      outputInputPath: resultPathRef(cwd, item.outputInputPath),
      outputInputRef: item.outputInputRef || runArtifactRef({ cwd, runDir: item.runDir, runId: item.runId, filePath: item.outputInputPath, kind: 'output-input' }),
      reviewerVerdictPath: resultPathRef(cwd, item.reviewerVerdictPath),
      reviewerVerdictRef: item.reviewerVerdictRef || runArtifactRef({ cwd, runDir: item.runDir, runId: item.runId, filePath: item.reviewerVerdictPath, kind: 'reviewer-verdict' }),
      repairSkillResultPath: resultPathRef(cwd, item.repairSkillResultPath),
      repairSkillResultRef: item.repairSkillResultRef || runArtifactRef({ cwd, runDir: item.runDir, runId: item.runId, filePath: item.repairSkillResultPath, kind: 'repair-skill-result' }),
      closureReviewResultPath: resultPathRef(cwd, item.closureReviewResultPath),
      closureReviewResultRef: item.closureReviewResultRef || runArtifactRef({ cwd, runDir: item.runDir, runId: item.runId, filePath: item.closureReviewResultPath, kind: 'closure-review-result' }),
      postReviewSelectionPath: resultPathRef(cwd, item.postReviewSelectionPath),
      postReviewSelectionRef: item.postReviewSelectionRef || runArtifactRef({ cwd, runDir: item.runDir, runId: item.runId, filePath: item.postReviewSelectionPath, kind: 'post-review-selection' }),
      restartHandoffPath: resultPathRef(cwd, item.restartHandoffPath),
      restartHandoffRef: item.restartHandoffRef || runArtifactRef({ cwd, runDir: item.runDir, runId: item.runId, filePath: item.restartHandoffPath, kind: 'controller-source-restart-handoff' }),
    })),
    lastEvidenceSummary: lastEvidence ? {
      unresolvedObjectiveTerms: arr(lastEvidence.objectiveState?.unresolvedObjectiveTerms).length,
      unprovenAcceptanceCriteria: arr(lastEvidence.objectiveState?.unprovenAcceptanceCriteria).length,
      nativeTraceRefs: arr(lastEvidence.workerEvidence?.nativeInferenceTraceRefs).length,
      prReviewPolicy: lastEvidence.prReviewPolicy || null,
      prReviewRequired: lastEvidence.prReviewRequired === true,
      prReviewEvidencePresent: lastEvidence.requiredHardFacts?.prReviewEvidencePresent === true,
    } : null,
  };
  await writeJson(resultPath, result);
  if (pendingPostFlight) {
    const postFlight = await runPostFlightSummaryUnit({
      ...pendingPostFlight,
      lifecycleResultPath: resultPath,
    });
    result = {
      ...result,
      finalState: {
        ...result.finalState,
        postFlightSummaryPath: postFlight?.summaryPath ? path.relative(cwd, postFlight.summaryPath) : null,
        postFlightSummaryRef: postFlight?.summaryPath
          ? runArtifactRef({ cwd, runDir: pendingPostFlight.runDir, runId: pendingPostFlight.runId, filePath: postFlight.summaryPath, kind: 'post-flight-summary' })
          : null,
        postFlightUnitResultPath: postFlight?.unit?.resultPath ? path.relative(cwd, postFlight.unit.resultPath) : null,
        postFlightUnitResultRef: postFlight?.unit?.resultPath
          ? runArtifactRef({ cwd, runDir: pendingPostFlight.runDir, runId: pendingPostFlight.runId, filePath: postFlight.unit.resultPath, kind: 'post-flight-summary-result' })
          : null,
      },
    };
    await writeJson(resultPath, result);
  }
  await appendJsonl(path.join(lifecycleDir, 'events.jsonl'), {
    event: 'lifecycle-result-written',
    at: addMs(now, (iterations.length + 1) * 1000),
    resultId,
    finalState: result.finalState,
    iterationCount: iterations.length,
  });
  if (execute) {
    await writeActiveLifecycleSnapshot({
      lifecycleDir,
      resultId,
      docPath,
      createdAt: now,
      supervisorPid: process.pid,
      executeProofRoutes,
      toolProfile,
      prReviewPolicy: normalizedPrReviewPolicy,
      command: commandInfo,
      status: 'finished',
      finalState: result.finalState,
    });
  }
  return {
    ...result,
    resultPath,
  };
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (command !== 'run') {
    throw new Error('usage: living-doc-harness-lifecycle.mjs run <doc.json> [--runs-dir <dir>] [--execute] [--execute-proof-routes] [--evidence-sequence <json>]');
  }
  const docPath = args.shift();
  if (!docPath) throw new Error('run requires <doc.json>');
  const options = {
    docPath,
    runsDir: '.living-doc-runs',
    evidenceDir: 'evidence/living-doc-harness',
    dashboardPath: 'docs/living-doc-harness-dashboard.html',
    execute: false,
    evidenceSequencePath: null,
    now: new Date().toISOString(),
    codexBin: 'codex',
    codexHome: undefined,
    traceLimit: 10,
    executeReviewer: null,
    executeClosureReview: null,
    executeRepairSkills: false,
    executeRepairSkillUnits: false,
    executeProofRoutes: false,
    toolProfile: 'local-harness',
    allowedUnitTypes: DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
    prReviewPolicy: DEFAULT_PR_REVIEW_POLICY,
    startupEvidenceTimeoutMs: undefined,
    gitWorktreeCwd: process.cwd(),
    enforceControllerWorktreeEvidence: null,
  };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--runs-dir') {
      options.runsDir = args.shift();
      if (!options.runsDir) throw new Error('--runs-dir requires a value');
    } else if (flag === '--evidence-dir') {
      options.evidenceDir = args.shift();
      if (!options.evidenceDir) throw new Error('--evidence-dir requires a value');
    } else if (flag === '--dashboard') {
      options.dashboardPath = args.shift();
      if (!options.dashboardPath) throw new Error('--dashboard requires a value');
    } else if (flag === '--execute') {
      options.execute = true;
    } else if (flag === '--evidence-sequence') {
      options.evidenceSequencePath = args.shift();
      if (!options.evidenceSequencePath) throw new Error('--evidence-sequence requires a value');
    } else if (flag === '--now') {
      options.now = args.shift();
      if (!options.now) throw new Error('--now requires a value');
    } else if (flag === '--codex-bin') {
      options.codexBin = args.shift();
      if (!options.codexBin) throw new Error('--codex-bin requires a value');
    } else if (flag === '--codex-home') {
      options.codexHome = args.shift();
      if (!options.codexHome) throw new Error('--codex-home requires a value');
    } else if (flag === '--trace-limit') {
      options.traceLimit = Number(args.shift());
      if (!Number.isInteger(options.traceLimit) || options.traceLimit < 1) throw new Error('--trace-limit requires an integer >= 1');
    } else if (flag === '--execute-reviewer') {
      options.executeReviewer = true;
      options.executeClosureReview = true;
    } else if (flag === '--no-execute-reviewer') {
      options.executeReviewer = false;
    } else if (flag === '--execute-closure-review') {
      options.executeClosureReview = true;
    } else if (flag === '--no-execute-closure-review') {
      options.executeClosureReview = false;
    } else if (flag === '--execute-repair-skills') {
      options.executeRepairSkills = true;
    } else if (flag === '--execute-repair-skill-units') {
      options.executeRepairSkillUnits = true;
    } else if (flag === '--execute-proof-routes') {
      options.executeProofRoutes = true;
    } else if (flag === '--tool-profile') {
      options.toolProfile = args.shift();
      if (!options.toolProfile) throw new Error('--tool-profile requires a value');
    } else if (flag === '--allowed-unit-types') {
      const value = args.shift();
      if (!value) throw new Error('--allowed-unit-types requires a comma-separated value');
      options.allowedUnitTypes = value.split(',').map((item) => item.trim()).filter(Boolean);
    } else if (flag === '--pr-review-policy') {
      const value = args.shift();
      if (!value) throw new Error('--pr-review-policy requires a value');
      options.prReviewPolicy = normalizePrReviewPolicy(value);
    } else if (flag === '--startup-evidence-timeout-ms') {
      options.startupEvidenceTimeoutMs = Number(args.shift());
      if (!Number.isInteger(options.startupEvidenceTimeoutMs) || options.startupEvidenceTimeoutMs < 1) {
        throw new Error('--startup-evidence-timeout-ms requires an integer >= 1');
      }
    } else if (flag === '--git-worktree-cwd') {
      options.gitWorktreeCwd = args.shift();
      if (!options.gitWorktreeCwd) throw new Error('--git-worktree-cwd requires a value');
    } else if (flag === '--enforce-controller-worktree-evidence') {
      options.enforceControllerWorktreeEvidence = true;
    } else if (flag === '--no-enforce-controller-worktree-evidence') {
      options.enforceControllerWorktreeEvidence = false;
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  if (options.executeReviewer == null) options.executeReviewer = options.execute;
  if (options.executeClosureReview == null) options.executeClosureReview = options.executeReviewer;
  if (options.enforceControllerWorktreeEvidence == null) options.enforceControllerWorktreeEvidence = options.execute;
  return options;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  try {
    const result = await runHarnessLifecycle(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({
      resultId: result.resultId,
      resultPath: result.resultPath,
      finalState: result.finalState,
      iterationCount: result.iterationCount,
    }, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
