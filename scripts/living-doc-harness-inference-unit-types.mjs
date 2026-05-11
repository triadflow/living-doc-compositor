// Registry and validators for standalone harness inference unit types.
//
// The lifecycle controller may only invoke unit types declared here and allowed
// by the run configuration. The registry is intentionally data-shaped so tests,
// dashboards, and future controllers can inspect the same contract surface.

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function contractFields(...fields) {
  return fields.filter(Boolean);
}

export const HARNESS_INFERENCE_UNIT_REGISTRY = {
  schema: 'living-doc-harness-inference-unit-type-registry/v1',
  version: 1,
  unitTypes: {
    worker: {
      id: 'worker',
      role: 'worker',
      inputContract: {
        schema: 'living-doc-worker-inference-input/v1',
        requiredFields: contractFields('runId', 'livingDocPath', 'objective', 'successCondition', 'requiredInspectionPaths'),
      },
      promptContract: {
        template: 'living-doc-harness-worker-prompt/v1',
        requiresObjective: true,
        requiresSuccessCondition: true,
        requiredRules: ['living-doc-json-is-source-state', 'worker-must-not-run-controller-commands'],
      },
      requiredEvidence: ['livingDocPath'],
      outputContract: {
        schema: 'living-doc-worker-output/v1',
        requiredFields: contractFields('status', 'runId', 'livingDocPath', 'nextAuthority'),
      },
      outputVerdicts: ['prepared', 'starting', 'running', 'finished', 'failed'],
      allowedNextUnitTypes: ['reviewer-inference'],
      deterministicSideEffects: [],
      dashboard: {
        role: 'worker',
        label: 'Worker',
        showContracts: true,
        showLogs: true,
      },
      closureImplications: {
        mayClose: false,
        contributesEvidence: ['nativeTraceRefs', 'filesChanged'],
      },
    },
    'reviewer-inference': {
      id: 'reviewer-inference',
      role: 'reviewer',
      inputContract: {
        schema: 'living-doc-harness-reviewer-input/v1',
        requiredFields: contractFields('runId', 'iteration', 'evidencePath', 'objectiveState', 'workerEvidence', 'proofGates', 'requiredInspectionPaths'),
      },
      promptContract: {
        template: 'living-doc-harness-reviewer-prompt/v1',
        requiresRawLogInspection: true,
      },
      requiredEvidence: ['evidencePath', 'rawWorkerJsonlPaths'],
      outputContract: {
        schema: 'living-doc-harness-stop-verdict/v1',
        requiredFields: contractFields('stopVerdict', 'nextIteration'),
      },
      outputVerdicts: ['closed', 'user-stopped', 'repairable', 'resumable', 'closure-candidate', 'true-block', 'pivot', 'deferred', 'budget-exhausted'],
      allowedNextUnitTypes: ['closure-review', 'commit-intent', 'pr-review', 'living-doc-balance-scan', 'repair-skill', 'continuation-inference', 'worker'],
      deterministicSideEffects: [],
      dashboard: {
        role: 'reviewer',
        label: 'Reviewer',
        showContracts: true,
        showLogs: true,
      },
      closureImplications: {
        mayRecommendClosure: true,
        cannotPersistClosureAlone: true,
      },
    },
    'closure-review': {
      id: 'closure-review',
      role: 'closure-review',
      inputContract: {
        schema: 'living-doc-harness-closure-review-input/v1',
        requiredFields: contractFields('runId', 'iteration', 'evidencePath', 'reviewerVerdictPath', 'evidenceSnapshotPath', 'requiredHardFacts', 'proofGates', 'stopVerdict', 'requiredInspectionPaths'),
      },
      promptContract: {
        template: 'living-doc-harness-closure-review-prompt/v1',
        requiresEvidencePathInspection: true,
      },
      requiredEvidence: ['evidencePath', 'reviewerVerdictPath', 'sideEffectEvidenceWhenRequired'],
      outputContract: {
        schema: 'living-doc-harness-closure-review/v1',
        requiredFields: contractFields('approved', 'reasonCode', 'confidence', 'basis', 'terminalAllowed'),
      },
      outputVerdicts: ['approved', 'blocked'],
      allowedNextUnitTypes: ['post-flight-summary', 'continuation-inference'],
      deterministicSideEffects: [],
      dashboard: {
        role: 'closure-review',
        label: 'Closure Review',
        showContracts: true,
        showLogs: true,
      },
      closureImplications: {
        mayPersistTerminalClosure: true,
        requiresAllProofGates: true,
      },
    },
    'living-doc-balance-scan': {
      id: 'living-doc-balance-scan',
      role: 'balance-scan',
      inputContract: {
        schema: 'living-doc-repair-skill-chain-input/v1',
        requiredFields: contractFields('runId', 'iteration', 'livingDocPath', 'reviewerVerdictPath', 'handoverPath', 'requiredInspectionPaths'),
      },
      promptContract: {
        template: 'living-doc-balance-scan-prompt/v1',
        requiresEvidencePathInspection: true,
      },
      requiredEvidence: ['livingDocPath', 'reviewerVerdictPath', 'handoverPath'],
      outputContract: {
        schema: 'living-doc-balance-scan-result/v1',
        requiredFields: contractFields('status', 'basis', 'orderedSkills'),
      },
      outputVerdicts: ['ordered', 'no-op', 'blocked', 'failed'],
      allowedNextUnitTypes: ['repair-skill', 'continuation-inference', 'worker'],
      deterministicSideEffects: [],
      dashboard: {
        role: 'balance-scan',
        label: 'Balance Scan',
        showContracts: true,
        showLogs: true,
      },
      closureImplications: {
        mayClose: false,
      },
    },
    'repair-skill': {
      id: 'repair-skill',
      role: 'repair-skill',
      inputContract: {
        schema: 'living-doc-repair-skill-chain-input/v1',
        requiredFields: contractFields('runId', 'iteration', 'skill', 'sequence', 'livingDocPath', 'requiredInspectionPaths', 'commitPolicy'),
      },
      promptContract: {
        template: 'living-doc-repair-skill-prompt/v1',
        requiresEvidencePathInspection: true,
        requiresCommitIntentOnlyPolicy: true,
      },
      requiredEvidence: ['livingDocPath', 'reviewerVerdictPath', 'handoverPath', 'priorRepairResultPaths'],
      outputContract: {
        schema: 'living-doc-repair-skill-result/v1',
        requiredFields: contractFields('skill', 'sequence', 'status', 'changedFiles', 'commitIntent'),
      },
      outputVerdicts: ['repaired', 'no-op', 'blocked', 'failed', 'aligned', 'criteria-gap', 'objective-gap', 'stale-map'],
      allowedNextUnitTypes: ['repair-skill', 'commit-intent', 'worker', 'continuation-inference'],
      deterministicSideEffects: [],
      dashboard: {
        role: 'repair-skill',
        label: 'Repair Skill',
        showContracts: true,
        showLogs: true,
        showCommitIntent: true,
      },
      closureImplications: {
        sourceChangesRequireCommitEvidence: true,
      },
    },
    'commit-intent': {
      id: 'commit-intent',
      role: 'commit-intent',
      inputContract: {
        schema: 'living-doc-harness-commit-intent-input/v1',
        requiredFields: contractFields('runId', 'iteration', 'changedFiles', 'evidenceSnapshotPath', 'requiredHardFacts', 'commitIntent', 'commitPolicy', 'requiredInspectionPaths'),
      },
      promptContract: {
        template: 'living-doc-harness-commit-intent-prompt/v1',
        requiresChangedFileInspection: true,
      },
      requiredEvidence: ['changedFiles', 'commitIntent'],
      outputContract: {
        schema: 'living-doc-harness-commit-intent-result/v1',
        requiredFields: contractFields('approved', 'status', 'changedFiles', 'message', 'sideEffect'),
      },
      outputVerdicts: ['approved', 'not-required', 'blocked', 'failed'],
      allowedNextUnitTypes: ['pr-review', 'closure-review', 'worker', 'continuation-inference'],
      deterministicSideEffects: ['git-commit'],
      dashboard: {
        role: 'commit-intent',
        label: 'Commit Intent',
        showContracts: true,
        showLogs: true,
        showSideEffects: true,
      },
      closureImplications: {
        satisfiesSourceChangeCommitGate: true,
      },
    },
    'pr-review': {
      id: 'pr-review',
      role: 'pr-review',
      inputContract: {
        schema: 'living-doc-harness-pr-review-input/v1',
        requiredFields: contractFields('runId', 'iteration', 'reviewTarget', 'evidenceSnapshotPath', 'requiredHardFacts', 'requiredInspectionPaths'),
      },
      promptContract: {
        template: 'living-doc-harness-pr-review-prompt/v1',
        requiresPrStateInspection: true,
      },
      requiredEvidence: ['reviewTarget', 'commitEvidence'],
      outputContract: {
        schema: 'living-doc-harness-pr-review-result/v1',
        requiredFields: contractFields('status', 'approvedActions', 'sideEffect'),
      },
      outputVerdicts: ['approved', 'not-required', 'blocked', 'failed'],
      allowedNextUnitTypes: ['closure-review', 'worker', 'continuation-inference'],
      deterministicSideEffects: ['github-pr-open-or-update', 'github-pr-review-comment'],
      dashboard: {
        role: 'pr-review',
        label: 'PR Review',
        showContracts: true,
        showLogs: true,
        showSideEffects: true,
      },
      closureImplications: {
        satisfiesPrGateWhenConfigured: true,
      },
    },
    'continuation-inference': {
      id: 'continuation-inference',
      role: 'continuation',
      inputContract: {
        schema: 'living-doc-continuation-input/v1',
        requiredFields: contractFields('runId', 'iteration', 'reasonCode', 'requiredInspectionPaths'),
      },
      promptContract: {
        template: 'living-doc-continuation-prompt/v1',
        requiresBlockerOrRepairEvidence: true,
      },
      requiredEvidence: ['reasonCode'],
      outputContract: {
        schema: 'living-doc-continuation-result/v1',
        requiredFields: contractFields('status', 'basis', 'nextRecommendedUnitType'),
      },
      outputVerdicts: ['continuation-required', 'blocked', 'ready'],
      allowedNextUnitTypes: ['worker', 'living-doc-balance-scan', 'repair-skill', 'commit-intent', 'pr-review'],
      deterministicSideEffects: [],
      dashboard: {
        role: 'continuation',
        label: 'Continuation',
        showContracts: true,
        showLogs: true,
      },
      closureImplications: {
        mayClose: false,
      },
    },
    'post-flight-summary': {
      id: 'post-flight-summary',
      role: 'post-flight-summary',
      inputContract: {
        schema: 'living-doc-harness-post-flight-summary-input/v1',
        requiredFields: contractFields('runId', 'iteration', 'terminalPath', 'proofPath', 'requiredInspectionPaths'),
      },
      promptContract: {
        template: 'living-doc-harness-post-flight-summary-prompt/v1',
        readsClosureArtifactsOnly: true,
      },
      requiredEvidence: ['terminalPath', 'proofPath', 'lifecycleResultPath'],
      outputContract: {
        schema: 'living-doc-harness-post-flight-summary/v1',
        requiredFields: contractFields('status', 'summaryPath', 'basis'),
      },
      outputVerdicts: ['written', 'blocked'],
      allowedNextUnitTypes: [],
      deterministicSideEffects: ['write-post-flight-summary'],
      dashboard: {
        role: 'post-flight-summary',
        label: 'Post-Flight Summary',
        showContracts: true,
        showLogs: false,
      },
      closureImplications: {
        runsAfterClosure: true,
        cannotChangeTerminalState: true,
      },
    },
  },
};

