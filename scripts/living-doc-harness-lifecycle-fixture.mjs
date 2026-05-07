// End-to-end lifecycle fixture runner for the standalone living-doc harness.
//
// This wires the run contract, native trace summary, stop negotiation, skill
// routing, terminal state, evidence bundle, dashboard, and iteration-proof
// validator together. It is intentionally synthetic: the point is to prove the
// harness lifecycle contracts reject fake closure and accept proven closure
// without relying on chat memory.

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarnessRun } from './living-doc-harness-runner.mjs';
import { attachTraceSummaryToRun } from './living-doc-harness-trace-reader.mjs';
import { inferStopNegotiation } from './living-doc-harness-stop-negotiation.mjs';
import { routeStopVerdict } from './living-doc-harness-skill-router.mjs';
import { writeTerminalState } from './living-doc-harness-terminal-state.mjs';
import { renderDashboard, writeEvidenceBundle } from './living-doc-harness-evidence-dashboard.mjs';
import { validateHarnessContract } from './validate-living-doc-harness-contract.mjs';

const __filename = fileURLToPath(import.meta.url);

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function traceLine({ timestamp, message }) {
  return JSON.stringify({
    timestamp,
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: message }],
    },
  });
}

async function writeSyntheticTrace({ rootDir, name, timestamp, message }) {
  const traceDir = path.join(rootDir, '.codex', 'sessions', '2026', '05', '07');
  await mkdir(traceDir, { recursive: true });
  const tracePath = path.join(traceDir, `${name}.jsonl`);
  await writeFile(tracePath, `${traceLine({ timestamp, message })}\n`, 'utf8');
  return tracePath;
}

function buildEvidence({ run, kind, traceRef }) {
  const objectiveHash = run.contract.livingDoc.objectiveHash;
  if (kind === 'fake-closure') {
    return {
      runId: run.runId,
      objectiveState: {
        objectiveHash,
        stageBefore: 'implementing',
        stageAfter: 'worker-claimed-done',
        unresolvedObjectiveTerms: ['dashboard must expose proof gates'],
        unprovenAcceptanceCriteria: ['criterion-strong-dashboard'],
      },
      workerEvidence: {
        nativeInferenceTraceRefs: [traceRef],
        wrapperLogRefs: ['codex-turns/codex-events.jsonl'],
        finalMessageSummary: 'Worker claims complete, but proof gates are not satisfied.',
        toolFailures: [],
        filesChanged: [],
      },
      wrapperSummary: {
        claimedStatus: 'done',
      },
      proofGates: {
        standaloneRun: 'pass',
        nativeTraceInspected: 'pass',
        livingDocRendered: 'pass',
        acceptanceCriteriaSatisfied: 'fail',
        evidenceBundleWritten: 'pass',
        closureAllowed: false,
      },
    };
  }

  return {
    runId: run.runId,
    objectiveState: {
      objectiveHash,
      stageBefore: 'implementing',
      stageAfter: 'closed',
      unresolvedObjectiveTerms: [],
      unprovenAcceptanceCriteria: [],
    },
    workerEvidence: {
      nativeInferenceTraceRefs: [traceRef],
      wrapperLogRefs: ['codex-turns/codex-events.jsonl'],
      finalMessageSummary: 'Objective complete with acceptance evidence and rendered dashboard proof.',
      toolFailures: [],
      filesChanged: [
        'scripts/living-doc-harness-lifecycle-fixture.mjs',
        'tests/contract/living-doc-harness-lifecycle.spec.mjs',
      ],
    },
    proofGates: {
      standaloneRun: 'pass',
      nativeTraceInspected: 'pass',
      livingDocRendered: 'pass',
      acceptanceCriteriaSatisfied: 'pass',
      evidenceBundleWritten: 'pass',
      closureAllowed: true,
    },
  };
}

function skillsAppliedFromRouting(routing) {
  return (routing.actions || [])
    .filter((action) => action.kind === 'skill')
    .map((action) => ({
      skill: action.skill,
      verdict: action.status,
      patchRefs: [],
    }));
}

function buildIterationProof({ run, evidence, verdict, routing, iteration, now }) {
  return {
    schema: 'living-doc-harness-iteration-proof/v1',
    runId: run.runId,
    iteration,
    createdAt: now,
    livingDoc: {
      sourcePath: run.contract.livingDoc.sourcePath,
      beforeHash: run.contract.livingDoc.sourceHash,
      afterHash: run.contract.livingDoc.sourceHash,
      renderedHtml: run.contract.livingDoc.renderedHtml,
    },
    objectiveState: evidence.objectiveState,
    workerEvidence: evidence.workerEvidence,
    stopVerdict: verdict.stopVerdict,
    skillsApplied: skillsAppliedFromRouting(routing),
    proofGates: evidence.proofGates,
    nextIteration: verdict.nextIteration,
    ...(verdict.terminal ? { terminal: verdict.terminal } : {}),
  };
}

