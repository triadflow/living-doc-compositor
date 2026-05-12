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
import { writeReviewerInferenceVerdict } from './living-doc-harness-reviewer-inference.mjs';
import { runClosureReviewUnit } from './living-doc-harness-closure-review.mjs';
import { routeStopVerdict } from './living-doc-harness-skill-router.mjs';
import { runRepairSkillChain } from './living-doc-harness-repair-skill-runner.mjs';
import { runContractBoundInferenceUnit } from './living-doc-harness-inference-unit.mjs';
import { writeTerminalState } from './living-doc-harness-terminal-state.mjs';
import { renderDashboard, writeEvidenceBundle } from './living-doc-harness-evidence-dashboard.mjs';
import { attachTraceSummaryToRun } from './living-doc-harness-trace-reader.mjs';
import { validateHarnessContract } from './validate-living-doc-harness-contract.mjs';
import {
  DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
  DEFAULT_PR_REVIEW_POLICY,
  normalizePrReviewPolicy,
  prReviewRequiredForEvidence,
  validateNextUnitSelection,
} from './living-doc-harness-inference-unit-types.mjs';

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

function runRef(runDir, filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? path.relative(runDir, filePath) : filePath;
}

async function fileHash(filePath, fallback = null) {
  if (!filePath) return fallback;
  try {
    return sha256(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function skillsAppliedFromRouting(routing, repairRun = null) {
  const recommended = (routing.actions || [])
    .filter((action) => action.kind === 'skill')
    .map((action) => ({
      skill: action.skill,
      verdict: action.status,
      patchRefs: [],
    }));
  const executed = (repairRun?.chain?.skillResults || [])
    .map((skill) => ({
      skill: skill.skill,
      verdict: skill.status,
      patchRefs: [skill.resultPath, skill.validationPath].filter(Boolean),
    }));
  return [...recommended, ...executed];
}

function proofGatesAfterBundle(evidence) {
  const nativeRefs = evidence.workerEvidence?.nativeInferenceTraceRefs || [];
  return {
    ...(evidence.proofGates || {}),
    nativeTraceInspected: nativeRefs.length > 0 ? 'pass' : evidence.proofGates?.nativeTraceInspected,
    evidenceBundleWritten: 'pass',
  };
}

function prReviewGateFromIterationEvidence(evidence, prReviewPolicy = null) {
  const sideEffects = evidence?.sideEffectEvidence || {};
  const normalizedPolicy = normalizePrReviewPolicy(prReviewPolicy || evidence?.prReviewPolicy || evidence?.requiredHardFacts?.prReviewPolicy || DEFAULT_PR_REVIEW_POLICY);
  const required = prReviewRequiredForEvidence({ policy: normalizedPolicy, evidence });
  const prReview = sideEffects.prReview || {};
  if (!required) {
    return {
      required: false,
      status: normalizedPolicy.mode === 'disabled' ? 'disabled' : 'not-required',
      evidencePresent: false,
    };
  }
  const hasContractArtifactPair = prReview.source === 'pr-review-output-contract'
    && prReview.resultPath
    && prReview.validationPath;
  if (hasContractArtifactPair) {
    const satisfied = prReview.approved === true || prReview.notRequired === true;
    const blocked = prReview.blocked === true || ['blocked', 'failed'].includes(prReview.status);
    return {
      required: true,
      status: satisfied ? 'satisfied' : blocked ? 'blocked' : 'requested',
      evidencePresent: satisfied,
      resultPath: prReview.resultPath,
      validationPath: prReview.validationPath || null,
      reasonCode: prReview.reasonCode || null,
      basis: arr(prReview.basis),
    };
  }
  return {
    required: true,
    status: 'missing',
    evidencePresent: false,
  };
}

function requiredHardFactsFromIterationEvidence(evidence) {
  const sideEffects = evidence?.sideEffectEvidence || {};
  const prReviewPolicy = normalizePrReviewPolicy(evidence?.prReviewPolicy || evidence?.requiredHardFacts?.prReviewPolicy || DEFAULT_PR_REVIEW_POLICY);
  const prReviewRequired = prReviewRequiredForEvidence({ policy: prReviewPolicy, evidence });
  const prReviewGate = prReviewGateFromIterationEvidence(evidence, prReviewPolicy);
  return {
    schema: 'living-doc-harness-required-hard-facts/v1',
    sourceFilesChanged: evidence?.sourceFilesChanged === true,
    dirtyTrackedFiles: arr(evidence?.requiredHardFacts?.dirtyTrackedFiles),
    relevantUntrackedFiles: arr(evidence?.requiredHardFacts?.relevantUntrackedFiles),
    currentRunChangedFiles: arr(evidence?.commitScope?.currentRunChangedFiles || evidence?.requiredHardFacts?.currentRunChangedFiles),
    preExistingDirtyFiles: arr(evidence?.commitScope?.preExistingDirtyFiles || evidence?.requiredHardFacts?.preExistingDirtyFiles),
    allowedCommitFiles: arr(evidence?.commitScope?.allowedCommitFiles || evidence?.requiredHardFacts?.allowedCommitFiles),
    forbiddenCommitFiles: arr(evidence?.commitScope?.forbiddenCommitFiles || evidence?.requiredHardFacts?.forbiddenCommitFiles),
    acceptanceCriteriaSatisfied: evidence?.proofGates?.acceptanceCriteriaSatisfied === 'pass',
    objectiveReady: evidence?.sourceState?.objectiveReady === true,
    documentReady: evidence?.sourceState?.documentReady === true,
    renderedHtmlExists: evidence?.sourceState?.renderedHtmlExists === true,
    closureAllowed: evidence?.proofGates?.closureAllowed === true,
    commitEvidencePresent: Boolean(sideEffects.commit?.sha || sideEffects.commit?.exemption?.approved === true || sideEffects.commit?.notRequired === true),
    prReviewPolicy,
    prReviewRequired,
    prReviewEvidencePresent: prReviewGate.evidencePresent === true,
    prReviewGate,
  };
}

async function ensureControllerEvidenceSnapshot({ runDir, evidence, iteration, now }) {
  const requiredHardFacts = evidence.requiredHardFacts || requiredHardFactsFromIterationEvidence(evidence);
  if (evidence.controllerEvidenceSnapshotPath && evidence.requiredHardFacts) return evidence;
  const snapshot = {
    schema: 'living-doc-harness-controller-evidence-snapshot/v1',
    runId: evidence.runId,
    iteration,
    createdAt: now,
    detectors: {
      suppliedIterationEvidence: evidence,
      note: 'Snapshot written by the iteration finalizer because the supplied evidence predated controller-owned snapshot artifacts.',
    },
    hardFacts: requiredHardFacts,
  };
  const snapshotPath = path.join(runDir, 'artifacts', `iteration-${iteration}-controller-evidence-snapshot.json`);
  await writeJson(snapshotPath, snapshot);
  return {
    ...evidence,
    controllerEvidenceSnapshotPath: evidence.controllerEvidenceSnapshotPath || path.relative(runDir, snapshotPath),
    requiredHardFacts,
  };
}

function repairChainBlockedVerdict(originalVerdict, repairRun) {
  const blocked = repairRun?.chain?.skillResults?.find((item) => ['blocked', 'failed'].includes(item.status));
  const status = repairRun?.chain?.status || blocked?.status || 'blocked';
  const skill = blocked?.skill || 'repair-skill-chain';
  const resultPath = blocked?.resultPath || repairRun?.chainPath || null;
  const reasonCode = blocked?.reasonCode || 'repair-skill-chain-blocked';
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification: 'true-block',
      reasonCode,
      confidence: 'high',
      closureAllowed: false,
      basis: [
        `Repair chain ${status} at ${skill}; the lifecycle cannot start the next worker iteration until this is resolved.`,
        ...(resultPath ? [`Repair result evidence: ${resultPath}`] : []),
        ...arr(originalVerdict?.stopVerdict?.basis),
      ],
    },
    nextIteration: {
      allowed: true,
      mode: 'continuation',
      instruction: 'Continue through a blocker-resolution inference unit; inspect the blocked repair-skill inference unit, resolve or reroute it, and feed the result into the next worker iteration.',
      mustNotDo: [
        'Do not stop the lifecycle unless the objective is closed or the user explicitly stops it.',
      ],
    },
    terminal: {
      kind: 'true-block',
      reasonCode,
      owningLayer: 'repair-skill-inference',
      requiredDecision: 'Resolve the blocked repair-skill inference unit and rerun the standalone lifecycle.',
      requiredProof: resultPath,
      unblockCriteria: [
        'The repair-skill chain result status is complete.',
        'Every ordered repair skill has prompt, input contract, raw JSONL log, result, and validation artifacts.',
        'The output-input artifact does not start the next worker iteration while the repair chain is blocked.',
      ],
      basis: [
        `Repair chain ${status} at ${skill}.`,
        ...(resultPath ? [`Repair result evidence: ${resultPath}`] : []),
      ],
    },
  };
}

function closureReviewBlockedVerdict(originalVerdict, closureReview) {
  const reasonCode = closureReview?.review?.reasonCode || 'closure-review-denied';
  const resultPath = closureReview?.unit?.resultPath || null;
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification: 'true-block',
      reasonCode: 'closure-review-denied',
      confidence: closureReview?.review?.confidence || 'high',
      closureAllowed: false,
      basis: [
        `Closure review denied terminal closure: ${reasonCode}.`,
        ...(resultPath ? [`Closure review evidence: ${resultPath}`] : []),
        ...arr(closureReview?.review?.basis),
        ...arr(originalVerdict?.stopVerdict?.basis),
      ],
    },
    nextIteration: {
      allowed: true,
      mode: 'continuation',
      instruction: 'Continue through a blocker-resolution inference unit; repair the proof ordering or evidence contract that caused closure review to deny terminal closure.',
      mustNotDo: [
        'Do not stop the lifecycle unless the objective is closed or the user explicitly stops it.',
      ],
    },
    terminal: {
      kind: 'true-block',
      reasonCode: 'closure-review-denied',
      owningLayer: 'closure-review-inference',
      requiredDecision: 'Repair the proof ordering or evidence contract that caused closure review to deny terminal closure.',
      requiredProof: resultPath,
      unblockCriteria: [
        'Closure review receives a coherent proof contract.',
        'No required pre-closure proof gate is impossible to satisfy when closure review runs.',
        'A denied closure review writes terminal lifecycle artifacts instead of aborting the controller.',
      ],
      basis: [
        `Closure review denied terminal closure: ${reasonCode}.`,
        ...(resultPath ? [`Closure review evidence: ${resultPath}`] : []),
      ],
    },
  };
}

