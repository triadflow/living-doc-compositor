// Standalone living-doc harness runner.
//
// This is the command boundary for running Codex headless from a living-doc
// objective. By default it creates the durable run directory without launching
// Codex; pass --execute to spawn `codex exec` as a separate process.

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { attachTraceSummaryToRun, discoverCodexTraceFiles, summarizeCodexTrace } from './living-doc-harness-trace-reader.mjs';
import { writeContractBoundInferenceUnitSnapshot } from './living-doc-harness-inference-unit.mjs';
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

const __filename = fileURLToPath(import.meta.url);
const execFileAsync = promisify(execFile);

const DEFAULT_RUNS_DIR = '.living-doc-runs';

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

function selectedInitialUnit(lifecycleInput) {
  const unitId = lifecycleInput?.nextUnit?.unitId || lifecycleInput?.selectedUnitType || 'worker';
  const type = getInferenceUnitType(unitId);
  return {
    unitId: type.id,
    role: lifecycleInput?.nextUnit?.role || type.role || type.id,
    type,
  };
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
      outputInputPath: lifecycleInput.outputInputPath || null,
      selectedUnitType: lifecycleInput.selectedUnitType || lifecycleInput.nextUnit?.unitId || null,
      nextUnit: lifecycleInput.nextUnit || null,
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

async function previousOutputInputContext({ cwd, lifecycleInput }) {
  const outputInputPath = lifecycleInput?.outputInputPath ? path.resolve(cwd, lifecycleInput.outputInputPath) : null;
  const outputInput = outputInputPath ? await readJson(outputInputPath, null) : null;
  const previousRunDir = outputInputPath ? path.dirname(path.dirname(outputInputPath)) : null;
  const evidencePath = outputInput?.previousOutput?.evidencePath && previousRunDir
    ? path.resolve(previousRunDir, outputInput.previousOutput.evidencePath)
    : null;
  const evidence = evidencePath ? await readJson(evidencePath, null) : null;
  return { outputInputPath, outputInput, previousRunDir, evidencePath, evidence };
}

function previousControllerEvidenceSnapshotPath({ previous, cwd }) {
  const snapshotPath = previous?.evidence?.controllerEvidenceSnapshotPath
    || previous?.evidence?.controllerEvidence?.snapshotPath
    || null;
  if (!snapshotPath || !previous?.previousRunDir) return null;
  return path.relative(cwd, path.resolve(previous.previousRunDir, snapshotPath));
}

function commonRequiredInspectionPaths({ docPath, lifecycleInput, previous, cwd }) {
  return unique([
    docPath,
    lifecycleInput?.outputInputPath || null,
    ...arr(lifecycleInput?.nextUnit?.requiredInputPaths),
    previous?.evidencePath ? path.relative(cwd, previous.evidencePath) : null,
    previousControllerEvidenceSnapshotPath({ previous, cwd }),
  ]);
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
  if (initialUnit.unitId === 'worker') {
    return buildWorkerInputContract({ doc, docPath, runId, lifecycleInput, toolProfile, allowedUnitTypes, prReviewPolicy });
  }

  const previous = await previousOutputInputContext({ cwd, lifecycleInput });
  const requiredInspectionPaths = commonRequiredInspectionPaths({ docPath, lifecycleInput, previous, cwd });
  const nextUnit = lifecycleInput?.nextUnit || {};

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
      requiredInspectionPaths,
    };
  }

  if (initialUnit.unitId === 'continuation-inference') {
    return {
      schema: 'living-doc-continuation-input/v1',
      runId,
      iteration,
      reasonCode: nextUnit.reasonCode || previous.outputInput?.previousOutput?.classification || 'continuation-required',
      lifecycleInput,
      requiredInspectionPaths,
    };
  }

  if (initialUnit.unitId === 'living-doc-balance-scan') {
    return {
      schema: 'living-doc-repair-skill-chain-input/v1',
      runId,
      iteration,
      livingDocPath: docPath,
      reviewerVerdictPath: previous.outputInput?.previousOutput?.reviewerVerdictPath || nextUnit.reviewerVerdictPath || null,
      handoverPath: previous.outputInput?.previousOutput?.handoverPath || lifecycleInput?.handoverPath || null,
      lifecycleInput,
      requiredInspectionPaths,
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
      requiredHardFacts: hardFacts,
      prReviewPolicy,
      prReviewRequired,
      changedFiles: arr(hardFacts.currentRunChangedFiles).length
        ? arr(hardFacts.currentRunChangedFiles)
        : arr(previous.evidence?.workerEvidence?.filesChanged),
      commitEvidence: previous.evidence?.sideEffectEvidence?.commit || null,
      lifecycleInput,
      requiredInspectionPaths,
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
      reviewerVerdictPath: previous.outputInput?.previousOutput?.reviewerVerdictPath || null,
      evidenceSnapshotPath,
      requiredHardFacts: previous.evidence?.requiredHardFacts || null,
      prReviewPolicy,
      prReviewRequired,
      proofGates: previous.evidence?.proofGates || {},
      stopVerdict: previous.outputInput?.previousOutput || {},
      lifecycleInput,
      requiredInspectionPaths,
    };
  }

  return {
    schema: initialUnit.type.inputContract.schema,
    runId,
    iteration,
    lifecycleInput,
    requiredInspectionPaths,
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

function externalOutputContract({ unitTypeId, runId, docPath, inputContract, status, exitCode, traceRefs, paths, commitBefore, commitAfter, commitEvidence, rawResult = null }) {
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
    if (output?.schema === 'living-doc-harness-pr-review-result/v1') {
      return {
        ...output,
        exitCode,
        ...paths,
        nativeTraceRefs: traceRefs,
      };
    }
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
  const initialUnit = selectedInitialUnit(lifecycleInput);
  const runConfigValidation = validateAllowedInferenceUnitRunConfig({
    allowedUnitTypes: normalizedAllowedUnitTypes,
    initialUnitType: initialUnit.unitId,
    prReviewPolicy: normalizedPrReviewPolicy,
  });
  if (!runConfigValidation.ok) {
    throw new Error(`invalid harness runner inference unit run config: ${runConfigValidation.violations.map((violation) => violation.message).join('; ')}`);
  }
  const prompt = `${buildPrompt(doc, { docPath: relativeDocPath, runId, lifecycleInput, initialUnit })}

Harness tool profile:
${JSON.stringify(resolvedToolProfile, null, 2)}
`;
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
  const initialUnitArtifact = {
    unitId: initialUnit.unitId,
    role: initialUnit.role,
    result: path.relative(runDir, initialUnitSnapshot.resultPath),
    validation: path.relative(runDir, initialUnitSnapshot.validationPath),
    inputContract: path.relative(runDir, initialUnitSnapshot.inputContractPath),
    prompt: path.relative(runDir, initialUnitSnapshot.promptPath),
    codexEvents: path.relative(runDir, initialUnitSnapshot.codexEventsPath),
    lastMessage: path.relative(runDir, initialUnitSnapshot.lastMessagePath),
    stderr: path.relative(runDir, initialUnitSnapshot.stderrPath),
  };
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
  const outputPaths = {
    exitCode,
    codexEventsPath: path.relative(runDir, codexEventsPath),
    lastMessagePath: path.relative(runDir, lastMessagePath),
    stderrPath: path.relative(runDir, codexStderrPath),
  };
  const rawLastMessage = await readFile(lastMessagePath, 'utf8').catch(() => '');
  const rawUnitResult = extractJson(rawLastMessage);
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
    status: initialUnit.unitId === 'commit-intent' ? finalOutputContract.status : finalContract.status,
    basis: [
      `${initialUnit.unitId} headless Codex process exited with code ${exitCode}.`,
      'Reviewer inference remains the authority for closure, repair, resume, or block decisions.',
    ],
    outputContract: finalOutputContract,
    now: finishedAt,
    cwd,
    toolProfile: resolvedToolProfile,
  });
  const finalUnitArtifact = {
    unitId: initialUnit.unitId,
    role: initialUnit.role,
    result: path.relative(runDir, finalUnitSnapshot.resultPath),
    validation: path.relative(runDir, finalUnitSnapshot.validationPath),
    inputContract: path.relative(runDir, finalUnitSnapshot.inputContractPath),
    prompt: path.relative(runDir, finalUnitSnapshot.promptPath),
    codexEvents: path.relative(runDir, finalUnitSnapshot.codexEventsPath),
    lastMessage: path.relative(runDir, finalUnitSnapshot.lastMessagePath),
    stderr: path.relative(runDir, finalUnitSnapshot.stderrPath),
  };
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
