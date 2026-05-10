import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { runHarnessLifecycle } from '../../scripts/living-doc-harness-lifecycle.mjs';

function minimalDoc(docPath) {
  return {
    docId: 'test:lifecycle-controller',
    title: 'Lifecycle Controller Fixture',
    subtitle: 'Fixture',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: docPath,
    sourceCoverage: 'fixture',
    updated: '2026-05-07T12:40:00.000Z',
    objective: 'Prove the lifecycle controller owns output-input iterations.',
    successCondition: 'The controller reaches terminal state without manual runner/finalizer commands between iterations.',
    sections: [],
  };
}

function sourceClosureDoc(docPath) {
  return {
    docId: 'test:source-derived-closure',
    title: 'Source Derived Closure Fixture',
    subtitle: 'Fixture',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: docPath,
    sourceCoverage: 'fixture',
    updated: '2026-05-07T13:20:00.000Z',
    objective: 'Close only after the second worker iteration updates source and living-doc state.',
    successCondition: 'The lifecycle finalizer derives closure from objectiveReady, completed criteria, rendered HTML, and trace refs.',
    runState: {
      currentPhase: 'phase-1-ready',
      documentReady: true,
      objectiveReady: false,
      nextObjectiveAction: 'run phase 1',
    },
    sections: [
      {
        id: 'acceptance-criteria',
        title: 'Acceptance Criteria',
        convergenceType: 'acceptance-criteria',
        updated: '2026-05-07T13:20:00.000Z',
        data: [
          {
            id: 'criterion-phase-one',
            name: 'Phase one completed',
            status: 'pending',
            updated: '2026-05-07T13:20:00.000Z',
          },
          {
            id: 'criterion-phase-two',
            name: 'Phase two completed',
            status: 'pending',
            updated: '2026-05-07T13:20:00.000Z',
          },
        ],
      },
    ],
  };
}

function reviewerVerdict(classification, {
  closureAllowed = false,
  reasonCode = classification === 'closed' ? 'objective-proven' : classification === 'true-block' ? 'missing-source' : 'proof-or-objective-unsatisfied',
  mode = classification === 'closed' ? 'none' : classification === 'user-stopped' ? 'user-stop' : classification === 'true-block' ? 'block' : 'repair',
  instruction = 'Run the appropriate repair or proof-producing action for the unresolved objective state.',
  terminal = null,
} = {}) {
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification,
      reasonCode,
      confidence: 'high',
      closureAllowed,
      basis: ['Reviewer inference fixture read the frozen evidence and emitted this lifecycle verdict.'],
    },
    nextIteration: {
      allowed: !['closed', 'user-stopped'].includes(classification),
      mode,
      instruction,
      mustNotDo: classification === 'closed' ? [] : ['Do not stop before objective closure or explicit user stop.'],
    },
    ...(terminal ? { terminal } : {}),
  };
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-lifecycle-controller-'));