function continuationVerdict(verdict) {
  const classification = verdict?.stopVerdict?.classification;
  if (!classification || classification === 'closed' || classification === 'user-stopped') return verdict;
  if (verdict.nextIteration?.allowed === true && verdict.nextIteration?.mode && !['none', 'user-stop'].includes(verdict.nextIteration.mode)) {
    return verdict;
  }
  return {
    ...verdict,
    nextIteration: {
      ...verdict.nextIteration,
      allowed: true,
      mode: verdict.nextIteration?.mode && !['none', 'user-stop'].includes(verdict.nextIteration.mode)
        ? verdict.nextIteration.mode
        : 'continuation',
      instruction: verdict.nextIteration?.instruction || 'Continue through the next contract-bound inference unit until the living-doc objective is reached.',
      mustNotDo: arr(verdict.nextIteration?.mustNotDo).length
        ? verdict.nextIteration.mustNotDo
        : [
          'Do not stop the lifecycle unless the objective is closed or the user explicitly stops it.',
          'Do not treat blocker classification, ticket creation, failed proof, or runtime limitation as terminal.',
        ],
    },
  };
}

function terminalKindFromVerdict(verdict) {
  const classification = verdict?.stopVerdict?.classification;
  if (classification === 'closed') return 'closed';
  if (classification === 'user-stopped') return 'user-stopped';
  if (['true-block', 'pivot', 'deferred', 'budget-exhausted'].includes(classification)) return 'continuation-required';
  if (['repairable', 'resumable', 'closure-candidate'].includes(classification)) return 'repair-resumed';
  return 'unknown';
}

