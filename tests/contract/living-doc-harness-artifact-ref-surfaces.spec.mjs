import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ARTIFACT_REF_SCHEMA,
  artifactRefFromPath,
  resolveArtifactRef,
  validateArtifactRef,
} from '../../scripts/living-doc-harness-artifact-ref.mjs';
import { commonRequiredInspectionPaths } from '../../scripts/living-doc-harness-runner.mjs';

const lifecycleSource = await readFile('scripts/living-doc-harness-lifecycle.mjs', 'utf8');

function assertSourcePair(pathField, refField, source = lifecycleSource) {
  assert.match(source, new RegExp(`${pathField}\\s*:`), `${pathField} is present`);
  assert.match(source, new RegExp(`\\b${refField}\\b\\s*[:,]`), `${refField} is present`);
}

for (const [pathField, refField] of [
  ['outputInputPath', 'outputInputRef'],
  ['reviewerVerdictPath', 'reviewerVerdictRef'],
  ['repairSkillResultPath', 'repairSkillResultRef'],
  ['closureReviewResultPath', 'closureReviewResultRef'],
  ['postReviewSelectionPath', 'postReviewSelectionRef'],
  ['restartHandoffPath', 'restartHandoffRef'],
]) {
  assertSourcePair(pathField, refField);
}

for (const [pathField, refField] of [
  ['evidencePath', 'evidenceRef'],
  ['verdictPath', 'verdictRef'],
  ['reviewerVerdictPath', 'reviewerVerdictRef'],
  ['proofPath', 'proofRef'],
  ['handoverPath', 'handoverRef'],
  ['terminalPath', 'terminalRef'],
  ['bundlePath', 'bundleRef'],
  ['postReviewSelectionPath', 'postReviewSelectionRef'],
]) {
  assertSourcePair(pathField, refField);
}

