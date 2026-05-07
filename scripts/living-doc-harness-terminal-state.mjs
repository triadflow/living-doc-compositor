// Terminal-state writer for the standalone living-doc harness.
//
// This records loop-stopping states as durable artifacts. A true block, pivot,
// deferral, budget exhaustion, or closure must be visible in the run directory
// before the harness is allowed to stop or resume.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

const CLASS_TO_KIND = {
  closed: 'closed',
  'true-block': 'true-blocked',
  pivot: 'pivoted',
  deferred: 'deferred',
  'budget-exhausted': 'budget-exhausted',
  repairable: 'repair-resumed',
  resumable: 'repair-resumed',
  'closure-candidate': 'repair-resumed',
};

const BLOCK_REASON_LAYERS = {
  'missing-source': 'source-authority',
  'missing-permission': 'permission-boundary',
  'missing-proof-authority': 'proof-authority',
  'objective-undecidable': 'objective-governance',
  'privacy-boundary': 'privacy-boundary',
  'platform-capability-gap': 'platform-capability',
};

function slug(value) {
  return String(value || 'terminal')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'terminal';
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

function terminalKindFor(verdict) {
  const classification = verdict?.stopVerdict?.classification;
  return CLASS_TO_KIND[classification] || null;
}

function terminalStatusFor(kind) {
  if (kind === 'closed') return 'closed';
  if (kind === 'repair-resumed') return 'repair-resumed';
  return 'terminal-non-closure';
}

function mayContinueFor(kind) {
  return kind === 'repair-resumed';
}

function nextActionFor(kind, terminal = {}) {
  if (kind === 'closed') return 'no-next-iteration-objective-closed';
  if (kind === 'repair-resumed') return 'resume-from-repair-handover';
  if (kind === 'true-blocked') return terminal.requiredDecision || 'external decision required before resume';
  if (kind === 'pivoted') return 'start a new objective after pivot approval';
  if (kind === 'deferred') return terminal.resumeTrigger || 'wait for deferral trigger';
  if (kind === 'budget-exhausted') return 'increase budget or close as budget-exhausted';
  return 'inspect terminal-state artifact';
}

function buildBlocker({ runId, iteration, verdict, evidence, now }) {
  const terminal = verdict.terminal || {};
  const reasonCode = terminal.reasonCode || verdict.stopVerdict?.reasonCode || 'true-block';
  return {
    schema: 'living-doc-harness-blocker/v1',
    id: `blocker-${slug(reasonCode)}`,
    runId,
    iteration,
    createdAt: now,
    stage: evidence.objectiveState?.stageAfter || evidence.objectiveState?.stageBefore || 'unknown',
    reasonCode,
    owningLayer: terminal.owningLayer || BLOCK_REASON_LAYERS[reasonCode] || 'unknown',
    requiredDecision: terminal.requiredDecision || evidence.requiredDecision || 'External decision required before the harness may continue.',
    requiredSource: terminal.requiredSource || evidence.requiredSource || null,
    requiredProof: terminal.requiredProof || evidence.requiredProof || null,
    issueRef: terminal.issueRef || evidence.issueRef || null,
    followUpRef: terminal.followUpRef || evidence.followUpRef || null,
    unblockCriteria: arr(terminal.unblockCriteria).length ? terminal.unblockCriteria : ['Explicitly satisfy the required decision/source/proof and rerun terminal validation.'],
    basis: arr(terminal.basis).length ? terminal.basis : arr(verdict.stopVerdict?.basis),
    dashboardVisible: true,
  };
}

export function validateTerminalStateRecord(record) {
  const violations = [];
  const allowedKinds = new Set(['closed', 'true-blocked', 'pivoted', 'deferred', 'budget-exhausted', 'repair-resumed']);
  if (record?.schema !== 'living-doc-harness-terminal-state/v1') {
    violations.push({ path: '$.schema', message: 'schema must be living-doc-harness-terminal-state/v1' });
  }
  if (!allowedKinds.has(record?.kind)) {
    violations.push({ path: '$.kind', message: `kind must be one of: ${[...allowedKinds].join(', ')}` });
  }
  if (record?.kind === 'true-blocked' && !record.blockerRef) {
    violations.push({ path: '$.blockerRef', message: 'true-blocked terminal states require blockerRef' });
  }
  if (record?.kind !== 'repair-resumed' && record?.loopMayContinue !== false) {
    violations.push({ path: '$.loopMayContinue', message: `${record?.kind} must not allow silent continuation` });
  }
  if (record?.kind === 'repair-resumed' && record?.loopMayContinue !== true) {
    violations.push({ path: '$.loopMayContinue', message: 'repair-resumed must allow the next repair/resume iteration' });
  }
  return { ok: violations.length === 0, violations };
}

export async function writeTerminalState({
  runDir,
  verdict,
  evidence = {},
  iteration = 1,
  now = new Date().toISOString(),
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!verdict?.stopVerdict) throw new Error('verdict.stopVerdict is required');

  const kind = terminalKindFor(verdict);
  if (!kind) throw new Error(`unsupported terminal classification: ${verdict.stopVerdict.classification}`);

  const runId = evidence.runId || verdict.runId || null;
  const terminalDir = path.join(runDir, 'terminal');
  const blockersDir = path.join(runDir, 'blockers');
  await mkdir(terminalDir, { recursive: true });
  await mkdir(blockersDir, { recursive: true });

  let blocker = null;
  let blockerPath = null;
  if (kind === 'true-blocked') {
    blocker = buildBlocker({ runId, iteration, verdict, evidence, now });
    blockerPath = path.join(blockersDir, `${blocker.id}.json`);
    await writeJson(blockerPath, blocker);
    await appendJsonl(path.join(runDir, 'blockers.jsonl'), blocker);
  }

  const record = {
    schema: 'living-doc-harness-terminal-state/v1',
    runId,
    iteration,
    createdAt: now,
    kind,
    status: terminalStatusFor(kind),
    loopMayContinue: mayContinueFor(kind),
    stopVerdict: verdict.stopVerdict,
    nextIteration: verdict.nextIteration || null,
    unresolvedObjectiveTerms: arr(evidence.objectiveState?.unresolvedObjectiveTerms),
    unprovenAcceptanceCriteria: arr(evidence.objectiveState?.unprovenAcceptanceCriteria),
    blockerRef: blockerPath ? path.relative(runDir, blockerPath) : null,
    nextAction: nextActionFor(kind, verdict.terminal || {}),
  };

  const validation = validateTerminalStateRecord(record);
  if (!validation.ok) {
    throw new Error(`invalid terminal state: ${validation.violations.map((v) => v.message).join('; ')}`);
  }

  const terminalPath = path.join(terminalDir, `iteration-${iteration}-${kind}.json`);
  await writeJson(terminalPath, record);
  await appendJsonl(path.join(runDir, 'terminal-states.jsonl'), record);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'terminal-state-written',
    at: now,
    runId,
    iteration,
    kind,
    terminalPath: path.relative(runDir, terminalPath),
    blockerRef: record.blockerRef,
  });

  const statePath = path.join(runDir, 'state.json');
  let state = {};
  try {
    state = await readJson(statePath);
  } catch {
    state = { schema: 'living-doc-harness-state/v1', runId };
  }
  state.updatedAt = now;
  state.lifecycleStage = kind;
  state.status = record.status;
  state.terminalState = path.relative(runDir, terminalPath);
  state.activeBlocker = record.blockerRef;
  state.nextAction = record.nextAction;
  await writeJson(statePath, state);

  return {
    terminalPath,
    record,
    blockerPath,
    blocker,
  };
}