function evidenceRequiresCommitIntent(evidence) {
  const sideEffects = evidence?.sideEffectEvidence || {};
  const commit = sideEffects.commit || {};
  const hardFacts = evidence?.requiredHardFacts || {};
  const sourceChanged = evidence?.sourceFilesChanged === true
    || hardFacts.sourceFilesChanged === true
    || commit.required === true;
  if (!sourceChanged) return false;
  return !(commit.sha
    || commit.exemption?.approved === true
    || commit.notRequired === true
    || hardFacts.commitEvidencePresent === true);
}

function evidenceSatisfiesPrReviewPolicy(evidence, prReviewPolicy) {
  const gate = prReviewGateFromIterationEvidence(evidence, prReviewPolicy);
  if (gate.required !== true) return true;
  return gate.status === 'satisfied';
}

function prReviewGateEligibleAtClosureBoundary({ classification }) {
  return ['closed', 'closure-candidate'].includes(classification);
}

function controllerOwnedNextUnitFromVerdict(verdict, { evidencePath, evidence, reviewer, runDir, closureReview } = {}) {
  const classification = String(verdict?.stopVerdict?.classification || '').toLowerCase();
  const instruction = String(verdict?.nextIteration?.instruction || '').toLowerCase();
  const reasonCode = String(verdict?.stopVerdict?.reasonCode || '').toLowerCase();
  const basisText = arr(verdict?.stopVerdict?.basis).join(' ').toLowerCase();
  const text = [instruction, reasonCode, basisText].join(' ');
  const commitRequiredByEvidence = evidenceRequiresCommitIntent(evidence);
  const prReviewPolicy = normalizePrReviewPolicy(evidence?.prReviewPolicy || evidence?.requiredHardFacts?.prReviewPolicy || DEFAULT_PR_REVIEW_POLICY);
  const prReviewRequiredByPolicy = prReviewRequiredForEvidence({ policy: prReviewPolicy, evidence });
  const prReviewGate = evidence?.prReviewGate || evidence?.requiredHardFacts?.prReviewGate || prReviewGateFromIterationEvidence(evidence, prReviewPolicy);
  const prReviewSatisfied = evidenceSatisfiesPrReviewPolicy(evidence, prReviewPolicy);
  const prReviewBlocked = prReviewGate.required === true && prReviewGate.status === 'blocked';
  const prReviewGateMentioned = reasonCode.includes('pr-review')
    || /pr[- ]?review[^\n.]{0,120}(gate|missing|required|policy|evidence)/.test(text)
    || /(gate|missing|required|policy|evidence)[^\n.]{0,120}pr[- ]?review/.test(text);
  const commitPreconditionMentioned = /(controller[- ]owned|controller)[^\n.]{0,120}commit[- ]?(intent|gate)s?/.test(text)
    || /(produce|producing|fresh|missing|pending|requires?|required)[^\n.]{0,100}commit[- ]?(intent|evidence|sha|gate)/.test(text)
    || /commit[- ]?(intent|evidence|sha|gate)[^\n.]{0,120}(pending|missing|required|before closure|controller[- ]owned)/.test(text);
  const commitGateMentioned = reasonCode.includes('commit') || commitPreconditionMentioned;
  const closureReviewMentioned = reasonCode.includes('closure-review')
    || /closure[- ]?review/.test(text);
  const requiredInputPaths = [
    evidencePath ? path.relative(runDir, evidencePath) : null,
    reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
    reviewer?.artifact?.inferenceUnitResultPath || null,
    reviewer?.artifact?.inferenceUnitValidationPath || null,
    prReviewGate.resultPath || null,
    prReviewGate.validationPath || null,
  ].filter(Boolean);

  if (['closure-candidate', 'resumable'].includes(classification)) {
    if (closureReviewMentioned && !commitRequiredByEvidence && !commitPreconditionMentioned && !prReviewRequiredByPolicy) {
      return {
        unitId: 'closure-review',
        role: 'closure-review',
        reasonCode: reasonCode || 'closure-candidate-requests-closure-review',
        requiredInputPaths,
        expectedOutputSchema: 'living-doc-harness-closure-review/v1',
        resultPath: closureReview?.unit?.resultPath ? path.relative(runDir, closureReview.unit.resultPath) : null,
        validationPath: closureReview?.unit?.validationPath ? path.relative(runDir, closureReview.unit.validationPath) : null,
        status: closureReview ? (closureReview.review.terminalAllowed ? 'approved' : 'blocked') : 'selected',
      };
    }
  }

  if (
    ['closure-candidate', 'resumable', 'repairable'].includes(classification)
    && commitRequiredByEvidence
  ) {
    return {
      unitId: 'commit-intent',
      role: 'commit-intent',
      reasonCode: commitRequiredByEvidence
        ? `${classification}-source-changes-require-commit-evidence`
        : `${classification}-requires-commit-intent`,
      requiredInputPaths,
      expectedOutputSchema: 'living-doc-harness-commit-intent-result/v1',
      status: 'selected',
    };
  }

  if (
    prReviewRequiredByPolicy
    && !prReviewSatisfied
    && prReviewBlocked
    && prReviewGateMentioned
  ) {
    return {
      unitId: 'continuation-inference',
      role: 'continuation',
      reasonCode: prReviewGate.reasonCode || reasonCode || 'pr-review-gate-blocked',
      prReviewPolicy,
      prReviewGate,
      reviewerVerdictPath: reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
      livingDocPath: evidence?.livingDocPath || null,
      requiredInputPaths,
      expectedOutputSchema: 'living-doc-continuation-result/v1',
      status: 'selected',
    };
  }

  if (
    prReviewRequiredByPolicy
    && !prReviewSatisfied
    && !prReviewBlocked
    && !commitRequiredByEvidence
    && (
      prReviewGateEligibleAtClosureBoundary({ classification })
      || prReviewGateMentioned
    )
  ) {
    return {
      unitId: 'pr-review',
      role: 'pr-review',
      reasonCode: prReviewGateMentioned ? reasonCode || 'pr-review-policy-gate-missing' : 'pr-review-required-by-run-policy',
      prReviewPolicy,
      reviewerVerdictPath: reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
      livingDocPath: evidence?.livingDocPath || null,
      requiredInputPaths,
      expectedOutputSchema: 'living-doc-harness-pr-review-result/v1',
      status: 'selected',
    };
  }

  const explicitControllerClosure = [
    'controller-evidence-pending',
    'controller-owned-closure-review-required',
    'closure-review-required',
  ].includes(reasonCode);
  const preconditionPending = reasonCode.includes('commit-evidence')
    || /(produce|producing|fresh|missing|pending)[^\n.]{0,80}commit[- ]?(intent|evidence|sha)/.test(text)
    || /commit[- ]?(intent|evidence|sha)[^\n.]{0,80}(pending|missing|required before|before closure)/.test(text)
    || /side[- ]effect[^\n.]{0,80}(pending|missing|produce|producing)/.test(text)
    || /criteria[- ]?pending|acceptance[^\n.]{0,80}pending/.test(text);
  if (!explicitControllerClosure || preconditionPending) return null;
  return {
    unitId: 'closure-review',
    role: 'closure-review',
    reasonCode: reasonCode || 'controller-owned-closure-review-required',
    requiredInputPaths,
    expectedOutputSchema: 'living-doc-harness-closure-review/v1',
    resultPath: closureReview?.unit?.resultPath ? path.relative(runDir, closureReview.unit.resultPath) : null,
    validationPath: closureReview?.unit?.validationPath ? path.relative(runDir, closureReview.unit.validationPath) : null,
    status: closureReview ? (closureReview.review.terminalAllowed ? 'approved' : 'blocked') : 'selected',
  };
}

