import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  artifactRef,
  validateArtifactRef,
} from './living-doc-harness-artifact-ref.mjs';
import {
  DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
  HARNESS_INFERENCE_UNIT_REGISTRY,
  registryMetadataForUnit,
  validateNextUnitSelection,
} from './living-doc-harness-inference-unit-types.mjs';
import {
  validateInferenceUnitResult,
} from './living-doc-harness-inference-unit.mjs';
import {
  LIFECYCLE_ROUTING_POLICY_RULES,
  selectLifecycleRoute,
} from './living-doc-harness-routing-policy.mjs';

const DEFAULT_SEED = '20260514';
const DEFAULT_CASE_COUNT = 48;
const REPORT_SCHEMA = 'living-doc-harness-monkey-report/v1';
const REPLAY_SCHEMA = 'living-doc-harness-monkey-replay/v1';
const MUTATION_SURFACES = Object.freeze([
  'inference-unit-output',
  'artifact-ref',
  'routing-policy',
  'lifecycle-gates',
  'evidence-freshness',
]);
const CONCEPT_IDS = Object.freeze([
  'controller-owned-routing',
  'artifact-ref-continuity',
  'closure-authority',
  'evidence-freshness',
  'side-effect-gates',
]);

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function stableSeedNumber(seed) {
  const text = String(seed || DEFAULT_SEED);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seedNumber) {
  let value = seedNumber >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function caseId({ seed, index, kind, variant }) {
  return `seed-${String(seed).replace(/[^a-zA-Z0-9_.-]/g, '-')}-${String(index + 1).padStart(3, '0')}-${kind}-${variant}`;
}

function unitTypes() {
  return Object.keys(HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes);
}

function expectedTransition({ currentUnitTypeId, selectedUnitTypeId, allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES }) {
  if (!selectedUnitTypeId) return { ok: true, reasonCode: 'no-next-unit-selected' };
  const selectedRegistered = Boolean(HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes[selectedUnitTypeId]);
  if (!selectedRegistered) return { ok: false, reasonCode: 'selected-unit-type-unregistered' };
  if (!allowedUnitTypes.includes(selectedUnitTypeId)) return { ok: false, reasonCode: 'selected-unit-type-not-allowed-for-run' };
  const current = HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes[currentUnitTypeId];
  if (!arr(current?.allowedNextUnitTypes).includes(selectedUnitTypeId)) {
    return { ok: false, reasonCode: 'selected-unit-type-not-allowed-by-current-contract' };
  }
  return { ok: true, reasonCode: 'selected-unit-type-valid' };
}

function transitionCase({ seed, index, random }) {
  const variant = pick(random, ['valid-transition', 'invalid-contract-edge', 'disallowed-run-unit', 'unregistered-unit']);
  let currentUnitTypeId = pick(random, unitTypes());
  let selectedUnitTypeId = null;
  let allowedUnitTypes = [...DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES];

  if (variant === 'valid-transition') {
    const allowedNext = arr(HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes[currentUnitTypeId].allowedNextUnitTypes);
    if (!allowedNext.length) currentUnitTypeId = 'reviewer-inference';
    selectedUnitTypeId = pick(random, arr(HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes[currentUnitTypeId].allowedNextUnitTypes));
  } else if (variant === 'invalid-contract-edge') {
    const current = HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes[currentUnitTypeId];
    const illegal = unitTypes().filter((unitTypeId) => !arr(current.allowedNextUnitTypes).includes(unitTypeId));
    selectedUnitTypeId = pick(random, illegal.length ? illegal : ['worker']);
  } else if (variant === 'disallowed-run-unit') {
    currentUnitTypeId = 'reviewer-inference';
    selectedUnitTypeId = pick(random, ['commit-intent', 'pr-review', 'living-doc-balance-scan']);
    allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES.filter((unitTypeId) => unitTypeId !== selectedUnitTypeId);
  } else {
    selectedUnitTypeId = `unregistered-monkey-${Math.floor(random() * 1000)}`;
  }

  return {
    id: caseId({ seed, index, kind: 'transition', variant }),
    kind: 'transition',
    variant,
    mutationSurface: 'routing-policy',
    conceptIds: ['controller-owned-routing'],
    input: {
      currentUnitTypeId,
      selectedUnitTypeId,
      allowedUnitTypes,
    },
    expected: expectedTransition({ currentUnitTypeId, selectedUnitTypeId, allowedUnitTypes }),
  };
}

function artifactRefCase({ seed, index, random }) {
  const variant = pick(random, ['valid-ref', 'schema-invalid', 'relative-path-missing', 'target-missing', 'escape-run-dir']);
  const relativePath = variant === 'target-missing' ? 'artifacts/missing.json' : 'artifacts/existing.json';
  const expectedViolations = {
    'valid-ref': [],
    'schema-invalid': ['artifact-ref-schema-invalid'],
    'relative-path-missing': ['artifact-ref-missing', 'artifact-ref-relativePath-missing'],
    'target-missing': ['artifact-ref-target-missing'],
    'escape-run-dir': ['artifact-ref-relativePath-escapes-runDir', 'artifact-ref-target-missing'],
  }[variant];

  return {
    id: caseId({ seed, index, kind: 'artifact-ref', variant }),
    kind: 'artifact-ref',
    variant,
    mutationSurface: 'artifact-ref',
    conceptIds: ['artifact-ref-continuity', variant === 'escape-run-dir' ? 'evidence-freshness' : null].filter(Boolean),
    input: {
      relativePath,
    },
    expected: {
      ok: expectedViolations.length === 0,
      violations: expectedViolations,
    },
  };
}

function dummyFieldValue(field, unitTypeId) {
  if (/paths|files|actions|basis|skills/i.test(field)) return [];
  if (/allowed|approved|required|executed|present|ready/i.test(field)) return false;
  if (/schema/i.test(field)) return `${unitTypeId}-${field}/v1`;
  if (/sequence|iteration/i.test(field)) return 1;
  return `monkey-${field}`;
}

function outputContractForValidation({ unitTypeId, status }) {
  const type = HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes[unitTypeId];
  const outputContract = {
    schema: type.outputContract.schema,
  };
  for (const field of arr(type.outputContract.requiredFields)) {
    outputContract[field] = field === 'status'
      ? status
      : dummyFieldValue(field, unitTypeId);
  }
  return outputContract;
}

function promptContractForValidation({ unitTypeId, promptPath }) {
  const type = HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes[unitTypeId];
  return {
    schema: 'living-doc-harness-prompt-contract/v1',
    unitTypeId,
    role: type.role,
    template: type.promptContract.template,
    promptContract: type.promptContract,
    promptPath,
    promptSha256: '0'.repeat(64),
    promptBytes: 42,
    toolProfile: {
      name: 'monkey-fixture',
      isolation: 'fixture',
      sandboxMode: 'fixture',
      mcpMode: 'fixture',
      mcpAllowlist: [],
      mcpDenylist: [],
      pluginDenylist: [],
    },
  };
}

function outputContractCase({ seed, index, random }) {
  const variant = pick(random, ['valid-output-contract', 'wrong-output-schema', 'invalid-output-status', 'missing-required-output-field']);
  const unitTypeId = pick(random, unitTypes());
  const type = HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes[unitTypeId];
  const validStatus = pick(random, type.outputVerdicts);
  const outputContract = outputContractForValidation({ unitTypeId, status: validStatus });
  const missingField = pick(random, arr(type.outputContract.requiredFields));

  if (variant === 'wrong-output-schema') outputContract.schema = 'wrong-output-contract/v1';
  if (variant === 'invalid-output-status') outputContract.status = 'not-a-registered-verdict';
  if (variant === 'missing-required-output-field') delete outputContract[missingField];
  const promptPath = 'inference-units/iteration-1/01-monkey/prompt.md';

  const expectedViolationPath = {
    'valid-output-contract': null,
    'wrong-output-schema': '$.outputContract.schema',
    'invalid-output-status': '$.outputContract.status',
    'missing-required-output-field': `$.outputContract.${missingField}`,
  }[variant];

  return {
    id: caseId({ seed, index, kind: 'output-contract', variant }),
    kind: 'output-contract',
    variant,
    mutationSurface: 'inference-unit-output',
    conceptIds: ['controller-owned-routing'],
    input: {
      unitTypeId,
      result: {
        schema: 'living-doc-contract-bound-inference-result/v1',
        unitId: unitTypeId,
        role: type.role,
        unitType: registryMetadataForUnit(unitTypeId),
        mode: 'fixture',
        iteration: 1,
        sequence: 1,
        promptPath,
        promptContract: promptContractForValidation({ unitTypeId, promptPath }),
        inputContractPath: 'inference-units/iteration-1/01-monkey/input-contract.json',
        codexEventsPath: 'inference-units/iteration-1/01-monkey/codex-events.jsonl',
        lastMessagePath: 'inference-units/iteration-1/01-monkey/last-message.txt',
        status: validStatus,
        basis: ['Monkey output-contract validation case.'],
        outputContract,
      },
    },
    expected: {
      ok: expectedViolationPath == null,
      violationPath: expectedViolationPath,
    },
  };
}

function routingCase({ seed, index, random }) {
  const templates = [
    {
      variant: 'source-change-requires-commit',
      facts: {
        classification: 'closed',
        nextIterationAllowed: true,
        commitRequired: true,
      },
      expected: { policyRuleId: 'source-side-effect-before-review', unitId: 'commit-intent' },
      conceptIds: ['side-effect-gates', 'controller-owned-routing'],
    },
    {
      variant: 'pr-review-required',
      facts: {
        classification: 'closed',
        nextIterationAllowed: true,
        commitRequired: false,
        prReviewRequired: true,
        prReviewSatisfied: false,
        prReviewBlocked: false,
      },
      expected: { policyRuleId: 'required-pr-review-after-commit', unitId: 'pr-review' },
      conceptIds: ['side-effect-gates', 'controller-owned-routing'],
    },
    {
      variant: 'blocked-pr-reroutes-continuation',
      facts: {
        classification: 'repairable',
        nextIterationAllowed: true,
        prReviewRequired: true,
        prReviewSatisfied: false,
        prReviewBlocked: true,
        prReviewGateMentioned: true,
        prReviewGate: { reasonCode: 'monkey-pr-review-blocked' },
      },
      expected: { policyRuleId: 'blocked-pr-review-gate-needs-continuation', unitId: 'worker' },
      conceptIds: ['side-effect-gates', 'controller-owned-routing'],
    },
    {
      variant: 'closure-review-denied',
      facts: {
        classification: 'closed',
        nextIterationAllowed: true,
        closureReviewDenied: true,
        closureReview: {
          review: {
            terminalAllowed: false,
            reasonCode: 'monkey-closure-review-denied',
          },
        },
      },
      expected: { policyRuleId: 'closure-review-denied-needs-continuation', unitId: 'worker' },
      conceptIds: ['closure-authority', 'controller-owned-routing'],
    },
    {
      variant: 'same-reason-loop-blocked',
      facts: {
        classification: 'repairable',
        nextIterationAllowed: true,
        latestRecommendedUnitType: 'worker',
        sameReasonContinuationLoop: true,
        reasonCode: 'monkey-same-reason-loop',
      },
      expected: { policyRuleId: 'same-reason-continuation-loop-blocked', terminalActionKind: 'continuation-required' },
      conceptIds: ['evidence-freshness', 'controller-owned-routing'],
    },
    {
      variant: 'worker-recommendation-ignored',
      facts: {
        classification: 'repairable',
        nextIterationAllowed: true,
        latestRecommendation: {
          sourceUnitType: 'worker',
          sourceUnitRole: 'worker',
          recommendedUnitType: 'living-doc-balance-scan',
          recommendedUnitRole: 'balance-scan',
          reasonCode: 'monkey-latest-evidence',
        },
        latestRecommendedUnitType: 'living-doc-balance-scan',
        latestRecommendedUnitRole: 'balance-scan',
        latestRecommendationReasonCode: 'monkey-latest-evidence',
      },
      expected: { policyRuleId: 'reviewer-authorized-worker-continuation', unitId: 'worker' },
      conceptIds: ['evidence-freshness', 'controller-owned-routing'],
      currentUnitTypeId: 'reviewer-inference',
    },
    {
      variant: 'repair-routes-balance-scan',
      facts: {
        classification: 'repairable',
        nextIterationAllowed: true,
        nextIterationMode: 'repair',
        executeRepairSkills: true,
      },
      expected: { policyRuleId: 'reviewer-repair-routes-balance-scan', unitId: 'living-doc-balance-scan' },
      conceptIds: ['controller-owned-routing'],
    },
    {
      variant: 'reviewer-closed-requires-closure-review',
      facts: {
        classification: 'closed',
        nextIterationAllowed: true,
        commitRequired: false,
      },
      expected: { policyRuleId: 'closure-review-after-preconditions', unitId: 'closure-review' },
      conceptIds: ['closure-authority', 'controller-owned-routing'],
    },
  ];
  const template = pick(random, templates);
  return {
    id: caseId({ seed, index, kind: 'routing', variant: template.variant }),
    kind: 'routing',
    variant: template.variant,
    mutationSurface: template.conceptIds.includes('evidence-freshness') ? 'evidence-freshness' : 'lifecycle-gates',
    conceptIds: template.conceptIds,
    input: {
      facts: template.facts,
      currentUnitTypeId: template.currentUnitTypeId || 'reviewer-inference',
    },
    expected: template.expected,
  };
}

function closureAuthorityCase({ seed, index, random }) {
  const variant = pick(random, ['reviewer-cannot-close', 'closure-review-can-close', 'closure-review-denial-continues']);
  const expected = {
    'reviewer-cannot-close': {
      route: { policyRuleId: 'closure-review-after-preconditions', unitId: 'closure-review' },
      terminalClosed: false,
    },
    'closure-review-can-close': {
      route: { policyRuleId: 'approved-closure-review-closes-lifecycle', terminalActionKind: 'closed' },
      terminalClosed: true,
    },
    'closure-review-denial-continues': {
      route: { policyRuleId: 'closure-review-denied-needs-continuation', unitId: 'worker' },
      terminalClosed: false,
    },
  }[variant];

  const facts = {
    'reviewer-cannot-close': {
      classification: 'closed',
      nextIterationAllowed: true,
      commitRequired: false,
      prReviewRequired: false,
    },
    'closure-review-can-close': {
      classification: 'closed',
      nextIterationAllowed: false,
      closureReviewApproved: true,
      commitRequired: false,
      prReviewRequired: false,
      closureReview: {
        review: {
          terminalAllowed: true,
          reasonCode: 'monkey-closure-review-approved',
        },
      },
    },
    'closure-review-denial-continues': {
      classification: 'closed',
      nextIterationAllowed: true,
      closureReviewDenied: true,
      closureReview: {
        review: {
          terminalAllowed: false,
          reasonCode: 'monkey-closure-review-denied',
        },
      },
    },
  }[variant];

  return {
    id: caseId({ seed, index, kind: 'closure-authority', variant }),
    kind: 'closure-authority',
    variant,
    mutationSurface: 'lifecycle-gates',
    conceptIds: ['closure-authority', 'controller-owned-routing'],
    input: { facts },
    expected,
  };
}

export function generateHarnessMonkeyCases({
  seed = DEFAULT_SEED,
  caseCount = DEFAULT_CASE_COUNT,
} = {}) {
  const random = mulberry32(stableSeedNumber(seed));
  const factories = [transitionCase, outputContractCase, artifactRefCase, routingCase, closureAuthorityCase];
  const cases = [];
  for (let index = 0; index < caseCount; index += 1) {
    const factory = factories[index % factories.length];
    const generated = factory({ seed, index, random });
    cases.push(generated);
  }
  return cases;
}

function assertKnownCaseMetadata(testCase) {
  assert.ok(testCase.id, 'case id is required');
  assert.ok(MUTATION_SURFACES.includes(testCase.mutationSurface), `${testCase.id} uses an unknown mutation surface`);
  assert.ok(arr(testCase.conceptIds).length > 0, `${testCase.id} must map to at least one concept`);
  for (const conceptId of testCase.conceptIds) {
    assert.ok(CONCEPT_IDS.includes(conceptId), `${testCase.id} uses unknown concept id ${conceptId}`);
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function runTransitionCase(testCase) {
  const validation = validateNextUnitSelection(testCase.input);
  assert.equal(validation.ok, testCase.expected.ok, `${testCase.id} ok`);
  assert.equal(validation.reasonCode, testCase.expected.reasonCode, `${testCase.id} reasonCode`);
  return {
    validation,
  };
}

async function runArtifactRefCase(testCase, { cwd, scratchRoot, validationRunRoot }) {
  const caseRoot = path.join(scratchRoot, testCase.id);
  const runDir = testCase.variant === 'escape-run-dir'
    ? path.join(validationRunRoot, testCase.id)
    : caseRoot;
  await mkdir(path.join(runDir, 'artifacts'), { recursive: true });
  await writeJson(path.join(runDir, 'artifacts', 'existing.json'), {
    schema: 'living-doc-harness-monkey-fixture/v1',
    caseId: testCase.id,
  });

  let ref = artifactRef({
    cwd,
    runId: testCase.id,
    runDir,
    relativePath: testCase.input.relativePath,
    kind: 'monkey-fixture',
  });
  if (testCase.variant === 'schema-invalid') {
    ref = {
      schema: 'wrong-schema/v1',
      runDir,
      relativePath: testCase.input.relativePath,
    };
  } else if (testCase.variant === 'relative-path-missing') {
    ref = {
      schema: 'living-doc-artifact-ref/v1',
      runDir,
      kind: 'monkey-fixture',
    };
  } else if (testCase.variant === 'escape-run-dir') {
    ref = {
      schema: 'living-doc-artifact-ref/v1',
      runId: testCase.id,
      runDir: path.relative(cwd, runDir),
      relativePath: '../outside.json',
      kind: 'monkey-fixture',
    };
  }

  const validation = await validateArtifactRef({
    cwd,
    currentRunDir: runDir,
    ref,
    mustExist: true,
  });
  assert.equal(validation.ok, testCase.expected.ok, `${testCase.id} ok`);
  for (const violation of testCase.expected.violations) {
    assert.ok(validation.violations.includes(violation), `${testCase.id} expected ${violation}, got ${validation.violations.join(', ')}`);
  }
  return {
    ref,
    validation: {
      ok: validation.ok,
      violations: validation.violations,
      displayPath: validation.displayPath ? testCase.input.relativePath : null,
    },
  };
}

async function runOutputContractCase(testCase) {
  const validation = validateInferenceUnitResult(testCase.input.result);
  assert.equal(validation.ok, testCase.expected.ok, `${testCase.id} ok`);
  if (testCase.expected.violationPath) {
    assert.ok(
      validation.violations.some((violation) => violation.path === testCase.expected.violationPath),
      `${testCase.id} expected violation ${testCase.expected.violationPath}, got ${validation.violations.map((violation) => violation.path).join(', ')}`
    );
  }
  return {
    validation,
  };
}

async function runRoutingCase(testCase) {
  const route = selectLifecycleRoute(testCase.input.facts);
  assert.equal(route?.policyRuleId, testCase.expected.policyRuleId, `${testCase.id} policyRuleId`);
  const ruleIds = new Set(LIFECYCLE_ROUTING_POLICY_RULES.map((rule) => rule.id));
  assert.equal(ruleIds.has(route.policyRuleId), true, `${testCase.id} route must be declared`);
  if (testCase.expected.unitId) {
    assert.equal(route.unitId, testCase.expected.unitId, `${testCase.id} unitId`);
    const validation = validateNextUnitSelection({
      currentUnitTypeId: testCase.input.currentUnitTypeId,
      selectedUnitTypeId: route.unitId,
    });
    assert.equal(validation.ok, true, `${testCase.id} selected unit must be registry-legal`);
  }
  if (testCase.expected.terminalActionKind) {
    assert.equal(route.terminalActionKind, testCase.expected.terminalActionKind, `${testCase.id} terminalActionKind`);
  }
  return { route };
}

async function runClosureAuthorityCase(testCase) {
  const route = selectLifecycleRoute(testCase.input.facts);
  assert.equal(route?.policyRuleId, testCase.expected.route.policyRuleId, `${testCase.id} policyRuleId`);
  if (testCase.expected.route.unitId) {
    assert.equal(route.unitId, testCase.expected.route.unitId, `${testCase.id} unitId`);
  }
  if (testCase.expected.route.terminalActionKind) {
    assert.equal(route.terminalActionKind, testCase.expected.route.terminalActionKind, `${testCase.id} terminalActionKind`);
  }
  assert.equal(route.terminalActionKind === 'closed', testCase.expected.terminalClosed, `${testCase.id} terminal closure authority`);
  return { route };
}

async function runCase(testCase, options) {
  assertKnownCaseMetadata(testCase);
  if (testCase.kind === 'transition') return runTransitionCase(testCase);
  if (testCase.kind === 'output-contract') return runOutputContractCase(testCase);
  if (testCase.kind === 'artifact-ref') return runArtifactRefCase(testCase, options);
  if (testCase.kind === 'routing') return runRoutingCase(testCase);
  if (testCase.kind === 'closure-authority') return runClosureAuthorityCase(testCase);
  throw new Error(`unknown monkey case kind: ${testCase.kind}`);
}

function replayCommandFor({ seed, caseCount, replayPath }) {
  if (replayPath) return `node scripts/living-doc-harness-monkey.mjs --replay ${replayPath}`;
  return `node scripts/living-doc-harness-monkey.mjs --seed ${seed} --case-count ${caseCount}`;
}

async function writeReplayArtifact({
  replayOutDir,
  seed,
  caseCount,
  testCase,
  error,
  replayPath = null,
}) {
  const artifactPath = path.join(replayOutDir, testCase.id, 'replay.json');
  const artifact = {
    schema: REPLAY_SCHEMA,
    seed,
    caseCount,
    caseId: testCase.id,
    generatedCase: testCase,
    mutationList: [{
      surface: testCase.mutationSurface,
      variant: testCase.variant,
      input: testCase.input,
    }],
    expectedInvariant: {
      conceptIds: testCase.conceptIds,
      expected: testCase.expected,
    },
    actualResult: {
      status: 'failed',
      errorName: error?.name || 'Error',
      message: error?.message || String(error),
      stack: error?.stack || null,
    },
    reasonCodes: [
      testCase.expected?.reasonCode,
      testCase.expected?.policyRuleId,
      testCase.expected?.route?.policyRuleId,
      ...arr(testCase.expected?.violations),
    ].filter(Boolean),
    replayCommand: replayCommandFor({ seed, caseCount, replayPath: replayPath || artifactPath }),
  };
  await writeJson(artifactPath, artifact);
  return artifactPath;
}

async function casesFromReplayPath(replayPath) {
  const replay = await readJson(replayPath);
  if (replay.schema === REPORT_SCHEMA) return arr(replay.cases);
  if (replay.schema === REPLAY_SCHEMA) return [replay.generatedCase];
  if (Array.isArray(replay.cases)) return replay.cases;
  if (replay.generatedCase) return [replay.generatedCase];
  throw new Error(`unsupported monkey replay artifact: ${replayPath}`);
}

export async function runHarnessMonkey({
  seed = DEFAULT_SEED,
  caseCount = DEFAULT_CASE_COUNT,
  cases = null,
  replayPath = null,
  reportPath = null,
  replayOutDir = null,
  cwd = process.cwd(),
  failFast = false,
  throwOnFailure = true,
} = {}) {
  const generatedCases = cases || (replayPath
    ? await casesFromReplayPath(replayPath)
    : generateHarnessMonkeyCases({ seed, caseCount }));
  const scratchRoot = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-monkey-'));
  const validationRunRoot = path.join(cwd, '.living-doc-runs', 'monkey-validation', `${Date.now()}-${process.pid}`);
  const resolvedReplayOutDir = replayOutDir || path.join(cwd, '.living-doc-runs', 'monkey-replays', `seed-${seed}`);
  const results = [];
  const startedAt = new Date().toISOString();

  try {
    for (const testCase of generatedCases) {
      const caseStartedAt = new Date().toISOString();
      try {
        const detail = await runCase(testCase, { cwd, scratchRoot, validationRunRoot });
        results.push({
          id: testCase.id,
          kind: testCase.kind,
          variant: testCase.variant,
          mutationSurface: testCase.mutationSurface,
          conceptIds: testCase.conceptIds,
          status: 'passed',
          startedAt: caseStartedAt,
          endedAt: new Date().toISOString(),
          detail,
        });
      } catch (error) {
        const replayArtifactPath = await writeReplayArtifact({
          replayOutDir: resolvedReplayOutDir,
          seed,
          caseCount: generatedCases.length,
          testCase,
          error,
          replayPath,
        });
        results.push({
          id: testCase.id,
          kind: testCase.kind,
          variant: testCase.variant,
          mutationSurface: testCase.mutationSurface,
          conceptIds: testCase.conceptIds,
          status: 'failed',
          startedAt: caseStartedAt,
          endedAt: new Date().toISOString(),
          replayArtifactPath,
          error: {
            name: error?.name || 'Error',
            message: error?.message || String(error),
          },
        });
        if (failFast) break;
      }
    }
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
    await rm(validationRunRoot, { recursive: true, force: true });
  }

  const failed = results.filter((result) => result.status === 'failed');
  const report = {
    schema: REPORT_SCHEMA,
    seed,
    caseCount: generatedCases.length,
    generatedAt: new Date().toISOString(),
    reportPath,
    startedAt,
    endedAt: new Date().toISOString(),
    status: failed.length ? 'failed' : 'passed',
    mutationSurfaces: MUTATION_SURFACES,
    conceptIds: CONCEPT_IDS,
    cases: generatedCases,
    results,
    summary: {
      passed: results.filter((result) => result.status === 'passed').length,
      failed: failed.length,
      conceptsTouched: [...new Set(results.flatMap((result) => result.conceptIds))].sort(),
      mutationSurfacesTouched: [...new Set(results.map((result) => result.mutationSurface))].sort(),
      replayArtifactPaths: failed.map((result) => result.replayArtifactPath),
    },
  };

  if (reportPath) await writeJson(reportPath, report);
  if (failed.length && throwOnFailure) {
    const first = failed[0];
    const error = new Error(`harness monkey failed ${failed.length}/${results.length} case(s); first failure ${first.id}: ${first.error.message}`);
    error.report = report;
    throw error;
  }
  return report;
}

function parseArgs(argv) {
  const args = {
    seed: DEFAULT_SEED,
    caseCount: DEFAULT_CASE_COUNT,
    reportPath: null,
    replayPath: null,
    replayOutDir: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--seed') args.seed = argv[++index];
    else if (arg === '--case-count') args.caseCount = Number(argv[++index]);
    else if (arg === '--report') args.reportPath = argv[++index];
    else if (arg === '--replay') args.replayPath = argv[++index];
    else if (arg === '--replay-out-dir') args.replayOutDir = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.caseCount) || args.caseCount < 1) {
    throw new Error('--case-count must be a positive integer');
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const report = await runHarnessMonkey(args);
  console.log(`living-doc harness monkey ${report.status}: ${report.summary.passed} passed, ${report.summary.failed} failed, seed ${report.seed}`);
  if (report.reportPath) console.log(`report: ${report.reportPath}`);
}
