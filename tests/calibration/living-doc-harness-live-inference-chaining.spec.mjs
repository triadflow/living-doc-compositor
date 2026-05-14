import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runContractBoundInferenceUnit } from '../../scripts/living-doc-harness-inference-unit.mjs';
import { createHarnessRun } from '../../scripts/living-doc-harness-runner.mjs';
import {
  finalizeHarnessIteration,
  writeIterationEvidenceTemplate,
} from '../../scripts/living-doc-harness-iteration.mjs';

function minimalDoc(docPath) {
  return {
    docId: 'test:live-inference-chaining',
    title: 'Live Inference Chaining Calibration Fixture',
    subtitle: 'Fixture',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: docPath,
    sourceCoverage: 'fixture',
    updated: '2026-05-14T00:00:00.000Z',
    objective: 'Calibrate live inference-unit chaining.',
    successCondition: 'Headless inference units inspect required evidence and produce consumable contracts.',
    sections: [],
  };
}

function nativeTraceLine(text) {
  return JSON.stringify({
    timestamp: '2026-05-14T01:00:30.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text }],
    },
  });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function fakeCodexSource({ inspect = true, malformed = false } = {}) {
  return `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const outputPath = args[args.indexOf('-o') + 1];
let prompt = '';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function requiredInspectionPaths(text) {
  const paths = [];
  for (const match of text.matchAll(/"requiredInspectionPaths"\\s*:\\s*\\[([\\s\\S]*?)\\]/g)) {
    for (const item of match[1].matchAll(/"([^"]+)"/g)) paths.push(item[1]);
  }
  for (const item of text.matchAll(/"([^"]*\\/(?:[^"\\\\]|\\\\.)+)"/g)) paths.push(item[1]);
  return unique(paths);
}

function outputForPrompt(text) {
  if (${JSON.stringify(malformed)}) {
    return {
      status: 'finished',
      basis: ['Fake Codex deliberately emitted a non-verdict PR-review shape.'],
      outputContract: {
        schema: 'living-doc-harness-pr-review-result/v1',
        status: 'finished',
        approvedActions: [],
        sideEffect: {
          type: 'github-pr-review',
          executed: false,
          reasonCode: 'unit-not-finalized'
        }
      }
    };
  }
  if (text.includes('living-doc-harness-reviewer-input/v1')) {
    return {
      status: 'closed',
      basis: ['Fake Codex reviewer inspected required evidence and emitted closed.'],
      outputContract: {
        schema: 'living-doc-harness-stop-verdict/v1',
        stopVerdict: {
          classification: 'closed',
          reasonCode: 'fake-live-reviewer-objective-proven',
          confidence: 'high',
          closureAllowed: true,
          basis: ['Fake Codex reviewer inspected required evidence and emitted closed.']
        },
        nextIteration: {
          allowed: false,
          mode: 'none'
        }
      }
    };
  }
  if (text.includes('living-doc-harness-closure-review-input/v1')) {
    return {
      status: 'approved',
      basis: ['Fake Codex closure-review inspected required evidence and approved terminal closure.'],
      outputContract: {
        schema: 'living-doc-harness-closure-review/v1',
        approved: true,
        reasonCode: 'fake-live-closure-review-approved',
        confidence: 'high',
        basis: ['Fake Codex closure-review inspected required evidence and approved terminal closure.'],
        terminalAllowed: true
      }
    };
  }
  if (text.includes('living-doc-worker-inference-input/v1')) {
    return {
      status: 'finished',
      basis: ['Fake Codex worker inspected required evidence and finished.'],
      outputContract: {
        schema: 'living-doc-worker-output/v1',
        status: 'finished',
        runId: 'fake-live-calibration-run',
        livingDocPath: 'doc.json',
        nextAuthority: 'reviewer-inference'
      }
    };
  }
  return {
    status: 'blocked',
    basis: ['Fake Codex did not recognize the input contract schema.'],
    outputContract: {
      schema: 'living-doc-worker-output/v1',
      status: 'blocked',
      runId: 'fake-live-calibration-run',
      livingDocPath: 'doc.json',
      nextAuthority: 'reviewer-inference',
      basis: ['Fake Codex did not recognize the input contract schema.']
    }
  };
}

process.stdin.on('data', (chunk) => {
  prompt += chunk.toString();
});

process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fake-live-calibration' }));
  if (${JSON.stringify(inspect)}) {
    console.log(JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: 'inspect prompt ' + prompt,
        status: 'completed',
        exit_code: 0
      }
    }));
    for (const target of requiredInspectionPaths(prompt)) {
      console.log(JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'cat ' + target,
          status: 'completed',
          exit_code: 0
        }
      }));
    }
  }
  writeFileSync(outputPath, JSON.stringify(outputForPrompt(prompt), null, 2));
  console.log(JSON.stringify({ type: 'turn.completed' }));
});
`;
}

