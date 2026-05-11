import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runHarnessLifecycle } from '../../scripts/living-doc-harness-lifecycle.mjs';

function minimalDoc(docPath) {
  return {
    docId: 'test:e2e-inference-unit-routing',
    title: 'E2E Inference Unit Routing',
    subtitle: 'Fixture',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: docPath,
    sourceCoverage: 'fixture',
    updated: '2026-05-10T14:40:00.000Z',
    objective: 'Prove the controller routes through registered inference unit types.',
    successCondition: 'Direct closure, repair routing, commit-intent gating, and PR-review gating are visible in lifecycle artifacts.',
    sections: [],
  };
}

function reviewerVerdict(classification, {
  closureAllowed = false,
  mode = classification === 'closed' ? 'none' : 'repair',
  reasonCode = classification === 'closed' ? 'objective-proven' : 'proof-or-objective-unsatisfied',
} = {}) {
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification,
      reasonCode,
      confidence: 'high',
      closureAllowed,
      basis: [`E2E fixture emitted ${classification}.`],
    },
    nextIteration: {
      allowed: classification !== 'closed',
      mode,
      instruction: classification === 'closed' ? 'none' : 'Continue through the selected contract-bound unit.',
      mustNotDo: classification === 'closed' ? [] : ['Do not stop before objective closure or explicit user stop.'],
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

test('lifecycle routes through registered inference unit contracts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-routing-e2e-'));
  try {
    const docPath = path.join(tmp, 'doc.json');
    await writeFile(docPath, `${JSON.stringify(minimalDoc(docPath), null, 2)}\n`, 'utf8');

    const directSequence = path.join(tmp, 'direct.json');
    await writeSequence(directSequence, [{
      stageAfter: 'closed',
      unresolvedObjectiveTerms: [],
      unprovenAcceptanceCriteria: [],
      acceptanceCriteriaSatisfied: 'pass',
      closureAllowed: true,
      reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
    }]);
    const direct = await runHarnessLifecycle({
      docPath,
      runsDir: path.join(tmp, 'direct-runs'),
      evidenceDir: path.join(tmp, 'direct-evidence'),
      dashboardPath: path.join(tmp, 'direct-dashboard.html'),
      evidenceSequencePath: directSequence,
      now: '2026-05-10T14:41:00.000Z',
    });
    expect(direct.finalState.kind).toBe('closed');
    expect(direct.finalState.postFlightUnitResultPath).toContain('04-post-flight-summary/result.json');
    const directSelection = await readJson(path.resolve(process.cwd(), direct.iterations[0].postReviewSelectionPath));
    expect(directSelection.nextUnit.unitId).toBe('closure-review');
    expect(directSelection.terminalAction.kind).toBe('closed');

    const repairSequence = path.join(tmp, 'repair.json');
    await writeSequence(repairSequence, [
      {
        stageAfter: 'needs-repair',
        unresolvedObjectiveTerms: ['repair route must be visible'],
        unprovenAcceptanceCriteria: ['criterion-repair-route'],
        acceptanceCriteriaSatisfied: 'fail',
        closureAllowed: false,
        reviewerVerdict: reviewerVerdict('closure-candidate', { mode: 'repair', reasonCode: 'repair-route-required' }),
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ]);
    const repair = await runHarnessLifecycle({
      docPath,
      runsDir: path.join(tmp, 'repair-runs'),
      evidenceDir: path.join(tmp, 'repair-evidence'),
      dashboardPath: path.join(tmp, 'repair-dashboard.html'),
      evidenceSequencePath: repairSequence,
      now: '2026-05-10T14:42:00.000Z',
    });
    const repairSelection = await readJson(path.resolve(process.cwd(), repair.iterations[0].postReviewSelectionPath));
    expect(repair.iterations[0].terminalKind).toBe('repair-resumed');
    expect(repairSelection.nextUnit.unitId).toBe('worker');
    expect(repairSelection.contractValidation.ok).toBe(true);

    const commitSequence = path.join(tmp, 'commit.json');
    await writeSequence(commitSequence, [
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        sourceFilesChanged: true,
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        sourceFilesChanged: true,
        sideEffectEvidence: { commit: { sha: 'abc1234', required: true } },
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ]);
    const commit = await runHarnessLifecycle({
      docPath,
      runsDir: path.join(tmp, 'commit-runs'),
      evidenceDir: path.join(tmp, 'commit-evidence'),
      dashboardPath: path.join(tmp, 'commit-dashboard.html'),
      evidenceSequencePath: commitSequence,
      now: '2026-05-10T14:43:00.000Z',
    });
    const commitSelection = await readJson(path.resolve(process.cwd(), commit.iterations[0].postReviewSelectionPath));
    expect(commitSelection.nextUnit.unitId).toBe('commit-intent');
    expect(commitSelection.nextUnit.resultPath).toContain('04-commit-intent/result.json');
    expect(commit.iterations[0].terminalKind).toBe('continuation-required');
    expect(commit.finalState.kind).toBe('closed');

    const prSequence = path.join(tmp, 'pr.json');
    await writeSequence(prSequence, [
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        prReviewRequired: true,
        sideEffectEvidence: { commit: { sha: 'abc1234', required: true } },
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        prReviewRequired: true,
        sideEffectEvidence: {
          commit: { sha: 'abc1234', required: true },
          prReview: { url: 'https://github.example/pr/1' },
        },
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ]);
    const pr = await runHarnessLifecycle({
      docPath,
      runsDir: path.join(tmp, 'pr-runs'),
      evidenceDir: path.join(tmp, 'pr-evidence'),
      dashboardPath: path.join(tmp, 'pr-dashboard.html'),
      evidenceSequencePath: prSequence,
      now: '2026-05-10T14:44:00.000Z',
    });
    const prSelection = await readJson(path.resolve(process.cwd(), pr.iterations[0].postReviewSelectionPath));
    expect(prSelection.nextUnit.unitId).toBe('pr-review');
    expect(prSelection.nextUnit.resultPath).toContain('05-pr-review/result.json');
    expect(pr.iterations[0].terminalKind).toBe('continuation-required');
    expect(pr.finalState.kind).toBe('closed');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
