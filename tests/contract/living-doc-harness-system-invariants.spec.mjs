import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runHarnessLifecycle } from '../../scripts/living-doc-harness-lifecycle.mjs';
import {
  LIFECYCLE_ROUTING_POLICY_RULES,
  selectLifecycleRoute,
} from '../../scripts/living-doc-harness-routing-policy.mjs';
import {
  ARTIFACT_REF_SCHEMA,
  validateArtifactRef,
} from '../../scripts/living-doc-harness-artifact-ref.mjs';
import {
  HARNESS_INFERENCE_UNIT_REGISTRY,
  validateNextUnitSelection,
} from '../../scripts/living-doc-harness-inference-unit-types.mjs';

const cwd = process.cwd();
const policyRuleIds = new Set(LIFECYCLE_ROUTING_POLICY_RULES.map((rule) => rule.id));

function minimalDoc(docPath) {
  return {
    docId: 'test:inference-unit-chain-system-invariants',
    title: 'Inference Unit Chain System Invariants Fixture',
    subtitle: 'Fixture',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: docPath,
    sourceCoverage: 'fixture',
    updated: '2026-05-14T08:00:00.000Z',
    objective: 'Prove inference-unit chaining is governed by runtime handoff invariants.',
    successCondition: 'Every selected next unit is policy-owned, contract-validated, and artifact-ref addressable.',
    sections: [
      {
        id: 'acceptance-criteria',
        title: 'Acceptance Criteria',
        convergenceType: 'acceptance-criteria',
        updated: '2026-05-14T08:00:00.000Z',
        data: [
          {
            id: 'criterion-policy-owned-routing',
            name: 'Policy owned routing',
            status: 'pending',
            updated: '2026-05-14T08:00:00.000Z',
          },
          {
            id: 'criterion-artifact-ref-continuity',
            name: 'Artifact ref continuity',
            status: 'pending',
            updated: '2026-05-14T08:00:00.000Z',
          },
        ],
      },
    ],
  };
}

function reviewerVerdict(classification, {
  closureAllowed = false,
  reasonCode = classification === 'closed' ? 'objective-proven' : 'proof-or-objective-unsatisfied',
  mode = classification === 'closed' ? 'none' : classification === 'user-stopped' ? 'user-stop' : 'repair',
  instruction = 'Run the controller-selected unit for the unresolved objective state.',
} = {}) {
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification,
      reasonCode,
      confidence: 'high',
      closureAllowed,
      basis: ['System-invariant fixture reviewer verdict.'],
    },
    nextIteration: {
      allowed: !['closed', 'user-stopped'].includes(classification),
      mode,
      instruction,
      mustNotDo: classification === 'closed' ? [] : ['Do not bypass controller routing.'],
    },
  };
}

function assertArtifactRef(value, label) {
  assert.equal(value?.schema, ARTIFACT_REF_SCHEMA, `${label} must be a living-doc artifact ref`);
  assert.ok(value.runDir, `${label} must include runDir`);
  assert.ok(value.relativePath, `${label} must include relativePath`);
}

async function assertResolvableArtifactRef({ ref, currentRunDir, label }) {
  assertArtifactRef(ref, label);
  const validation = await validateArtifactRef({
    cwd,
    currentRunDir,
    ref,
    mustExist: true,
  });
  assert.equal(validation.ok, true, `${label} must resolve to an existing artifact: ${validation.violations.join(', ')}`);
}

async function assertPathRefPairs({ object, currentRunDir, pairs, label }) {
  for (const [pathField, refField] of pairs) {
    if (!object?.[pathField]) continue;
    await assertResolvableArtifactRef({
      ref: object[refField],
      currentRunDir,
      label: `${label}.${refField}`,
    });
  }
}