function finalizePostReviewSelection({ selected, runDir, evidencePath, reviewer, allowedUnitTypes }) {
  if (!selected.nextUnit) {
    selected.contractValidation = {
      ok: true,
      reasonCode: selected.terminalAction ? 'terminal-action-selected' : 'no-next-unit-selected',
      allowedUnitTypes,
    };
    return selected;
  }
  const validation = validateNextUnitSelection({
    currentUnitTypeId: 'reviewer-inference',
    selectedUnitTypeId: selected.nextUnit.unitId,
    allowedUnitTypes,
  });
  selected.contractValidation = validation;
  if (validation.ok) return selected;
  selected.nextUnit = {
    unitId: 'continuation-inference',
    role: 'continuation',
    reasonCode: validation.reasonCode,
    requiredInputPaths: [
      evidencePath ? path.relative(runDir, evidencePath) : null,
      reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
    ].filter(Boolean),
    expectedOutputSchema: 'living-doc-continuation-result/v1',
    status: 'selected',
  };
  selected.contractValidation = validateNextUnitSelection({
    currentUnitTypeId: 'reviewer-inference',
    selectedUnitTypeId: selected.nextUnit.unitId,
    allowedUnitTypes,
  });
  return selected;
}

function buildPostReviewSelection({
  runDir,
  evidencePath,
  evidence,
  reviewer,
  verdict,
  effectiveVerdict,
  closureReview,
  repairRun,
  iteration,
  now,
  executeRepairSkills,
  allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
}) {
  const classification = verdict?.stopVerdict?.classification || 'unknown';
  const prReviewPolicy = normalizePrReviewPolicy(evidence?.prReviewPolicy || evidence?.requiredHardFacts?.prReviewPolicy || DEFAULT_PR_REVIEW_POLICY);
  const prReviewGate = evidence?.prReviewGate || evidence?.requiredHardFacts?.prReviewGate || prReviewGateFromIterationEvidence(evidence, prReviewPolicy);
  const selected = {
    schema: 'living-doc-harness-post-review-selection/v1',
    runId: verdict?.runId || reviewer?.artifact?.runId || null,
    iteration,
    createdAt: now,
    reviewerVerdictPath: reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
    reviewerInferenceUnitResultPath: reviewer?.artifact?.inferenceUnitResultPath || null,
    classification,
    reasonCode: verdict?.stopVerdict?.reasonCode || null,
    prReviewPolicy,
    prReviewRequired: prReviewGate.required === true,
    prReviewGate,
    selectionBasis: [
      'Only worker and reviewer are fixed bootstrap units.',
      'This selection records the post-review unit or terminal action chosen from reviewer output and proof state.',
    ],
  };

  if (classification === 'closed') {
    const sideEffects = evidence?.sideEffectEvidence || {};
    const prSatisfied = evidenceSatisfiesPrReviewPolicy(evidence, prReviewPolicy);

    if (evidenceRequiresCommitIntent(evidence)) {
      selected.nextUnit = {
        unitId: 'commit-intent',
        role: 'commit-intent',
        reasonCode: 'source-changes-require-commit-evidence',
        requiredInputPaths: [evidencePath ? path.relative(runDir, evidencePath) : null, reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null].filter(Boolean),
        expectedOutputSchema: 'living-doc-harness-commit-intent-result/v1',
        status: 'selected',
      };
      return finalizePostReviewSelection({ selected, runDir, evidencePath, reviewer, allowedUnitTypes });
    }
    if (!prSatisfied) {
      if (prReviewGate.status === 'blocked') {
        selected.nextUnit = {
          unitId: 'continuation-inference',
          role: 'continuation',
          reasonCode: prReviewGate.reasonCode || 'pr-review-gate-blocked',
          prReviewPolicy,
          prReviewGate,
          reviewerVerdictPath: reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
          livingDocPath: evidence?.livingDocPath || null,
          requiredInputPaths: [
            evidencePath ? path.relative(runDir, evidencePath) : null,
            reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
            runRef(runDir, prReviewGate.resultPath),
            runRef(runDir, prReviewGate.validationPath),
          ].filter(Boolean),
          expectedOutputSchema: 'living-doc-continuation-result/v1',
          status: 'selected',
        };
        return finalizePostReviewSelection({ selected, runDir, evidencePath, reviewer, allowedUnitTypes });
      }
      selected.nextUnit = {
        unitId: 'pr-review',
        role: 'pr-review',
        reasonCode: 'pr-review-required-by-run-policy',
        prReviewPolicy,
        reviewerVerdictPath: reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
        livingDocPath: evidence?.livingDocPath || null,
        requiredInputPaths: [evidencePath ? path.relative(runDir, evidencePath) : null, reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null].filter(Boolean),
        expectedOutputSchema: 'living-doc-harness-pr-review-result/v1',
        status: 'selected',
      };
      return finalizePostReviewSelection({ selected, runDir, evidencePath, reviewer, allowedUnitTypes });
    }
    selected.nextUnit = {
      unitId: 'closure-review',
      role: 'closure-review',
      reasonCode: 'reviewer-closed-requires-final-closure-review',
      requiredInputPaths: [
        evidencePath ? path.relative(runDir, evidencePath) : null,
        reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
        reviewer?.artifact?.inferenceUnitResultPath || null,
        reviewer?.artifact?.inferenceUnitValidationPath || null,
        runRef(runDir, sideEffects.prReview?.resultPath),
        runRef(runDir, sideEffects.prReview?.validationPath),
      ].filter(Boolean),
      expectedOutputSchema: 'living-doc-harness-closure-review/v1',
      resultPath: closureReview?.unit?.resultPath ? path.relative(runDir, closureReview.unit.resultPath) : null,
      validationPath: closureReview?.unit?.validationPath ? path.relative(runDir, closureReview.unit.validationPath) : null,
      status: closureReview ? (closureReview.review.terminalAllowed ? 'approved' : 'blocked') : 'selected',
    };
    if (closureReview) {
      if (closureReview.review.terminalAllowed) {
        selected.terminalAction = {
          kind: 'closed',
          reasonCode: closureReview.review.reasonCode,
          selectedBy: 'closure-review',
        };
      } else {
        selected.nextUnit = {
          unitId: 'continuation-inference',
          role: 'continuation',
          reasonCode: 'closure-review-denied',
          requiredInputPaths: [
            evidencePath ? path.relative(runDir, evidencePath) : null,
            reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
            closureReview?.unit?.resultPath ? path.relative(runDir, closureReview.unit.resultPath) : null,
            closureReview?.unit?.codexEventsPath ? path.relative(runDir, closureReview.unit.codexEventsPath) : null,
          ].filter(Boolean),
          expectedOutputSchema: 'living-doc-continuation-result/v1',
          status: 'selected',
        };
      }
    }
    return finalizePostReviewSelection({ selected, runDir, evidencePath, reviewer, allowedUnitTypes });
  }

  if (classification === 'user-stopped') {
    selected.terminalAction = {
      kind: 'user-stopped',
      reasonCode: verdict?.stopVerdict?.reasonCode || 'user-stopped',
      selectedBy: 'user-stop',
    };
    return finalizePostReviewSelection({ selected, runDir, evidencePath, reviewer, allowedUnitTypes });
  }

  if (['true-block', 'pivot', 'deferred', 'budget-exhausted'].includes(classification)) {
    selected.nextUnit = {
      unitId: 'continuation-inference',
      role: 'continuation',
      reasonCode: verdict?.stopVerdict?.reasonCode || classification,
      requiredInputPaths: [
        evidencePath ? path.relative(runDir, evidencePath) : null,
        reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
        reviewer?.artifact?.inferenceUnitResultPath || null,
        reviewer?.artifact?.codexEventsPath || null,
      ].filter(Boolean),
      expectedOutputSchema: 'living-doc-continuation-result/v1',
      status: 'selected',
    };
    return finalizePostReviewSelection({ selected, runDir, evidencePath, reviewer, allowedUnitTypes });
  }

  const controllerOwnedNextUnit = verdict?.nextIteration?.allowed !== false
    ? controllerOwnedNextUnitFromVerdict(verdict, { evidencePath, evidence, reviewer, runDir, closureReview })
    : null;
  if (controllerOwnedNextUnit) {
    selected.nextUnit = controllerOwnedNextUnit;
    return finalizePostReviewSelection({ selected, runDir, evidencePath, reviewer, allowedUnitTypes });
  }

  if (verdict?.nextIteration?.allowed !== false && verdict?.nextIteration?.mode === 'repair') {
    selected.nextUnit = executeRepairSkills
      ? {
        unitId: 'living-doc-balance-scan',
        role: 'balance-scan',
        reasonCode: 'reviewer-selected-repair',
        requiredInputPaths: [
          reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
          evidencePath ? path.relative(runDir, evidencePath) : null,
        ].filter(Boolean),
        expectedOutputSchema: 'living-doc-balance-scan-result/v1',
        resultPath: repairRun?.chainPath ? path.relative(runDir, repairRun.chainPath) : null,
        status: repairRun?.chain?.status || 'selected',
      }
      : {
        unitId: 'worker',
        role: 'worker',
        reasonCode: 'repair-resumed-without-executed-repair-units',
        expectedOutputSchema: 'living-doc-worker-output/v1',
        status: 'selected',
      };
    if (repairRun && ['blocked', 'failed'].includes(repairRun.chain?.status)) {
      selected.nextUnit = {
        unitId: 'continuation-inference',
        role: 'continuation',
        reasonCode: 'repair-skill-chain-blocked',
        requiredInputPaths: [
          evidencePath ? path.relative(runDir, evidencePath) : null,
          reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
          repairRun?.chainPath ? path.relative(runDir, repairRun.chainPath) : null,
        ].filter(Boolean),
        expectedOutputSchema: 'living-doc-continuation-result/v1',
        status: 'selected',
      };
    }
    return finalizePostReviewSelection({ selected, runDir, evidencePath, reviewer, allowedUnitTypes });
  }

  if (verdict?.nextIteration?.allowed !== false) {
    selected.nextUnit = {
      unitId: 'worker',
      role: 'worker',
      reasonCode: 'reviewer-authorized-continuation',
      expectedOutputSchema: 'living-doc-worker-output/v1',
      status: 'selected',
    };
    return finalizePostReviewSelection({ selected, runDir, evidencePath, reviewer, allowedUnitTypes });
  }

  selected.terminalAction = {
    kind: terminalKindFromVerdict(effectiveVerdict || verdict),
    reasonCode: (effectiveVerdict || verdict)?.stopVerdict?.reasonCode || 'no-valid-next-unit',
    selectedBy: 'reviewer-verdict',
  };
  return finalizePostReviewSelection({ selected, runDir, evidencePath, reviewer, allowedUnitTypes });
}