export const DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES = Object.freeze(Object.keys(HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes));

export function getInferenceUnitType(unitTypeId) {
  const type = HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes[unitTypeId];
  if (!type) throw new Error(`unregistered inference unit type: ${unitTypeId}`);
  return type;
}

export function normalizeAllowedInferenceUnitTypes(value = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES) {
  const allowed = arr(value).length ? arr(value) : DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES;
  const unique = [...new Set(allowed)];
  for (const unitTypeId of unique) getInferenceUnitType(unitTypeId);
  return unique;
}

export function validateInferenceUnitAllowed({ unitTypeId, allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES }) {
  getInferenceUnitType(unitTypeId);
  const allowed = normalizeAllowedInferenceUnitTypes(allowedUnitTypes);
  if (!allowed.includes(unitTypeId)) {
    return {
      ok: false,
      reasonCode: 'unit-type-not-allowed-for-run',
      message: `unit type ${unitTypeId} is not allowed for this run`,
      allowedUnitTypes: allowed,
    };
  }
  return { ok: true, allowedUnitTypes: allowed };
}

export function registryMetadataForUnit(unitTypeId, allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES) {
  const type = getInferenceUnitType(unitTypeId);
  return {
    schema: 'living-doc-harness-inference-unit-type-ref/v1',
    unitTypeId: type.id,
    role: type.role,
    inputContractSchema: type.inputContract.schema,
    promptContract: type.promptContract,
    requiredEvidence: type.requiredEvidence,
    outputContractSchema: type.outputContract.schema,
    outputVerdicts: type.outputVerdicts,
    allowedNextUnitTypes: type.allowedNextUnitTypes.filter((next) => normalizeAllowedInferenceUnitTypes(allowedUnitTypes).includes(next)),
    deterministicSideEffects: type.deterministicSideEffects,
    dashboard: type.dashboard,
    closureImplications: type.closureImplications,
  };
}

