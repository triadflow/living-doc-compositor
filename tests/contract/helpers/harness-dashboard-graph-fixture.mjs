import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createHarnessRun } from '../../../scripts/living-doc-harness-runner.mjs';

export async function createDashboardGraphFixture({ cwd = process.cwd() } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-dashboard-graph-ui-'));
  const runsDir = path.join(tmp, 'runs');
  const evidenceDir = path.join(tmp, 'evidence');
  const prepared = await createHarnessRun({
    docPath: 'tests/fixtures/minimal-doc.json',
    runsDir,
    execute: false,
    cwd,
    now: '2026-05-07T12:00:00.000Z',
  });

  const repairRoot = path.join(prepared.runDir, 'repair-skills', 'iteration-1');
  const repairUnitDir = path.join(repairRoot, '01-live-repair-unit');
  const docUpdateUnitDir = path.join(repairRoot, '02-doc-update-unit');
  const readinessUnitDir = path.join(repairRoot, '03-objective-execution-readiness');
  await mkdir(repairUnitDir, { recursive: true });
  await mkdir(docUpdateUnitDir, { recursive: true });
  await mkdir(readinessUnitDir, { recursive: true });

  await writeFile(path.join(repairUnitDir, 'prompt.md'), 'hidden local prompt\n', 'utf8');
  await writeFile(path.join(repairUnitDir, 'input-contract.json'), `${JSON.stringify({
    schema: 'living-doc-repair-skill-chain-input/v1',
    unitRole: 'repair-skill',
    skill: 'live-repair-unit',
    sequence: 1,
    requiredInspectionPaths: ['/tmp/required-evidence.json'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(repairUnitDir, 'codex-events.jsonl'), '{"type":"thread.started"}\n', 'utf8');

  await writeFile(path.join(docUpdateUnitDir, 'prompt.md'), 'hidden local update prompt\n', 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'input-contract.json'), `${JSON.stringify({
    schema: 'living-doc-repair-skill-chain-input/v1',
    unitRole: 'repair-skill',
    skill: 'doc-update-unit',
    sequence: 2,
    requiredInspectionPaths: ['/tmp/required-evidence.json'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'codex-events.jsonl'), '{"type":"thread.started"}\n', 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'result.json'), `${JSON.stringify({
    schema: 'living-doc-harness-inference-unit-result/v1',
    unitId: 'doc-update-unit',
    role: 'repair-skill',
    status: 'repaired',
    outputContract: {
      schema: 'living-doc-repair-skill-result/v1',
      skill: 'doc-update-unit',
      sequence: 2,
      status: 'repaired',
      changedFiles: [
        'tests/fixtures/minimal-doc.json',
        'tests/fixtures/minimal-doc.html',
      ],
      commitSha: 'abcdef1234567890',
      commitMessage: 'Repair minimal living doc fixture',
      nextRecommendedAction: 'continue-repair-chain',
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(docUpdateUnitDir, 'validation.json'), `${JSON.stringify({ ok: true }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(readinessUnitDir, 'prompt.md'), 'hidden local readiness prompt\n', 'utf8');
  await writeFile(path.join(readinessUnitDir, 'input-contract.json'), `${JSON.stringify({
    schema: 'living-doc-repair-skill-chain-input/v1',
    unitRole: 'repair-skill',
    skill: 'objective-execution-readiness',
    sequence: 3,
    requiredInspectionPaths: ['/tmp/required-evidence.json'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(readinessUnitDir, 'codex-events.jsonl'), '{"type":"thread.started"}\n', 'utf8');
  await writeFile(path.join(readinessUnitDir, 'result.json'), `${JSON.stringify({
    schema: 'living-doc-harness-inference-unit-result/v1',
    unitId: 'objective-execution-readiness',
    role: 'repair-skill',
    status: 'aligned',
    outputContract: {
      schema: 'living-doc-repair-skill-result/v1',
      skill: 'objective-execution-readiness',
      sequence: 3,
      status: 'aligned',
      changedFiles: [],
      commitIntent: {
        required: false,
        reason: 'Readiness inspection changed no files in the dashboard graph fixture.',
        message: '',
        body: [],
        changedFiles: [],
      },
      nextRecommendedAction: 'continue-repair-chain',
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(readinessUnitDir, 'validation.json'), `${JSON.stringify({ ok: true }, null, 2)}\n`, 'utf8');
  const repairChainResultPath = path.join(repairRoot, 'repair-chain-result.json');
  await writeFile(repairChainResultPath, `${JSON.stringify({
    schema: 'living-doc-repair-skill-chain-result/v1',
    runId: prepared.runId,
    iteration: 1,
    createdAt: '2026-05-07T12:00:08.000Z',
    status: 'complete',
    livingDocPath: 'tests/fixtures/minimal-doc.json',
    renderedHtmlPath: 'tests/fixtures/minimal-doc.html',
    skillResults: [
      {
        skill: 'doc-update-unit',
        sequence: 2,
        status: 'repaired',
        resultPath: 'repair-skills/iteration-1/02-doc-update-unit/result.json',
        validationPath: 'repair-skills/iteration-1/02-doc-update-unit/validation.json',
        changedFiles: [
          'tests/fixtures/minimal-doc.json',
          'tests/fixtures/minimal-doc.html',
        ],
        commitPolicy: {
          mode: 'commit-intent-only',
          gitCommitAllowed: false,
        },
        commitIntent: {
          required: true,
          reason: 'Repair-chain fixture deferred the commit because repair units run under commit-intent-only policy.',
          message: 'Repair minimal living doc fixture from repair chain',
          body: [
            'This body comes from repair-chain-result.json, not from the per-unit result fixture.',
          ],
          changedFiles: [
            'tests/fixtures/minimal-doc.json',
            'tests/fixtures/minimal-doc.html',
          ],
        },
      },
      {
        skill: 'objective-execution-readiness',
        sequence: 3,
        status: 'aligned',
        resultPath: 'repair-skills/iteration-1/03-objective-execution-readiness/result.json',
        validationPath: 'repair-skills/iteration-1/03-objective-execution-readiness/validation.json',
        changedFiles: [],
        commitPolicy: {
          mode: 'commit-intent-only',
          gitCommitAllowed: false,
        },
        commitIntent: {
          required: false,
          reason: 'No files changed during readiness in the repair-chain fixture.',
          message: '',
          body: [],
          changedFiles: [],
        },
      },
    ],
    nextRecommendedAction: 'continue-repair-chain',
  }, null, 2)}\n`, 'utf8');

  const reviewerDir = path.join(prepared.runDir, 'reviewer-inference');
  const outputInputDir = path.join(prepared.runDir, 'output-input');
  const terminalDir = path.join(prepared.runDir, 'terminal');
  await mkdir(reviewerDir, { recursive: true });
  await mkdir(outputInputDir, { recursive: true });
  await mkdir(terminalDir, { recursive: true });

  const reviewerInputPath = path.join(reviewerDir, 'iteration-1-input.json');
  const reviewerPromptPath = path.join(reviewerDir, 'iteration-1-prompt.md');
  const reviewerVerdictPath = path.join(reviewerDir, 'iteration-1-verdict.json');
  const terminalPath = path.join(terminalDir, 'iteration-1-continuation-required.json');
  const outputInputPath = path.join(outputInputDir, 'iteration-1.json');

  await writeFile(reviewerPromptPath, 'Inspect the raw worker JSONL and classify the lifecycle transition.\n', 'utf8');
  await writeFile(reviewerInputPath, `${JSON.stringify({
    schema: 'living-doc-harness-reviewer-input/v1',
    runId: prepared.runId,
    iteration: 1,
    rawWorkerJsonlPaths: ['/tmp/raw-worker.jsonl'],
  }, null, 2)}\n`, 'utf8');
  await writeFile(reviewerVerdictPath, `${JSON.stringify({
    schema: 'living-doc-harness-reviewer-verdict/v1',
    runId: prepared.runId,
    iteration: 1,
    createdAt: '2026-05-07T12:00:10.000Z',
    mode: 'fixture',
    reviewerInputPath: 'reviewer-inference/iteration-1-input.json',
    promptPath: 'reviewer-inference/iteration-1-prompt.md',
    codexEventsPath: 'reviewer-inference/iteration-1-codex-events.jsonl',
    verdict: {
      schema: 'living-doc-harness-stop-verdict/v1',
      stopVerdict: {
        classification: 'repairable',
        reasonCode: 'graph-fixture-repairable',
        closureAllowed: false,
      },
      nextIteration: {
        allowed: true,
        mode: 'repair',
      },
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(terminalPath, `${JSON.stringify({
    id: 'blocker-graph-fixture',
    kind: 'continuation-required',
    status: 'repair-resumed',
    reasonCode: 'graph-fixture-blocked',
    loopMayContinue: true,
    nextAction: 'continue through the next contract-bound inference unit',
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(prepared.runDir, 'terminal-states.jsonl'), `${JSON.stringify({
    id: 'blocker-graph-fixture',
    kind: 'continuation-required',
    status: 'repair-resumed',
    reasonCode: 'graph-fixture-blocked',
    loopMayContinue: true,
    createdAt: '2026-05-07T12:00:20.000Z',
  })}\n`, 'utf8');
  await writeFile(path.join(prepared.runDir, 'blockers.jsonl'), `${JSON.stringify({
    id: 'blocker-graph-fixture',
    reasonCode: 'graph-fixture-blocked',
    owningLayer: 'dashboard-graph',
    issueRef: '#209',
    unblockCriteria: ['prove graph nodes are artifact-derived'],
  })}\n`, 'utf8');
  await writeFile(outputInputPath, `${JSON.stringify({
    schema: 'living-doc-harness-output-input/v1',
    runId: prepared.runId,
    iteration: 1,
    previousOutput: {
      classification: 'true-block',
      terminalKind: 'continuation-required',
      reviewerVerdictPath: 'reviewer-inference/iteration-1-verdict.json',
      terminalPath: 'terminal/iteration-1-continuation-required.json',
    },
    nextAction: {
      action: 'start-next-worker-iteration',
      allowed: true,
      reason: 'Graph fixture continuation state.',
    },
  }, null, 2)}\n`, 'utf8');

  const lifecycleId = 'ldhl-20260507T120030Z-dashboard-graph-fixture';
  const lifecycleDir = path.join(runsDir, lifecycleId);
  await mkdir(lifecycleDir, { recursive: true });
  await writeFile(path.join(lifecycleDir, 'lifecycle-result.json'), `${JSON.stringify({
    schema: 'living-doc-harness-lifecycle-result/v1',
    resultId: lifecycleId,
    createdAt: '2026-05-07T12:00:30.000Z',
    docPath: 'tests/fixtures/minimal-doc.json',
    lifecycleDir,
    iterationCount: 1,
    finalState: {
      kind: 'continuation-required',
      reason: 'Graph fixture continuation state.',
      runId: prepared.runId,
    },
    iterations: [
      {
        iteration: 1,
        runId: prepared.runId,
        runDir: prepared.runDir,
        classification: 'true-block',
        terminalKind: 'continuation-required',
        nextAction: {
          action: 'start-next-worker-iteration',
          allowed: true,
        },
        outputInputPath,
        reviewerVerdictPath,
        repairSkillResultPath: repairChainResultPath,
        proofValid: true,
      },
    ],
  }, null, 2)}\n`, 'utf8');

  return {
    tmp,
    runsDir,
    evidenceDir,
    runId: prepared.runId,
    runDir: prepared.runDir,
    lifecycleId,
    lifecycleDir,
    cleanup: () => rm(tmp, { recursive: true, force: true }),
  };
}
