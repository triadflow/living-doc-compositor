// One-step iteration finalizer for the standalone living-doc harness.
//
// This is the operator command that stitches a completed worker run into the
// durable harness state. It consumes explicit evidence, infers the stop verdict,
// routes skill/repair handover, writes terminal state, emits iteration proof,
// writes sanitized evidence, and refreshes the local dashboard.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferStopNegotiation } from './living-doc-harness-stop-negotiation.mjs';
import { routeStopVerdict } from './living-doc-harness-skill-router.mjs';
import { writeTerminalState } from './living-doc-harness-terminal-state.mjs';
import { renderDashboard, writeEvidenceBundle } from './living-doc-harness-evidence-dashboard.mjs';
import { attachTraceSummaryToRun } from './living-doc-harness-trace-reader.mjs';
import { validateHarnessContract } from './validate-living-doc-harness-contract.mjs';

const __filename = fileURLToPath(import.meta.url);

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function appendJsonl(filePath, event) {
  await writeFile(filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
}

async function fileHash(filePath, fallback = null) {
  if (!filePath) return fallback;
  try {
    return sha256(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function skillsAppliedFromRouting(routing) {
  return (routing.actions || [])
    .filter((action) => action.kind === 'skill')
    .map((action) => ({
      skill: action.skill,
      verdict: action.status,
      patchRefs: [],
    }));
}

function proofGatesAfterBundle(evidence) {
  const nativeRefs = evidence.workerEvidence?.nativeInferenceTraceRefs || [];
  return {
    ...(evidence.proofGates || {}),
    nativeTraceInspected: nativeRefs.length > 0 ? 'pass' : evidence.proofGates?.nativeTraceInspected,
    evidenceBundleWritten: 'pass',
  };
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function nativeTraceRefsFromContract(contract) {
  return arr(contract.artifacts?.nativeTraceRefs)
    .map((ref) => ref.summaryPath)
    .filter(Boolean);
}

export async function writeIterationEvidenceTemplate({
  runDir,
  outPath = null,
  tracePaths = [],
  stageBefore = null,
  stageAfter = 'stopped',
  unresolvedObjectiveTerms = [],
  unprovenAcceptanceCriteria = [],
  finalMessageSummary = 'Not supplied; inspect native trace and worker output before closing.',
  toolFailures = [],
  filesChanged = [],
  acceptanceCriteriaSatisfied = 'pending',
  closureAllowed = false,
  now = new Date().toISOString(),
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  for (const tracePath of tracePaths) {
    await attachTraceSummaryToRun({ runDir, tracePath, now });
  }
  const contract = await readJson(path.join(runDir, 'contract.json'));
  let state = {};
  try {
    state = await readJson(path.join(runDir, 'state.json'));
  } catch {
    state = {};
  }
  const nativeRefs = nativeTraceRefsFromContract(contract);
  const evidence = {
    schema: 'living-doc-harness-iteration-evidence/v1',
    runId: contract.runId || state.runId || path.basename(runDir),
    createdAt: now,
    objectiveState: {
      objectiveHash: contract.livingDoc?.objectiveHash || state.objectiveHash || null,
      stageBefore: stageBefore || state.lifecycleStage || 'unknown',
      stageAfter,
      unresolvedObjectiveTerms,
      unprovenAcceptanceCriteria,
    },
    workerEvidence: {
      nativeInferenceTraceRefs: nativeRefs,
      wrapperLogRefs: [
        contract.artifacts?.codexEvents,
        contract.artifacts?.codexStderr,
        contract.artifacts?.lastMessage,
      ].filter(Boolean),
      finalMessageSummary,
      toolFailures,
      filesChanged,
    },
    proofGates: {
      standaloneRun: contract.process?.isolatedFromUserSession === true ? 'pass' : 'fail',
      nativeTraceInspected: nativeRefs.length > 0 ? 'pass' : 'pending',
      livingDocRendered: contract.livingDoc?.renderedHtml ? 'pass' : 'pending',
      acceptanceCriteriaSatisfied,
      evidenceBundleWritten: 'pending',
      closureAllowed,
    },
  };
  const target = outPath || path.join(runDir, 'artifacts', 'iteration-evidence-template.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeJson(target, evidence);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'iteration-evidence-template-written',
    at: now,
    runId: evidence.runId,
    path: path.relative(runDir, target),
    unresolvedObjectiveTerms: unresolvedObjectiveTerms.length,
    unprovenAcceptanceCriteria: unprovenAcceptanceCriteria.length,
  });
  return { evidence, evidencePath: target };
}

async function attachNativeTraces({ runDir, evidence, tracePaths, now }) {
  if (!tracePaths.length) return evidence;
  const attachedRefs = [];
  for (const tracePath of tracePaths) {
    const attached = await attachTraceSummaryToRun({ runDir, tracePath, now });
    attachedRefs.push(attached.traceRef.summaryPath);
  }
  const existingRefs = evidence.workerEvidence?.nativeInferenceTraceRefs || [];
  return {
    ...evidence,
    workerEvidence: {
      ...(evidence.workerEvidence || {}),
      nativeInferenceTraceRefs: [...new Set([...existingRefs, ...attachedRefs])],
    },
  };
}

async function buildIterationProof({ runDir, evidence, verdict, routing, livingDocPath, afterDocPath, iteration, now }) {
  const contract = await readJson(path.join(runDir, 'contract.json'));
  const afterHash = await fileHash(afterDocPath || livingDocPath, contract.livingDoc?.sourceHash || null);
  return {
    schema: 'living-doc-harness-iteration-proof/v1',
    runId: contract.runId || evidence.runId,
    iteration,
    createdAt: now,
    livingDoc: {
      sourcePath: contract.livingDoc?.sourcePath || livingDocPath || '',
      beforeHash: contract.livingDoc?.sourceHash || await fileHash(livingDocPath),
      afterHash,
      renderedHtml: contract.livingDoc?.renderedHtml || String(afterDocPath || livingDocPath || '').replace(/\.json$/i, '.html'),
    },
    objectiveState: evidence.objectiveState,
    workerEvidence: evidence.workerEvidence,
    stopVerdict: verdict.stopVerdict,
    skillsApplied: skillsAppliedFromRouting(routing),
    proofGates: proofGatesAfterBundle(evidence),
    nextIteration: verdict.nextIteration,
    ...(verdict.terminal ? { terminal: verdict.terminal } : {}),
  };
}

export async function finalizeHarnessIteration({
  runDir,
  evidencePath,
  livingDocPath = null,
  afterDocPath = null,
  iteration = 1,
  now = new Date().toISOString(),
  render = true,
  evidenceDir = 'evidence/living-doc-harness',
  dashboardPath = 'docs/living-doc-harness-dashboard.html',
  runsDir = null,
  tracePaths = [],
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!evidencePath) throw new Error('evidencePath is required');
  const evidence = await readJson(evidencePath);
  const traceEnrichedEvidence = await attachNativeTraces({
    runDir,
    evidence,
    tracePaths,
    now,
  });
  const finalEvidence = {
    ...traceEnrichedEvidence,
    proofGates: proofGatesAfterBundle(traceEnrichedEvidence),
  };
  const artifactsDir = path.join(runDir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });

  const verdict = inferStopNegotiation(finalEvidence);
  const evidenceSnapshotPath = path.join(artifactsDir, `iteration-${iteration}-evidence.json`);
  const verdictPath = path.join(artifactsDir, `iteration-${iteration}-stop-verdict.json`);
  await writeJson(evidenceSnapshotPath, finalEvidence);
  await writeJson(verdictPath, verdict);

  const routed = await routeStopVerdict({
    verdict,
    evidence: finalEvidence,
    runDir,
    livingDocPath,
    afterDocPath,
    iteration,
    now,
    render,
  });
  const terminal = await writeTerminalState({
    runDir,
    verdict,
    evidence: finalEvidence,
    iteration,
    now,
  });
  const bundleResult = await writeEvidenceBundle({ runDir, outDir: evidenceDir, now });
  const proof = await buildIterationProof({
    runDir,
    evidence: finalEvidence,
    verdict,
    routing: routed.routing,
    livingDocPath,
    afterDocPath,
    iteration,
    now,
  });
  const proofValidation = validateHarnessContract(proof);
  const proofPath = path.join(artifactsDir, `iteration-${iteration}-proof.json`);
  const proofValidationPath = path.join(artifactsDir, `iteration-${iteration}-proof-validation.json`);
  await writeJson(proofPath, proof);
  await writeJson(proofValidationPath, proofValidation);

  const dashboard = await renderDashboard({
    runsDir: runsDir || path.dirname(runDir),
    evidenceDir,
    outPath: dashboardPath,
    now,
  });
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'harness-iteration-finalized',
    at: now,
    runId: evidence.runId || proof.runId,
    iteration,
    classification: verdict.stopVerdict.classification,
    terminalKind: terminal.record.kind,
    evidenceBundle: path.relative(runDir, bundleResult.bundlePath),
    dashboardPath,
    proofValid: proofValidation.ok,
  });

  return {
    schema: 'living-doc-harness-iteration-finalization/v1',
    runId: proof.runId,
    runDir,
    iteration,
    classification: verdict.stopVerdict.classification,
    terminalKind: terminal.record.kind,
    nextIteration: verdict.nextIteration,
    verdictPath,
    handoverPath: routed.handoverPath,
    terminalPath: terminal.terminalPath,
    blockerPath: terminal.blockerPath,
    bundlePath: bundleResult.bundlePath,
    summaryPath: bundleResult.summaryPath,
    proofPath,
    proofValidationPath,
    proofValid: proofValidation.ok,
    dashboardPath: dashboard.outPath,
  };
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!['finalize', 'evidence-template'].includes(command)) {
    throw new Error('usage: living-doc-harness-iteration.mjs <evidence-template|finalize> <runDir> ...');
  }
  const options = {
    command,
    runDir: args.shift(),
    evidencePath: null,
    livingDocPath: null,
    afterDocPath: null,
    iteration: 1,
    render: true,
    evidenceDir: 'evidence/living-doc-harness',
    dashboardPath: 'docs/living-doc-harness-dashboard.html',
    runsDir: null,
    tracePaths: [],
    outPath: null,
    stageBefore: null,
    stageAfter: 'stopped',
    unresolvedObjectiveTerms: [],
    unprovenAcceptanceCriteria: [],
    finalMessageSummary: 'Not supplied; inspect native trace and worker output before closing.',
    toolFailures: [],
    filesChanged: [],
    acceptanceCriteriaSatisfied: 'pending',
    closureAllowed: false,
  };
  if (!options.runDir) throw new Error(`${command} requires <runDir>`);
  while (args.length) {
    const flag = args.shift();
    if (flag === '--evidence') {
      options.evidencePath = args.shift();
      if (!options.evidencePath) throw new Error('--evidence requires a value');
    } else if (flag === '--trace') {
      const tracePath = args.shift();
      if (!tracePath) throw new Error('--trace requires a value');
      options.tracePaths.push(tracePath);
    } else if (flag === '--living-doc') {
      options.livingDocPath = args.shift();
      if (!options.livingDocPath) throw new Error('--living-doc requires a value');
    } else if (flag === '--after-doc') {
      options.afterDocPath = args.shift();
      if (!options.afterDocPath) throw new Error('--after-doc requires a value');
    } else if (flag === '--iteration') {
      options.iteration = Number(args.shift());
      if (!Number.isInteger(options.iteration) || options.iteration < 1) throw new Error('--iteration requires an integer >= 1');
    } else if (flag === '--no-render') {
      options.render = false;
    } else if (flag === '--evidence-dir') {
      options.evidenceDir = args.shift();
      if (!options.evidenceDir) throw new Error('--evidence-dir requires a value');
    } else if (flag === '--dashboard') {
      options.dashboardPath = args.shift();
      if (!options.dashboardPath) throw new Error('--dashboard requires a value');
    } else if (flag === '--runs-dir') {
      options.runsDir = args.shift();
      if (!options.runsDir) throw new Error('--runs-dir requires a value');
    } else if (flag === '--out') {
      options.outPath = args.shift();
      if (!options.outPath) throw new Error('--out requires a value');
    } else if (flag === '--stage-before') {
      options.stageBefore = args.shift();
      if (!options.stageBefore) throw new Error('--stage-before requires a value');
    } else if (flag === '--stage-after') {
      options.stageAfter = args.shift();
      if (!options.stageAfter) throw new Error('--stage-after requires a value');
    } else if (flag === '--unresolved') {
      const value = args.shift();
      if (!value) throw new Error('--unresolved requires a value');
      options.unresolvedObjectiveTerms.push(value);
    } else if (flag === '--unproven') {
      const value = args.shift();
      if (!value) throw new Error('--unproven requires a value');
      options.unprovenAcceptanceCriteria.push(value);
    } else if (flag === '--final-summary') {
      options.finalMessageSummary = args.shift();
      if (!options.finalMessageSummary) throw new Error('--final-summary requires a value');
    } else if (flag === '--tool-failure') {
      const value = args.shift();
      if (!value) throw new Error('--tool-failure requires a value');
      options.toolFailures.push(value);
    } else if (flag === '--file-changed') {
      const value = args.shift();
      if (!value) throw new Error('--file-changed requires a value');
      options.filesChanged.push(value);
    } else if (flag === '--acceptance-pass') {
      options.acceptanceCriteriaSatisfied = 'pass';
    } else if (flag === '--acceptance-fail') {
      options.acceptanceCriteriaSatisfied = 'fail';
    } else if (flag === '--closure-allowed') {
      options.closureAllowed = true;
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  if (command === 'finalize' && !options.evidencePath) throw new Error('--evidence is required');
  return options;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.command === 'evidence-template'
      ? await writeIterationEvidenceTemplate(options)
      : await finalizeHarnessIteration(options);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.proofValid === false ? 1 : 0);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
