#!/usr/bin/env node
// Lifecycle controller for the standalone living-doc harness.
//
// This is the output-input channel between iterations. It consumes one
// iteration's durable output, writes the next controlled input, and starts the
// next worker iteration when the stop verdict allows repair or resume.

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHarnessRun } from './living-doc-harness-runner.mjs';
import { finalizeHarnessIteration, writeIterationEvidenceTemplate } from './living-doc-harness-iteration.mjs';
import { loadProofRoutesFromDoc, runProofRoutes } from './living-doc-harness-proof-route.mjs';
import { DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES, normalizeAllowedInferenceUnitTypes } from './living-doc-harness-inference-unit-types.mjs';
import { runContractBoundInferenceUnit } from './living-doc-harness-inference-unit.mjs';

const __filename = fileURLToPath(import.meta.url);

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

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function appendJsonl(filePath, event) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
}

async function fileHash(filePath) {
  try {
    return sha256(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
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
  const mode = ['none', 'user-stop'].includes(finalization.nextIteration?.mode)
    ? 'continuation'
    : finalization.nextIteration?.mode || 'continuation';
  return {
    mode,
    previousRunId: finalization.runId,
    previousIteration: finalization.iteration,
    instruction: finalization.nextIteration?.instruction || 'Continue from the previous non-closure state until the living-doc objective is reached.',
    handoverPath: finalization.handoverPath ? path.relative(process.cwd(), finalization.handoverPath) : null,
    repairSkillResultPath: finalization.repairSkillResultPath ? path.relative(process.cwd(), finalization.repairSkillResultPath) : null,
    outputInputPath: path.relative(process.cwd(), outputInputPath),
  };
}

function lifecycleMayStop(finalization) {
  return finalization.terminalKind === 'closed' || finalization.terminalKind === 'user-stopped';
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
      verdictPath: path.relative(runDir, finalization.verdictPath),
      reviewerVerdictPath: finalization.reviewerVerdictPath ? path.relative(runDir, finalization.reviewerVerdictPath) : null,
      proofPath: path.relative(runDir, finalization.proofPath),
      handoverPath: finalization.handoverPath ? path.relative(runDir, finalization.handoverPath) : null,
      terminalPath: path.relative(runDir, finalization.terminalPath),
      bundlePath: path.relative(process.cwd(), finalization.bundlePath),
      postReviewSelectionPath: finalization.postReviewSelectionPath ? path.relative(runDir, finalization.postReviewSelectionPath) : null,
    },
    postReviewSelection: finalization.postReviewSelection ? {
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
  now,
  proofRouteBundle = null,
}) {
  const sourceState = await deriveSourceStateEvidence({ docPath, cwd });
  const sourceClosureAllowed = sourceState?.closureAllowed === true;
  const sourceUnprovenCriteria = sourceState ? sourceState.incompleteCriteria : [];
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
    filesChanged: hasOwn(plan, 'filesChanged') ? arr(plan.filesChanged) : [docPath, sourceState?.renderedHtml].filter(Boolean),
    acceptanceCriteriaSatisfied: plan.acceptanceCriteriaSatisfied || (sourceClosureAllowed ? 'pass' : 'pending'),
    closureAllowed: hasOwn(plan, 'closureAllowed') ? plan.closureAllowed === true : sourceClosureAllowed,
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
    ...(hasOwn(plan, 'sourceFilesChanged') ? { sourceFilesChanged: plan.sourceFilesChanged === true } : {}),
    ...(plan.sideEffectEvidence ? { sideEffectEvidence: plan.sideEffectEvidence } : {}),
    ...(hasOwn(plan, 'prReviewRequired') ? { prReviewRequired: plan.prReviewRequired === true } : {}),
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
    proofPath: path.relative(runDir, finalization.proofPath),
    lifecycleResultPath: null,
    requiredInspectionPaths: [finalization.terminalPath, finalization.proofPath],
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
    prompt: `Write a post-flight summary from the closed run artifacts.\n\n${JSON.stringify(input, null, 2)}`,
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
} = {}) {
  if (!docPath) throw new Error('docPath is required');

  const evidenceSequence = await loadEvidenceSequence(evidenceSequencePath);
  const reviewerSequence = reviewerVerdictSequence || evidenceSequence.map((item) => item?.reviewerVerdict || null);
  const absoluteRunsDir = path.resolve(cwd, runsDir);
  const absoluteEvidenceDir = path.resolve(cwd, evidenceDir);
  const absoluteDashboardPath = path.resolve(cwd, dashboardPath);
  const normalizedAllowedUnitTypes = normalizeAllowedInferenceUnitTypes(allowedUnitTypes);
  const resultId = `ldhl-${timestampForId(now)}-${path.basename(docPath, '.json').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  const lifecycleDir = path.join(absoluteRunsDir, resultId);
  await mkdir(lifecycleDir, { recursive: true });

  const iterations = [];
  let lifecycleInput = null;
  let finalState = null;
  let lastEvidence = null;
  const docProofRoutes = proofRoutes || await loadProofRoutesFromDoc(docPath, { cwd });

  for (let iteration = 1; ; iteration += 1) {
    const iterationNow = addMs(now, iteration * 1000);
    const plan = evidenceSequence[iteration - 1] || {};
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
    });
    const iterationProofRoutes = arr(plan.proofRoutes).length ? plan.proofRoutes : docProofRoutes;
    const proofRouteBundle = executeProofRoutes && iterationProofRoutes.length
      ? await runProofRoutes({
        runDir: run.runDir,
        iteration,
        routes: iterationProofRoutes,
        cwd,
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
      now: addMs(iterationNow, 250),
      proofRouteBundle,
    });
    lastEvidence = evidence;
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
    });

    const mayStop = lifecycleMayStop(finalization);
    const nextAction = !mayStop
      ? {
        action: 'start-next-worker-iteration',
        allowed: true,
        reason: finalization.nextIteration?.instruction || 'Non-closure verdict requires continuation inference.',
      }
      : {
        action: 'stop-terminal-state',
        allowed: false,
        reason: finalization.terminalKind === 'closed'
          ? 'Objective closure reached.'
          : 'User explicitly stopped the lifecycle.',
      };

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
      reviewerVerdictPath: finalization.reviewerVerdictPath,
      repairSkillResultPath: finalization.repairSkillResultPath,
      closureReviewResultPath: finalization.closureReviewResultPath,
      postReviewSelectionPath: finalization.postReviewSelectionPath,
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
      const postFlight = finalization.terminalKind === 'closed'
        ? await runPostFlightSummaryUnit({
          runDir: run.runDir,
          runId: run.runId,
          iteration,
          finalization,
          now: addMs(iterationNow, 850),
          cwd,
          allowedUnitTypes: normalizedAllowedUnitTypes,
        })
        : null;
      finalState = {
        kind: finalization.terminalKind,
        reason: nextAction.reason,
        runId: run.runId,
        postFlightSummaryPath: postFlight?.summaryPath ? path.relative(cwd, postFlight.summaryPath) : null,
        postFlightUnitResultPath: postFlight?.unit?.resultPath ? path.relative(cwd, postFlight.unit.resultPath) : null,
      };
      break;
    }

    lifecycleInput = {
      ...nextInput,
      outputInputPath: path.relative(cwd, outputInput.outputInputPath),
    };
  }

  const result = {
    schema: 'living-doc-harness-lifecycle-result/v1',
    resultId,
    createdAt: now,
    docPath,
    docHash: await fileHash(path.resolve(cwd, docPath)),
    lifecycleDir,
    iterationCount: iterations.length,
    finalState: finalState || {
      kind: 'unknown',
      reason: 'loop ended without final state',
      runId: iterations.at(-1)?.runId || null,
    },
    iterations: iterations.map((item) => ({
      ...item,
      runDir: path.relative(cwd, item.runDir),
      outputInputPath: path.relative(cwd, item.outputInputPath),
      reviewerVerdictPath: path.relative(cwd, item.reviewerVerdictPath),
      repairSkillResultPath: item.repairSkillResultPath ? path.relative(cwd, item.repairSkillResultPath) : null,
      closureReviewResultPath: item.closureReviewResultPath ? path.relative(cwd, item.closureReviewResultPath) : null,
      postReviewSelectionPath: item.postReviewSelectionPath ? path.relative(cwd, item.postReviewSelectionPath) : null,
    })),
    lastEvidenceSummary: lastEvidence ? {
      unresolvedObjectiveTerms: arr(lastEvidence.objectiveState?.unresolvedObjectiveTerms).length,
      unprovenAcceptanceCriteria: arr(lastEvidence.objectiveState?.unprovenAcceptanceCriteria).length,
      nativeTraceRefs: arr(lastEvidence.workerEvidence?.nativeInferenceTraceRefs).length,
    } : null,
  };
  const resultPath = path.join(lifecycleDir, 'lifecycle-result.json');
  await writeJson(resultPath, result);
  await appendJsonl(path.join(lifecycleDir, 'events.jsonl'), {
    event: 'lifecycle-result-written',
    at: addMs(now, (iterations.length + 1) * 1000),
    resultId,
    finalState: result.finalState,
    iterationCount: iterations.length,
  });
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
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  if (options.executeReviewer == null) options.executeReviewer = options.execute;
  if (options.executeClosureReview == null) options.executeClosureReview = options.executeReviewer;
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
