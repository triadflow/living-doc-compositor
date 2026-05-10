// Validator for living-doc-harness-iteration-proof/v1.
//
// This contract is the durable proof handover between standalone harness
// iterations. It intentionally treats native inference traces as primary
// evidence and rejects closure based on worker self-report or wrapper output.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCHEMA = 'living-doc-harness-iteration-proof/v1';
const HASH = /^sha256:[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const CLASSIFICATIONS = new Set([
  'resumable',
  'repairable',
  'closure-candidate',
  'closed',
  'user-stopped',
  'true-block',
  'pivot',
  'deferred',
  'budget-exhausted',
]);

const CONFIDENCE = new Set(['low', 'medium', 'high']);
const GATE_STATUS = new Set(['pass', 'fail', 'warn', 'pending', 'not-applicable']);
const NEXT_MODES = new Set(['resume', 'repair', 'continuation', 'close', 'user-stop', 'none']);
const TERMINAL_CLASSIFICATIONS = new Set(['closed', 'user-stopped']);

let _schema = null;
export async function loadHarnessContractSchema() {
  if (!_schema) {
    const raw = await readFile(path.join(__dirname, 'living-doc-harness-contract-schema.json'), 'utf8');
    _schema = JSON.parse(raw);
  }
  return _schema;
}

function push(arr, entry) {
  arr.push(entry);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(parent, key, base, violations) {
  const value = parent?.[key];
  if (!isObject(value)) {
    push(violations, { path: `${base}.${key}`, rule: 'shape', message: `${key} must be an object` });
    return null;
  }
  return value;
}

function requireString(parent, key, base, violations) {
  const value = parent?.[key];
  if (typeof value !== 'string' || value.length === 0) {
    push(violations, { path: `${base}.${key}`, rule: 'shape', message: `${key} must be a non-empty string` });
    return null;
  }
  return value;
}

function requireBoolean(parent, key, base, violations) {
  const value = parent?.[key];
  if (typeof value !== 'boolean') {
    push(violations, { path: `${base}.${key}`, rule: 'shape', message: `${key} must be a boolean` });
    return null;
  }
  return value;
}

function requireStringArray(parent, key, base, violations, { min = 0 } = {}) {
  const value = parent?.[key];
  if (!Array.isArray(value)) {
    push(violations, { path: `${base}.${key}`, rule: 'shape', message: `${key} must be an array` });
    return null;
  }
  if (value.length < min) {
    push(violations, { path: `${base}.${key}`, rule: 'shape', message: `${key} must contain at least ${min} item(s)` });
  }
  value.forEach((item, i) => {
    if (typeof item !== 'string' || item.length === 0) {
      push(violations, { path: `${base}.${key}[${i}]`, rule: 'shape', message: `${key} entries must be non-empty strings` });
    }
  });
  return value;
}

function validateTopLevel(contract, violations) {
  if (!isObject(contract)) {
    push(violations, { path: '$', rule: 'shape', message: 'contract must be an object' });
    return;
  }
  if (contract.schema !== SCHEMA) {
    push(violations, { path: '$.schema', rule: 'shape', message: `schema must be "${SCHEMA}"` });
  }
  requireString(contract, 'runId', '$', violations);
  if (!Number.isInteger(contract.iteration) || contract.iteration < 1) {
    push(violations, { path: '$.iteration', rule: 'shape', message: 'iteration must be an integer >= 1' });
  }
  const createdAt = requireString(contract, 'createdAt', '$', violations);
  if (createdAt && !ISO.test(createdAt)) {
    push(violations, { path: '$.createdAt', rule: 'shape', message: 'createdAt must be a full UTC ISO timestamp' });
  }
}

function validateLivingDoc(contract, violations) {
  const livingDoc = requireObject(contract, 'livingDoc', '$', violations);
  if (!livingDoc) return;
  requireString(livingDoc, 'sourcePath', '$.livingDoc', violations);
  requireString(livingDoc, 'renderedHtml', '$.livingDoc', violations);
  for (const key of ['beforeHash', 'afterHash']) {
    const value = requireString(livingDoc, key, '$.livingDoc', violations);
    if (value && !HASH.test(value)) {
      push(violations, { path: `$.livingDoc.${key}`, rule: 'shape', message: `${key} must be a sha256:<64 hex> hash` });
    }
  }
}

function validateObjectiveState(contract, violations) {
  const state = requireObject(contract, 'objectiveState', '$', violations);
  if (!state) return;
  const objectiveHash = requireString(state, 'objectiveHash', '$.objectiveState', violations);
  if (objectiveHash && !HASH.test(objectiveHash)) {
    push(violations, { path: '$.objectiveState.objectiveHash', rule: 'shape', message: 'objectiveHash must be a sha256:<64 hex> hash' });
  }
  requireString(state, 'stageBefore', '$.objectiveState', violations);
  requireString(state, 'stageAfter', '$.objectiveState', violations);
  requireStringArray(state, 'unresolvedObjectiveTerms', '$.objectiveState', violations);
  requireStringArray(state, 'unprovenAcceptanceCriteria', '$.objectiveState', violations);
}

function validateWorkerEvidence(contract, violations) {
  const evidence = requireObject(contract, 'workerEvidence', '$', violations);
  if (!evidence) return;
  requireStringArray(evidence, 'nativeInferenceTraceRefs', '$.workerEvidence', violations, { min: 1 });
  requireStringArray(evidence, 'wrapperLogRefs', '$.workerEvidence', violations);
  requireString(evidence, 'finalMessageSummary', '$.workerEvidence', violations);
  requireStringArray(evidence, 'toolFailures', '$.workerEvidence', violations);
  requireStringArray(evidence, 'filesChanged', '$.workerEvidence', violations);
}

function validateStopVerdict(contract, violations) {
  const verdict = requireObject(contract, 'stopVerdict', '$', violations);
  if (!verdict) return;
  const classification = requireString(verdict, 'classification', '$.stopVerdict', violations);
  if (classification && !CLASSIFICATIONS.has(classification)) {
    push(violations, { path: '$.stopVerdict.classification', rule: 'shape', message: `classification must be one of: ${[...CLASSIFICATIONS].join(', ')}` });
  }
  requireString(verdict, 'reasonCode', '$.stopVerdict', violations);
  const confidence = requireString(verdict, 'confidence', '$.stopVerdict', violations);
  if (confidence && !CONFIDENCE.has(confidence)) {
    push(violations, { path: '$.stopVerdict.confidence', rule: 'shape', message: `confidence must be one of: ${[...CONFIDENCE].join(', ')}` });
  }
  requireStringArray(verdict, 'basis', '$.stopVerdict', violations, { min: 1 });
}

function validateSkillsApplied(contract, violations) {
  if (!Array.isArray(contract.skillsApplied)) {
    push(violations, { path: '$.skillsApplied', rule: 'shape', message: 'skillsApplied must be an array' });
    return;
  }
  contract.skillsApplied.forEach((skill, i) => {
    const base = `$.skillsApplied[${i}]`;
    if (!isObject(skill)) {
      push(violations, { path: base, rule: 'shape', message: 'skill entry must be an object' });
      return;
    }
    requireString(skill, 'skill', base, violations);
    requireString(skill, 'verdict', base, violations);
    if (skill.patchRefs !== undefined) requireStringArray(skill, 'patchRefs', base, violations);
  });
}

function validateProofGates(contract, violations) {
  const gates = requireObject(contract, 'proofGates', '$', violations);
  if (!gates) return;
  for (const key of ['standaloneRun', 'nativeTraceInspected', 'livingDocRendered', 'acceptanceCriteriaSatisfied', 'evidenceBundleWritten']) {
    const value = requireString(gates, key, '$.proofGates', violations);
    if (value && !GATE_STATUS.has(value)) {
      push(violations, { path: `$.proofGates.${key}`, rule: 'shape', message: `${key} must be one of: ${[...GATE_STATUS].join(', ')}` });
    }
  }
  requireBoolean(gates, 'closureAllowed', '$.proofGates', violations);
}

function validateNextIteration(contract, violations) {
  const next = requireObject(contract, 'nextIteration', '$', violations);
  if (!next) return;
  const allowed = requireBoolean(next, 'allowed', '$.nextIteration', violations);
  const mode = requireString(next, 'mode', '$.nextIteration', violations);
  if (mode && !NEXT_MODES.has(mode)) {
    push(violations, { path: '$.nextIteration.mode', rule: 'shape', message: `mode must be one of: ${[...NEXT_MODES].join(', ')}` });
  }
  if (allowed === true) {
    requireString(next, 'instruction', '$.nextIteration', violations);
    requireStringArray(next, 'mustNotDo', '$.nextIteration', violations);
  }
}

function validateTerminal(contract, violations) {
  const classification = contract.stopVerdict?.classification;
  if (!TERMINAL_CLASSIFICATIONS.has(classification)) return;
  if (classification === 'closed' || classification === 'user-stopped') return;

  const terminal = requireObject(contract, 'terminal', '$', violations);
  if (!terminal) return;
  const kind = requireString(terminal, 'kind', '$.terminal', violations);
  if (kind && kind !== classification) {
    push(violations, { path: '$.terminal.kind', rule: 'terminal-contract', message: `terminal.kind must match stopVerdict.classification (${classification})` });
  }
  requireString(terminal, 'reasonCode', '$.terminal', violations);
  requireStringArray(terminal, 'basis', '$.terminal', violations, { min: 1 });
  if (classification === 'true-block') {
    requireString(terminal, 'owningLayer', '$.terminal', violations);
    requireString(terminal, 'requiredDecision', '$.terminal', violations);
    requireStringArray(terminal, 'unblockCriteria', '$.terminal', violations, { min: 1 });
  }
}

function validateSemanticRules(contract, violations, warnings, summary) {
  const classification = contract.stopVerdict?.classification;
  const nativeRefs = contract.workerEvidence?.nativeInferenceTraceRefs || [];
  const unresolvedTerms = contract.objectiveState?.unresolvedObjectiveTerms || [];
  const unprovenCriteria = contract.objectiveState?.unprovenAcceptanceCriteria || [];
  const gates = contract.proofGates || {};
  const next = contract.nextIteration || {};

  summary.classification = classification || null;
  summary.nativeTraceRefs = nativeRefs.length;
  summary.unresolvedObjectiveTerms = unresolvedTerms.length;
  summary.unprovenAcceptanceCriteria = unprovenCriteria.length;
  summary.closureAllowed = gates.closureAllowed === true;

  if (nativeRefs.length === 0) {
    push(violations, { path: '$.workerEvidence.nativeInferenceTraceRefs', rule: 'proof-contract', message: 'native inference trace refs are required; wrapper output alone is not proof' });
  }

  if (gates.closureAllowed === true && classification !== 'closed') {
    push(violations, { path: '$.proofGates.closureAllowed', rule: 'closure-contract', message: 'closureAllowed can only be true when stopVerdict.classification is "closed"' });
  }

  if (classification === 'closed') {
    if (gates.closureAllowed !== true) {
      push(violations, { path: '$.proofGates.closureAllowed', rule: 'closure-contract', message: 'closed contracts must explicitly allow closure' });
    }
    for (const [key, expected] of [
      ['standaloneRun', 'pass'],
      ['nativeTraceInspected', 'pass'],
      ['livingDocRendered', 'pass'],
      ['acceptanceCriteriaSatisfied', 'pass'],
      ['evidenceBundleWritten', 'pass'],
    ]) {
      if (gates[key] !== expected) {
        push(violations, { path: `$.proofGates.${key}`, rule: 'closure-contract', message: `closed contracts require ${key}=${expected}` });
      }
    }
    if (unresolvedTerms.length > 0) {
      push(violations, { path: '$.objectiveState.unresolvedObjectiveTerms', rule: 'closure-contract', message: 'closed contracts cannot have unresolved objective terms' });
    }
    if (unprovenCriteria.length > 0) {
      push(violations, { path: '$.objectiveState.unprovenAcceptanceCriteria', rule: 'closure-contract', message: 'closed contracts cannot have unproven acceptance criteria' });
    }
    if (next.allowed !== false || next.mode !== 'none') {
      push(violations, { path: '$.nextIteration', rule: 'closure-contract', message: 'closed contracts must stop iteration with allowed=false and mode="none"' });
    }
  }

  if (classification === 'user-stopped') {
    if (next.allowed !== false || next.mode !== 'user-stop') {
      push(violations, { path: '$.nextIteration', rule: 'user-stop-contract', message: 'user-stopped contracts must stop with allowed=false and mode="user-stop"' });
    }
    if (gates.closureAllowed === true) {
      push(violations, { path: '$.proofGates.closureAllowed', rule: 'user-stop-contract', message: 'user-stopped is not objective closure' });
    }
    return;
  }

  if (classification && classification !== 'closed') {
    if (next.allowed !== true) {
      push(violations, { path: '$.nextIteration.allowed', rule: 'continuation-contract', message: `${classification} contracts must continue until objective closure or explicit user stop` });
    }
    if (next.mode === 'none' || next.mode === 'user-stop') {
      push(violations, { path: '$.nextIteration.mode', rule: 'continuation-contract', message: `${classification} cannot use a terminal nextIteration mode` });
    }
    if (gates.closureAllowed === true) {
      push(violations, { path: '$.proofGates.closureAllowed', rule: 'continuation-contract', message: `${classification} is not objective closure` });
    }
  }

  if (next.allowed === true && (!next.instruction || next.instruction.length < 12)) {
    push(violations, { path: '$.nextIteration.instruction', rule: 'proof-contract', message: 'allowed next iterations need a concrete instruction' });
  }

  if (gates.nativeTraceInspected !== 'pass' && classification === 'closed') {
    push(violations, { path: '$.proofGates.nativeTraceInspected', rule: 'closure-contract', message: 'closure requires native trace inspection to pass' });
  } else if (gates.nativeTraceInspected !== 'pass') {
    push(warnings, { path: '$.proofGates.nativeTraceInspected', message: 'native trace inspection has not passed; this contract can hand over but cannot close' });
  }
}

export function validateHarnessContract(contract) {
  const violations = [];
  const warnings = [];
  const summary = {
    classification: null,
    nativeTraceRefs: 0,
    unresolvedObjectiveTerms: 0,
    unprovenAcceptanceCriteria: 0,
    closureAllowed: false,
  };

  validateTopLevel(contract, violations);
  if (isObject(contract)) {
    validateLivingDoc(contract, violations);
    validateObjectiveState(contract, violations);
    validateWorkerEvidence(contract, violations);
    validateStopVerdict(contract, violations);
    validateSkillsApplied(contract, violations);
    validateProofGates(contract, violations);
    validateNextIteration(contract, violations);
    validateTerminal(contract, violations);
    validateSemanticRules(contract, violations, warnings, summary);
  }

  return {
    ok: violations.length === 0,
    violations,
    warnings,
    summary,
  };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const [contractPath] = process.argv.slice(2);
  if (!contractPath) {
    console.error('usage: validate-living-doc-harness-contract.mjs <contract.json>');
    process.exit(2);
  }
  const contract = JSON.parse(await readFile(contractPath, 'utf8'));
  const result = validateHarnessContract(contract);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