for (const [pathField, refField] of [
  ['postFlightSummaryPath', 'postFlightSummaryRef'],
  ['postFlightUnitResultPath', 'postFlightUnitResultRef'],
  ['commitTransactionPath', 'commitTransactionRef'],
]) {
  assertSourcePair(pathField, refField);
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-artifact-ref-surfaces-'));
try {
  const runDir = path.join(tmp, 'run-a');
  const artifactPath = path.join(runDir, 'artifacts', 'evidence.json');
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, '{"ok":true}\n', { encoding: 'utf8', flag: 'w' });

  const ref = artifactRefFromPath({
    cwd: tmp,
    runDir,
    runId: 'run-a',
    filePath: artifactPath,
    kind: 'iteration-evidence',
  });
  assert.equal(ref.schema, ARTIFACT_REF_SCHEMA);
  assert.equal(resolveArtifactRef({ cwd: tmp, currentRunDir: path.join(tmp, 'run-b'), ref }), artifactPath);

  const valid = await validateArtifactRef({
    cwd: tmp,
    currentRunDir: path.join(tmp, 'run-b'),
    ref,
    mustExist: true,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.absolutePath, artifactPath);

  const currentRunDir = path.join(tmp, '.living-doc-runs', 'ldh-current');
  const ownerRunDir = path.join(tmp, '.living-doc-runs', 'ldh-previous');
  const previousCommitIntentPath = path.join(
    ownerRunDir,
    'initial-inference-units',
    'iteration-2',
    '04-commit-intent',
    'result.json',
  );
  await mkdir(path.dirname(previousCommitIntentPath), { recursive: true });
  await mkdir(currentRunDir, { recursive: true });
  await writeFile(previousCommitIntentPath, '{"status":"blocked"}\n', { encoding: 'utf8', flag: 'w' });

  const crossRunCommitIntentRef = artifactRefFromPath({
    cwd: tmp,
    runDir: currentRunDir,
    runId: 'ldh-current',
    filePath: '../ldh-previous/initial-inference-units/iteration-2/04-commit-intent/result.json',
    kind: 'commit-intent-result',
  });
  assert.equal(crossRunCommitIntentRef.runId, 'ldh-previous');
  assert.equal(crossRunCommitIntentRef.runDir, '.living-doc-runs/ldh-previous');
  assert.equal(crossRunCommitIntentRef.relativePath, 'initial-inference-units/iteration-2/04-commit-intent/result.json');
  assert.equal(crossRunCommitIntentRef.relativePath.startsWith('..'), false);

  const crossRunValid = await validateArtifactRef({
    cwd: tmp,
    currentRunDir,
    ref: crossRunCommitIntentRef,
    mustExist: true,
  });
  assert.equal(crossRunValid.ok, true);
  assert.equal(crossRunValid.absolutePath, previousCommitIntentPath);
  assert.equal(
    crossRunValid.displayPath,
    '.living-doc-runs/ldh-previous/initial-inference-units/iteration-2/04-commit-intent/result.json',
  );

  const requiredInspectionPaths = commonRequiredInspectionPaths({
    cwd: tmp,
    docPath: 'docs/example.json',
    lifecycleInput: {
      outputInputPath: '.living-doc-runs/ldh-current/output-input/iteration-3.json',
      nextUnit: {
        requiredInputRefs: [crossRunCommitIntentRef],
        requiredInputPaths: ['../ldh-previous/initial-inference-units/iteration-2/04-commit-intent/result.json'],
      },
    },
    previous: {
      previousRunDir: currentRunDir,
      evidencePath: null,
      evidence: null,
    },
  });
  assert.ok(requiredInspectionPaths.includes('docs/example.json'));
  assert.ok(requiredInspectionPaths.includes('.living-doc-runs/ldh-previous/initial-inference-units/iteration-2/04-commit-intent/result.json'));
  assert.equal(requiredInspectionPaths.some((item) => item.startsWith('../ldh-previous/')), false);

  const escapingStructuredRef = await validateArtifactRef({
    cwd: tmp,
    currentRunDir,
    ref: {
      schema: ARTIFACT_REF_SCHEMA,
      runDir: '.living-doc-runs/ldh-current',
      relativePath: '../ldh-previous/initial-inference-units/iteration-2/04-commit-intent/result.json',
      kind: 'commit-intent-result',
    },
    mustExist: false,
  });
  assert.equal(escapingStructuredRef.ok, false);
  assert.ok(escapingStructuredRef.violations.includes('artifact-ref-relativePath-escapes-runDir'));

  const badSchema = await validateArtifactRef({
    cwd: tmp,
    currentRunDir: runDir,
    ref: { schema: 'wrong-ref/v1', runDir: 'run-a', relativePath: 'artifacts/evidence.json' },
    mustExist: true,
  });
  assert.equal(badSchema.ok, false);
  assert.ok(badSchema.violations.includes('artifact-ref-schema-invalid'));
  assert.ok(badSchema.violations.includes('artifact-ref-missing'));

  const missingRunDir = await validateArtifactRef({
    cwd: tmp,
    currentRunDir: runDir,
    ref: { schema: ARTIFACT_REF_SCHEMA, relativePath: 'artifacts/evidence.json' },
    mustExist: true,
  });
  assert.equal(missingRunDir.ok, false);
  assert.ok(missingRunDir.violations.includes('artifact-ref-runDir-missing'));
  assert.ok(missingRunDir.violations.includes('artifact-ref-missing'));

  const missingRelativePath = await validateArtifactRef({
    cwd: tmp,
    currentRunDir: runDir,
    ref: { schema: ARTIFACT_REF_SCHEMA, runDir: 'run-a' },
    mustExist: true,
  });
  assert.equal(missingRelativePath.ok, false);
  assert.ok(missingRelativePath.violations.includes('artifact-ref-relativePath-missing'));
  assert.ok(missingRelativePath.violations.includes('artifact-ref-missing'));
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness artifact-ref surface contract spec: all assertions passed');