function sideEffectGateBlockedVerdict(verdict, selection) {
  const unitId = selection?.nextUnit?.unitId;
  if (!['closed', 'closure-candidate'].includes(verdict?.stopVerdict?.classification) || !['commit-intent', 'pr-review'].includes(unitId)) return null;
  const reasonCode = selection.nextUnit.reasonCode || `${unitId}-required-before-closure`;
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification: 'true-block',
      reasonCode,
      confidence: verdict.stopVerdict.confidence || 'high',
      closureAllowed: false,
      basis: [
        `Reviewer selected closure, but ${unitId} contract evidence is required before closure-review may run.`,
        ...arr(verdict.stopVerdict.basis),
      ],
    },
    nextIteration: {
      allowed: true,
      mode: 'continuation',
      instruction: `Continue through the ${unitId} contract and return its side-effect evidence before closure review.`,
      mustNotDo: [
        'Do not persist closed terminal state until side-effect contract evidence is present.',
      ],
    },
    terminal: {
      kind: 'true-block',
      reasonCode,
      owningLayer: unitId,
      requiredDecision: `Execute or exempt the ${unitId} contract evidence required for closure.`,
      requiredProof: selection.nextUnit.expectedOutputSchema,
      unblockCriteria: [
        `${unitId} result artifact exists and validates against its registered output contract.`,
        'Closure review receives sideEffectEvidence satisfying the configured gate.',
      ],
      basis: [`Missing ${unitId} contract evidence.`],
    },
  };
}