async function runOneLifecycle({ rootDir, docPath, runsDir, evidenceDir, kind, now, iteration }) {
  const run = await createHarnessRun({
    docPath,
    runsDir,
    execute: false,
    cwd: process.cwd(),
    now,
  });
  const tracePath = await writeSyntheticTrace({
    rootDir,
    name: `${kind}-trace`,
    timestamp: now,
    message: kind === 'fake-closure'
      ? 'The worker says done, but the dashboard proof gate is missing.'
      : 'The worker produced objective proof, dashboard evidence, and closure gates.',
  });
  const attachedTrace = await attachTraceSummaryToRun({
    runDir: run.runDir,
    tracePath,
    now,
  });
  const traceRef = path.relative(run.runDir, attachedTrace.summaryPath);
  const evidence = buildEvidence({ run, kind, traceRef });
  const verdict = inferStopNegotiation(evidence);
  const routed = await routeStopVerdict({
    verdict,
    evidence,
    runDir: run.runDir,
    livingDocPath: docPath,
    afterDocPath: docPath,
    iteration,
    now,
    render: true,
  });
  const terminal = await writeTerminalState({
    runDir: run.runDir,
    verdict,
    evidence,
    iteration,
    now,
  });
  const proof = buildIterationProof({
    run,
    evidence,
    verdict,
    routing: routed.routing,
    iteration,
    now,
  });
  const proofValidation = validateHarnessContract(proof);
  const proofPath = path.join(run.runDir, 'artifacts', `iteration-${iteration}-proof.json`);
  const validationPath = path.join(run.runDir, 'artifacts', `iteration-${iteration}-proof-validation.json`);
  await writeJson(proofPath, proof);
  await writeJson(validationPath, proofValidation);
  const bundleResult = await writeEvidenceBundle({
    runDir: run.runDir,
    outDir: evidenceDir,
    now,
  });

  return {
    kind,
    runId: run.runId,
    runDir: run.runDir,
    verdict,
    terminal: terminal.record,
    bundle: bundleResult.bundle,
    proofPath,
    proofValidation,
  };
}

function invalidFakeClosedContract(validRepairProof) {
  return {
    ...validRepairProof,
    stopVerdict: {
      classification: 'closed',
      reasonCode: 'worker-self-report',
      confidence: 'low',
      basis: ['Worker claimed done.'],
    },
    proofGates: {
      ...validRepairProof.proofGates,
      closureAllowed: true,
    },
    nextIteration: {
      allowed: false,
      mode: 'none',
    },
  };
}

export async function runLifecycleFixture({
  rootDir = null,
  keep = false,
  now = '2026-05-07T10:00:00.000Z',
  docPath = 'tests/fixtures/minimal-doc.json',
} = {}) {
  const ownedRoot = rootDir ? null : await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-lifecycle-'));
  const fixtureRoot = rootDir || ownedRoot;
  const runsDir = path.join(fixtureRoot, 'runs');
  const evidenceDir = path.join(fixtureRoot, 'evidence');
  const dashboardPath = path.join(fixtureRoot, 'dashboard.html');

  try {
    await mkdir(fixtureRoot, { recursive: true });
    const fixtureDocPath = path.join(fixtureRoot, 'sample-living-doc.json');
    await writeFile(fixtureDocPath, await readFile(path.resolve(process.cwd(), docPath), 'utf8'), 'utf8');

    const fakeClosure = await runOneLifecycle({
      rootDir: fixtureRoot,
      docPath: fixtureDocPath,
      runsDir,
      evidenceDir,
      kind: 'fake-closure',
      now,
      iteration: 1,
    });
    const fakeProof = await readJson(fakeClosure.proofPath);
    const invalidClosed = invalidFakeClosedContract(fakeProof);
    const invalidClosedValidation = validateHarnessContract(invalidClosed);
    const invalidClosedPath = path.join(fakeClosure.runDir, 'artifacts', 'invalid-worker-self-report-closure.json');
    const invalidClosedValidationPath = path.join(fakeClosure.runDir, 'artifacts', 'invalid-worker-self-report-closure-validation.json');
    await writeJson(invalidClosedPath, invalidClosed);
    await writeJson(invalidClosedValidationPath, invalidClosedValidation);

    const provenClosure = await runOneLifecycle({
      rootDir: fixtureRoot,
      docPath: fixtureDocPath,
      runsDir,
      evidenceDir,
      kind: 'proven-closure',
      now: '2026-05-07T10:01:00.000Z',
      iteration: 1,
    });
    const dashboard = await renderDashboard({
      runsDir,
      evidenceDir,
      outPath: dashboardPath,
      now: '2026-05-07T10:02:00.000Z',
    });

    const result = {
      schema: 'living-doc-harness-lifecycle-fixture-result/v1',
      rootDir: fixtureRoot,
      dashboardPath,
      fakeClosure: {
        runId: fakeClosure.runId,
        runDir: fakeClosure.runDir,
        classification: fakeClosure.verdict.stopVerdict.classification,
        terminalKind: fakeClosure.terminal.kind,
        proofValid: fakeClosure.proofValidation.ok,
        invalidSelfReportClosureValid: invalidClosedValidation.ok,
        invalidSelfReportClosureViolations: invalidClosedValidation.violations.map((item) => item.message),
        recommendation: fakeClosure.bundle.recommendation,
      },
      provenClosure: {
        runId: provenClosure.runId,
        runDir: provenClosure.runDir,
        classification: provenClosure.verdict.stopVerdict.classification,
        terminalKind: provenClosure.terminal.kind,
        proofValid: provenClosure.proofValidation.ok,
        recommendation: provenClosure.bundle.recommendation,
      },
      dashboardRunCount: dashboard.bundles.length,
    };
    await writeJson(path.join(fixtureRoot, 'lifecycle-fixture-result.json'), result);
    return result;
  } finally {
    if (ownedRoot && !keep) {
      await rm(ownedRoot, { recursive: true, force: true });
    }
  }
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (command !== 'run') {
    throw new Error('usage: living-doc-harness-lifecycle-fixture.mjs run [--out-dir <dir>] [--keep]');
  }
  const options = { rootDir: null, keep: false };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--out-dir') {
      options.rootDir = args.shift();
      if (!options.rootDir) throw new Error('--out-dir requires a value');
      options.keep = true;
    } else if (flag === '--keep') {
      options.keep = true;
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  return options;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await runLifecycleFixture(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
