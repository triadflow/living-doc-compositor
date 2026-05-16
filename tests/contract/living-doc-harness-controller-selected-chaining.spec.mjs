import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createHarnessRun } from '../../scripts/living-doc-harness-runner.mjs';
import {
  finalizeHarnessIteration,
  writeIterationEvidenceTemplate,
} from '../../scripts/living-doc-harness-iteration.mjs';

function minimalDoc(docPath) {
  return {
    docId: 'test:controller-selected-chaining',
    title: 'Controller Selected Chaining Fixture',
    subtitle: 'Fixture',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: docPath,
    sourceCoverage: 'fixture',
    updated: '2026-05-14T00:00:00.000Z',
    objective: 'Prove the controller selects the inference-unit chain.',
    successCondition: 'The controller chooses next units from evidence and policy.',
    sections: [],
  };
}

function nativeTraceLine(text) {
  return JSON.stringify({
    timestamp: '2026-05-14T00:00:30.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text }],
    },
  });
}

function reviewerVerdict(classification, {
  closureAllowed = classification === 'closed',
  reasonCode = `fixture-${classification}`,
  mode = classification === 'closed' ? 'none' : 'fresh-unit',
  instruction = 'Continue through the controller-selected fixture path.',
} = {}) {
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification,
      reasonCode,
      confidence: 'high',
      closureAllowed,
      basis: [`Fixture reviewer emitted ${classification}; controller must select the next unit.`],
    },
    nextIteration: {
      allowed: classification !== 'closed',
      mode,
      instruction,
    },
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function createFixture(rootDir, name, {
  stageAfter = 'closed',
  acceptanceCriteriaSatisfied = 'pass',
  closureAllowed = true,
  filesChanged = [],
  mutateEvidence = null,
  allowedUnitTypes = undefined,
} = {}) {
  const fixtureRoot = path.join(rootDir, name);
  const docPath = path.join(fixtureRoot, 'doc.json');
  const tracePath = path.join(fixtureRoot, 'native.jsonl');
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(docPath, `${JSON.stringify(minimalDoc(docPath), null, 2)}\n`, 'utf8');
  await writeFile(tracePath, `${nativeTraceLine(`trace for ${name}`)}\n`, 'utf8');
  const run = await createHarnessRun({
    docPath,
    runsDir: path.join(fixtureRoot, 'runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-14T00:00:00.000Z',
    ...(allowedUnitTypes ? { allowedUnitTypes } : {}),
  });
  const evidencePath = path.join(fixtureRoot, 'evidence.json');
  const template = await writeIterationEvidenceTemplate({
    runDir: run.runDir,
    outPath: evidencePath,
    tracePaths: [tracePath],
    stageAfter,
    acceptanceCriteriaSatisfied,
    closureAllowed,
    filesChanged,
    finalMessageSummary: `Fixture evidence for ${name}.`,
    now: '2026-05-14T00:00:10.000Z',
  });
  let evidence = {
    ...template.evidence,
    livingDocPath: docPath,
  };
  if (mutateEvidence) evidence = mutateEvidence(evidence);
  await writeJson(evidencePath, evidence);
  return {
    ...run,
    fixtureRoot,
    docPath,
    tracePath,
    evidencePath,
  };
}

async function finalizeFixture(fixture, {
  verdict,
  allowedUnitTypes = undefined,
  codexBin = undefined,
  executeClosureReview = false,
  executeRepairSkills = false,
  repairSkillPlan = null,
  now = '2026-05-14T00:01:00.000Z',
} = {}) {
  return finalizeHarnessIteration({
    runDir: fixture.runDir,
    evidencePath: fixture.evidencePath,
    livingDocPath: fixture.docPath,
    afterDocPath: fixture.docPath,
    iteration: 1,
    now,
    evidenceDir: path.join(fixture.fixtureRoot, 'evidence-bundles'),
    dashboardPath: path.join(fixture.fixtureRoot, 'dashboard.html'),
    reviewerVerdict: verdict,
    executeClosureReview,
    executeRepairSkills,
    repairSkillPlan,
    ...(codexBin ? { codexBin } : {}),
    ...(allowedUnitTypes ? { allowedUnitTypes } : {}),
  });
}

async function writeFakeClosureReviewCodex(filePath) {
  await writeFile(filePath, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const outputPath = args[args.indexOf('-o') + 1];
let prompt = '';
process.stdin.on('data', (chunk) => {
  prompt += chunk.toString();
});
process.stdin.on('end', () => {
  const match = prompt.match(/"requiredInspectionPaths"\\s*:\\s*\\[([\\s\\S]*?)\\]/);
  if (match) {
    for (const item of match[1].matchAll(/"([^"]+)"/g)) {
      console.log(JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'cat ' + item[1],
          status: 'completed',
          exit_code: 0,
        },
      }));
    }
  }
  writeFileSync(outputPath, JSON.stringify({
    schema: 'living-doc-harness-closure-review/v1',
    approved: false,
    reasonCode: 'fixture-closure-review-denied',
    confidence: 'high',
    basis: ['Fake closure-review inspected required paths and denied terminal closure.'],
    terminalAllowed: false
  }, null, 2));
  console.log(JSON.stringify({ type: 'turn.completed' }));
});
`, 'utf8');
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-controller-selected-chaining-'));

try {
  {
    const fixture = await createFixture(tmp, 'closed-no-gates');
    const result = await finalizeFixture(fixture, {
      verdict: reviewerVerdict('closed', { reasonCode: 'fixture-objective-proven' }),
    });
    const selection = await readJson(result.postReviewSelectionPath);
    assert.equal(result.classification, 'closed');
    assert.equal(result.terminalKind, 'closed');
    assert.equal(selection.nextUnit.unitId, 'closure-review');
    assert.equal(selection.nextUnit.status, 'approved');
    assert.equal(selection.terminalAction.kind, 'closed');
    assert.match(result.closureReviewResultPath, /inference-units\/iteration-1\/03-closure-review\/result\.json$/);
  }

  {
    const fixture = await createFixture(tmp, 'source-change-selects-commit-intent', {
      filesChanged: ['docs/fixture.json'],
      mutateEvidence: (evidence) => ({
        ...evidence,
        sourceFilesChanged: true,
      }),
    });
    const result = await finalizeFixture(fixture, {
      verdict: reviewerVerdict('closed', { reasonCode: 'fixture-closed-needs-commit' }),
    });
    const selection = await readJson(result.postReviewSelectionPath);
    assert.equal(result.classification, 'true-block');
    assert.notEqual(result.terminalKind, 'closed');
    assert.equal(selection.nextUnit.unitId, 'commit-intent');
    assert.equal(selection.contractValidation.ok, true);
    assert.match(selection.nextUnit.resultPath, /inference-units\/iteration-1\/04-commit-intent\/result\.json$/);
    assert.equal(selection.nextUnit.status, 'blocked');
    const commitResult = await readJson(path.join(fixture.runDir, selection.nextUnit.resultPath));
    assert.equal(commitResult.outputContract.sideEffect.executed, false);
    assert.equal(result.closureReviewResultPath, null);
  }

  {
    const sourceFixture = await createFixture(tmp, 'selected-unit-router-start', {
      filesChanged: ['docs/selected-unit-fixture.md'],
      mutateEvidence: (evidence) => ({
        ...evidence,
        sourceFilesChanged: true,
      }),
    });
    const sourceResult = await finalizeFixture(sourceFixture, {
      verdict: reviewerVerdict('repairable', {
        reasonCode: 'source-changes-require-commit-evidence',
        closureAllowed: false,
        mode: 'fresh-unit',
        instruction: 'Run commit-intent before returning to worker.',
      }),
    });
    const sourceOutputInputPath = path.join(sourceFixture.runDir, 'output-input', 'iteration-1.json');
    await mkdir(path.dirname(sourceOutputInputPath), { recursive: true });
    await writeJson(sourceOutputInputPath, {
      schema: 'living-doc-harness-output-input/v1',
      runId: sourceResult.runId,
      iteration: 1,
      previousOutput: {
        classification: sourceResult.classification,
        terminalKind: sourceResult.terminalKind,
        proofValid: sourceResult.proofValid,
        evidencePath: path.relative(sourceFixture.runDir, sourceResult.evidencePath),
        reviewerVerdictPath: path.relative(sourceFixture.runDir, sourceResult.reviewerVerdictPath),
        handoverPath: path.relative(sourceFixture.runDir, sourceResult.handoverPath),
      },
      postReviewSelection: sourceResult.postReviewSelection,
      nextUnit: sourceResult.postReviewSelection.nextUnit,
      nextInput: null,
    });
    const commitRun = await createHarnessRun({
      docPath: sourceFixture.docPath,
      runsDir: path.join(sourceFixture.fixtureRoot, 'selected-unit-runs'),
      execute: false,
      cwd: process.cwd(),
      now: '2026-05-14T00:01:30.000Z',
      lifecycleInput: {
        mode: 'fresh-unit',
        previousRunId: sourceResult.runId,
        previousRunDir: path.relative(process.cwd(), sourceResult.runDir),
        previousIteration: sourceResult.iteration,
        instruction: sourceResult.postReviewSelection.nextUnit.handoffInstruction,
        outputInputPath: path.relative(process.cwd(), sourceOutputInputPath),
        selectedUnitType: sourceResult.postReviewSelection.nextUnit.unitId,
        selectedUnitRole: sourceResult.postReviewSelection.nextUnit.role,
        nextUnit: sourceResult.postReviewSelection.nextUnit,
      },
      iteration: 2,
    });
    assert.equal(commitRun.contract.runConfig.initialUnitType, 'commit-intent');
    assert.equal(commitRun.contract.artifacts.initialInferenceUnit.unitId, 'commit-intent');

    const evidencePath = path.join(sourceFixture.fixtureRoot, 'selected-unit-evidence.json');
    const template = await writeIterationEvidenceTemplate({
      runDir: commitRun.runDir,
      outPath: evidencePath,
      tracePaths: [sourceFixture.tracePath],
      stageAfter: 'commit-intent-blocked',
      acceptanceCriteriaSatisfied: 'fail',
      closureAllowed: false,
      filesChanged: [],
      finalMessageSummary: 'Selected commit-intent inspected the scope and recommended worker repair.',
      now: '2026-05-14T00:01:40.000Z',
    });
    const initialUnit = commitRun.contract.artifacts.initialInferenceUnit;
    await writeJson(evidencePath, {
      ...template.evidence,
      livingDocPath: sourceFixture.docPath,
      initialInferenceUnit: {
        schema: 'living-doc-harness-initial-inference-unit-evidence/v1',
        unitId: 'commit-intent',
        role: 'commit-intent',
        resultPath: initialUnit.result,
        validationPath: initialUnit.validation,
        resultRef: initialUnit.resultRef,
        validationRef: initialUnit.validationRef,
        validationOk: true,
        status: 'blocked',
        outputContract: {
          schema: 'living-doc-harness-commit-intent-result/v1',
          approved: false,
          status: 'blocked',
          changedFiles: ['docs/selected-unit-fixture.md'],
          message: 'Commit-intent blocked because the scope needs worker repair.',
          reasonCode: 'commit-scope-needs-worker-repair',
          nextRecommendedUnitType: 'worker',
          sideEffect: {
            type: 'git-commit',
            executed: false,
            reasonCode: 'commit-scope-needs-worker-repair',
            requiredChangedFiles: ['docs/selected-unit-fixture.md'],
            allowedCommitFiles: ['docs/selected-unit-fixture.md'],
          },
          basis: ['The selected commit-intent unit recommended worker repair from its output contract.'],
        },
      },
    });
    const selectedResult = await finalizeHarnessIteration({
      runDir: commitRun.runDir,
      evidencePath,
      livingDocPath: sourceFixture.docPath,
      afterDocPath: sourceFixture.docPath,
      iteration: 2,
      now: '2026-05-14T00:01:50.000Z',
      evidenceDir: path.join(sourceFixture.fixtureRoot, 'selected-unit-evidence-bundles'),
      dashboardPath: path.join(sourceFixture.fixtureRoot, 'selected-unit-dashboard.html'),
    });
    const selectedSelection = await readJson(selectedResult.postReviewSelectionPath);
    assert.equal(sourceResult.postReviewSelection.nextUnit.unitId, 'commit-intent');
    assert.equal(selectedResult.classification, 'true-block');
    assert.equal(selectedSelection.nextUnit.unitId, 'worker');
    assert.equal(selectedSelection.nextUnit.policyRuleId, 'latest-unit-output-recommendation');
    assert.equal(selectedSelection.nextUnit.routeAuthority.sourceUnitType, 'commit-intent');
    assert.equal(selectedSelection.nextUnit.routeAuthority.recommendedUnitType, 'worker');
    assert.equal(selectedSelection.nextUnit.routeAuthority.validationOk, true);
    assert.equal(selectedSelection.contractValidation.ok, true);
  }

  {
    const fixture = await createFixture(tmp, 'pr-policy-selects-pr-review', {
      mutateEvidence: (evidence) => ({
        ...evidence,
        prReviewPolicy: {
          schema: 'living-doc-harness-pr-review-policy/v1',
          mode: 'required-before-closure',
        },
        prReviewRequired: true,
        requiredHardFacts: {
          ...(evidence.requiredHardFacts || {}),
          prReviewPolicy: {
            schema: 'living-doc-harness-pr-review-policy/v1',
            mode: 'required-before-closure',
          },
          prReviewRequired: true,
          prReviewEvidencePresent: false,
        },
        sideEffectEvidence: {
          commit: {
            sha: 'fixture-commit-sha',
            required: false,
          },
        },
      }),
    });
    const result = await finalizeFixture(fixture, {
      verdict: reviewerVerdict('closed', { reasonCode: 'fixture-closed-needs-pr-review' }),
    });
    const selection = await readJson(result.postReviewSelectionPath);
    assert.equal(result.classification, 'true-block');
    assert.equal(selection.prReviewRequired, true);
    assert.equal(selection.prReviewGate.status, 'missing');
    assert.equal(selection.nextUnit.unitId, 'pr-review');
    assert.match(selection.nextUnit.resultPath, /inference-units\/iteration-1\/05-pr-review\/result\.json$/);
    assert.equal(selection.nextUnit.status, 'blocked');
  }

  {
    const fixture = await createFixture(tmp, 'blocked-pr-evidence-selects-continuation', {
      stageAfter: 'repairable',
      acceptanceCriteriaSatisfied: 'fail',
      closureAllowed: false,
      mutateEvidence: (evidence) => ({
        ...evidence,
        prReviewPolicy: {
          schema: 'living-doc-harness-pr-review-policy/v1',
          mode: 'required-before-closure',
        },
        prReviewRequired: true,
        requiredHardFacts: {
          ...(evidence.requiredHardFacts || {}),
          prReviewPolicy: {
            schema: 'living-doc-harness-pr-review-policy/v1',
            mode: 'required-before-closure',
          },
          prReviewRequired: true,
          prReviewEvidencePresent: false,
        },
        sideEffectEvidence: {
          commit: {
            sha: 'fixture-commit-sha',
            required: false,
          },
          prReview: {
            status: 'blocked',
            blocked: true,
            source: 'pr-review-output-contract',
            resultPath: 'inference-units/iteration-1/05-pr-review/result.json',
            validationPath: 'inference-units/iteration-1/05-pr-review/validation.json',
            reasonCode: 'fixture-pr-review-blocked',
            basis: ['Fixture PR-review evidence is blocked.'],
          },
        },
      }),
    });
    const result = await finalizeFixture(fixture, {
      verdict: reviewerVerdict('repairable', {
        reasonCode: 'fixture-pr-review-blocked',
        closureAllowed: false,
        mode: 'fresh-unit',
        instruction: 'Resolve the blocked PR-review gate before closure.',
      }),
    });
    const selection = await readJson(result.postReviewSelectionPath);
    assert.notEqual(result.terminalKind, 'closed');
    assert.equal(selection.nextUnit.unitId, 'worker');
    assert.equal(selection.prReviewGate.status, 'blocked');
    assert.ok(
      selection.nextUnit.requiredInputPaths.includes('inference-units/iteration-1/05-pr-review/result.json')
        || selection.nextUnit.requiredInputRefs.some((ref) => ref.relativePath === 'inference-units/iteration-1/05-pr-review/result.json')
    );
  }

  {
    const fixture = await createFixture(tmp, 'repair-selects-balance-scan', {
      stageAfter: 'repairable',
      acceptanceCriteriaSatisfied: 'fail',
      closureAllowed: false,
    });
    const result = await finalizeFixture(fixture, {
      verdict: reviewerVerdict('repairable', {
        reasonCode: 'fixture-repairable',
        closureAllowed: false,
        mode: 'repair',
        instruction: 'Run balance scan and repair skill chain.',
      }),
      executeRepairSkills: true,
      repairSkillPlan: {
        balanceScanResult: {
          status: 'ordered',
          basis: ['Fixture balance scan ordered objective-conservation-audit.'],
          orderedSkills: ['objective-conservation-audit'],
        },
        skillResults: [{
          status: 'no-op',
          basis: ['Fixture repair skill found no source change required.'],
          changedFiles: [],
        }],
      },
    });
    const selection = await readJson(result.postReviewSelectionPath);
    assert.equal(selection.nextUnit.unitId, 'living-doc-balance-scan');
    assert.equal(selection.nextUnit.status, 'complete');
    assert.match(result.repairSkillResultPath, /repair-skills\/iteration-1\/repair-chain-result\.json$/);
  }

  for (const classification of ['true-block', 'pivot', 'deferred', 'budget-exhausted']) {
    const fixture = await createFixture(tmp, `non-terminal-${classification}`, {
      stageAfter: classification,
      acceptanceCriteriaSatisfied: 'fail',
      closureAllowed: false,
    });
    const result = await finalizeFixture(fixture, {
      verdict: reviewerVerdict(classification, {
        reasonCode: `fixture-${classification}`,
        closureAllowed: false,
        mode: 'fresh-unit',
      }),
    });
    const selection = await readJson(result.postReviewSelectionPath);
    assert.equal(result.terminalKind, 'continuation-required');
    assert.notEqual(result.terminalKind, 'closed');
    assert.equal(selection.nextUnit.unitId, 'worker');
  }

  {
    const deniedFixture = await createFixture(tmp, 'closure-review-denial-selects-continuation');
    const fakeCodex = path.join(deniedFixture.fixtureRoot, 'fake-closure-review-codex.mjs');
    await writeFakeClosureReviewCodex(fakeCodex);
    await import('node:fs/promises').then(({ chmod }) => chmod(fakeCodex, 0o755));
    const deniedResult = await finalizeFixture(deniedFixture, {
      verdict: reviewerVerdict('closed', {
        reasonCode: 'fixture-closed-but-closure-review-denies',
        closureAllowed: true,
      }),
      executeClosureReview: true,
      codexBin: fakeCodex,
      now: '2026-05-14T00:02:10.000Z',
    });
    const deniedSelection = await readJson(deniedResult.postReviewSelectionPath);
    assert.equal(deniedResult.classification, 'true-block');
    assert.equal(deniedResult.terminalKind, 'continuation-required');
    assert.equal(deniedSelection.nextUnit.unitId, 'worker');
    assert.equal(deniedSelection.nextUnit.reasonCode, 'fixture-closure-review-denied');
  }

  {
    const allowedUnitTypes = ['worker', 'reviewer-inference', 'closure-review', 'worker', 'post-flight-summary'];
    const fixture = await createFixture(tmp, 'pr-review-disallowed-reroutes-continuation', {
      allowedUnitTypes,
      mutateEvidence: (evidence) => ({
        ...evidence,
        prReviewPolicy: {
          schema: 'living-doc-harness-pr-review-policy/v1',
          mode: 'required-before-closure',
        },
        prReviewRequired: true,
        requiredHardFacts: {
          ...(evidence.requiredHardFacts || {}),
          prReviewPolicy: {
            schema: 'living-doc-harness-pr-review-policy/v1',
            mode: 'required-before-closure',
          },
          prReviewRequired: true,
          prReviewEvidencePresent: false,
        },
        sideEffectEvidence: {
          commit: {
            sha: 'fixture-commit-sha',
            required: false,
          },
        },
      }),
    });
    const result = await finalizeFixture(fixture, {
      allowedUnitTypes,
      verdict: reviewerVerdict('closed', {
        reasonCode: 'fixture-pr-review-required-but-disallowed',
        closureAllowed: true,
      }),
    });
    const selection = await readJson(result.postReviewSelectionPath);
    assert.equal(selection.nextUnit, null);
    assert.equal(selection.contractValidation.ok, false);
    assert.equal(selection.contractValidation.reasonCode, 'selected-unit-type-not-allowed-for-run');
    assert.equal(selection.rejectedNextUnit.unitId, 'pr-review');
    assert.equal(selection.rejectedNextUnit.status, 'rejected');
    assert.equal(selection.terminalAction.policyRuleId, 'contract-validation-rejected-route');
    assert.equal(selection.terminalAction.rejectedNextUnit.rejection.reasonCode, 'selected-unit-type-not-allowed-for-run');
    assert.equal(result.terminalKind, 'continuation-required');
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness controller-selected chaining spec: all assertions passed');