export function validateNextUnitSelection({
  currentUnitTypeId,
  selectedUnitTypeId,
  allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
}) {
  const allowed = normalizeAllowedInferenceUnitTypes(allowedUnitTypes);
  if (!selectedUnitTypeId) {
    return { ok: true, reasonCode: 'no-next-unit-selected', allowedUnitTypes: allowed };
  }
  const current = getInferenceUnitType(currentUnitTypeId);
  const selectedRegistered = Boolean(HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes[selectedUnitTypeId]);
  if (!selectedRegistered) {
    return {
      ok: false,
      reasonCode: 'selected-unit-type-unregistered',
      message: `selected next unit type ${selectedUnitTypeId} is not registered`,
      allowedUnitTypes: allowed,
    };
  }
  if (!allowed.includes(selectedUnitTypeId)) {
    return {
      ok: false,
      reasonCode: 'selected-unit-type-not-allowed-for-run',
      message: `selected next unit type ${selectedUnitTypeId} is not in the run allowed set`,
      allowedUnitTypes: allowed,
    };
  }
  if (!arr(current.allowedNextUnitTypes).includes(selectedUnitTypeId)) {
    return {
      ok: false,
      reasonCode: 'selected-unit-type-not-allowed-by-current-contract',
      message: `${currentUnitTypeId} cannot hand off to ${selectedUnitTypeId}`,
      allowedUnitTypes: allowed,
    };
  }
  return { ok: true, reasonCode: 'selected-unit-type-valid', allowedUnitTypes: allowed };
}