async function writeFakeCodex(filePath, options = {}) {
  await writeFile(filePath, fakeCodexSource(options), 'utf8');
  await chmod(filePath, 0o755);
  return filePath;
}

async function createFixture(rootDir, name) {
  const fixtureRoot = path.join(rootDir, name);
  await mkdir(fixtureRoot, { recursive: true });
  const docPath = path.join(fixtureRoot, 'doc.json');
  const tracePath = path.join(fixtureRoot, 'native.jsonl');
  await writeFile(docPath, `${JSON.stringify(minimalDoc(docPath), null, 2)}\n`, 'utf8');
  await writeFile(tracePath, `${nativeTraceLine(`trace for ${name}`)}\n`, 'utf8');
  const run = await createHarnessRun({
    docPath,
    runsDir: path.join(fixtureRoot, 'runs'),
    execute: false,
    cwd: process.cwd(),
    now: '2026-05-14T01:00:00.000Z',
  });
  const evidencePath = path.join(fixtureRoot, 'evidence.json');
  const template = await writeIterationEvidenceTemplate({
    runDir: run.runDir,
    outPath: evidencePath,
    tracePaths: [tracePath],
    stageAfter: 'closed',
    acceptanceCriteriaSatisfied: 'pass',
    closureAllowed: true,
    finalMessageSummary: `Live calibration fixture evidence for ${name}.`,
    now: '2026-05-14T01:00:10.000Z',
  });
  await writeJson(evidencePath, {
    ...template.evidence,
    livingDocPath: docPath,
    sideEffectEvidence: {
      commit: {
        sha: 'fixture-live-calibration-sha',
        required: false,
      },
    },
  });
  return {
    ...run,
    fixtureRoot,
    docPath,
    tracePath,
    evidencePath,
  };
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-live-inference-chaining-'));

try {
  {
    const fixture = await createFixture(tmp, 'fake-live-controller-chain');
    const fakeCodex = await writeFakeCodex(path.join(fixture.fixtureRoot, 'fake-codex.mjs'), { inspect: true });
    const result = await finalizeHarnessIteration({
      runDir: fixture.runDir,
      evidencePath: fixture.evidencePath,
      livingDocPath: fixture.docPath,
      afterDocPath: fixture.docPath,
      iteration: 1,
      now: '2026-05-14T01:01:00.000Z',
      evidenceDir: path.join(fixture.fixtureRoot, 'evidence-bundles'),
      dashboardPath: path.join(fixture.fixtureRoot, 'dashboard.html'),
      executeReviewer: true,
      executeClosureReview: true,
      codexBin: fakeCodex,
    });

    assert.equal(result.classification, 'closed');
    assert.equal(result.terminalKind, 'closed');
    assert.match(result.closureReviewResultPath, /inference-units\/iteration-1\/03-closure-review\/result\.json$/);

    const reviewerArtifact = await readJson(result.reviewerVerdictPath);
    const reviewerResult = await readJson(path.join(fixture.runDir, reviewerArtifact.inferenceUnitResultPath));
    assert.equal(reviewerResult.mode, 'headless-codex');
    assert.equal(reviewerResult.outputContract.stopVerdict.classification, 'closed');
    assert.equal(reviewerResult.toolProfile.name, 'local-harness');
    assert.equal(reviewerResult.toolProfile.sandboxMode, 'danger-full-access');

    const reviewerEvents = await readFile(path.join(fixture.runDir, reviewerArtifact.codexEventsPath), 'utf8');
    assert.match(reviewerEvents, /command_execution/);
    assert.match(reviewerEvents, /native\.jsonl/);

    const closureReviewResult = await readJson(result.closureReviewResultPath);
    assert.equal(closureReviewResult.mode, 'headless-codex');
    assert.equal(closureReviewResult.outputContract.terminalAllowed, true);
    const closureEvents = await readFile(path.join(fixture.runDir, closureReviewResult.codexEventsPath), 'utf8');
    assert.match(closureEvents, /command_execution/);
    assert.match(closureEvents, /iteration-1-evidence\.json/);

    const proof = await readJson(result.proofPath);
    assert.equal(proof.postReviewSelection.nextUnit.unitId, 'closure-review');
    assert.equal(proof.closureReview.terminalAllowed, true);
  }

  {
    const fixture = await createFixture(tmp, 'missing-required-inspection-fails');
    const fakeCodex = await writeFakeCodex(path.join(fixture.fixtureRoot, 'fake-codex-no-inspect.mjs'), { inspect: false });
    await assert.rejects(
      runContractBoundInferenceUnit({
        runDir: fixture.runDir,
        iteration: 1,
        sequence: 9,
        unitId: 'worker',
        role: 'worker',
        unitTypeId: 'worker',
        prompt: 'Return worker JSON but do not inspect paths.',
        inputContract: {
          schema: 'living-doc-worker-inference-input/v1',
          runId: fixture.runId,
          runConfig: fixture.contract.runConfig,
          livingDocPath: fixture.docPath,
          objective: 'Prove required path inspection.',
          successCondition: 'The worker must inspect required evidence before returning output.',
          requiredInspectionPaths: [fixture.evidencePath],
        },
        execute: true,
        codexBin: fakeCodex,
        cwd: process.cwd(),
        now: '2026-05-14T01:02:00.000Z',
      }),
      /did not inspect required path/,
    );
  }

  {
    const fixture = await createFixture(tmp, 'non-verdict-live-output-normalizes');
    const fakeCodex = await writeFakeCodex(path.join(fixture.fixtureRoot, 'fake-codex-malformed.mjs'), {
      inspect: true,
      malformed: true,
    });
    const prReviewUnit = await runContractBoundInferenceUnit({
      runDir: fixture.runDir,
      iteration: 1,
      sequence: 5,
      unitId: 'pr-review',
      role: 'pr-review',
      unitTypeId: 'pr-review',
      prompt: `Inspect ${fixture.evidencePath}, then return a malformed historical PR-review output.`,
      inputContract: {
        schema: 'living-doc-harness-pr-review-input/v1',
        runId: fixture.runId,
        iteration: 1,
        livingDocPath: fixture.docPath,
        reviewerVerdictPath: fixture.evidencePath,
        reviewTarget: 'https://github.example/triadflow/living-doc-compositor/pull/1',
        evidenceSnapshotPath: fixture.evidencePath,
        requiredHardFacts: {
          schema: 'living-doc-harness-required-hard-facts/v1',
          prReviewRequired: true,
        },
        prReviewPolicy: {
          schema: 'living-doc-harness-pr-review-policy/v1',
          mode: 'required-before-closure',
        },
        prReviewRequired: true,
        requiredInspectionPaths: [fixture.evidencePath],
      },
      execute: true,
      codexBin: fakeCodex,
      cwd: process.cwd(),
      now: '2026-05-14T01:03:00.000Z',
    });
    assert.equal(prReviewUnit.result.mode, 'headless-codex');
    assert.equal(prReviewUnit.result.status, 'blocked');
    assert.equal(prReviewUnit.result.outputContract.reasonCode, 'pr-review-non-verdict-output');
    assert.equal(prReviewUnit.validation.ok, true);
  }

  if (process.env.LIVING_DOC_RUN_REAL_CODEX === '1') {
    const fixture = await createFixture(tmp, 'real-codex-smoke');
    const unit = await runContractBoundInferenceUnit({
      runDir: fixture.runDir,
      iteration: 1,
      sequence: 6,
      unitId: 'worker',
      role: 'worker',
      unitTypeId: 'worker',
      prompt: `Inspect the required path, then return JSON only:
{
  "status": "finished",
  "runId": "${fixture.runId}",
  "livingDocPath": "${fixture.docPath}",
  "nextAuthority": "reviewer-inference",
  "basis": ["Inspected the required calibration evidence path."]
}`,
      inputContract: {
        schema: 'living-doc-worker-inference-input/v1',
        runId: fixture.runId,
        runConfig: fixture.contract.runConfig,
        livingDocPath: fixture.docPath,
        objective: 'Prove required path inspection with a real worker unit.',
        successCondition: 'The real worker unit inspects the required evidence path and emits a valid worker output contract.',
        requiredInspectionPaths: [fixture.evidencePath],
      },
      execute: true,
      codexBin: 'codex',
      cwd: process.cwd(),
      now: '2026-05-14T01:04:00.000Z',
    });
    assert.equal(unit.result.mode, 'headless-codex');
    assert.equal(unit.result.outputContract.schema, 'living-doc-worker-output/v1');
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness live inference chaining calibration spec: all assertions passed');
