import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createHarnessRun } from '../../scripts/living-doc-harness-runner.mjs';
import { writeIterationEvidenceTemplate } from '../../scripts/living-doc-harness-iteration.mjs';
import { writeReviewerInferenceVerdict } from '../../scripts/living-doc-harness-reviewer-inference.mjs';

function assertContains(text, pattern, label) {
  assert.match(text, pattern, `${label} must include ${pattern}`);
}

async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-prompt-doctrine-'));

try {
  const docPath = path.join(tmp, 'doc.json');
  await mkdir(path.dirname(docPath), { recursive: true });
  await writeFile(docPath, `${JSON.stringify({
    docId: 'test:worker-first-prompt-doctrine',
    title: 'Worker First Prompt Doctrine Fixture',
    subtitle: 'Fixture',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: docPath,
    sourceCoverage: 'fixture',
    updated: '2026-05-14T09:00:00.000Z',
    objective: 'Repair prompt doctrine so the worker drives real progress.',
    successCondition: 'Prompts make worker progress, living-doc purpose, and return-to-work hierarchy explicit.',
    sections: [],
  }, null, 2)}\n`, 'utf8');

  const workerRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'worker-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-14T09:01:00.000Z',
  });
  const workerPrompt = await readText(path.join(workerRun.runDir, 'prompt.md'));
  assertContains(workerPrompt, /primary actuator of objective progress/, 'worker prompt');
  assertContains(workerPrompt, /next honest source-system or living-doc move is knowable/, 'worker prompt');
  assertContains(workerPrompt, /active working surface/, 'worker prompt');
  assertContains(workerPrompt, /Progress-shaped artifacts are invalid/, 'worker prompt');
  assertContains(workerPrompt, /Only return a blocker after making the concrete local moves/, 'worker prompt');

  const freshWorkerRun = await createHarnessRun({
    docPath,
    runsDir: path.join(tmp, 'fresh-worker-runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-14T09:02:00.000Z',
    lifecycleInput: {
      mode: 'fresh-unit',
      previousRunId: 'previous-run',
      previousIteration: 1,
      instruction: 'Resolve or reroute the controller-owned blocker.',
      selectedUnitType: 'worker',
      nextUnit: {
        unitId: 'worker',
        role: 'worker',
        reasonCode: 'fixture-fresh-worker-required',
      },
    },
  });
  const freshWorkerPrompt = await readText(path.join(freshWorkerRun.runDir, 'prompt.md'));
  assertContains(freshWorkerPrompt, /fresh isolated unit/, 'fresh worker prompt');
  assertContains(freshWorkerPrompt, /Do not resume or return to a previous unit/, 'fresh worker prompt');
  assertContains(freshWorkerPrompt, /selectedUnitType: worker/, 'fresh worker prompt');

  const tracePath = path.join(tmp, 'native-trace.jsonl');
  await writeFile(tracePath, `${JSON.stringify({
    timestamp: '2026-05-14T09:03:00.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'fixture trace' }],
    },
  })}\n`, 'utf8');
  const evidencePath = path.join(tmp, 'evidence.json');
  const evidenceTemplate = await writeIterationEvidenceTemplate({
    runDir: workerRun.runDir,
    outPath: evidencePath,
    tracePaths: [tracePath],
    stageAfter: 'running',
    acceptanceCriteriaSatisfied: 'fail',
    closureAllowed: false,
    finalMessageSummary: 'Fixture worker still has prompt doctrine work remaining.',
    now: '2026-05-14T09:03:30.000Z',
  });
  const reviewer = await writeReviewerInferenceVerdict({
    runDir: workerRun.runDir,
    evidence: {
      ...evidenceTemplate.evidence,
      livingDocPath: docPath,
      requiredHardFacts: {
        schema: 'living-doc-harness-required-hard-facts/v1',
        sourceFilesChanged: false,
        dirtyTrackedFiles: [],
        relevantUntrackedFiles: [],
        currentRunChangedFiles: [],
        preExistingDirtyFiles: [],
        allowedCommitFiles: [],
        forbiddenCommitFiles: [],
        acceptanceCriteriaSatisfied: false,
        objectiveReady: false,
        documentReady: false,
        renderedHtmlExists: false,
        closureAllowed: false,
        commitEvidencePresent: false,
        prReviewPolicy: {
          schema: 'living-doc-harness-pr-review-policy/v1',
          mode: 'disabled',
        },
        prReviewRequired: false,
        prReviewEvidencePresent: false,
        prReviewGate: {
          required: false,
          status: 'disabled',
          evidencePresent: false,
        },
      },
    },
    evidencePath,
    iteration: 1,
    now: '2026-05-14T09:04:00.000Z',
    reviewerVerdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification: 'repairable',
        reasonCode: 'fixture-more-worker-progress-needed',
        confidence: 'high',
        closureAllowed: false,
        basis: ['Fixture reviewer keeps lifecycle open for worker progress.'],
      },
      nextIteration: {
        allowed: true,
        mode: 'fresh-unit',
        instruction: 'Return to worker after the prompt doctrine gap is named.',
      },
    },
  });
  const reviewerPrompt = await readText(reviewer.inputPath.replace(/input\.json$/, 'prompt.md'));
  assertContains(reviewerPrompt, /active working surface for the objective/, 'reviewer prompt');
  assertContains(reviewerPrompt, /materially advanced that surface/, 'reviewer prompt');
  assertContains(reviewerPrompt, /prefer routing back to worker/, 'reviewer prompt');
  assertContains(reviewerPrompt, /scans, summaries, blocker labels, report polish, or route churn/, 'reviewer prompt');

  const promptSources = {
    closureReview: await readText('scripts/living-doc-harness-closure-review.mjs'),
    repairSkill: await readText('scripts/living-doc-harness-repair-skill-runner.mjs'),
    gates: await readText('scripts/living-doc-harness-iteration.mjs'),
    postFlight: await readText('scripts/living-doc-harness-lifecycle.mjs'),
  };
  assertContains(promptSources.closureReview, /terminal guard duty only/, 'closure-review prompt builder');
  assertContains(promptSources.closureReview, /return a concrete denial reason/, 'closure-review prompt builder');
  assertContains(promptSources.repairSkill, /Use this unit only for structural living-doc imbalance/, 'balance-scan prompt builder');
  assertContains(promptSources.repairSkill, /Do not become a general worker replacement/, 'repair-skill prompt builder');
  assertContains(promptSources.gates, /side-effect evidence gate, not an objective-progress engine/, 'commit-intent prompt builder');
  assertContains(promptSources.gates, /PR evidence gate, not an objective-progress engine/, 'pr-review prompt builder');
  assertContains(promptSources.postFlight, /summarizes the receipts/, 'post-flight prompt builder');
  assertContains(promptSources.postFlight, /must not create a new progress claim/, 'post-flight prompt builder');

  const reviewerArtifact = await readJson(reviewer.artifactPath);
  assert.equal(reviewerArtifact.verdict.stopVerdict.classification, 'repairable');
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness prompt doctrine contract spec: all assertions passed');
