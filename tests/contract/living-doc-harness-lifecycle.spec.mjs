import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runLifecycleFixture } from '../../scripts/living-doc-harness-lifecycle-fixture.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-lifecycle-spec-'));

try {
  const result = await runLifecycleFixture({
    rootDir: tmp,
    keep: true,
  });

  assert.equal(result.schema, 'living-doc-harness-lifecycle-fixture-result/v1');
  assert.equal(result.dashboardRunCount, 2);

  assert.equal(result.fakeClosure.classification, 'closure-candidate');
  assert.equal(result.fakeClosure.terminalKind, 'repair-resumed');
  assert.equal(result.fakeClosure.proofValid, true);
  assert.equal(result.fakeClosure.invalidSelfReportClosureValid, false);
  assert.equal(result.fakeClosure.invalidSelfReportClosureViolations.some((message) => /acceptanceCriteriaSatisfied=pass/.test(message)), true);
  assert.equal(result.fakeClosure.invalidSelfReportClosureViolations.some((message) => /unresolved objective terms/.test(message)), true);

  assert.equal(result.provenClosure.classification, 'closed');
  assert.equal(result.provenClosure.terminalKind, 'closed');
  assert.equal(result.provenClosure.proofValid, true);
  assert.equal(result.provenClosure.recommendation, 'close');

  const dashboardHtml = await readFile(result.dashboardPath, 'utf8');
  assert.match(dashboardHtml, /Living Doc Harness Dashboard/);
  assert.match(dashboardHtml, /data-recommendation="close"/);
  assert.match(dashboardHtml, /data-recommendation="resume"/);
  assert.match(dashboardHtml, /Wrapper\/native mismatch:/);
  assert.match(dashboardHtml, /done -> closure-candidate/);

  const fixtureResultJson = await readFile(path.join(tmp, 'lifecycle-fixture-result.json'), 'utf8');
  assert.match(fixtureResultJson, /invalidSelfReportClosureValid/);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness lifecycle contract spec: all assertions passed');