async function runSelectedSideEffectGateUnit({
  runDir,
  evidence,
  selection,
  iteration,
  now,
  allowedUnitTypes,
}) {
  const unitId = selection?.nextUnit?.unitId;
  if (!['commit-intent', 'pr-review'].includes(unitId)) return null;
  const requiredInspectionPaths = arr(selection.nextUnit.requiredInputPaths);
  const changedFiles = arr(evidence?.workerEvidence?.filesChanged);
  const common = {
    runDir,
    rootDir: 'inference-units',
    iteration,
    sequence: unitId === 'commit-intent' ? 4 : 5,
    unitId,
    role: selection.nextUnit.role || unitId,
    unitTypeId: unitId,
    allowedUnitTypes,
    execute: false,
    cwd: process.cwd(),
    now,
  };

  if (unitId === 'commit-intent') {
    const input = {
      schema: 'living-doc-harness-commit-intent-input/v1',
      runId: evidence?.runId,
      iteration,
      changedFiles,
      evidenceSnapshotPath: evidence?.controllerEvidenceSnapshotPath || evidence?.controllerEvidence?.snapshotPath || null,
      requiredHardFacts: evidence?.requiredHardFacts || null,
      commitIntent: evidence?.commitIntent || {
        mode: 'required-before-closure',
        reason: selection.nextUnit.reasonCode || 'source-changes-require-commit-evidence',
      },
      commitPolicy: {
        exactFilesOnly: true,
        forbidPreExistingDirtyFiles: true,
        reason: 'Commit-intent may only approve files scoped by controller-owned evidence.',
      },
      requiredInspectionPaths,
    };
    return runContractBoundInferenceUnit({
      ...common,
      prompt: `Evaluate the commit-intent gate before closure.\n\n${JSON.stringify(input, null, 2)}`,
      inputContract: input,
      fixtureResult: {
        status: 'blocked',
        basis: ['Commit-intent side-effect evidence is required before closure review may persist terminal closure.'],
        outputContract: {
          schema: 'living-doc-harness-commit-intent-result/v1',
          approved: false,
          status: 'blocked',
          changedFiles,
          message: 'Commit evidence is missing; continue through the commit-intent contract before closure.',
          sideEffect: {
            type: 'git-commit',
            executed: false,
            reasonCode: selection.nextUnit.reasonCode || 'source-changes-require-commit-evidence',
          },
        },
      },
    });
  }

  const input = {
    schema: 'living-doc-harness-pr-review-input/v1',
    runId: evidence?.runId,
    iteration,
    livingDocPath: selection.nextUnit.livingDocPath || evidence?.livingDocPath || null,
    reviewerVerdictPath: selection.nextUnit.reviewerVerdictPath || null,
    reviewTarget: evidence?.prReview?.reviewTarget || evidence?.prReview?.url || 'configured-pr-review-target',
    evidenceSnapshotPath: evidence?.controllerEvidenceSnapshotPath || evidence?.controllerEvidence?.snapshotPath || null,
    requiredHardFacts: evidence?.requiredHardFacts || null,
    prReviewPolicy: evidence?.prReviewPolicy || evidence?.requiredHardFacts?.prReviewPolicy || DEFAULT_PR_REVIEW_POLICY,
    prReviewRequired: evidence?.prReviewRequired === true || evidence?.requiredHardFacts?.prReviewRequired === true,
    changedFiles: arr(evidence?.requiredHardFacts?.currentRunChangedFiles).length
      ? arr(evidence.requiredHardFacts.currentRunChangedFiles)
      : arr(evidence?.workerEvidence?.filesChanged),
    commitEvidence: evidence?.sideEffectEvidence?.commit || null,
    requiredInspectionPaths,
  };
  return runContractBoundInferenceUnit({
    ...common,
    prompt: `Evaluate the PR-review gate before closure.\n\n${JSON.stringify(input, null, 2)}`,
    inputContract: input,
    fixtureResult: {
      status: 'blocked',
      basis: ['PR-review contract evidence is required before closure review may persist terminal closure.'],
      outputContract: {
        schema: 'living-doc-harness-pr-review-result/v1',
        status: 'blocked',
        approvedActions: [],
        sideEffect: {
          type: 'github-pr-review',
          executed: false,
          reasonCode: selection.nextUnit.reasonCode || 'pr-review-required-by-run-config',
        },
      },
    },
  });
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

async function buildIterationProof({ runDir, evidence, verdict, reviewer, closureReview, postReviewSelection, routing, repairRun, livingDocPath, afterDocPath, iteration, now }) {
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
    reviewerInference: {
      verdictPath: reviewer?.artifactPath ? path.relative(runDir, reviewer.artifactPath) : null,
      inputPath: reviewer?.inputPath ? path.relative(runDir, reviewer.inputPath) : null,
      mode: reviewer?.artifact?.mode || null,
      inferenceUnitResultPath: reviewer?.artifact?.inferenceUnitResultPath || null,
      inferenceUnitValidationPath: reviewer?.artifact?.inferenceUnitValidationPath || null,
      inferenceUnitInputContractPath: reviewer?.artifact?.inferenceUnitInputContractPath || null,
      inferenceUnitPromptPath: reviewer?.artifact?.inferenceUnitPromptPath || null,
    },
    closureReview: closureReview ? {
      approved: closureReview.review.approved,
      terminalAllowed: closureReview.review.terminalAllowed,
      reasonCode: closureReview.review.reasonCode,
      inferenceUnitResultPath: path.relative(runDir, closureReview.unit.resultPath),
      inferenceUnitValidationPath: path.relative(runDir, closureReview.unit.validationPath),
      inferenceUnitInputContractPath: path.relative(runDir, closureReview.unit.inputContractPath),
      inferenceUnitPromptPath: path.relative(runDir, closureReview.unit.promptPath),
    } : null,
    postReviewSelection: postReviewSelection ? {
      selectionPath: postReviewSelection.selectionPath ? path.relative(runDir, postReviewSelection.selectionPath) : null,
      prReviewPolicy: postReviewSelection.artifact.prReviewPolicy || null,
      prReviewRequired: postReviewSelection.artifact.prReviewRequired === true,
      prReviewGate: postReviewSelection.artifact.prReviewGate || null,
      nextUnit: postReviewSelection.artifact.nextUnit || null,
      terminalAction: postReviewSelection.artifact.terminalAction || null,
    } : null,
    stopVerdict: verdict.stopVerdict,
    skillsApplied: skillsAppliedFromRouting(routing, repairRun),
    controllerEvidenceSnapshotPath: evidence.controllerEvidenceSnapshotPath || null,
    requiredHardFacts: evidence.requiredHardFacts || null,
    prReviewPolicy: evidence.prReviewPolicy || evidence.requiredHardFacts?.prReviewPolicy || null,
    prReviewRequired: evidence.prReviewRequired === true || evidence.requiredHardFacts?.prReviewRequired === true,
    controllerProofRoutes: evidence.controllerProofRoutes || null,
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
  reviewerVerdict = null,
  reviewerVerdictPath = null,
  executeReviewer = false,
  executeClosureReview = executeReviewer,
  executeRepairSkills = false,
  executeRepairSkillUnits = false,
  repairSkillPlan = null,
  codexBin = 'codex',
  allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
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
  let finalEvidence = {
    ...traceEnrichedEvidence,
    livingDocPath: traceEnrichedEvidence.livingDocPath || livingDocPath || afterDocPath || null,
    proofGates: proofGatesAfterBundle(traceEnrichedEvidence),
  };
  const artifactsDir = path.join(runDir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });
  finalEvidence = await ensureControllerEvidenceSnapshot({
    runDir,
    evidence: finalEvidence,
    iteration,
    now,
  });

  const reviewer = await writeReviewerInferenceVerdict({
    runDir,
    evidence: finalEvidence,
    evidencePath,
    iteration,
    now,
    reviewerVerdict,
    reviewerVerdictPath,
    executeReviewer,
    codexBin,
    cwd: process.cwd(),
    allowedUnitTypes,
  });
  const verdict = continuationVerdict(reviewer.verdict);
  const evidenceSnapshotPath = path.join(artifactsDir, `iteration-${iteration}-evidence.json`);
  const verdictPath = path.join(artifactsDir, `iteration-${iteration}-stop-verdict.json`);
  await writeJson(evidenceSnapshotPath, finalEvidence);
  await writeJson(verdictPath, verdict);
  const closureEvidencePath = evidenceSnapshotPath;

  const initialPostReviewSelection = buildPostReviewSelection({
    runDir,
    evidencePath: closureEvidencePath,
    evidence: finalEvidence,
    reviewer,
    verdict,
    effectiveVerdict: verdict,
    closureReview: null,
    repairRun: null,
    iteration,
    now,
    executeRepairSkills,
    allowedUnitTypes,
  });

  const closureReview = initialPostReviewSelection.nextUnit?.unitId === 'closure-review'
    ? await runClosureReviewUnit({
      runDir,
      evidence: finalEvidence,
      evidencePath: closureEvidencePath,
      reviewer,
      verdict,
      iteration,
      now,
      executeClosureReview,
      codexBin,
      cwd: process.cwd(),
      allowedUnitTypes,
    })
    : null;
  const selectedSideEffectGateUnit = await runSelectedSideEffectGateUnit({
    runDir,
    evidence: finalEvidence,
    selection: initialPostReviewSelection,
    iteration,
    now,
    allowedUnitTypes,
  });

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
  const shouldRunRepairSkills = initialPostReviewSelection.nextUnit?.unitId === 'living-doc-balance-scan';
  const repairRun = shouldRunRepairSkills
    ? await runRepairSkillChain({
      runDir,
      iteration,
      livingDocPath: afterDocPath || livingDocPath,
      renderedHtmlPath: String(afterDocPath || livingDocPath || '').replace(/\.json$/i, '.html'),
      reviewerVerdictPath: reviewer.artifactPath,
      handoverPath: routed.handoverPath,
      repairSkillPlan: repairSkillPlan || {},
      executeUnits: executeRepairSkillUnits,
      codexBin,
      cwd: process.cwd(),
      now,
      allowedUnitTypes,
    })
    : null;
  let effectiveVerdict = verdict;
  const sideEffectBlockedVerdict = sideEffectGateBlockedVerdict(verdict, initialPostReviewSelection);
  if (sideEffectBlockedVerdict) {
    effectiveVerdict = sideEffectBlockedVerdict;
  } else if (verdict.stopVerdict?.classification === 'closed' && closureReview && (!closureReview.review.approved || !closureReview.review.terminalAllowed)) {
    effectiveVerdict = closureReviewBlockedVerdict(verdict, closureReview);
  } else if (['blocked', 'failed'].includes(repairRun?.chain?.status)) {
    effectiveVerdict = repairChainBlockedVerdict(verdict, repairRun);
  }
  if (effectiveVerdict !== verdict) {
    await writeJson(verdictPath, effectiveVerdict);
  }
  const postReviewSelectionArtifact = buildPostReviewSelection({
    runDir,
    evidencePath: closureEvidencePath,
    evidence: finalEvidence,
    reviewer,
    verdict,
    effectiveVerdict,
    closureReview,
    repairRun,
    iteration,
    now,
    executeRepairSkills,
    allowedUnitTypes,
  });
  if (
    selectedSideEffectGateUnit
    && postReviewSelectionArtifact.nextUnit?.unitId === selectedSideEffectGateUnit.result.unitId
  ) {
    postReviewSelectionArtifact.nextUnit = {
      ...postReviewSelectionArtifact.nextUnit,
      resultPath: path.relative(runDir, selectedSideEffectGateUnit.resultPath),
      validationPath: path.relative(runDir, selectedSideEffectGateUnit.validationPath),
      inputContractPath: path.relative(runDir, selectedSideEffectGateUnit.inputContractPath),
      promptPath: path.relative(runDir, selectedSideEffectGateUnit.promptPath),
      codexEventsPath: path.relative(runDir, selectedSideEffectGateUnit.codexEventsPath),
      status: selectedSideEffectGateUnit.result.status,
    };
  }
  const postReviewSelectionPath = path.join(artifactsDir, `iteration-${iteration}-post-review-selection.json`);
  await writeJson(postReviewSelectionPath, postReviewSelectionArtifact);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'post-review-selection-written',
    at: now,
    runId: evidence.runId,
    iteration,
    classification: verdict.stopVerdict?.classification,
    nextUnit: postReviewSelectionArtifact.nextUnit?.unitId || null,
    terminalAction: postReviewSelectionArtifact.terminalAction?.kind || null,
    selectionPath: path.relative(runDir, postReviewSelectionPath),
  });
  const terminal = await writeTerminalState({
    runDir,
    verdict: effectiveVerdict,
    evidence: finalEvidence,
    iteration,
    now,
  });
  const bundleResult = await writeEvidenceBundle({ runDir, outDir: evidenceDir, now });
  const proof = await buildIterationProof({
    runDir,
    evidence: finalEvidence,
    verdict: effectiveVerdict,
    reviewer,
    closureReview,
    postReviewSelection: {
      artifact: postReviewSelectionArtifact,
      selectionPath: postReviewSelectionPath,
    },
    routing: routed.routing,
    repairRun,
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
    classification: effectiveVerdict.stopVerdict.classification,
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
    classification: effectiveVerdict.stopVerdict.classification,
    terminalKind: terminal.record.kind,
    nextIteration: effectiveVerdict.nextIteration,
    evidencePath: evidenceSnapshotPath,
    verdictPath,
    reviewerVerdictPath: reviewer.artifactPath,
    reviewerInputPath: reviewer.inputPath,
    handoverPath: routed.handoverPath,
    terminalPath: terminal.terminalPath,
    blockerPath: terminal.blockerPath,
    bundlePath: bundleResult.bundlePath,
    summaryPath: bundleResult.summaryPath,
    proofPath,
    proofValidationPath,
    proofValid: proofValidation.ok,
    dashboardPath: dashboard.outPath,
    repairSkillResultPath: repairRun?.chainPath || null,
    closureReviewResultPath: closureReview?.unit?.resultPath || null,
    postReviewSelectionPath,
    postReviewSelection: postReviewSelectionArtifact,
    prReviewPolicy: postReviewSelectionArtifact.prReviewPolicy || null,
    prReviewRequired: postReviewSelectionArtifact.prReviewRequired === true,
    prReviewGate: postReviewSelectionArtifact.prReviewGate || null,
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
    reviewerVerdictPath: null,
    executeReviewer: false,
    executeClosureReview: false,
    codexBin: 'codex',
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
    } else if (flag === '--reviewer-verdict') {
      options.reviewerVerdictPath = args.shift();
      if (!options.reviewerVerdictPath) throw new Error('--reviewer-verdict requires a value');
    } else if (flag === '--execute-reviewer') {
      options.executeReviewer = true;
      options.executeClosureReview = true;
    } else if (flag === '--execute-closure-review') {
      options.executeClosureReview = true;
    } else if (flag === '--codex-bin') {
      options.codexBin = args.shift();
      if (!options.codexBin) throw new Error('--codex-bin requires a value');
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
    if (process.env.LIVING_DOC_HARNESS_ROLE === 'worker') {
      throw new Error('harness iteration commands are lifecycle-owned and cannot run from inside a worker inference process');
    }
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