function assertNoPreplannedUnitChain(value, label = '$') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.notEqual(key, 'plannedUnitSequence', `${label}.${key} must not pre-plan a unit chain`);
    assert.notEqual(key, 'hardCodedUnitSequence', `${label}.${key} must not pre-plan a unit chain`);
    assert.notEqual(key, 'preplannedUnitChain', `${label}.${key} must not pre-plan a unit chain`);
    if (Array.isArray(child) && /unit(sequence|chain|plan)|nextunits/i.test(key)) {
      assert.fail(`${label}.${key} must not contain a pre-planned unit chain`);
    }
    assertNoPreplannedUnitChain(child, `${label}.${key}`);
  }
}

function assertPolicySelection({ facts, expectedRuleId, expectedUnitId = null, currentUnitTypeId = 'reviewer-inference' }) {
  const route = selectLifecycleRoute(facts);
  assert.equal(route?.policyRuleId, expectedRuleId);
  assert.equal(policyRuleIds.has(route.policyRuleId), true, `${expectedRuleId} must be declared in the policy table`);
  if (!expectedUnitId) return route;
  assert.equal(route.unitId, expectedUnitId);
  assert.ok(HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes[route.unitId], `${route.unitId} must be registered`);
  const validation = validateNextUnitSelection({
    currentUnitTypeId,
    selectedUnitTypeId: route.unitId,
  });
  assert.equal(validation.ok, true, `${currentUnitTypeId} must be allowed to hand off to ${route.unitId}`);
  return route;
}

