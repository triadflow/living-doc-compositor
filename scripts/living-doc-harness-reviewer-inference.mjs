#!/usr/bin/env node
// Reviewer-inference contract for the standalone living-doc harness.
//
// The worker does the objective work. This layer emits the authoritative
// close-or-continue verdict from frozen evidence. Deterministic lifecycle code
// may validate and enforce that verdict, but it must not manufacture it.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runContractBoundInferenceUnit } from './living-doc-harness-inference-unit.mjs';

const __filename = fileURLToPath(import.meta.url);

const CLASSIFICATIONS = new Set(['closed', 'user-stopped', 'repairable', 'resumable', 'closure-candidate', 'true-block', 'pivot', 'deferred', 'budget-exhausted']);
const CONFIDENCE = new Set(['low', 'medium', 'high']);

function arr(value) {
  return Array.isArray(value) ? value : [];
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function appendJsonl(filePath, event) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
}

function allClosureGatesPass(evidence) {
  const gates = evidence?.proofGates || {};
  return gates.standaloneRun === 'pass'
    && gates.nativeTraceInspected === 'pass'
    && gates.livingDocRendered === 'pass'
    && gates.acceptanceCriteriaSatisfied === 'pass'
    && gates.evidenceBundleWritten === 'pass'
    && gates.closureAllowed === true;
}

function noUnresolvedClosureState(evidence) {
  return arr(evidence?.objectiveState?.unresolvedObjectiveTerms).length === 0
    && arr(evidence?.objectiveState?.unprovenAcceptanceCriteria).length === 0;
}

function normalizeVerdict(verdict) {
  const normalized = verdict?.schema === 'living-doc-harness-reviewer-verdict/v1'
    ? verdict.verdict
    : verdict;
  if (!normalized?.stopVerdict) {
    throw new Error('reviewer verdict must contain stopVerdict');
  }
  const classification = normalized.stopVerdict.classification;
  if (!CLASSIFICATIONS.has(classification)) {
    throw new Error(`reviewer stopVerdict.classification must be one of: ${[...CLASSIFICATIONS].join(', ')}`);
  }
  if (!normalized.stopVerdict.reasonCode) {
    throw new Error('reviewer stopVerdict.reasonCode is required');
  }
  if (!CONFIDENCE.has(normalized.stopVerdict.confidence || '')) {
    throw new Error('reviewer stopVerdict.confidence must be low, medium, or high');
  }
  if (arr(normalized.stopVerdict.basis).length === 0) {
    throw new Error('reviewer stopVerdict.basis must contain at least one item');
  }
  if (!normalized.nextIteration || typeof normalized.nextIteration.allowed !== 'boolean') {
    throw new Error('reviewer nextIteration.allowed is required');
  }
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    ...normalized,
    nextIteration: {
      ...normalized.nextIteration,
      mustNotDo: arr(normalized.nextIteration.mustNotDo),
    },
  };
}

function normalizeTerminalClosureFlag(verdict) {
  const classification = verdict.stopVerdict.classification;
  if (classification === 'closed' || classification === 'user-stopped' || verdict.stopVerdict.closureAllowed !== true) {
    return verdict;
  }
  return {
    ...verdict,
    stopVerdict: {
      ...verdict.stopVerdict,
      closureAllowed: false,
      basis: [
        ...arr(verdict.stopVerdict.basis),
        'Controller normalized closureAllowed from true to false because only a closed verdict may carry terminal closure permission; this verdict must continue through the selected next inference unit.',
      ],
    },
  };
}