export function validateRegistryCompleteness(registry = HARNESS_INFERENCE_UNIT_REGISTRY) {
  const violations = [];
  for (const [id, type] of Object.entries(registry.unitTypes || {})) {
    for (const key of ['id', 'role', 'inputContract', 'promptContract', 'requiredEvidence', 'outputContract', 'outputVerdicts', 'allowedNextUnitTypes', 'deterministicSideEffects', 'dashboard', 'closureImplications']) {
      if (type[key] == null) violations.push({ path: `$.unitTypes.${id}.${key}`, message: `${key} is required` });
    }
    if (type.id !== id) violations.push({ path: `$.unitTypes.${id}.id`, message: 'id must match registry key' });
    if (!type.inputContract?.schema) violations.push({ path: `$.unitTypes.${id}.inputContract.schema`, message: 'input contract schema is required' });
    if (!type.outputContract?.schema) violations.push({ path: `$.unitTypes.${id}.outputContract.schema`, message: 'output contract schema is required' });
    if (!arr(type.outputVerdicts).length) violations.push({ path: `$.unitTypes.${id}.outputVerdicts`, message: 'at least one output verdict is required' });
    for (const next of arr(type.allowedNextUnitTypes)) {
      if (!registry.unitTypes?.[next]) {
        violations.push({ path: `$.unitTypes.${id}.allowedNextUnitTypes`, message: `unknown next unit type ${next}` });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}