assertPolicySelection({
  facts: {
    classification: 'closure-candidate',
    nextIterationAllowed: true,
    commitRequired: true,
  },
  expectedRuleId: 'source-side-effect-before-review',
  expectedUnitId: 'commit-intent',
});
assertPolicySelection({
  facts: {
    classification: 'closure-candidate',
    nextIterationAllowed: true,
    commitRequired: false,
    prReviewRequired: true,
    prReviewSatisfied: false,
    prReviewBlocked: false,
  },
  expectedRuleId: 'required-pr-review-after-commit',
  expectedUnitId: 'pr-review',
});
assertPolicySelection({
  facts: {
    classification: 'closure-candidate',
    nextIterationAllowed: true,
    closureReviewMentioned: true,
    commitRequired: false,
  },
  expectedRuleId: 'closure-review-after-preconditions',
  expectedUnitId: 'closure-review',
});
assertPolicySelection({
  facts: {
    classification: 'closed',
    nextIterationAllowed: true,
    closureReviewDenied: true,
    closureReview: {
      review: {
        terminalAllowed: false,
        reasonCode: 'closure-review-denied',
      },
    },
  },
  expectedRuleId: 'closure-review-denied-needs-continuation',
  expectedUnitId: 'worker',
});
assertPolicySelection({
  facts: {
    classification: 'repairable',
    nextIterationAllowed: true,
    nextIterationMode: 'repair',
    executeRepairSkills: true,
  },
  expectedRuleId: 'reviewer-repair-routes-balance-scan',
  expectedUnitId: 'living-doc-balance-scan',
});
assertPolicySelection({
  facts: {
    classification: 'repairable',
    nextIterationAllowed: true,
    latestRecommendation: {
      sourceUnitType: 'worker',
      sourceUnitRole: 'worker',
      recommendedUnitType: 'living-doc-balance-scan',
      recommendedUnitRole: 'balance-scan',
      reasonCode: 'git-head-unchanged',
    },
    latestRecommendedUnitType: 'living-doc-balance-scan',
    latestRecommendedUnitRole: 'balance-scan',
    latestRecommendationReasonCode: 'git-head-unchanged',
    commitBlocked: true,
  },
  expectedRuleId: 'blocked-commit-intent-gate-needs-continuation',
  expectedUnitId: 'worker',
});
assertPolicySelection({
  facts: {
    classification: 'repairable',
    nextIterationAllowed: true,
    latestRecommendedUnitType: 'worker',
    sameReasonContinuationLoop: true,
    commitBlocked: true,
    reasonCode: 'git-head-unchanged',
  },
  expectedRuleId: 'same-reason-continuation-loop-blocked',
});

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-system-invariants-'));
try {
  const docPath = path.join(tmp, 'doc.json');
  await writeFile(docPath, `${JSON.stringify(minimalDoc(docPath), null, 2)}\n`, 'utf8');

  const sequencePath = path.join(tmp, 'system-invariant-sequence.json');
  await mkdir(path.dirname(sequencePath), { recursive: true });
  await writeFile(sequencePath, `${JSON.stringify({
    schema: 'living-doc-harness-lifecycle-evidence-sequence/v1',
    iterations: [
      {
        stageAfter: 'commit-intent-blocked',
        unresolvedObjectiveTerms: ['commit evidence is blocked and must route through a fresh worker unit'],
        unprovenAcceptanceCriteria: ['criterion-policy-owned-routing'],
        acceptanceCriteriaSatisfied: 'pending',
        closureAllowed: false,
        sourceFilesChanged: true,
        sideEffectEvidence: {
          commit: {
            required: true,
            status: 'blocked',
            blocked: true,
            source: 'commit-intent-output-contract',
            reasonCode: 'git-head-unchanged',
            changedFiles: ['docs/example.json'],
          },
        },
        traceMessage: 'Blocked commit gate should select a fresh worker by routing policy.',
        reviewerVerdict: reviewerVerdict('repairable', {
          reasonCode: 'acceptance-criteria-unproven',
          mode: 'repair',
          instruction: 'Continue through the controller-owned blocker.',
        }),
      },
      {
        stageAfter: 'worker-recommendation-ignored',
        unresolvedObjectiveTerms: ['worker recommendations must not override the controller route'],
        unprovenAcceptanceCriteria: ['criterion-policy-owned-routing'],
        acceptanceCriteriaSatisfied: 'pending',
        closureAllowed: false,
        sourceFilesChanged: true,
        initialInferenceUnitOutputContract: {
          schema: 'living-doc-worker-output/v1',
          status: 'running',
          reasonCode: 'git-head-unchanged',
          basis: ['The worker output is evidence for review, not routing authority.'],
          nextRecommendedUnitType: 'living-doc-balance-scan',
        },
        sideEffectEvidence: {
          commit: {
            required: true,
            status: 'blocked',
            blocked: true,
            source: 'commit-intent-output-contract',
            reasonCode: 'git-head-unchanged',
            changedFiles: ['docs/example.json'],
          },
        },
        traceMessage: 'Worker output recommends balance scan, but the controller ignores worker routing claims.',
        reviewerVerdict: reviewerVerdict('repairable', {
          reasonCode: 'acceptance-criteria-not-satisfied',
          mode: 'repair',
          instruction: 'Ignore worker routing claims and use controller policy.',
        }),
      },
      {
        stageAfter: 'operator-stop-after-invariant-proof',
        unresolvedObjectiveTerms: ['runtime invariant fixture completed'],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pending',
        closureAllowed: false,
        traceMessage: 'Stop after proving runtime handoff invariants.',
        reviewerVerdict: reviewerVerdict('user-stopped', {
          reasonCode: 'operator-stop',
          mode: 'user-stop',
        }),
      },
    ],
  }, null, 2)}\n`, 'utf8');

  const lifecycle = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'runs'),
    evidenceDir: path.join(tmp, 'evidence'),
    dashboardPath: path.join(tmp, 'dashboard.html'),
    evidenceSequencePath: sequencePath,
    now: '2026-05-14T08:00:00.000Z',
  });

  assert.equal(lifecycle.schema, 'living-doc-harness-lifecycle-result/v1');
  assert.equal(lifecycle.iterationCount, 3);
  assertNoPreplannedUnitChain(lifecycle);

  assert.equal(lifecycle.iterations[0].nextAction.selectedUnitType, 'worker');
  assert.equal(lifecycle.iterations[1].nextAction.selectedUnitType, 'worker');
  assert.equal(lifecycle.finalState.kind, 'user-stopped');

  for (const iteration of lifecycle.iterations) {
    const runDir = path.resolve(cwd, iteration.runDir);
    await assertPathRefPairs({
      object: iteration,
      currentRunDir: runDir,
      label: `lifecycle.iterations[${iteration.iteration}]`,
      pairs: [
        ['outputInputPath', 'outputInputRef'],
        ['reviewerVerdictPath', 'reviewerVerdictRef'],
        ['repairSkillResultPath', 'repairSkillResultRef'],
        ['closureReviewResultPath', 'closureReviewResultRef'],
        ['postReviewSelectionPath', 'postReviewSelectionRef'],
        ['restartHandoffPath', 'restartHandoffRef'],
      ],
    });

    const outputInput = JSON.parse(await readFile(path.resolve(cwd, iteration.outputInputPath), 'utf8'));
    assert.equal(outputInput.schema, 'living-doc-harness-output-input/v1');
    assertNoPreplannedUnitChain(outputInput, `outputInput[${iteration.iteration}]`);

    await assertPathRefPairs({
      object: outputInput.previousOutput,
      currentRunDir: runDir,
      label: `outputInput[${iteration.iteration}].previousOutput`,
      pairs: [
        ['evidencePath', 'evidenceRef'],
        ['verdictPath', 'verdictRef'],
        ['reviewerVerdictPath', 'reviewerVerdictRef'],
        ['proofPath', 'proofRef'],
        ['handoverPath', 'handoverRef'],
        ['terminalPath', 'terminalRef'],
        ['bundlePath', 'bundleRef'],
        ['postReviewSelectionPath', 'postReviewSelectionRef'],
      ],
    });

    if (outputInput.nextInput) {
      await assertPathRefPairs({
        object: outputInput.nextInput,
        currentRunDir: runDir,
        label: `outputInput[${iteration.iteration}].nextInput`,
        pairs: [
          ['handoverPath', 'handoverRef'],
          ['repairSkillResultPath', 'repairSkillResultRef'],
          ['outputInputPath', 'outputInputRef'],
        ],
      });
    }

    const selected = outputInput.postReviewSelection?.nextUnit;
    if (!selected) continue;
    assert.equal(outputInput.nextUnit.unitId, selected.unitId);
    assert.equal(policyRuleIds.has(selected.policyRuleId), true, `selected unit ${selected.unitId} must cite a routing policy rule`);
    assert.ok(selected.selectedBy, `selected unit ${selected.unitId} must identify route authority`);
    assert.equal(validateNextUnitSelection({
      currentUnitTypeId: selected.routeAuthority?.sourceUnitType || 'reviewer-inference',
      selectedUnitTypeId: selected.unitId,
    }).ok, true, `selected unit ${selected.unitId} must pass transition validation`);
    assert.ok(HARNESS_INFERENCE_UNIT_REGISTRY.unitTypes[selected.unitId], `selected unit ${selected.unitId} must be registered`);
    for (const [index, ref] of (selected.requiredInputRefs || []).entries()) {
      assertArtifactRef(ref, `outputInput[${iteration.iteration}].nextUnit.requiredInputRefs[${index}]`);
    }
  }

  const firstOutputInput = JSON.parse(await readFile(path.resolve(cwd, lifecycle.iterations[0].outputInputPath), 'utf8'));
  assert.equal(firstOutputInput.postReviewSelection.nextUnit.policyRuleId, 'blocked-commit-intent-gate-needs-continuation');

  const secondOutputInput = JSON.parse(await readFile(path.resolve(cwd, lifecycle.iterations[1].outputInputPath), 'utf8'));
  assert.equal(secondOutputInput.postReviewSelection.nextUnit.policyRuleId, 'blocked-commit-intent-gate-needs-continuation');
  assert.equal(secondOutputInput.postReviewSelection.nextUnit.selectedBy, 'routing-policy');
  assert.equal(secondOutputInput.postReviewSelection.nextUnit.unitId, 'worker');
  assert.equal(secondOutputInput.postReviewSelection.nextUnit.routeAuthority, undefined);

  const thirdOutputInput = JSON.parse(await readFile(path.resolve(cwd, lifecycle.iterations[2].outputInputPath), 'utf8'));
  assert.equal(thirdOutputInput.postReviewSelection.terminalAction.policyRuleId, 'user-stop-terminal');
  assert.equal(thirdOutputInput.postReviewSelection.nextUnit, null);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness system invariant contract spec: all assertions passed');
