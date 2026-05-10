// Stop-negotiation layer for the standalone living-doc harness.
//
// This module diagnoses why a worker stopped from evidence. It does not trust
// the worker final message or wrapper summary as authoritative. Native trace
// refs and proof gates are the control surface.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

const CONTINUATION_SIGNAL_KINDS = new Set(['true-block', 'pivot', 'deferred', 'budget-exhausted']);

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

function gatePass(gates, key) {
  return gates?.[key] === 'pass';
}

function allClosureGatesPass(gates) {
  return [
    'standaloneRun',
    'nativeTraceInspected',
    'livingDocRendered',
    'acceptanceCriteriaSatisfied',
    'evidenceBundleWritten',
  ].every((key) => gatePass(gates, key));
}

function nativeTraceCount(evidence) {
  return arr(evidence.workerEvidence?.nativeInferenceTraceRefs || evidence.nativeTraceRefs).length;
}

function wrapperClaim(evidence) {
  return evidence.wrapperSummary?.claimedClassification || evidence.wrapperSummary?.claimedStatus || null;
}

function workerClaimsDone(evidence) {
  const claim = wrapperClaim(evidence);
  return claim === 'closed'
    || claim === 'done'
    || claim === 'success'
    || hasText(evidence.workerEvidence?.finalMessageSummary || evidence.finalMessageSummary, /\b(done|complete|completed|finished|success)\b/i);
}

function workerAsksUser(evidence) {
  const finalSummary = evidence.workerEvidence?.finalMessageSummary || evidence.finalMessageSummary;
  const claim = wrapperClaim(evidence);
  return claim === 'needs-user'
    || claim === 'handoff'
    || hasText(finalSummary, /\b(user|decision|confirm|approve|clarify|input)\b/i);
}

function availableNextActions(evidence) {
  return arr(evidence.availableNextActions).filter(Boolean);
}

function unresolvedTerms(evidence) {
  return arr(evidence.objectiveState?.unresolvedObjectiveTerms);
}

function unprovenCriteria(evidence) {
  return arr(evidence.objectiveState?.unprovenAcceptanceCriteria);
}

function baseVerdict({ classification, reasonCode, confidence = 'high', basis, nextIteration, terminal = null, mismatch = null }) {
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification,
      reasonCode,
      confidence,
      basis,
    },
    nextIteration,
    ...(terminal ? { terminal } : {}),
    ...(mismatch ? { mismatch } : {}),
  };
}

function mismatchFromWrapper(evidence, classification, basis) {
  const claim = wrapperClaim(evidence);
  if (!claim || claim === classification) return null;
  basis.push(`Wrapper/worker claim "${claim}" is not authoritative and differs from inferred classification "${classification}".`);
  return {
    wrapperClaim: claim,
    inferredClassification: classification,
    authoritativeSource: 'native-trace-and-proof-gates',
  };
}

function terminalVerdict(evidence) {
  const signal = evidence.terminalSignal;
  if (!signal || !CONTINUATION_SIGNAL_KINDS.has(signal.kind)) return null;

  const basis = [
    `Continuation signal ${signal.kind} was supplied by the harness evidence.`,
    ...(arr(signal.basis).length ? arr(signal.basis) : ['Terminal signal requires an outside state change before continuation.']),
  ];
  return baseVerdict({
    classification: signal.kind,
    reasonCode: signal.reasonCode || `${signal.kind}-signal`,
    confidence: signal.confidence || 'high',
    basis,
    nextIteration: {
      allowed: true,
      mode: 'continuation',
      instruction: 'Continue through the next contract-bound inference unit; this signal is not objective closure.',
      mustNotDo: ['do not stop unless the objective is proven reached or the user explicitly stops the lifecycle'],
    },
    terminal: {
      kind: signal.kind,
      reasonCode: signal.reasonCode || `${signal.kind}-signal`,
      basis,
      ...(signal.owningLayer ? { owningLayer: signal.owningLayer } : {}),
      ...(signal.requiredDecision ? { requiredDecision: signal.requiredDecision } : {}),
      ...(signal.unblockCriteria ? { unblockCriteria: signal.unblockCriteria } : {}),
    },
  });
}