function validateHardGates(verdict, evidence) {
  const classification = verdict.stopVerdict.classification;
  const closureAllowed = verdict.stopVerdict.closureAllowed === true;
  if (classification === 'closed') {
    if (!closureAllowed) {
      throw new Error('reviewer closed verdict must explicitly set closureAllowed true');
    }
    if (!allClosureGatesPass(evidence) || !noUnresolvedClosureState(evidence)) {
      throw new Error('reviewer closed verdict rejected because deterministic hard gates do not allow closure');
    }
    if (verdict.nextIteration.allowed !== false) {
      throw new Error('reviewer closed verdict must not allow a next iteration');
    }
  } else if (classification === 'user-stopped') {
    if (verdict.nextIteration.allowed !== false || verdict.nextIteration.mode !== 'user-stop') {
      throw new Error('reviewer user-stopped verdict must use nextIteration.allowed false and mode user-stop');
    }
  } else if (closureAllowed) {
    throw new Error('reviewer closureAllowed true is only valid for closed verdicts');
  } else {
    const allowedModes = new Set(['continuation', 'repair', 'resume']);
    if (verdict.nextIteration.allowed !== true || !allowedModes.has(verdict.nextIteration.mode)) {
      throw new Error('reviewer non-closure verdicts must continue with mode continuation, repair, or resume');
    }
  }
  return true;
}

function increment(map, key) {
  const safeKey = key || '(missing)';
  map[safeKey] = (map[safeKey] || 0) + 1;
}

function sanitizeTraceSummary(summary, ref) {
  if (!summary) return null;
  return {
    summaryPath: ref,
    rawJsonlPath: summary.traceRef || null,
    traceHash: summary.traceHash || null,
    sizeBytes: summary.sizeBytes || null,
    modifiedAt: summary.modifiedAt || null,
    lineCount: summary.lineCount || 0,
    invalidJsonLines: arr(summary.invalidJsonLines),
    firstTimestamp: summary.firstTimestamp || null,
    lastTimestamp: summary.lastTimestamp || null,
    session: {
      id: summary.session?.id || null,
      source: summary.session?.source || null,
      cliVersion: summary.session?.cliVersion || null,
      modelProvider: summary.session?.modelProvider || null,
      cwdHash: summary.session?.cwdHash || null,
    },
    eventTypes: summary.eventTypes || {},
    payloadTypes: summary.payloadTypes || {},
    responseItemTypes: summary.responseItemTypes || {},
    turnModels: summary.turnModels || {},
    toolCallNames: summary.toolCallNames || {},
    privacy: {
      rawPayloadIncluded: false,
      contentFieldsOmitted: true,
      cwdIsHashed: true,
    },
  };
}

async function loadNativeTraceSummaries(runDir, refs) {
  const summaries = [];
  for (const ref of arr(refs)) {
    const summary = await readJsonIfExists(path.resolve(runDir, ref));
    const sanitized = sanitizeTraceSummary(summary, ref);
    if (sanitized) summaries.push(sanitized);
  }
  return summaries;
}

