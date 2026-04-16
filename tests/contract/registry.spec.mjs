import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const registry = JSON.parse(await readFile('scripts/living-doc-registry.json', 'utf8'));

assert.equal(registry.schemaVersion, 1, 'registry schemaVersion should be 1');
assert.ok(registry.entityTypes && typeof registry.entityTypes === 'object', 'missing entityTypes');
assert.ok(registry.statusSets && typeof registry.statusSets === 'object', 'missing statusSets');
assert.ok(registry.convergenceTypes && typeof registry.convergenceTypes === 'object', 'missing convergenceTypes');

const projections = new Set(['card-grid', 'edge-table']);
const guidanceKeys = ['operatingThesis', 'keepDistinct', 'inspect', 'update', 'avoid'];

function assertEntitySource(source, typeId, fieldName) {
  assert.ok(source && typeof source === 'object', `${typeId}.${fieldName} must be an object`);
  assert.ok(source.key, `${typeId}.${fieldName} must define key`);
  if (source.entityType !== null && source.entityType !== undefined) {
    assert.ok(
      registry.entityTypes[source.entityType],
      `${typeId}.${fieldName} references unknown entity type ${source.entityType}`,
    );
  }
}

function assertStatusField(field, typeId, fieldName) {
  assert.ok(field && typeof field === 'object', `${typeId}.${fieldName} must be an object`);
  assert.ok(field.key, `${typeId}.${fieldName} must define key`);
  assert.ok(field.statusSet, `${typeId}.${fieldName} must define statusSet`);
  assert.ok(
    registry.statusSets[field.statusSet],
    `${typeId}.${fieldName} references unknown status set ${field.statusSet}`,
  );
}

for (const [typeId, typeDef] of Object.entries(registry.convergenceTypes)) {
  assert.ok(typeDef.name, `${typeId} missing name`);
  assert.ok(typeDef.icon, `${typeId} missing icon`);
  assert.ok(projections.has(typeDef.projection), `${typeId} has unsupported projection ${typeDef.projection}`);

  assert.ok(typeDef.promptGuidance, `${typeId} missing promptGuidance`);
  for (const key of guidanceKeys) {
    const value = typeDef.promptGuidance[key];
    if (key === 'operatingThesis') {
      assert.equal(typeof value, 'string', `${typeId}.promptGuidance.${key} must be a string`);
      assert.ok(value.trim(), `${typeId}.promptGuidance.${key} must not be empty`);
    } else {
      assert.ok(Array.isArray(value), `${typeId}.promptGuidance.${key} must be an array`);
      assert.ok(value.length > 0, `${typeId}.promptGuidance.${key} must not be empty`);
    }
  }

  if (typeDef.projection === 'card-grid') {
    assert.ok(Array.isArray(typeDef.sources), `${typeId} card-grid type must define sources array`);
    assert.ok(Array.isArray(typeDef.statusFields), `${typeId} card-grid type must define statusFields array`);
    typeDef.sources.forEach((source, index) => assertEntitySource(source, typeId, `sources[${index}]`));
    typeDef.statusFields.forEach((field, index) => assertStatusField(field, typeId, `statusFields[${index}]`));
  }

  if (typeDef.projection === 'edge-table') {
    assertEntitySource(typeDef.sourceA, typeId, 'sourceA');
    if (typeDef.sourceB) assertEntitySource(typeDef.sourceB, typeId, 'sourceB');
    if (typeDef.edgeStatus) assertStatusField(typeDef.edgeStatus, typeId, 'edgeStatus');
  }
}

console.log(`registry contract ok: ${Object.keys(registry.convergenceTypes).length} convergence types`);
