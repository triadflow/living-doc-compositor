import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defineConvergenceType, convergenceTypeDefinitions } from '../../scripts/living-doc-definitions/index.mjs';

const registry = JSON.parse(await readFile('scripts/living-doc-registry.json', 'utf8'));

assert.ok(Array.isArray(convergenceTypeDefinitions), 'convergenceTypeDefinitions must be an array');
assert.ok(convergenceTypeDefinitions.length > 0, 'convergenceTypeDefinitions must expose at least one code-defined type');

const authoredRegistryKeys = new Set([
  'aiActions',
  'aiProfiles',
  'category',
  'columnHeaders',
  'columns',
  'derived',
  'derivedFrom',
  'description',
  'detailsFields',
  'domain',
  'edgeNotes',
  'edgeStatus',
  'entityShape',
  'icon',
  'iconColor',
  'kind',
  'name',
  'nestable',
  'notFor',
  'projection',
  'promptGuidance',
  'sourceA',
  'sourceB',
  'sources',
  'statusFields',
  'structuralContract',
  'textFields',
]);
const generatedRegistryKeys = new Set(['semanticUses']);

for (const [typeId, typeDef] of Object.entries(registry.convergenceTypes)) {
  for (const key of Object.keys(typeDef)) {
    assert.ok(
      authoredRegistryKeys.has(key) || generatedRegistryKeys.has(key),
      `${typeId}.${key} is not covered by the convergence-type definition API boundary`,
    );
  }
}

for (const definition of convergenceTypeDefinitions) {
  assert.ok(definition.id, 'code-defined convergence type missing id');
  assert.ok(definition.registryEntry, `${definition.id} missing registryEntry`);
  assert.ok(Array.isArray(definition.generatedFields), `${definition.id} missing generatedFields array`);
  assert.equal(definition.registryEntry.id, definition.id, `${definition.id} registryEntry id mismatch`);
  assert.equal(
    definition.registryEntry.semanticUses,
    undefined,
    `${definition.id} must not author generated semanticUses in the type definition`,
  );

  for (const source of definition.registryEntry.sources || []) {
    if (source.entityType !== null && source.entityType !== undefined) {
      assert.ok(
        registry.entityTypes[source.entityType],
        `${definition.id}.sources references unknown entity type ${source.entityType}`,
      );
    }
  }

  for (const source of [definition.registryEntry.sourceA, definition.registryEntry.sourceB].filter(Boolean)) {
    if (source.entityType !== null && source.entityType !== undefined) {
      assert.ok(
        registry.entityTypes[source.entityType],
        `${definition.id} edge source references unknown entity type ${source.entityType}`,
      );
    }
  }

  for (const field of definition.registryEntry.statusFields || []) {
    assert.ok(
      registry.statusSets[field.statusSet],
      `${definition.id}.statusFields references unknown status set ${field.statusSet}`,
    );
  }

  if (definition.registryEntry.edgeStatus) {
    assert.ok(
      registry.statusSets[definition.registryEntry.edgeStatus.statusSet],
      `${definition.id}.edgeStatus references unknown status set ${definition.registryEntry.edgeStatus.statusSet}`,
    );
  }
}

const acceptanceCriteria = convergenceTypeDefinitions.find((definition) => definition.id === 'acceptance-criteria');
assert.ok(acceptanceCriteria, 'acceptance-criteria must exist as the proof fixture');
assert.deepEqual(
  acceptanceCriteria.registryEntry,
  {
    id: 'acceptance-criteria',
    ...registry.convergenceTypes['acceptance-criteria'],
  },
  'acceptance-criteria code definition must match the registry entry during the API proof slice',
);

assert.throws(
  () => defineConvergenceType({ id: 'broken', name: 'Broken' }),
  /missing category/,
  'defineConvergenceType should reject incomplete definitions',
);

const generatedBoundaryFixture = defineConvergenceType({
  id: 'generated-boundary-fixture',
  name: 'Generated Boundary Fixture',
  category: 'governance',
  kind: 'surface',
  description: 'Fixture for generated field boundary checks.',
  structuralContract: 'Fixture only.',
  promptGuidance: {
    operatingThesis: 'Generated fields are explicit but not authored into registryEntry.',
    keepDistinct: ['authored contract', 'generated metadata'],
    inspect: ['Inspect authored and generated boundaries.'],
    update: ['Update authored fields through code definitions.'],
    avoid: ['Do not author generated metadata in registryEntry.'],
  },
  icon: '<path d="M4 4h16v16H4z"/>',
  projection: 'card-grid',
  generatedFields: ['semanticUses'],
});

assert.deepEqual(generatedBoundaryFixture.generatedFields, ['semanticUses']);
assert.equal(generatedBoundaryFixture.registryEntry.semanticUses, undefined);

console.log(`convergence type definition contract ok: ${convergenceTypeDefinitions.length} code-defined type(s)`);
