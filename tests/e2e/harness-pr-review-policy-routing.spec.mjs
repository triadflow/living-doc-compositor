import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runHarnessLifecycle } from '../../scripts/living-doc-harness-lifecycle.mjs';

test.setTimeout(90000);

function doc(docPath) {
  return {
    docId: 'test:pr-review-policy-routing',
    title: 'PR Review Policy Routing',
    subtitle: 'Fixture',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: docPath,
    sourceCoverage: 'fixture',
    updated: '2026-05-11T13:00:00.000Z',
    objective: 'Prove PR-review policy routing is explicit.',
    successCondition: 'Disabled, required, and source-change-gated PR-review policies route distinctly.',
    sections: [],
  };
}

function reviewerVerdict(classification, { closureAllowed = false } = {}) {
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification,
      reasonCode: classification === 'closed' ? 'objective-proven' : 'policy-gate-pending',
      confidence: 'high',
      closureAllowed,
      basis: [`Fixture emitted ${classification}.`],
    },
    nextIteration: {
      allowed: classification !== 'closed',
      mode: classification === 'closed' ? 'none' : 'continuation',
      instruction: classification === 'closed' ? 'none' : 'Continue through the selected policy gate.',
      mustNotDo: classification === 'closed' ? [] : ['Do not close before the selected policy gate is satisfied.'],
    },
  };
}

async function writeSequence(filePath, iterations) {
  await writeFile(filePath, `${JSON.stringify({
    schema: 'living-doc-harness-lifecycle-evidence-sequence/v1',
    iterations,
  }, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

test('PR review policy modes produce distinct lifecycle routing and dashboard state', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-pr-policy-e2e-'));
  try {
    const docPath = path.join(tmp, 'doc.json');
    await writeFile(docPath, `${JSON.stringify(doc(docPath), null, 2)}\n`, 'utf8');

    const changedClosure = {
      stageAfter: 'closed',
      unresolvedObjectiveTerms: [],
      unprovenAcceptanceCriteria: [],
      acceptanceCriteriaSatisfied: 'pass',
      closureAllowed: true,
      sourceFilesChanged: true,
      sideEffectEvidence: { commit: { sha: 'abc1234', required: true } },
      reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
    };
    const satisfiedClosure = {
      ...changedClosure,
      sideEffectEvidence: {
        commit: { sha: 'abc1234', required: true },
        prReview: {
          status: 'approved',
          approved: true,
          source: 'pr-review-output-contract',
          resultPath: 'initial-inference-units/iteration-2/05-pr-review/result.json',
          url: 'https://github.example/pr/7',
        },
      },
    };

    const requiredSequence = path.join(tmp, 'required.json');
    await writeSequence(requiredSequence, [changedClosure, satisfiedClosure]);
    const required = await runHarnessLifecycle({
      docPath,
      runsDir: path.join(tmp, 'required-runs'),
      evidenceDir: path.join(tmp, 'required-evidence'),
      dashboardPath: path.join(tmp, 'required-dashboard.html'),
      evidenceSequencePath: requiredSequence,
      prReviewPolicy: { mode: 'required-before-closure' },
      now: '2026-05-11T13:01:00.000Z',
    });
    expect(required.iterations[0].nextAction.selectedUnitType).toBe('pr-review');
    expect(required.iterations[0].nextAction.prReviewPolicy.mode).toBe('required-before-closure');
    expect(required.iterations[0].nextAction.prReviewGate.status).toBe('missing');
    expect(required.runConfig.prReviewPolicy.mode).toBe('required-before-closure');
    expect(required.finalState.kind).toBe('closed');

    const disabled = await runHarnessLifecycle({
      docPath,
      runsDir: path.join(tmp, 'disabled-runs'),
      evidenceDir: path.join(tmp, 'disabled-evidence'),
      dashboardPath: path.join(tmp, 'disabled-dashboard.html'),
      evidenceSequencePath: requiredSequence,
      prReviewPolicy: { mode: 'disabled' },
      now: '2026-05-11T13:02:00.000Z',
    });
    expect(disabled.iterationCount).toBe(1);
    expect(disabled.runConfig.prReviewPolicy.mode).toBe('disabled');
    expect(disabled.lastEvidenceSummary.prReviewPolicy.mode).toBe('disabled');
    expect(disabled.lastEvidenceSummary.prReviewRequired).toBe(false);
    expect(disabled.lastEvidenceSummary.prReviewEvidencePresent).toBe(false);
    const disabledSelection = await readJson(path.resolve(process.cwd(), disabled.iterations[0].postReviewSelectionPath));
    expect(disabledSelection.prReviewPolicy.mode).toBe('disabled');
    expect(disabledSelection.prReviewRequired).toBe(false);
    expect(disabledSelection.prReviewGate.status).toBe('disabled');
    expect(disabledSelection.nextUnit.unitId).toBe('closure-review');
    const disabledOutputInput = await readJson(path.resolve(process.cwd(), disabled.iterations[0].outputInputPath));
    expect(disabledOutputInput.postReviewSelection.prReviewPolicy.mode).toBe('disabled');
    expect(disabledOutputInput.nextAction.prReviewGate.status).toBe('disabled');
    const disabledRunDir = path.resolve(process.cwd(), disabled.iterations[0].runDir);
    const disabledEvidence = await readJson(path.join(disabledRunDir, 'artifacts/lifecycle-iteration-1-evidence-input.json'));
    expect(disabledEvidence.prReviewPolicy.mode).toBe('disabled');
    expect(disabledEvidence.prReviewRequired).toBe(false);
    expect(disabledEvidence.sideEffectEvidence?.prReview).toBeUndefined();

    const unchangedSequence = path.join(tmp, 'unchanged.json');
    await writeSequence(unchangedSequence, [{
      ...changedClosure,
      sourceFilesChanged: false,
      sideEffectEvidence: undefined,
    }]);
    const changeOnly = await runHarnessLifecycle({
      docPath,
      runsDir: path.join(tmp, 'change-only-runs'),
      evidenceDir: path.join(tmp, 'change-only-evidence'),
      dashboardPath: path.join(tmp, 'change-only-dashboard.html'),
      evidenceSequencePath: unchangedSequence,
      prReviewPolicy: { mode: 'required-when-source-changes' },
      gitWorktreeCwd: tmp,
      now: '2026-05-11T13:03:00.000Z',
    });
    expect(changeOnly.finalState.kind).toBe('closed');

    const changedOnlySequence = path.join(tmp, 'changed-only.json');
    await writeSequence(changedOnlySequence, [changedClosure, satisfiedClosure]);
    const changeOnlyWithChanges = await runHarnessLifecycle({
      docPath,
      runsDir: path.join(tmp, 'change-only-with-changes-runs'),
      evidenceDir: path.join(tmp, 'change-only-with-changes-evidence'),
      dashboardPath: path.join(tmp, 'change-only-with-changes-dashboard.html'),
      evidenceSequencePath: changedOnlySequence,
      prReviewPolicy: { mode: 'required-when-source-changes' },
      now: '2026-05-11T13:04:00.000Z',
    });
    expect(changeOnlyWithChanges.iterations[0].nextAction.selectedUnitType).toBe('pr-review');
    expect(changeOnlyWithChanges.finalState.kind).toBe('closed');

    const dashboard = await readFile(path.join(tmp, 'required-dashboard.html'), 'utf8');
    expect(dashboard).toContain('PR review policy:');
    expect(dashboard).toContain('required-before-closure');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
