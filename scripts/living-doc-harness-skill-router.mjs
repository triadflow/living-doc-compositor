// Skill routing and repair handover for the standalone living-doc harness.
//
// Given a stop-negotiation verdict, choose the next living-doc skills/actions
// and persist the handover that the next iteration must consume.

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
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

function skillAction(skill, reason, extra = {}) {
  return {
    kind: 'skill',
    skill,
    reason,
    status: 'recommended',
    ...extra,
  };
}

function harnessAction(actionId, reason, extra = {}) {
  return {
    kind: 'harness-action',
    actionId,
    reason,
    status: 'recommended',
    ...extra,
  };
}

function routeForVerdict(verdict, evidence = {}) {
  const classification = verdict.stopVerdict?.classification;
  const reasonCode = verdict.stopVerdict?.reasonCode;
  const actions = [];

  if (classification === 'resumable') {
    actions.push(skillAction('reaction-path-validator', 'Validate that resuming is a valid stage transition before the next worker run.'));
    actions.push(harnessAction('resume-worker', 'Resume because stop-negotiation found available next action without requiring user input.', {
      mode: 'resume',
      instruction: verdict.nextIteration?.instruction || '',
    }));
  } else if (classification === 'closure-candidate') {
    actions.push(skillAction('objective-conservation-audit', 'Check whether every objective term is conserved before closure.'));
    actions.push(skillAction('activation-energy-review', 'Reject closure-shaped artifacts when proof threshold has not been crossed.'));
    actions.push(skillAction('reaction-path-validator', 'Validate movement from closure-candidate to closed or back to repair.'));
    actions.push(harnessAction('prepare-repair-handover', 'Closure is not accepted until missing proof is repaired.', { mode: 'repair' }));
  } else if (classification === 'repairable') {
    if (reasonCode === 'missing-native-trace-evidence') {
      actions.push(harnessAction('attach-native-trace', 'Native trace evidence is missing; attach sanitized native trace refs before deeper repair.', { issue: 188 }));
      actions.push(skillAction('objective-execution-readiness', 'Re-check whether the living doc can drive execution after trace evidence is attached.'));
    } else if (reasonCode === 'objective-ambiguous' || reasonCode === 'acceptance-criteria-weak') {
      actions.push(skillAction('objective-acceptance-shaping', 'Repair objective or acceptance criteria before continuing implementation.'));
      actions.push(skillAction('objective-execution-readiness', 'Confirm the repaired doc is executable.'));
    } else {
      actions.push(skillAction('living-doc-balance-scan', 'Classify the imbalance before running a repair bundle.'));
      actions.push(skillAction('catalytic-repair-run', 'Run the chemistry repair bundle against the out-of-balance living doc.'));
      actions.push(skillAction('objective-execution-readiness', 'Confirm the repaired living doc can drive the next iteration.'));
    }
    actions.push(harnessAction('prepare-repair-handover', 'Persist unresolved objective terms and unproven criteria for the next iteration.', { mode: 'repair' }));
  } else if (classification === 'closed') {
    actions.push(skillAction('objective-conservation-audit', 'Final conservation audit before accepting closure.'));
    actions.push(skillAction('activation-energy-review', 'Final proof-threshold review before closure is accepted.'));
    actions.push(skillAction('reaction-path-validator', 'Validate transition to closed.'));
    actions.push(harnessAction('stop-loop', 'Closure is allowed; no next worker iteration should run.', { mode: 'none' }));
  } else if (classification === 'true-block') {
    actions.push(harnessAction('create-blocker-record', 'True block must be explicit and terminal until outside state changes.', { mode: 'block' }));
    actions.push(skillAction('reaction-path-validator', 'Validate transition to true-blocked state.'));
  } else if (classification === 'pivot') {
    actions.push(skillAction('reaction-path-validator', 'Validate pivot transition before changing objective direction.'));
    actions.push(harnessAction('record-pivot', 'Persist pivot reason and stop the current objective loop.', { mode: 'pivot' }));
  } else if (classification === 'deferred') {
    actions.push(skillAction('reaction-path-validator', 'Validate deferral transition and resume trigger.'));
    actions.push(harnessAction('record-deferral', 'Persist deferral reason and trigger.', { mode: 'defer' }));
  } else if (classification === 'budget-exhausted') {
    actions.push(harnessAction('record-budget-exhaustion', 'Persist budget exhaustion as a terminal non-closure state.', { mode: 'stop-budget' }));
    actions.push(skillAction('reaction-path-validator', 'Validate budget exhaustion terminal state.'));
  } else {
    actions.push(skillAction('living-doc-balance-scan', 'Unknown stop classification; triage the document before continuing.'));
  }

  return {
    schema: 'living-doc-harness-skill-routing/v1',
    runId: evidence.runId || null,
    routedAt: null,
    stopVerdict: verdict.stopVerdict,
    mismatch: verdict.mismatch || null,
    nextIteration: verdict.nextIteration,
    unresolvedObjectiveTerms: arr(evidence.objectiveState?.unresolvedObjectiveTerms),
    unprovenAcceptanceCriteria: arr(evidence.objectiveState?.unprovenAcceptanceCriteria),
    actions,
  };
}

async function snapshotDoc({ sourcePath, destDir, label }) {
  if (!sourcePath) return null;
  await mkdir(destDir, { recursive: true });
  const raw = await readFile(sourcePath, 'utf8');
  const destPath = path.join(destDir, `${label}-${path.basename(sourcePath)}`);
  await copyFile(sourcePath, destPath);
  return {
    sourcePath,
    artifactPath: destPath,
    hash: sha256(raw),
  };
}

