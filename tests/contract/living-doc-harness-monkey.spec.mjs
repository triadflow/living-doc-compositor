import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  generateHarnessMonkeyCases,
  runHarnessMonkey,
} from '../../scripts/living-doc-harness-monkey.mjs';

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

const seed = argValue('--seed', '20260514');
const caseCount = Number(argValue('--case-count', '48'));
const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-monkey-contract-'));

try {
  const casesA = generateHarnessMonkeyCases({ seed, caseCount });
  const casesB = generateHarnessMonkeyCases({ seed, caseCount });
  assert.deepEqual(casesA, casesB, 'same seed must generate same cases');
  assert.equal(casesA.length, caseCount);
  assert.equal(new Set(casesA.map((testCase) => testCase.id)).size, casesA.length, 'case ids must be stable and unique');

  for (const testCase of casesA) {
    assert.ok(testCase.mutationSurface, `${testCase.id} declares mutation surface`);
    assert.ok(testCase.conceptIds.length > 0, `${testCase.id} maps to at least one concept`);
  }

  const reportPath = path.join(tmp, 'monkey-report.json');
  const replayOutDir = path.join(tmp, 'replay-failures');
  const report = await runHarnessMonkey({
    seed,
    caseCount,
    reportPath,
    replayOutDir,
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.passed, caseCount);
  assert.deepEqual(report.cases, casesA);
  assert.ok(report.summary.mutationSurfacesTouched.includes('artifact-ref'));
  assert.ok(report.summary.mutationSurfacesTouched.includes('routing-policy'));
  assert.ok(report.summary.mutationSurfacesTouched.includes('lifecycle-gates'));
  assert.ok(report.summary.conceptsTouched.includes('controller-owned-routing'));
  assert.ok(report.summary.conceptsTouched.includes('artifact-ref-continuity'));
  assert.ok(report.summary.conceptsTouched.includes('closure-authority'));

  const writtenReport = await readJson(reportPath);
  assert.equal(writtenReport.schema, 'living-doc-harness-monkey-report/v1');
  assert.equal(writtenReport.status, 'passed');
  assert.deepEqual(writtenReport.cases, casesA);

  const replayReport = await runHarnessMonkey({
    replayPath: reportPath,
    replayOutDir,
  });
  assert.equal(replayReport.status, 'passed');
  assert.deepEqual(replayReport.cases, casesA);

  const tamperedCase = {
    ...casesA.find((testCase) => testCase.kind === 'transition'),
    id: 'tampered-replay-artifact-shape',
    expected: {
      ok: true,
      reasonCode: 'intentionally-wrong-reason-code',
    },
  };
  const failedReport = await runHarnessMonkey({
    seed: 'tampered',
    cases: [tamperedCase],
    replayOutDir,
    throwOnFailure: false,
  });
  assert.equal(failedReport.status, 'failed');
  assert.equal(failedReport.summary.failed, 1);
  const replayArtifact = await readJson(failedReport.summary.replayArtifactPaths[0]);
  assert.equal(replayArtifact.schema, 'living-doc-harness-monkey-replay/v1');
  assert.equal(replayArtifact.caseId, tamperedCase.id);
  assert.deepEqual(replayArtifact.generatedCase, tamperedCase);
  assert.equal(replayArtifact.actualResult.status, 'failed');
  assert.ok(replayArtifact.replayCommand.includes('--replay'));
  assert.ok(replayArtifact.mutationList[0].surface);
  assert.ok(replayArtifact.expectedInvariant.conceptIds.length > 0);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log(`living-doc harness monkey contract spec: ${caseCount} seeded cases passed for seed ${seed}`);