export function inferStopNegotiation(evidence) {
  const gates = evidence.proofGates || {};
  const terms = unresolvedTerms(evidence);
  const criteria = unprovenCriteria(evidence);
  const nativeRefs = nativeTraceCount(evidence);
  const nextActions = availableNextActions(evidence);

  const terminal = terminalVerdict(evidence);
  if (terminal) return terminal;

  if (nativeRefs === 0) {
    const basis = [
      'No native inference trace refs are present.',
      'Wrapper output and worker final message cannot prove the stop reason.',
    ];
    return baseVerdict({
      classification: 'repairable',
      reasonCode: 'missing-native-trace-evidence',
      confidence: 'high',
      basis,
      nextIteration: {
        allowed: true,
        mode: 'repair',
        instruction: 'Attach native inference trace evidence before diagnosing or closing this run.',
        mustNotDo: ['do not rely on wrapper summaries', 'do not claim closure without native trace refs'],
      },
      mismatch: mismatchFromWrapper(evidence, 'repairable', basis),
    });
  }

  const canClose = terms.length === 0
    && criteria.length === 0
    && allClosureGatesPass(gates)
    && gates.closureAllowed === true;

  if (canClose) {
    const basis = [
      'Native inference trace refs are present.',
      'No unresolved objective terms remain.',
      'No unproven acceptance criteria remain.',
      'All closure proof gates pass.',
    ];
    return baseVerdict({
      classification: 'closed',
      reasonCode: 'objective-proven',
      confidence: 'high',
      basis,
      nextIteration: {
        allowed: false,
        mode: 'none',
      },
      mismatch: mismatchFromWrapper(evidence, 'closed', basis),
    });
  }

  if (workerClaimsDone(evidence)) {
    const basis = [
      'Worker or wrapper claims completion, but closure gates or objective terms are not satisfied.',
      `${terms.length} unresolved objective term(s) remain.`,
      `${criteria.length} unproven acceptance criteria remain.`,
    ];
    return baseVerdict({
      classification: 'closure-candidate',
      reasonCode: 'closure-proof-incomplete',
      confidence: 'high',
      basis,
      nextIteration: {
        allowed: true,
        mode: 'repair',
        instruction: 'Repair the missing proof or objective terms before closure can be reconsidered.',
        mustNotDo: ['do not accept worker self-report as closure', 'do not accept wrapper summary as closure'],
      },
      mismatch: mismatchFromWrapper(evidence, 'closure-candidate', basis),
    });
  }

  if (workerAsksUser(evidence) && nextActions.length > 0) {
    const basis = [
      'Worker appears to ask for user input.',
      'Evidence still contains available next actions, so the handoff is premature.',
      `Available next action: ${nextActions[0]}`,
    ];
    return baseVerdict({
      classification: 'resumable',
      reasonCode: 'premature-handoff',
      confidence: 'high',
      basis,
      nextIteration: {
        allowed: true,
        mode: 'resume',
        instruction: `Resume with available next action: ${nextActions[0]}`,
        mustNotDo: ['do not ask the user before exhausting available harness actions'],
      },
      mismatch: mismatchFromWrapper(evidence, 'resumable', basis),
    });
  }

  if (criteria.length > 0 || terms.length > 0 || Object.values(gates).some((value) => value === 'fail')) {
    const basis = [
      'Native inference trace refs are present, but objective/proof state remains unsatisfied.',
      `${terms.length} unresolved objective term(s) remain.`,
      `${criteria.length} unproven acceptance criteria remain.`,
    ];
    return baseVerdict({
      classification: 'repairable',
      reasonCode: 'proof-or-objective-unsatisfied',
      confidence: 'high',
      basis,
      nextIteration: {
        allowed: true,
        mode: 'repair',
        instruction: 'Run the appropriate repair or proof-producing action for the unresolved objective state.',
        mustNotDo: ['do not claim closure while proof gates fail'],
      },
      mismatch: mismatchFromWrapper(evidence, 'repairable', basis),
    });
  }

  const basis = [
    'Native inference trace refs are present and no explicit terminal signal exists.',
    'Closure is not allowed because at least one closure gate is pending, warning, or not applicable.',
  ];
  return baseVerdict({
    classification: 'closure-candidate',
    reasonCode: 'closure-gates-not-final',
    confidence: 'medium',
    basis,
    nextIteration: {
      allowed: true,
      mode: 'repair',
      instruction: 'Resolve pending closure gates before claiming completion.',
      mustNotDo: ['do not close from partial gates'],
    },
    mismatch: mismatchFromWrapper(evidence, 'closure-candidate', basis),
  });
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (command !== 'diagnose') {
    throw new Error('usage: living-doc-harness-stop-negotiation.mjs diagnose <evidence.json> [--out <file>]');
  }
  const evidencePath = args.shift();
  if (!evidencePath) throw new Error('diagnose requires an evidence JSON file');
  const options = { evidencePath, out: null };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--out') {
      options.out = args.shift();
      if (!options.out) throw new Error('--out requires a value');
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
    const evidence = JSON.parse(await readFile(options.evidencePath, 'utf8'));
    const verdict = inferStopNegotiation(evidence);
    const json = `${JSON.stringify(verdict, null, 2)}\n`;
    if (options.out) {
      await writeFile(options.out, json, 'utf8');
    } else {
      process.stdout.write(json);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