try {
  const docPath = path.join(tmp, 'doc.json');
  await writeFile(docPath, `${JSON.stringify(minimalDoc(docPath), null, 2)}\n`, 'utf8');
  const sequencePath = path.join(tmp, 'evidence-sequence.json');
  await writeFile(sequencePath, `${JSON.stringify({
    schema: 'living-doc-harness-lifecycle-evidence-sequence/v1',
    iterations: [
      {
        stageAfter: 'worker-claimed-done',
        unresolvedObjectiveTerms: ['output-input channel must start the next iteration'],
        unprovenAcceptanceCriteria: ['criterion-owned-lifecycle-controller'],
        acceptanceCriteriaSatisfied: 'fail',
        closureAllowed: false,
        finalMessageSummary: 'Worker claims done, but output-input proof is missing.',
        wrapperSummary: { claimedStatus: 'done' },
        traceMessage: 'Iteration one produced a premature completion claim.',
        reviewerVerdict: reviewerVerdict('closure-candidate', {
          reasonCode: 'closure-proof-incomplete',
          mode: 'repair',
        }),
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        finalMessageSummary: 'Lifecycle controller proof is complete.',
        filesChanged: ['scripts/living-doc-harness-lifecycle.mjs'],
        sideEffectEvidence: {
          commit: {
            sha: 'abc1234',
            required: true,
          },
        },
        traceMessage: 'Iteration two produced terminal proof.',
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ],
  }, null, 2)}\n`, 'utf8');

  const result = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'runs'),
    evidenceDir: path.join(tmp, 'evidence'),
    dashboardPath: path.join(tmp, 'dashboard.html'),
    evidenceSequencePath: sequencePath,
    now: '2026-05-07T12:40:00.000Z',
  });

  assert.equal(result.schema, 'living-doc-harness-lifecycle-result/v1');
  assert.equal(result.iterationCount, 2);
  assert.equal(result.finalState.kind, 'closed');
  assert.match(result.finalState.postFlightSummaryPath, /iteration-2-post-flight-summary\.md$/);
  assert.match(result.finalState.postFlightUnitResultPath, /inference-units\/iteration-2\/04-post-flight-summary\/result\.json$/);
  assert.equal(result.iterations[0].classification, 'closure-candidate');
  assert.equal(result.iterations[0].terminalKind, 'repair-resumed');
  assert.equal(result.iterations[0].nextAction.action, 'start-next-worker-iteration');
  assert.equal(result.iterations[1].classification, 'closed');
  assert.equal(result.iterations[1].terminalKind, 'closed');
  assert.match(result.iterations[1].closureReviewResultPath, /inference-units\/iteration-2\/03-closure-review\/result\.json$/);
  const lifecycleEvents = await readFile(path.join(result.lifecycleDir, 'events.jsonl'), 'utf8');
  assert.match(lifecycleEvents, /closureReviewResultPath/);
  assert.match(lifecycleEvents, /03-closure-review/);

  const firstOutputInput = JSON.parse(await readFile(path.resolve(process.cwd(), result.iterations[0].outputInputPath), 'utf8'));
  assert.equal(firstOutputInput.schema, 'living-doc-harness-output-input/v1');
  assert.equal(firstOutputInput.postReviewSelection.nextUnit.unitId, 'worker');
  assert.equal(firstOutputInput.nextUnit.unitId, 'worker');
  assert.match(firstOutputInput.previousOutput.postReviewSelectionPath, /iteration-1-post-review-selection\.json$/);
  assert.equal(firstOutputInput.nextInput.mode, 'repair');
  assert.equal(firstOutputInput.nextInput.previousRunId, result.iterations[0].runId);
  assert.match(firstOutputInput.nextInput.handoverPath, /iteration-1-handover\.json$/);
  const secondOutputInput = JSON.parse(await readFile(path.resolve(process.cwd(), result.iterations[1].outputInputPath), 'utf8'));
  assert.equal(secondOutputInput.postReviewSelection.nextUnit.unitId, 'closure-review');
  assert.equal(secondOutputInput.postReviewSelection.terminalAction.kind, 'closed');
  assert.equal(secondOutputInput.terminalAction.kind, 'closed');

  const secondContract = JSON.parse(await readFile(path.resolve(process.cwd(), result.iterations[1].runDir, 'contract.json'), 'utf8'));
  assert.equal(secondContract.lifecycleInput.previousRunId, result.iterations[0].runId);
  assert.equal(secondContract.lifecycleInput.mode, 'repair');
  const secondPrompt = await readFile(path.resolve(process.cwd(), result.iterations[1].runDir, 'prompt.md'), 'utf8');
  assert.match(secondPrompt, /Lifecycle input from previous iteration/);
  assert.match(secondPrompt, /previousRunId:/);

  const terminalSequencePath = path.join(tmp, 'terminal-sequence.json');
  await writeFile(terminalSequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'blocked',
        acceptanceCriteriaSatisfied: 'fail',
        closureAllowed: false,
        traceMessage: 'Missing source authority.',
        terminalSignal: {
          kind: 'true-block',
          reasonCode: 'missing-source',
          owningLayer: 'source-authority',
          requiredDecision: 'Provide the missing source.',
          unblockCriteria: ['source exists'],
          basis: ['The source required by the objective is unavailable.'],
        },
        reviewerVerdict: reviewerVerdict('true-block', {
          reasonCode: 'missing-source',
          mode: 'continuation',
          terminal: {
            kind: 'true-block',
            reasonCode: 'missing-source',
            owningLayer: 'source-authority',
            requiredDecision: 'Provide the missing source.',
            unblockCriteria: ['source exists'],
            basis: ['The source required by the objective is unavailable.'],
          },
        }),
      },
      {
        stageAfter: 'closed',
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const terminal = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'terminal-runs'),
    evidenceDir: path.join(tmp, 'terminal-evidence'),
    dashboardPath: path.join(tmp, 'terminal-dashboard.html'),
    evidenceSequencePath: terminalSequencePath,
    now: '2026-05-07T12:50:00.000Z',
  });
  assert.equal(terminal.iterationCount, 2);
  assert.equal(terminal.finalState.kind, 'closed');
  assert.equal(terminal.iterations[0].classification, 'true-block');
  assert.equal(terminal.iterations[0].terminalKind, 'continuation-required');
  assert.equal(terminal.iterations[0].nextAction.action, 'start-next-worker-iteration');
  const trueBlockOutputInput = JSON.parse(await readFile(path.resolve(process.cwd(), terminal.iterations[0].outputInputPath), 'utf8'));
  assert.equal(trueBlockOutputInput.postReviewSelection.nextUnit.unitId, 'continuation-inference');
  assert.equal(trueBlockOutputInput.terminalAction, null);

  const trueBlockBatchSequencePath = path.join(tmp, 'true-block-batch-sequence.json');
  await writeFile(trueBlockBatchSequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'blocked',
        acceptanceCriteriaSatisfied: 'fail',
        closureAllowed: false,
        traceMessage: 'Runtime proof surface unavailable in this worker batch.',
        terminalSignal: {
          kind: 'true-block',
          reasonCode: 'runtime-proof-surface-unavailable',
          owningLayer: 'runtime',
          requiredDecision: 'Resume in a runtime that can inspect the proof surface.',
          unblockCriteria: ['proof surface is available to a continuation worker'],
          basis: ['The current worker batch cannot inspect the runtime proof surface.'],
        },
        reviewerVerdict: reviewerVerdict('true-block', {
          reasonCode: 'runtime-proof-surface-unavailable',
          mode: 'continuation',
          terminal: {
            kind: 'true-block',
            reasonCode: 'runtime-proof-surface-unavailable',
            owningLayer: 'runtime',
            requiredDecision: 'Resume in a runtime that can inspect the proof surface.',
            unblockCriteria: ['proof surface is available to a continuation worker'],
            basis: ['The current worker batch cannot inspect the runtime proof surface.'],
          },
        }),
      },
      {
        stageAfter: 'closed',
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Continuation worker reached objective closure after the true block was carried forward.',
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const trueBlockBatch = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'true-block-batch-runs'),
    evidenceDir: path.join(tmp, 'true-block-batch-evidence'),
    dashboardPath: path.join(tmp, 'true-block-batch-dashboard.html'),
    evidenceSequencePath: trueBlockBatchSequencePath,
    now: '2026-05-07T12:52:00.000Z',
  });
  assert.equal(trueBlockBatch.iterationCount, 2);
  assert.equal(trueBlockBatch.finalState.kind, 'closed');
  assert.equal(trueBlockBatch.iterations[0].classification, 'true-block');
  assert.equal(trueBlockBatch.iterations[0].terminalKind, 'continuation-required');
  assert.equal(trueBlockBatch.iterations[0].nextAction.action, 'start-next-worker-iteration');
  assert.equal(trueBlockBatch.iterations[0].nextAction.allowed, true);
  assert.equal(trueBlockBatch.iterations[1].classification, 'closed');
  const trueBlockBatchOutputInput = JSON.parse(await readFile(path.resolve(process.cwd(), trueBlockBatch.iterations[0].outputInputPath), 'utf8'));
  assert.equal(trueBlockBatchOutputInput.previousOutput.classification, 'true-block');
  assert.equal(trueBlockBatchOutputInput.previousOutput.terminalKind, 'continuation-required');
  assert.equal(trueBlockBatchOutputInput.postReviewSelection.nextUnit.unitId, 'continuation-inference');
  assert.equal(trueBlockBatchOutputInput.terminalAction, null);
  assert.equal(trueBlockBatchOutputInput.nextInput.mode, 'continuation');
  assert.match(trueBlockBatchOutputInput.nextAction.reason, /unresolved objective state/);

  const deniedClosureSequencePath = path.join(tmp, 'denied-closure-sequence.json');
  const fakeClosureReviewPath = path.join(tmp, 'fake-closure-review.mjs');
  const fakeClosureReviewCountPath = `${fakeClosureReviewPath}.count`;
  await writeFile(fakeClosureReviewPath, `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const outputPath = args[args.indexOf('-o') + 1];
const prompt = readFileSync(0, 'utf8');
const match = prompt.match(/"requiredInspectionPaths"\\s*:\\s*(\\[[\\s\\S]*?\\])/);
const required = match ? JSON.parse(match[1]) : [];
for (const requiredPath of required) {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'command_execution',
      command: "sed -n '1,20p' " + JSON.stringify(requiredPath),
      status: 'completed'
    }
  }));
}
const countPath = ${JSON.stringify(fakeClosureReviewCountPath)};
const current = existsSync(countPath) ? Number(readFileSync(countPath, 'utf8') || '0') || 0 : 0;
const next = current + 1;
writeFileSync(countPath, String(next));
writeFileSync(outputPath, JSON.stringify({
  schema: 'living-doc-harness-closure-review/v1',
  status: next > 1 ? 'approved' : 'blocked',
  approved: next > 1,
  reasonCode: next > 1 ? 'fixture-approved-closure' : 'fixture-denied-closure',
  confidence: 'high',
  basis: [next > 1 ? 'Fake closure-review inference approved closure on the resumed iteration.' : 'Fake closure-review inference denied closure after inspecting required paths.'],
  terminalAllowed: next > 1
}) + '\\n');
`, 'utf8');
  await chmod(fakeClosureReviewPath, 0o755);
  await writeFile(deniedClosureSequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Worker produced closure-shaped evidence, but closure review denies terminal closure.',
        reviewerVerdict: reviewerVerdict('closed', {
          closureAllowed: true,
          reasonCode: 'objective-proven-by-reviewer',
        }),
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Resumed worker preserved closure evidence and the closure review approves it.',
        reviewerVerdict: reviewerVerdict('closed', {
          closureAllowed: true,
          reasonCode: 'objective-proven-by-reviewer',
        }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const deniedClosure = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'denied-closure-runs'),
    evidenceDir: path.join(tmp, 'denied-closure-evidence'),
    dashboardPath: path.join(tmp, 'denied-closure-dashboard.html'),
    evidenceSequencePath: deniedClosureSequencePath,
    executeClosureReview: true,
    codexBin: fakeClosureReviewPath,
    now: '2026-05-07T12:55:00.000Z',
  });
  assert.equal(deniedClosure.iterationCount, 2);
  assert.equal(deniedClosure.finalState.kind, 'closed');
  assert.match(deniedClosure.iterations[0].closureReviewResultPath, /inference-units\/iteration-1\/03-closure-review\/result\.json$/);
  assert.match(deniedClosure.iterations[0].postReviewSelectionPath, /artifacts\/iteration-1-post-review-selection\.json$/);
  const deniedOutputInput = JSON.parse(await readFile(path.resolve(process.cwd(), deniedClosure.iterations[0].outputInputPath), 'utf8'));
  assert.equal(deniedOutputInput.nextUnit.unitId, 'continuation-inference');
  assert.equal(deniedOutputInput.terminalAction, null);
  assert.equal(deniedOutputInput.postReviewSelection.nextUnit.status, 'selected');

  const sourceClosureDocPath = path.join(tmp, 'source-closure-doc.json');
  const sourceClosureHtmlPath = sourceClosureDocPath.replace(/\.json$/i, '.html');
  const fakeCodexPath = path.join(tmp, 'fake-codex.mjs');
  const fakeCountPath = path.join(tmp, 'fake-codex-count.txt');
  await writeFile(sourceClosureDocPath, `${JSON.stringify(sourceClosureDoc(sourceClosureDocPath), null, 2)}\n`, 'utf8');
  await writeFile(sourceClosureHtmlPath, '<!doctype html><title>pending</title>\n', 'utf8');
  await writeFile(fakeCodexPath, `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const docPath = ${JSON.stringify(sourceClosureDocPath)};
const htmlPath = ${JSON.stringify(sourceClosureHtmlPath)};
const countPath = ${JSON.stringify(fakeCountPath)};
const args = process.argv.slice(2);
const outputPath = args[args.indexOf('-o') + 1];
const current = existsSync(countPath) ? Number(readFileSync(countPath, 'utf8') || '0') || 0 : 0;
const next = current + 1;
writeFileSync(countPath, String(next));
const doc = JSON.parse(readFileSync(docPath, 'utf8'));
if (next === 1) {
  doc.runState.currentPhase = 'phase-1-complete';
  doc.runState.objectiveReady = false;
  doc.runState.nextObjectiveAction = 'phase 2 requires lifecycle input';
  doc.sections[0].data[0].status = 'completed';
  doc.sections[0].data[0].updated = '2026-05-07T13:21:00.000Z';
  writeFileSync(outputPath, 'phase 1 complete; lifecycle input required');
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'phase 1 complete' } }));
} else {
  doc.runState.currentPhase = 'completed';
  doc.runState.objectiveReady = true;
  doc.runState.nextObjectiveAction = 'closed';
  for (const [index, criterion] of doc.sections[0].data.entries()) {
    criterion.status = index === 0 ? 'contract-proven' : 'browser-and-ui-proven';
    criterion.updated = '2026-05-07T13:22:00.000Z';
  }
  writeFileSync(outputPath, 'phase 2 complete; objectiveReady true');
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'phase 2 complete' } }));
}
doc.updated = next === 1 ? '2026-05-07T13:21:00.000Z' : '2026-05-07T13:22:00.000Z';
writeFileSync(docPath, JSON.stringify(doc, null, 2) + '\\n');
writeFileSync(htmlPath, '<!doctype html><title>' + doc.runState.currentPhase + '</title>\\n');
`, 'utf8');
  await chmod(fakeCodexPath, 0o755);

  const sourceClosure = await runHarnessLifecycle({
    docPath: sourceClosureDocPath,
    runsDir: path.join(tmp, 'source-closure-runs'),
    evidenceDir: path.join(tmp, 'source-closure-evidence'),
    dashboardPath: path.join(tmp, 'source-closure-dashboard.html'),
    execute: true,
    codexBin: fakeCodexPath,
    codexHome: tmp,
    executeReviewer: false,
    reviewerVerdictSequence: [
      reviewerVerdict('repairable', {
        reasonCode: 'proof-or-objective-unsatisfied',
        mode: 'repair',
      }),
      reviewerVerdict('closed', { closureAllowed: true }),
    ],
    now: '2026-05-07T13:20:00.000Z',
  });
  assert.equal(sourceClosure.iterationCount, 2);
  assert.equal(sourceClosure.finalState.kind, 'closed');
  assert.equal(sourceClosure.iterations[0].classification, 'repairable');
  assert.equal(sourceClosure.iterations[1].classification, 'closed');
  const sourceClosureEvidence = JSON.parse(await readFile(path.resolve(
    process.cwd(),
    sourceClosure.iterations[1].runDir,
    'artifacts',
    'iteration-2-evidence.json',
  ), 'utf8'));
  assert.equal(sourceClosureEvidence.sourceState.objectiveReady, true);
  assert.equal(sourceClosureEvidence.sourceState.closureAllowed, true);
  assert.equal(sourceClosureEvidence.proofGates.acceptanceCriteriaSatisfied, 'pass');
  assert.equal(sourceClosureEvidence.proofGates.closureAllowed, true);
  assert.match(sourceClosure.iterations[1].reviewerVerdictPath, /reviewer-inference\/iteration-2-verdict\.json$/);
  assert.match(sourceClosure.iterations[1].closureReviewResultPath, /inference-units\/iteration-2\/03-closure-review\/result\.json$/);

  const proofRouteSequencePath = path.join(tmp, 'proof-route-sequence.json');
  await writeFile(proofRouteSequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Controller-owned deterministic proof route passed before reviewer closure.',
        reviewerVerdict: reviewerVerdict('closed', { closureAllowed: true }),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const proofRouteLifecycle = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'proof-route-runs'),
    evidenceDir: path.join(tmp, 'proof-route-evidence'),
    dashboardPath: path.join(tmp, 'proof-route-dashboard.html'),
    evidenceSequencePath: proofRouteSequencePath,
    executeProofRoutes: true,
    proofRoutes: [
      {
        id: 'controller-owned-fixture-proof',
        kind: 'command',
        command: `${process.execPath} -e "console.log('controller-proof-ok')"`,
        required: true,
        acceptanceCriteria: ['criterion-owned-controller-proof'],
      },
    ],
    now: '2026-05-07T13:05:00.000Z',
  });
  assert.equal(proofRouteLifecycle.iterationCount, 1);
  assert.equal(proofRouteLifecycle.finalState.kind, 'closed');
  const proofRouteEvidence = JSON.parse(await readFile(path.resolve(
    process.cwd(),
    proofRouteLifecycle.iterations[0].runDir,
    'artifacts',
    'iteration-1-evidence.json',
  ), 'utf8'));
  assert.equal(proofRouteEvidence.controllerProofRoutes.routeCount, 1);
  assert.equal(proofRouteEvidence.controllerProofRoutes.results[0].status, 'passed');
  assert.equal(proofRouteEvidence.proofGates.controllerProofRoutes, 'pass');
  const proofRouteProof = JSON.parse(await readFile(path.resolve(
    process.cwd(),
    proofRouteLifecycle.iterations[0].runDir,
    'artifacts',
    'iteration-1-proof.json',
  ), 'utf8'));
  assert.equal(proofRouteProof.controllerProofRoutes.results[0].routeId, 'controller-owned-fixture-proof');
  assert.equal(proofRouteProof.controllerProofRoutes.results[0].closureAllowedContribution, 'pass');

  const cliResultDir = path.join(tmp, 'cli-runs');
  const cli = spawnSync(process.execPath, [
    'scripts/living-doc-harness-lifecycle.mjs',
    'run',
    docPath,
    '--runs-dir',
    cliResultDir,
    '--evidence-dir',
    path.join(tmp, 'cli-evidence'),
    '--dashboard',
    path.join(tmp, 'cli-dashboard.html'),
    '--evidence-sequence',
    sequencePath,
    '--now',
    '2026-05-07T13:10:00.000Z',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /"kind": "closed"/);
  assert.match(cli.stdout, /"iterationCount": 2/);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness lifecycle controller contract spec: all assertions passed');
