import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { buildRegistryFromDefinitions } from '../../scripts/generate-living-doc-registry-from-definitions.mjs';
import { convergenceTypeDefinitions } from '../../scripts/living-doc-definitions/index.mjs';

const check = spawnSync(process.execPath, ['scripts/generate-living-doc-registry-from-definitions.mjs', '--check'], {
  encoding: 'utf8',
});
assert.equal(
  check.status,
  0,
  `registry-from-definitions check failed\nSTDOUT:\n${check.stdout}\nSTDERR:\n${check.stderr}`,
);

const strictCheck = spawnSync(
  process.execPath,
  ['scripts/generate-living-doc-registry-from-definitions.mjs', '--check', '--strict'],
  { encoding: 'utf8' },
);
assert.notEqual(strictCheck.status, 0, 'strict generation must fail until all convergence types are code-defined');
assert.match(strictCheck.stderr, /Missing:/, 'strict failure should name missing convergence type definitions');

const registry = JSON.parse(await readFile('scripts/living-doc-registry.json', 'utf8'));
const generated = buildRegistryFromDefinitions(registry);
assert.deepEqual(generated.registry, registry, 'generator must reproduce the committed registry in transitional mode');
assert.deepEqual(generated.definedTypeIds, convergenceTypeDefinitions.map((definition) => definition.id).sort());
assert.ok(generated.legacyTypeIds.length > 0, 'transitional generation should report legacy registry-authored types');

const drifted = JSON.parse(JSON.stringify(registry));
drifted.convergenceTypes['acceptance-criteria'].name = 'Drifted Acceptance Criteria';
const repaired = buildRegistryFromDefinitions(drifted);
assert.equal(
  repaired.registry.convergenceTypes['acceptance-criteria'].name,
  'Acceptance Criteria',
  'code-defined convergence type should overwrite registry drift',
);

console.log(
  `convergence type registry generation contract ok: ${generated.definedTypeIds.length} code-defined type(s), ${generated.legacyTypeIds.length} legacy type(s)`,
);