async function summarizeWrapperJsonl(runDir, ref) {
  const filePath = path.resolve(runDir, ref);
  let raw = '';
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  const lines = raw.split('\n').filter(Boolean);
  const eventTypes = {};
  const itemTypes = {};
  const itemStatuses = {};
  const commandStatuses = {};
  const invalidJsonLines = [];
  let threadId = null;
  let turnStartedCount = 0;
  let turnCompletedCount = 0;
  let agentMessageCount = 0;
  let commandExecutionCount = 0;
  let fileChangeCount = 0;

  lines.forEach((line, index) => {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      invalidJsonLines.push(index + 1);
      return;
    }
    increment(eventTypes, entry.type);
    if (entry.thread_id && !threadId) threadId = entry.thread_id;
    if (entry.type === 'turn.started') turnStartedCount += 1;
    if (entry.type === 'turn.completed') turnCompletedCount += 1;
    const item = entry.item;
    if (!item || typeof item !== 'object') return;
    increment(itemTypes, item.type);
    increment(itemStatuses, item.status);
    if (item.type === 'agent_message') agentMessageCount += 1;
    if (item.type === 'command_execution') {
      commandExecutionCount += 1;
      increment(commandStatuses, item.status);
    }
    if (item.type === 'file_change') fileChangeCount += 1;
  });

  return {
    path: ref,
    rawJsonlPath: filePath,
    lineCount: lines.length,
    invalidJsonLines,
    threadId,
    eventTypes,
    itemTypes,
    itemStatuses,
    commandStatuses,
    turnStartedCount,
    turnCompletedCount,
    agentMessageCount,
    commandExecutionCount,
    fileChangeCount,
    privacy: {
      rawPayloadIncluded: false,
      messageTextOmitted: true,
      commandTextOmitted: true,
      commandOutputOmitted: true,
    },
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function buildLogInspection(runDir, evidence) {
  const nativeTraceSummaries = await loadNativeTraceSummaries(
    runDir,
    arr(evidence?.workerEvidence?.nativeInferenceTraceRefs),
  );
  const wrapperRunLogs = [];
  for (const ref of arr(evidence?.workerEvidence?.wrapperLogRefs).filter((value) => value.endsWith('.jsonl'))) {
    const summary = await summarizeWrapperJsonl(runDir, ref);
    if (summary) wrapperRunLogs.push(summary);
  }
  return {
    schema: 'living-doc-harness-reviewer-log-inspection/v1',
    nativeTraceSummaries,
    wrapperRunLogs,
    rawWorkerJsonlPaths: [
      ...nativeTraceSummaries.map((summary) => ({
        kind: 'native-codex-session-jsonl',
        path: summary.rawJsonlPath,
        summaryPath: summary.summaryPath,
        traceHash: summary.traceHash,
      })),
      ...wrapperRunLogs.map((summary) => ({
        kind: 'wrapper-codex-events-jsonl',
        path: summary.rawJsonlPath,
        summaryPath: summary.path,
        threadId: summary.threadId,
      })),
    ].filter((entry) => entry.path),
    privacy: {
      rawJsonlIncluded: false,
      rawJsonlPathIncluded: true,
      rawPayloadIncluded: false,
      reviewerMustInspectRawJsonlByPath: true,
    },
  };
}

function rawWorkerJsonlPaths(logInspection) {
  return arr(logInspection?.rawWorkerJsonlPaths)
    .map((entry) => entry.path)
    .filter(Boolean);
}

function pathWasInspected(command, targetPath) {
  const text = String(command || '');
  if (!text) return false;
  return text.includes(targetPath) || text.includes(shellQuote(targetPath)) || text.includes(path.basename(targetPath));
}

async function assertReviewerInspectedRawLogs({ eventsPath, logInspection }) {
  const targets = rawWorkerJsonlPaths(logInspection);
  if (!targets.length) {
    throw new Error('reviewer input must include raw worker JSONL paths');
  }
  let raw = '';
  try {
    raw = await readFile(eventsPath, 'utf8');
  } catch {
    throw new Error(`reviewer events log is missing: ${eventsPath}`);
  }
  const inspected = new Set();
  for (const line of raw.split('\n').filter(Boolean)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const item = entry.item;
    if (item?.type !== 'command_execution') continue;
    for (const target of targets) {
      if (pathWasInspected(item.command, target)) inspected.add(target);
    }
  }
  const missing = targets.filter((target) => !inspected.has(target));
  if (missing.length) {
    throw new Error(`reviewer did not inspect raw worker JSONL path(s): ${missing.join(', ')}`);
  }
}

function reviewerPrompt(input) {
  return `You are the reviewer-inference layer for a standalone living-doc harness.

Read the frozen worker evidence below. Emit JSON only. Do not ask for user input.

You are not the worker. You are judging the worker stop state from evidence.
The lifecycle code will enforce your verdict against hard gates.

Mandatory raw-log inspection:
- The input contains logInspection.rawWorkerJsonlPaths.
- Before emitting the verdict, run commands that inspect every raw JSONL file path in logInspection.rawWorkerJsonlPaths.
- Do not rely only on summaries, proof gates, worker final message, or wrapper state.
- If the raw JSONL files cannot be read, do not classify as closed; return true-block or repairable with a reasonCode that names the unreadable log path.
- In stopVerdict.basis, mention the raw JSONL path(s) you inspected and what they showed structurally.
- Your own reviewer codex-events log must show command_execution entries that reference the raw JSONL path(s); otherwise the lifecycle will reject your verdict.

Controller hard facts:
- Treat input.requiredHardFacts and input.controllerEvidence as deterministic facts, not suggestions.
- If requiredHardFacts.sourceFilesChanged is true and commitEvidencePresent is false, do not classify as closed.
- If requiredHardFacts.closureAllowed is false, do not classify as closed even when the worker claims completion.

Return this JSON shape:
{
  "schema": "living-doc-harness-stop-verdict/v1",
  "stopVerdict": {
    "classification": "closed|user-stopped|repairable|resumable|closure-candidate|true-block|pivot|deferred|budget-exhausted",
    "reasonCode": "short-kebab-case",
    "confidence": "low|medium|high",
    "closureAllowed": false,
    "basis": ["specific evidence-based reason"]
  },
  "nextIteration": {
    "allowed": true,
    "mode": "repair|resume|continuation|none|user-stop",
    "instruction": "what should happen next"
  }
}

Hard rule: only use classification "closed" when closureAllowed is true and the evidence shows no unresolved objective terms, no unproven acceptance criteria, native trace refs are present, acceptance criteria pass, rendered doc proof exists, evidence bundle proof exists, and the objective is actually proven.
Hard rule: for every classification except "closed", set stopVerdict.closureAllowed to false even when controller hard facts say closure is possible. Use nextIteration.instruction to request closure-review when the evidence is a closure candidate that still needs terminal closure review.
Hard rule: for every classification except "closed" and an explicit "user-stopped" lifecycle control signal, nextIteration.allowed must be true and nextIteration.mode must be "continuation", "repair", or "resume". A blocker, runtime limitation, failed proof, issue creation, pivot pressure, deferral, or budget boundary is not a lifecycle stop.

Frozen evidence:
${JSON.stringify(input, null, 2)}
`;
}

export async function writeReviewerInferenceVerdict({
  runDir,
  evidence,
  evidencePath,
  iteration = 1,
  now = new Date().toISOString(),
  reviewerVerdict = null,
  reviewerVerdictPath = null,
  executeReviewer = false,
  codexBin = 'codex',
  cwd = process.cwd(),
  allowedUnitTypes = null,
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!evidence) throw new Error('evidence is required');
  const reviewerDir = path.join(runDir, 'reviewer-inference');
  await mkdir(reviewerDir, { recursive: true });
  const inputPath = path.join(reviewerDir, `iteration-${iteration}-input.json`);
  const promptPath = path.join(reviewerDir, `iteration-${iteration}-prompt.md`);
  const artifactPath = path.join(reviewerDir, `iteration-${iteration}-verdict.json`);
  const logInspection = await buildLogInspection(runDir, evidence);

  const input = {
    schema: 'living-doc-harness-reviewer-input/v1',
    runId: evidence.runId,
    iteration,
    createdAt: now,
    evidencePath: evidencePath ? path.relative(runDir, evidencePath) : null,
    evidenceSnapshotPath: evidence.controllerEvidenceSnapshotPath || evidence.controllerEvidence?.snapshotPath || null,
    objectiveState: evidence.objectiveState,
    workerEvidence: evidence.workerEvidence,
    proofGates: evidence.proofGates,
    wrapperSummary: evidence.wrapperSummary || null,
    logInspection,
    availableNextActions: evidence.availableNextActions || [],
    terminalSignal: evidence.terminalSignal || null,
    sourceState: evidence.sourceState || null,
    controllerEvidence: evidence.controllerEvidence || null,
    requiredHardFacts: evidence.requiredHardFacts || null,
  };
  if (allowedUnitTypes) input.runConfig = { schema: 'living-doc-harness-run-inference-config/v1', allowedUnitTypes };
  input.requiredInspectionPaths = rawWorkerJsonlPaths(logInspection);
  await writeJson(inputPath, input);
  const prompt = reviewerPrompt(input);
  await writeFile(promptPath, prompt, 'utf8');

  let verdictSource = null;
  let mode = 'fixture';
  let fixtureResult = null;
  if (reviewerVerdictPath) {
    verdictSource = await readJson(reviewerVerdictPath);
    mode = 'provided-file';
  } else if (reviewerVerdict) {
    verdictSource = reviewerVerdict;
    mode = 'provided-object';
  } else if (!executeReviewer) {
    throw new Error('reviewer inference verdict is required; pass reviewerVerdict, reviewerVerdictPath, or executeReviewer');
  }

  if (verdictSource) {
    const providedVerdict = normalizeTerminalClosureFlag(normalizeVerdict(verdictSource));
    fixtureResult = {
      status: providedVerdict.stopVerdict.classification,
      basis: providedVerdict.stopVerdict.basis,
      outputContract: providedVerdict,
    };
  }

  const unit = await runContractBoundInferenceUnit({
    runDir,
    rootDir: 'inference-units',
    iteration,
    sequence: 2,
    unitId: 'reviewer-inference',
    role: 'reviewer',
    unitTypeId: 'reviewer-inference',
    allowedUnitTypes: allowedUnitTypes || undefined,
    prompt,
    inputContract: input,
    fixtureResult,
    execute: executeReviewer,
    codexBin,
    cwd,
    now,
  });
  if (executeReviewer) mode = unit.result.mode;
  verdictSource = unit.result.outputContract;
  const verdict = normalizeTerminalClosureFlag(normalizeVerdict(verdictSource));
  validateHardGates(verdict, evidence);
  if (executeReviewer) {
    await assertReviewerInspectedRawLogs({ eventsPath: unit.codexEventsPath, logInspection });
  }

  const artifact = {
    schema: 'living-doc-harness-reviewer-verdict/v1',
    runId: evidence.runId,
    iteration,
    createdAt: now,
    mode,
    reviewerInputPath: path.relative(runDir, inputPath),
    promptPath: path.relative(runDir, promptPath),
    stdoutPath: mode === 'headless-codex' ? unit.result.lastMessagePath : null,
    codexEventsPath: unit.result.codexEventsPath,
    stderrPath: unit.result.stderrPath,
    inferenceUnitResultPath: path.relative(runDir, unit.resultPath),
    inferenceUnitValidationPath: path.relative(runDir, unit.validationPath),
    inferenceUnitInputContractPath: path.relative(runDir, unit.inputContractPath),
    inferenceUnitPromptPath: path.relative(runDir, unit.promptPath),
    evidencePath: evidencePath ? path.relative(runDir, evidencePath) : null,
    verdict,
  };
  await writeJson(artifactPath, artifact);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'reviewer-inference-verdict-written',
    at: now,
    runId: evidence.runId,
    iteration,
    classification: verdict.stopVerdict.classification,
    reasonCode: verdict.stopVerdict.reasonCode,
    reviewerVerdictPath: path.relative(runDir, artifactPath),
    inferenceUnitResultPath: path.relative(runDir, unit.resultPath),
    inferenceUnitValidationPath: path.relative(runDir, unit.validationPath),
  });

  return {
    input,
    inputPath,
    artifact,
    artifactPath,
    verdict,
    inferenceUnit: unit,
  };
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (command !== 'review') {
    throw new Error('usage: living-doc-harness-reviewer-inference.mjs review <runDir> --evidence <evidence.json> [--iteration <n>] [--verdict <verdict.json>] [--execute-reviewer]');
  }
  const runDir = args.shift();
  if (!runDir) throw new Error('review requires <runDir>');
  const options = {
    runDir,
    evidencePath: null,
    iteration: 1,
    reviewerVerdictPath: null,
    executeReviewer: false,
    codexBin: 'codex',
    cwd: process.cwd(),
  };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--evidence') {
      options.evidencePath = args.shift();
    } else if (flag === '--iteration') {
      options.iteration = Number(args.shift());
    } else if (flag === '--verdict') {
      options.reviewerVerdictPath = args.shift();
    } else if (flag === '--execute-reviewer') {
      options.executeReviewer = true;
    } else if (flag === '--codex-bin') {
      options.codexBin = args.shift();
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  if (!options.evidencePath) throw new Error('--evidence is required');
  return options;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const evidence = await readJson(options.evidencePath);
    const result = await writeReviewerInferenceVerdict({ ...options, evidence });
    console.log(JSON.stringify({
      schema: 'living-doc-harness-reviewer-result/v1',
      reviewerVerdictPath: result.artifactPath,
      classification: result.verdict.stopVerdict.classification,
    }, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