function renderLivingDoc(docPath) {
  const result = spawnSync(process.execPath, ['scripts/render-living-doc.mjs', docPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  return {
    command: `node scripts/render-living-doc.mjs ${docPath}`,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    renderedHtml: docPath.replace(/\.json$/i, '.html'),
  };
}

export async function routeStopVerdict({
  verdict,
  evidence = {},
  runDir,
  livingDocPath = null,
  afterDocPath = null,
  iteration = 1,
  now = new Date().toISOString(),
  render = false,
} = {}) {
  if (!verdict?.stopVerdict) throw new Error('verdict.stopVerdict is required');
  if (!runDir) throw new Error('runDir is required');

  const artifactsDir = path.join(runDir, 'artifacts');
  const handoversDir = path.join(runDir, 'handovers');
  const docArtifactsDir = path.join(artifactsDir, 'living-docs');
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(handoversDir, { recursive: true });

  const routing = routeForVerdict(verdict, evidence);
  routing.runId = evidence.runId || routing.runId;
  routing.routedAt = now;

  const beforeDoc = await snapshotDoc({ sourcePath: livingDocPath, destDir: docArtifactsDir, label: `iteration-${iteration}-before` });
  const afterDoc = await snapshotDoc({ sourcePath: afterDocPath, destDir: docArtifactsDir, label: `iteration-${iteration}-after` });
  const renderResult = render && afterDocPath ? renderLivingDoc(afterDocPath) : null;

  const routingPath = path.join(artifactsDir, `skill-routing-iteration-${iteration}.json`);
  const handoverPath = path.join(handoversDir, `iteration-${iteration}-handover.json`);
  const invocationPath = path.join(runDir, 'skill-invocations.jsonl');
  const eventsPath = path.join(runDir, 'events.jsonl');

  const handover = {
    schema: 'living-doc-harness-repair-handover/v1',
    runId: routing.runId,
    iteration,
    createdAt: now,
    stopVerdict: verdict.stopVerdict,
    mismatch: verdict.mismatch || null,
    nextIteration: verdict.nextIteration,
    unresolvedObjectiveTerms: routing.unresolvedObjectiveTerms,
    unprovenAcceptanceCriteria: routing.unprovenAcceptanceCriteria,
    actions: routing.actions,
    livingDoc: {
      before: beforeDoc,
      after: afterDoc,
      render: renderResult,
    },
  };

  await writeJson(routingPath, routing);
  await writeJson(handoverPath, handover);
  for (const action of routing.actions) {
    if (action.kind !== 'skill') continue;
    await appendJsonl(invocationPath, {
      schema: 'living-doc-harness-skill-invocation/v1',
      at: now,
      runId: routing.runId,
      iteration,
      skill: action.skill,
      status: action.status,
      reason: action.reason,
      stopClassification: verdict.stopVerdict.classification,
      stopReasonCode: verdict.stopVerdict.reasonCode,
      handoverPath: path.relative(runDir, handoverPath),
    });
  }
  await appendJsonl(eventsPath, {
    event: 'skill-routing-written',
    at: now,
    runId: routing.runId,
    iteration,
    routingPath: path.relative(runDir, routingPath),
    handoverPath: path.relative(runDir, handoverPath),
    actions: routing.actions.map((action) => action.skill || action.actionId),
  });

  return {
    routing,
    handover,
    routingPath,
    handoverPath,
    skillInvocationsPath: invocationPath,
  };
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (command !== 'route') {
    throw new Error('usage: living-doc-harness-skill-router.mjs route <verdict.json> --run-dir <dir> [--evidence <file>] [--living-doc <file>] [--after-doc <file>] [--iteration <n>] [--render]');
  }
  const verdictPath = args.shift();
  if (!verdictPath) throw new Error('route requires a verdict JSON file');
  const options = {
    verdictPath,
    evidencePath: null,
    runDir: null,
    livingDocPath: null,
    afterDocPath: null,
    iteration: 1,
    render: false,
  };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--evidence') {
      options.evidencePath = args.shift();
      if (!options.evidencePath) throw new Error('--evidence requires a value');
    } else if (flag === '--run-dir') {
      options.runDir = args.shift();
      if (!options.runDir) throw new Error('--run-dir requires a value');
    } else if (flag === '--living-doc') {
      options.livingDocPath = args.shift();
      if (!options.livingDocPath) throw new Error('--living-doc requires a value');
    } else if (flag === '--after-doc') {
      options.afterDocPath = args.shift();
      if (!options.afterDocPath) throw new Error('--after-doc requires a value');
    } else if (flag === '--iteration') {
      options.iteration = Number(args.shift());
      if (!Number.isInteger(options.iteration) || options.iteration < 1) throw new Error('--iteration requires an integer >= 1');
    } else if (flag === '--render') {
      options.render = true;
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  if (!options.runDir) throw new Error('--run-dir is required');
  return options;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const verdict = await readJson(options.verdictPath);
    const evidence = options.evidencePath ? await readJson(options.evidencePath) : {};
    const result = await routeStopVerdict({
      verdict,
      evidence,
      runDir: options.runDir,
      livingDocPath: options.livingDocPath,
      afterDocPath: options.afterDocPath,
      iteration: options.iteration,
      render: options.render,
    });
    console.log(JSON.stringify({
      routingPath: result.routingPath,
      handoverPath: result.handoverPath,
      actionCount: result.routing.actions.length,
    }, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
