#!/usr/bin/env node
// Closure-review contract-bound inference unit.
//
// Reviewer inference emits the stop signal. This unit is the final closure
// reviewer for a closed transition: it checks the frozen evidence and reviewer
// verdict before the lifecycle is allowed to persist terminal closure.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { runContractBoundInferenceUnit } from './living-doc-harness-inference-unit.mjs';

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function rel(runDir, filePath) {
  return filePath ? path.relative(runDir, filePath) : null;
}

function closureApprovedFromEvidence({ evidence, verdict }) {
  const gates = evidence?.proofGates || {};
  const sideEffects = evidence?.sideEffectEvidence || {};
  const sourceChanged = evidence?.sourceFilesChanged === true || sideEffects.commit?.required === true;
  const commitGateSatisfied = !sourceChanged
    || sideEffects.commit?.sha
    || sideEffects.commit?.exemption?.approved === true
    || sideEffects.commit?.notRequired === true;
  const prGateSatisfied = evidence?.prReviewRequired === true
    ? Boolean(sideEffects.prReview?.url || sideEffects.prReview?.notRequired === true)
    : true;
  return verdict?.stopVerdict?.classification === 'closed'
    && (verdict.stopVerdict.closureAllowed === true || verdict.proofGates?.closureAllowed === true)
    && gates.standaloneRun === 'pass'
    && gates.nativeTraceInspected === 'pass'
    && gates.livingDocRendered === 'pass'
    && gates.acceptanceCriteriaSatisfied === 'pass'
    && gates.evidenceBundleWritten === 'pass'
    && gates.closureAllowed === true
    && arr(evidence?.objectiveState?.unresolvedObjectiveTerms).length === 0
    && arr(evidence?.objectiveState?.unprovenAcceptanceCriteria).length === 0
    && arr(evidence?.workerEvidence?.nativeInferenceTraceRefs).length > 0
    && commitGateSatisfied
    && prGateSatisfied;
}

function closureReviewPrompt(input) {
  return `You are the closure-review inference unit for a standalone living-doc harness.

You are not the worker and you are not the reviewer that emitted the first stop verdict.
You are the final closure reviewer. Emit JSON only.

Mandatory inspection:
- Inspect every file path in requiredInspectionPaths before emitting JSON.
- If any required path cannot be read, return approved false.
- Do not approve closure from worker self-report, wrapper summaries, deterministic validation alone, or a reviewer verdict that lacks evidence.

Return this JSON shape:
{
  "schema": "living-doc-harness-closure-review/v1",
  "approved": false,
  "reasonCode": "short-kebab-case",
  "confidence": "low|medium|high",
  "basis": ["specific evidence-based reason"],
  "terminalAllowed": false
}

Only set approved true and terminalAllowed true when the reviewer verdict is closed, closureAllowed is true, all proof gates pass, native trace evidence exists, no objective terms remain unresolved, and no acceptance criteria remain unproven.
If source files changed, require sideEffectEvidence.commit.sha or an explicit approved no-commit exemption. If PR review is configured, require sideEffectEvidence.prReview evidence.

Frozen closure-review input:
${JSON.stringify(input, null, 2)}
`;
}

function normalizeClosureReview(value) {
  const review = value?.schema === 'living-doc-contract-bound-inference-result/v1'
    ? value.outputContract
    : value;
  if (review?.schema !== 'living-doc-harness-closure-review/v1') {
    throw new Error('closure review output must use schema living-doc-harness-closure-review/v1');
  }
  if (typeof review.approved !== 'boolean') throw new Error('closure review approved must be boolean');
  if (typeof review.terminalAllowed !== 'boolean') throw new Error('closure review terminalAllowed must be boolean');
  if (!review.reasonCode) throw new Error('closure review reasonCode is required');
  if (!['low', 'medium', 'high'].includes(review.confidence)) throw new Error('closure review confidence must be low, medium, or high');
  if (!Array.isArray(review.basis) || review.basis.length === 0) throw new Error('closure review basis must contain at least one item');
  return review;
}

export async function runClosureReviewUnit({
  runDir,
  evidence,
  evidencePath,
  reviewer,
  verdict,
  iteration = 1,
  now = new Date().toISOString(),
  executeClosureReview = false,
  codexBin = 'codex',
  cwd = process.cwd(),
  allowedUnitTypes = null,
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!evidence) throw new Error('evidence is required');
  if (!verdict) throw new Error('verdict is required');

  const requiredInspectionPaths = [
    evidencePath,
    reviewer?.artifactPath,
    reviewer?.artifact?.inferenceUnitResultPath ? path.resolve(runDir, reviewer.artifact.inferenceUnitResultPath) : null,
    reviewer?.artifact?.inferenceUnitValidationPath ? path.resolve(runDir, reviewer.artifact.inferenceUnitValidationPath) : null,
  ].filter(Boolean);
  const approved = closureApprovedFromEvidence({ evidence, verdict });
  const input = {
    schema: 'living-doc-harness-closure-review-input/v1',
    runId: evidence.runId,
    iteration,
    createdAt: now,
    evidencePath: rel(runDir, evidencePath),
    reviewerVerdictPath: rel(runDir, reviewer?.artifactPath),
    evidenceSnapshotPath: evidence.controllerEvidenceSnapshotPath || evidence.controllerEvidence?.snapshotPath || null,
    requiredHardFacts: evidence.requiredHardFacts || null,
    reviewerInferenceUnitResultPath: reviewer?.artifact?.inferenceUnitResultPath || null,
    reviewerInferenceUnitValidationPath: reviewer?.artifact?.inferenceUnitValidationPath || null,
    objectiveState: evidence.objectiveState,
    proofGates: evidence.proofGates,
    sideEffectEvidence: evidence.sideEffectEvidence || null,
    workerEvidence: evidence.workerEvidence,
    stopVerdict: verdict.stopVerdict,
    nextIteration: verdict.nextIteration,
    requiredInspectionPaths,
  };
  const prompt = closureReviewPrompt(input);
  const fixtureResult = {
    status: approved ? 'approved' : 'blocked',
    basis: approved
      ? ['Closure review fixture approved because reviewer verdict and all hard proof gates allow closure.']
      : ['Closure review fixture blocked because reviewer verdict or hard proof gates do not allow closure.'],
    outputContract: {
      schema: 'living-doc-harness-closure-review/v1',
      approved,
      reasonCode: approved ? 'closure-proof-accepted' : 'closure-proof-rejected',
      confidence: 'high',
      basis: approved
        ? ['Reviewer verdict is closed, closureAllowed is true, native trace evidence exists, proof gates pass, and objective/criteria are resolved.']
        : ['Closure proof is not complete enough to allow terminal closure.'],
      terminalAllowed: approved,
    },
  };

  const unit = await runContractBoundInferenceUnit({
    runDir,
    rootDir: 'inference-units',
    iteration,
    sequence: 3,
    unitId: 'closure-review',
    role: 'closure-review',
    unitTypeId: 'closure-review',
    allowedUnitTypes: allowedUnitTypes || undefined,
    prompt,
    inputContract: input,
    fixtureResult,
    execute: executeClosureReview,
    codexBin,
    cwd,
    now,
  });
  const review = normalizeClosureReview(unit.result.outputContract);
  return { input, prompt, unit, review };
}

export async function readClosureReviewResult(runDir, resultRef) {
  if (!resultRef) return null;
  return normalizeClosureReview(JSON.parse(await readFile(path.resolve(runDir, resultRef), 'utf8')));
}
