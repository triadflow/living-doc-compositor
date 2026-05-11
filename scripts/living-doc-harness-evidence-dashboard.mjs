// Evidence bundle writer and local dashboard renderer for harness runs.
//
// Reads durable run artifacts and emits sanitized proof summaries. Raw Codex
// traces, wrapper logs, prompts, and message content are never copied into the
// evidence bundle or dashboard.

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readJsonl(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function listFiles(dir, predicate = () => true) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && predicate(entry.name)).map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

async function listFilesRecursive(dir, predicate = () => true) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await listFilesRecursive(entryPath, predicate));
      } else if (entry.isFile() && predicate(entry.name, entryPath)) {
        files.push(entryPath);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function listDirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

function latestByCreatedAt(items) {
  return [...items].sort((a, b) => String(b.createdAt || b.at || '').localeCompare(String(a.createdAt || a.at || '')))[0] || null;
}

function iterationFromName(filePath) {
  const match = path.basename(filePath || '').match(/^iteration-(\d+)-/);
  return match ? Number(match[1]) : 0;
}

function latestByIteration(files) {
  return [...files].sort((a, b) => iterationFromName(b) - iterationFromName(a) || path.basename(b).localeCompare(path.basename(a)))[0] || null;
}

function relative(runDir, filePath) {
  return filePath ? path.relative(runDir, filePath) : null;
}

function deriveRecommendation({ state, terminal, handover }) {
  const stage = terminal?.kind || state?.lifecycleStage || '';
  if (stage === 'closed') return 'close';
  if (stage === 'user-stopped') return 'user-stop';
  if (stage === 'continuation-required') return 'continuation';
  if (stage === 'repair-resumed') return 'resume';
  if (handover?.nextIteration?.mode) return handover.nextIteration.mode;
  if (state?.status === 'prepared') return 'resume';
  return 'inspect';
}

function proofGates({ contract, state, terminal, handover, traceRefs, skillInvocations, blockers }) {
  return {
    standaloneRun: contract?.process?.isolatedFromUserSession === true ? 'pass' : 'fail',
    nativeTrace: traceRefs.length > 0 ? 'pass' : 'fail',
    livingDocRendered: handover?.livingDoc?.render?.status === 0 || Boolean(contract?.livingDoc?.renderedHtml) ? 'pass' : 'pending',
    skillRouting: skillInvocations.length > 0 || Boolean(handover?.actions?.length) ? 'pass' : 'pending',
    terminalState: terminal ? 'pass' : 'pending',
    blockersVisible: blockers.length > 0 ? 'pass' : terminal?.stopVerdict?.classification === 'true-block' ? 'fail' : 'not-applicable',
    evidenceBundle: 'pass',
    closureAllowed: terminal?.kind === 'closed' ? 'pass' : 'not-applicable',
    lifecycleStage: state?.lifecycleStage || terminal?.kind || 'unknown',
  };
}

export async function collectRunEvidence(runDir) {
  const contract = await readJson(path.join(runDir, 'contract.json'), {});
  const state = await readJson(path.join(runDir, 'state.json'), {});
  const events = await readJsonl(path.join(runDir, 'events.jsonl'));
  const blockers = await readJsonl(path.join(runDir, 'blockers.jsonl'));
  const terminalStates = await readJsonl(path.join(runDir, 'terminal-states.jsonl'));
  const skillInvocations = await readJsonl(path.join(runDir, 'skill-invocations.jsonl'));
  const handoverFiles = await listFiles(path.join(runDir, 'handovers'), (name) => name.endsWith('.json'));
  const handovers = [];
  for (const file of handoverFiles) {
    const handover = await readJson(file);
    if (handover) handovers.push({ ...handover, artifactPath: relative(runDir, file) });
  }
  const traceFiles = await listFiles(path.join(runDir, 'traces'), (name) => name.endsWith('.summary.json'));
  const proofFiles = await listFiles(path.join(runDir, 'artifacts'), (name) => /^iteration-\d+-proof\.json$/.test(name));
  const verdictFiles = await listFiles(path.join(runDir, 'artifacts'), (name) => /^iteration-\d+-stop-verdict\.json$/.test(name));
  const reviewerFiles = await listFiles(path.join(runDir, 'reviewer-inference'), (name) => /^iteration-\d+-verdict\.json$/.test(name));
  const inferenceUnitResultFiles = await listFilesRecursive(path.join(runDir, 'inference-units'), (name) => name === 'result.json');
  const repairIterationDirs = await listDirs(path.join(runDir, 'repair-skills'));
  const repairChainFiles = [];
  for (const dir of repairIterationDirs) {
    const chain = path.join(dir, 'repair-chain-result.json');
    if (await exists(chain)) repairChainFiles.push(chain);
  }
  const traceSummaries = [];
  for (const file of traceFiles) {
    const summary = await readJson(file);
    if (summary) {
      traceSummaries.push({
        summaryPath: relative(runDir, file),
        traceHash: summary.traceHash,
        lineCount: summary.lineCount,
        firstTimestamp: summary.firstTimestamp,
        lastTimestamp: summary.lastTimestamp,
        eventTypes: summary.eventTypes || {},
        payloadTypes: summary.payloadTypes || {},
        privacy: summary.privacy || {},
      });
    }
  }

  const latestTerminal = latestByCreatedAt(terminalStates);
  const latestHandover = latestByCreatedAt(handovers);
  const latestProofPath = latestByIteration(proofFiles);
  const latestVerdictPath = latestByIteration(verdictFiles);
  const latestReviewerPath = latestByIteration(reviewerFiles);
  const latestRepairChainPath = latestByIteration(repairChainFiles);
  const latestProof = latestProofPath ? await readJson(latestProofPath) : null;
  const latestVerdict = latestVerdictPath ? await readJson(latestVerdictPath) : null;
  const latestReviewerVerdict = latestReviewerPath ? await readJson(latestReviewerPath) : null;
  const latestRepairChain = latestRepairChainPath ? await readJson(latestRepairChainPath) : null;
  const inferenceUnits = [];
  for (const file of inferenceUnitResultFiles) {
    const result = await readJson(file);
    if (!result) continue;
    inferenceUnits.push({
      unitId: result.unitId,
      role: result.role,
      status: result.status,
      mode: result.mode,
      sequence: result.sequence,
      iteration: result.iteration,
      resultPath: relative(runDir, file),
      inputContractPath: result.inputContractPath,
      promptPath: result.promptPath,
      allowedNextUnitTypes: result.unitType?.allowedNextUnitTypes || [],
      deterministicSideEffects: result.unitType?.deterministicSideEffects || [],
      dashboard: result.unitType?.dashboard || null,
      closureImplications: result.unitType?.closureImplications || null,
    });
  }
  inferenceUnits.sort((a, b) => (a.iteration - b.iteration) || (a.sequence - b.sequence) || String(a.unitId).localeCompare(String(b.unitId)));
  const traceRefs = [
    ...(contract?.artifacts?.nativeTraceRefs || []),
    ...traceSummaries.map((summary) => ({
      summaryPath: summary.summaryPath,
      traceHash: summary.traceHash,
      lineCount: summary.lineCount,
      rawPayloadIncluded: false,
    })),
  ];
  const uniqueTraceRefs = [...new Map(traceRefs.filter(Boolean).map((ref) => [ref.traceHash || ref.summaryPath, ref])).values()];
  const gates = proofGates({ contract, state, terminal: latestTerminal, handover: latestHandover, traceRefs: uniqueTraceRefs, skillInvocations, blockers });
  const recommendation = deriveRecommendation({ state, terminal: latestTerminal, handover: latestHandover });

  return {
    schema: 'living-doc-harness-evidence-facts/v1',
    runDir,
    runId: contract.runId || state.runId || path.basename(runDir),
    contract,
    state,
    events,
    blockers,
    terminalState: latestTerminal,
    terminalStates,
    skillInvocations,
    handover: latestHandover,
    handovers,
    latestProof,
    latestProofPath: relative(runDir, latestProofPath),
    latestVerdict,
    latestVerdictPath: relative(runDir, latestVerdictPath),
    latestReviewerVerdict,
    latestReviewerVerdictPath: relative(runDir, latestReviewerPath),
    latestRepairChain,
    latestRepairChainPath: relative(runDir, latestRepairChainPath),
    inferenceUnits,
    traceRefs: uniqueTraceRefs,
    traceSummaries,
    proofGates: gates,
    prReviewPolicy: contract.runConfig?.prReviewPolicy || latestProof?.prReviewPolicy || null,
    prReviewRequired: latestProof?.prReviewRequired === true || latestProof?.requiredHardFacts?.prReviewRequired === true,
    prReviewEvidencePresent: latestProof?.requiredHardFacts?.prReviewEvidencePresent === true,
    recommendation,
  };
}

export async function writeEvidenceBundle({
  runDir,
  outDir = 'evidence/living-doc-harness',
  now = new Date().toISOString(),
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  const facts = await collectRunEvidence(runDir);
  const bundleDir = path.join(outDir, facts.runId);
  await mkdir(bundleDir, { recursive: true });

  const bundle = {
    schema: 'living-doc-harness-evidence-bundle/v1',
    generatedAt: now,
    runId: facts.runId,
    runDirHash: sha256(path.resolve(runDir)),
    objectiveHash: facts.contract?.livingDoc?.objectiveHash || facts.state?.objectiveHash || null,
    sourceHash: facts.contract?.livingDoc?.sourceHash || null,
    lifecycleStage: facts.state?.lifecycleStage || facts.terminalState?.kind || 'unknown',
    status: facts.state?.status || facts.contract?.status || 'unknown',
    recommendation: facts.recommendation,
    proofGates: facts.proofGates,
    prReviewPolicy: facts.prReviewPolicy,
    prReviewGate: {
      required: facts.prReviewRequired === true,
      evidencePresent: facts.prReviewEvidencePresent === true,
      state: facts.prReviewPolicy?.mode === 'disabled'
        ? 'disabled'
        : facts.prReviewRequired === true
          ? facts.prReviewEvidencePresent === true ? 'satisfied' : 'blocking'
          : 'not-required',
    },
    reviewerVerdict: facts.latestReviewerVerdict ? {
      path: facts.latestReviewerVerdictPath,
      mode: facts.latestReviewerVerdict.mode,
      inputPath: facts.latestReviewerVerdict.reviewerInputPath,
      classification: facts.latestReviewerVerdict.verdict?.stopVerdict?.classification || null,
      reasonCode: facts.latestReviewerVerdict.verdict?.stopVerdict?.reasonCode || null,
      closureAllowed: facts.latestReviewerVerdict.verdict?.stopVerdict?.closureAllowed === true,
    } : null,
    stopVerdict: facts.terminalState?.stopVerdict || facts.latestReviewerVerdict?.verdict?.stopVerdict || facts.latestVerdict?.stopVerdict || facts.handover?.stopVerdict || null,
    stopMismatch: facts.latestVerdict?.mismatch || facts.handover?.mismatch || null,
    objectiveRef: {
      sourcePath: facts.contract?.livingDoc?.sourcePath || facts.state?.docPath || null,
      renderedHtml: facts.contract?.livingDoc?.renderedHtml || null,
      objectiveHash: facts.contract?.livingDoc?.objectiveHash || facts.state?.objectiveHash || null,
      sourceHash: facts.contract?.livingDoc?.sourceHash || null,
    },
    terminalState: facts.terminalState ? {
      kind: facts.terminalState.kind,
      status: facts.terminalState.status,
      loopMayContinue: facts.terminalState.loopMayContinue,
      blockerRef: facts.terminalState.blockerRef,
      nextAction: facts.terminalState.nextAction,
    } : null,
    blockers: facts.blockers.map((blocker) => ({
      id: blocker.id,
      reasonCode: blocker.reasonCode,
      owningLayer: blocker.owningLayer,
      requiredDecision: blocker.requiredDecision,
      requiredSource: blocker.requiredSource,
      requiredProof: blocker.requiredProof,
      issueRef: blocker.issueRef,
      followUpRef: blocker.followUpRef,
      unblockCriteria: blocker.unblockCriteria,
      dashboardVisible: blocker.dashboardVisible === true,
    })),
    skillTimeline: facts.skillInvocations.map((item) => ({
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
    repairSkillChain: facts.latestRepairChain ? {
      path: facts.latestRepairChainPath,
      status: facts.latestRepairChain.status,
      orderedSkills: facts.latestRepairChain.balanceScan?.orderedSkills || [],
      resultCount: facts.latestRepairChain.skillResults?.length || 0,
    } : null,
    inferenceUnits: facts.inferenceUnits,
    traceRefs: facts.traceRefs.map((ref) => ({
      summaryPath: ref.summaryPath || null,
      traceHash: ref.traceHash || null,
      lineCount: ref.lineCount || null,
      firstTimestamp: ref.firstTimestamp || null,
      lastTimestamp: ref.lastTimestamp || null,
      rawPayloadIncluded: false,
    })),
    renderedDocRefs: [
      facts.contract?.livingDoc?.renderedHtml,
      facts.handover?.livingDoc?.render?.renderedHtml,
    ].filter(Boolean),
    artifacts: {
      contract: 'contract.json',
      state: 'state.json',
      events: 'events.jsonl',
      terminalStates: facts.terminalStates.length ? 'terminal-states.jsonl' : null,
      blockers: facts.blockers.length ? 'blockers.jsonl' : null,
      skillInvocations: facts.skillInvocations.length ? 'skill-invocations.jsonl' : null,
      latestHandover: facts.handover?.artifactPath || null,
      latestProof: facts.latestProofPath || null,
      latestStopVerdict: facts.latestVerdictPath || null,
      latestReviewerVerdict: facts.latestReviewerVerdictPath || null,
      latestRepairSkillChain: facts.latestRepairChainPath || null,
      evidenceBundle: path.join(facts.runId, 'bundle.json'),
      evidenceSummary: path.join(facts.runId, 'summary.md'),
    },
    privacy: {
      rawPromptIncluded: false,
      rawWrapperLogIncluded: false,
      rawNativeTraceIncluded: false,
      rawMessageContentIncluded: false,
      sanitizedTraceSummariesOnly: true,
    },
  };

  const summary = [
    `# Harness Evidence Bundle: ${facts.runId}`,
    '',
    `Generated: ${now}`,
    `Lifecycle stage: ${bundle.lifecycleStage}`,
    `Recommendation: ${bundle.recommendation}`,
    `PR review policy: ${bundle.prReviewPolicy?.mode || 'unknown'} (${bundle.prReviewGate.state})`,
    `Objective hash: ${bundle.objectiveHash || 'missing'}`,
    '',
    '## Gates',
    ...Object.entries(bundle.proofGates).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Stop',
    `- classification: ${bundle.stopVerdict?.classification || 'none'}`,
    `- reason: ${bundle.stopVerdict?.reasonCode || 'none'}`,
    `- reviewer verdict: ${bundle.reviewerVerdict?.path || 'missing'}`,
    '',
    '## Privacy',
    '- raw prompt included: false',
    '- raw wrapper log included: false',
    '- raw native trace included: false',
    '- raw message content included: false',
    '',
  ].join('\n');

  const bundlePath = path.join(bundleDir, 'bundle.json');
  const summaryPath = path.join(bundleDir, 'summary.md');
  await writeJson(bundlePath, bundle);
  await writeFile(summaryPath, summary, 'utf8');
  return { bundle, bundlePath, summaryPath };
}

function renderRunCard(bundle) {
  const gates = Object.entries(bundle.proofGates || {})
    .map(([key, value]) => `<span class="gate gate-${esc(value)}">${esc(key)}: ${esc(value)}</span>`)
    .join('');
  const blockers = (bundle.blockers || [])
    .map((blocker) => `<li><strong>${esc(blocker.reasonCode)}</strong> · ${esc(blocker.owningLayer)} · ${esc(blocker.requiredDecision)}</li>`)
    .join('') || '<li>none</li>';
  const skills = (bundle.skillTimeline || [])
    .map((item) => `<li>${esc(item.skill)} · ${esc(item.status)} · ${esc(item.resultPath || item.stopClassification || '')}</li>`)
    .join('') || '<li>none</li>';
  const repairChain = bundle.repairSkillChain
    ? `<p><strong>Repair chain:</strong> ${esc(bundle.repairSkillChain.status)} · ${esc(bundle.repairSkillChain.resultCount)} result(s) · ${esc(bundle.repairSkillChain.path)}</p>`
    : '<p class="muted">Repair chain: none recorded</p>';
  const traces = (bundle.traceRefs || [])
    .map((ref) => `<li>${esc(ref.summaryPath || ref.traceHash)} · ${esc(ref.lineCount || 'unknown')} lines</li>`)
    .join('') || '<li>none</li>';
  const units = (bundle.inferenceUnits || [])
    .map((unit) => `<li>${esc(unit.iteration)}.${esc(unit.sequence)} ${esc(unit.unitId)} · ${esc(unit.status)} · next: ${esc((unit.allowedNextUnitTypes || []).join(', ') || 'none')} · side effects: ${esc((unit.deterministicSideEffects || []).join(', ') || 'none')}</li>`)
    .join('') || '<li>none</li>';
  const objective = bundle.objectiveRef || {};
  const renderedRefs = (bundle.renderedDocRefs || [])
    .map((ref) => `<li>${esc(ref)}</li>`)
    .join('') || '<li>none</li>';
  const artifactRefs = Object.entries(bundle.artifacts || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `<li>${esc(key)}: ${esc(value)}</li>`)
    .join('') || '<li>none</li>';
  const mismatch = bundle.stopMismatch
    ? `<p class="mismatch"><strong>Wrapper/native mismatch:</strong> ${esc(bundle.stopMismatch.wrapperClaim || 'wrapper claim')} -> ${esc(bundle.stopMismatch.inferredClassification || 'inferred')} via ${esc(bundle.stopMismatch.authoritativeSource || 'native evidence')}</p>`
    : '<p class="mismatch muted">Wrapper/native mismatch: none recorded</p>';
  const prPolicy = bundle.prReviewPolicy || {};
  const prGate = bundle.prReviewGate || {};
  return `
    <section class="run-card" data-run-id="${esc(bundle.runId)}" data-recommendation="${esc(bundle.recommendation)}">
      <header>
        <h2>${esc(bundle.runId)}</h2>
        <div class="recommendation">${esc(bundle.recommendation)}</div>
      </header>
      <p><strong>Stage:</strong> ${esc(bundle.lifecycleStage)} · <strong>Status:</strong> ${esc(bundle.status)}</p>
      <p><strong>Objective:</strong> ${esc(objective.sourcePath || 'unknown')} · ${esc(objective.objectiveHash || 'missing hash')}</p>
      <p><strong>Stop:</strong> ${esc(bundle.stopVerdict?.classification || 'none')} · ${esc(bundle.stopVerdict?.reasonCode || 'none')}</p>
      <p><strong>PR review policy:</strong> ${esc(prPolicy.mode || 'unknown')} · <strong>Gate:</strong> ${esc(prGate.state || 'unknown')}</p>
      <p><strong>Reviewer:</strong> ${esc(bundle.reviewerVerdict?.path || 'missing')} · ${esc(bundle.reviewerVerdict?.mode || 'no mode')}</p>
      ${repairChain}
      ${mismatch}
      <div class="gates">${gates}</div>
      <div class="grid">
        <div><h3>Blockers</h3><ul>${blockers}</ul></div>
        <div><h3>Skills</h3><ul>${skills}</ul></div>
        <div><h3>Inference Units</h3><ul>${units}</ul></div>
        <div><h3>Native Trace Summaries</h3><ul>${traces}</ul></div>
        <div><h3>Rendered Docs</h3><ul>${renderedRefs}</ul></div>
        <div class="wide"><h3>Evidence Artifacts</h3><ul>${artifactRefs}</ul></div>
      </div>
      <p class="privacy">Privacy: raw prompts, wrapper logs, native traces, and message content are omitted.</p>
    </section>`;
}

export async function renderDashboard({
  runsDir = '.living-doc-runs',
  evidenceDir = 'evidence/living-doc-harness',
  outPath = 'docs/living-doc-harness-dashboard.html',
  now = new Date().toISOString(),
} = {}) {
  const runDirs = await listDirs(runsDir);
  const bundles = [];
  for (const runDir of runDirs) {
    const { bundle } = await writeEvidenceBundle({ runDir, outDir: evidenceDir, now });
    bundles.push(bundle);
  }
  bundles.sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Living Doc Harness Dashboard</title>
  <style>
    :root { color-scheme: light; --ink:#17202a; --muted:#5d6876; --line:#d9dee7; --bg:#f7f8fb; --panel:#fff; --accent:#0f766e; --warn:#b45309; --bad:#b91c1c; }
    body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); background:var(--bg); }
    header.page { padding:24px 28px; border-bottom:1px solid var(--line); background:var(--panel); }
    h1 { margin:0 0 4px; font-size:24px; letter-spacing:0; }
    .sub { color:var(--muted); }
    main { max-width:1180px; margin:0 auto; padding:24px; }
    .run-card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:18px; margin-bottom:16px; }
    .run-card header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
    h2 { margin:0; font-size:18px; letter-spacing:0; }
    h3 { margin:14px 0 6px; font-size:13px; letter-spacing:0; color:var(--muted); text-transform:uppercase; }
    .recommendation { padding:4px 8px; border-radius:6px; background:#e6f3f1; color:var(--accent); font-weight:700; }
    .gates { display:flex; flex-wrap:wrap; gap:6px; margin:12px 0; }
    .gate { border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .gate-pass { border-color:#9dd6c8; background:#ecfdf5; color:#047857; }
    .gate-fail { border-color:#fecaca; background:#fef2f2; color:var(--bad); }
    .gate-pending, .gate-warn { border-color:#fed7aa; background:#fff7ed; color:var(--warn); }
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
    .wide { grid-column:span 2; }
    .mismatch { margin:8px 0; }
    .muted { color:var(--muted); }
    ul { margin:0; padding-left:18px; }
    .privacy { color:var(--muted); border-top:1px solid var(--line); padding-top:10px; margin-bottom:0; }
    @media (max-width: 760px) { .grid { grid-template-columns:1fr; } .wide { grid-column:auto; } .run-card header { display:block; } .recommendation { display:inline-block; margin-top:8px; } }
  </style>
</head>
<body>
  <header class="page">
    <h1>Living Doc Harness Dashboard</h1>
    <div class="sub">Generated ${esc(now)} · ${bundles.length} run(s) · local sanitized proof view</div>
  </header>
  <main>
    ${bundles.length ? bundles.map(renderRunCard).join('\n') : '<p>No harness runs found.</p>'}
  </main>
</body>
</html>
`;
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');
  return { outPath, bundles };
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!['bundle', 'dashboard'].includes(command)) {
    throw new Error('usage: living-doc-harness-evidence-dashboard.mjs <bundle|dashboard> ...');
  }
  const options = {
    command,
    runDir: null,
    runsDir: '.living-doc-runs',
    outDir: 'evidence/living-doc-harness',
    outPath: 'docs/living-doc-harness-dashboard.html',
  };
  if (command === 'bundle') {
    options.runDir = args.shift();
    if (!options.runDir) throw new Error('bundle requires <runDir>');
  }
  while (args.length) {
    const flag = args.shift();
    if (flag === '--out-dir') {
      options.outDir = args.shift();
      if (!options.outDir) throw new Error('--out-dir requires a value');
    } else if (flag === '--runs-dir') {
      options.runsDir = args.shift();
      if (!options.runsDir) throw new Error('--runs-dir requires a value');
    } else if (flag === '--out') {
      options.outPath = args.shift();
      if (!options.outPath) throw new Error('--out requires a value');
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  return options;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.command === 'bundle'
      ? await writeEvidenceBundle({ runDir: options.runDir, outDir: options.outDir })
      : await renderDashboard({ runsDir: options.runsDir, evidenceDir: options.outDir, outPath: options.outPath });
    console.log(JSON.stringify({
      bundlePath: result.bundlePath || null,
      summaryPath: result.summaryPath || null,
      outPath: result.outPath || null,
      runCount: result.bundles?.length || 1,
    }, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