export async function canResumeRun(runDir) {
  const state = await readJson(path.join(runDir, 'state.json'));
  if (state.lifecycleStage === 'repair-resumed') {
    return { allowed: true, reason: 'repair-resumed allows the next iteration' };
  }
  if (state.lifecycleStage === 'closed') {
    return { allowed: false, reason: 'objective is closed' };
  }
  if (state.lifecycleStage === 'true-blocked') {
    return { allowed: false, reason: 'true block requires explicit unblock before resume', blockerRef: state.activeBlocker || null };
  }
  if (['pivoted', 'deferred', 'budget-exhausted'].includes(state.lifecycleStage)) {
    return { allowed: false, reason: `${state.lifecycleStage} is terminal until outside state changes` };
  }
  return { allowed: true, reason: 'no terminal blocker present' };
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!['write', 'can-resume'].includes(command)) {
    throw new Error('usage: living-doc-harness-terminal-state.mjs <write|can-resume> ...');
  }
  const options = { command, runDir: null, verdictPath: null, evidencePath: null, iteration: 1 };
  if (command === 'can-resume') {
    options.runDir = args.shift();
    if (!options.runDir) throw new Error('can-resume requires <runDir>');
    return options;
  }
  options.verdictPath = args.shift();
  if (!options.verdictPath) throw new Error('write requires <verdict.json>');
  while (args.length) {
    const flag = args.shift();
    if (flag === '--run-dir') {
      options.runDir = args.shift();
      if (!options.runDir) throw new Error('--run-dir requires a value');
    } else if (flag === '--evidence') {
      options.evidencePath = args.shift();
      if (!options.evidencePath) throw new Error('--evidence requires a value');
    } else if (flag === '--iteration') {
      options.iteration = Number(args.shift());
      if (!Number.isInteger(options.iteration) || options.iteration < 1) throw new Error('--iteration requires an integer >= 1');
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
    if (options.command === 'can-resume') {
      const result = await canResumeRun(options.runDir);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.allowed ? 0 : 1);
    }
    const verdict = await readJson(options.verdictPath);
    const evidence = options.evidencePath ? await readJson(options.evidencePath) : {};
    const result = await writeTerminalState({
      runDir: options.runDir,
      verdict,
      evidence,
      iteration: options.iteration,
    });
    console.log(JSON.stringify({
      terminalPath: result.terminalPath,
      blockerPath: result.blockerPath,
      kind: result.record.kind,
    }, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
