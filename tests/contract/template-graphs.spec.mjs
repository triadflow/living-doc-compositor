import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { convergenceTypeDefinitions } from '../../scripts/living-doc-definitions/index.mjs';

const check = spawnSync(process.execPath, ['scripts/generate-living-doc-semantic-graph.mjs', '--check'], {
  encoding: 'utf8',
});
assert.equal(check.status, 0, check.stderr || check.stdout);

const registry = JSON.parse(await readFile('scripts/living-doc-registry.json', 'utf8'));
const graph = JSON.parse(await readFile('scripts/generated/living-doc-template-graphs.json', 'utf8'));
const convergenceTypes = new Map(convergenceTypeDefinitions.map((definition) => [definition.id, definition]));
const conditionKinds = new Set([
  'section-empty',
  'related-relationship-gap',
  'source-populated-target-empty',
  'all-populated-no-high-gaps',
  'manual-review',
]);
const evidenceKinds = new Set([
  'shared-field-value',
]);

assert.equal(graph.schema, 'living-doc-semantic-graph/v1');
assert.ok(graph.templates && typeof graph.templates === 'object', 'graph must define templates');

for (const [templateId, templateGraph] of Object.entries(graph.templates)) {
  assert.equal(templateGraph.id, templateId, `${templateId} id mismatch`);
  assert.ok(templateGraph.templatePath, `${templateId} missing templatePath`);
  const template = JSON.parse(await readFile(templateGraph.templatePath, 'utf8'));
  const templateSections = new Map((template.sections || []).map((section) => [section.id, section]));
  const sectionTypes = new Set((template.sections || []).map((section) => section.convergenceType));
  const graphSectionTypes = new Set(templateGraph.sections.map((section) => section.convergenceType));
  const composedTypes = templateGraph.convergenceTypes || {};
  const relationshipIds = new Set();
  const operationIds = new Set((templateGraph.validOperations || []).map((operation) => operation.id));

  for (const section of templateGraph.sections) {
    assert.ok(section.id, `${templateId} section missing id`);
    assert.ok(section.convergenceType, `${templateId}.${section.id} missing convergenceType`);
    assert.ok(
      registry.convergenceTypes[section.convergenceType],
      `${templateId}.${section.id} references unknown convergence type ${section.convergenceType}`,
    );
    assert.equal(
      templateSections.get(section.id)?.convergenceType,
      section.convergenceType,
      `${templateId}.${section.id} does not match template section type`,
    );
    assert.ok(composedTypes[section.convergenceType], `${templateId}.${section.id} missing composed convergence type contract`);
  }

  for (const [typeId, contract] of Object.entries(composedTypes)) {
    const definition = convergenceTypes.get(typeId);
    assert.ok(definition, `${templateId} composes unknown convergence type ${typeId}`);
    assert.deepEqual(
      contract,
      {
        ...definition.registryEntry,
        generatedFields: definition.generatedFields,
      },
      `${templateId}.${typeId} composed contract drifted from code-defined convergence type`,
    );
  }

  for (const relationship of templateGraph.relationships) {
    assert.ok(relationship.id, `${templateId} relationship missing id`);
    assert.ok(!relationshipIds.has(relationship.id), `${templateId} duplicate relationship ${relationship.id}`);
    relationshipIds.add(relationship.id);
    assert.ok(sectionTypes.has(relationship.from), `${templateId}.${relationship.id} from type not present in template`);
    assert.ok(sectionTypes.has(relationship.to), `${templateId}.${relationship.id} to type not present in template`);
    assert.ok(graphSectionTypes.has(relationship.from), `${templateId}.${relationship.id} from type not present in graph sections`);
    assert.ok(graphSectionTypes.has(relationship.to), `${templateId}.${relationship.id} to type not present in graph sections`);
    assert.ok(relationship.relation, `${templateId}.${relationship.id} missing relation`);
    assert.ok(Array.isArray(relationship.repairOperationIds), `${templateId}.${relationship.id} repairOperationIds must be an array`);
    for (const operationId of relationship.repairOperationIds) {
      assert.ok(operationIds.has(operationId), `${templateId}.${relationship.id} references unknown repair operation ${operationId}`);
    }
    if (relationship.evidence) {
      assert.ok(evidenceKinds.has(relationship.evidence.kind), `${templateId}.${relationship.id} has unknown evidence kind ${relationship.evidence.kind}`);
      assert.ok(Array.isArray(relationship.evidence.sourceFields), `${templateId}.${relationship.id} evidence sourceFields must be an array`);
      assert.ok(Array.isArray(relationship.evidence.targetFields), `${templateId}.${relationship.id} evidence targetFields must be an array`);
    }
  }

  for (const signal of templateGraph.stageSignals) {
    assert.ok(signal.id, `${templateId} stage signal missing id`);
    assert.ok(signal.stage, `${templateId}.${signal.id} missing stage`);
    assert.ok(signal.condition && typeof signal.condition === 'object', `${templateId}.${signal.id} missing condition`);
    assert.ok(conditionKinds.has(signal.condition.kind), `${templateId}.${signal.id} has unknown condition kind ${signal.condition.kind}`);
    for (const relationshipId of signal.relatedRelationships || []) {
      assert.ok(relationshipIds.has(relationshipId), `${templateId}.${signal.id} references unknown relationship ${relationshipId}`);
    }
  }

  for (const operation of templateGraph.validOperations) {
    assert.ok(operation.id, `${templateId} operation missing id`);
    assert.ok(Array.isArray(operation.stages), `${templateId}.${operation.id} stages must be an array`);
    assert.ok(operation.description, `${templateId}.${operation.id} missing description`);
  }
}

assert.ok(graph.templates['surface-delivery'], 'expected initial surface-delivery template graph');
assert.ok(
  graph.templates['surface-delivery'].relationships.some((relationship) => relationship.id === 'alignment-requires-verification'),
  'surface-delivery should encode alignment -> verification relationship',
);
assert.ok(
  graph.templates['surface-delivery'].relationships.some((relationship) => relationship.id === 'flow-feeds-alignment' && relationship.evidence?.kind === 'shared-field-value'),
  'surface-delivery should encode card-level evidence for flow -> alignment',
);
assert.ok(graph.templates['proof-canonicality'], 'expected proof-canonicality template graph');
assert.ok(
  graph.templates['proof-canonicality'].relationships.some((relationship) => relationship.id === 'assertion-requires-proof'),
  'proof-canonicality should encode assertion -> proof relationship',
);
assert.ok(
  graph.templates['proof-canonicality'].relationships.some((relationship) => relationship.id === 'assertion-requires-proof' && relationship.evidence?.kind === 'shared-field-value'),
  'proof-canonicality should encode card-level evidence for assertion -> proof',
);
assert.ok(graph.templates['operations-support'], 'expected operations-support template graph');
assert.ok(
  graph.templates['operations-support'].relationships.some((relationship) => relationship.id === 'operation-routes-surface'),
  'operations-support should encode operation -> operating surface relationship',
);
assert.ok(
  graph.templates['operations-support'].relationships.some((relationship) => relationship.id === 'operation-routes-surface' && relationship.evidence?.kind === 'shared-field-value'),
  'operations-support should encode card-level evidence for operation -> operating surface',
);
assert.ok(graph.templates['oss-issue-deep-dive'], 'expected oss-issue-deep-dive template graph');
assert.ok(
  graph.templates['oss-issue-deep-dive'].relationships.some((relationship) => relationship.id === 'symptom-localized-by-anchor'),
  'oss-issue-deep-dive should encode symptom -> code anchor relationship',
);
assert.ok(
  graph.templates['oss-issue-deep-dive'].relationships.some((relationship) => relationship.id === 'symptom-localized-by-anchor' && relationship.evidence?.kind === 'shared-field-value'),
  'oss-issue-deep-dive should encode card-level evidence for symptom -> code anchor',
);

console.log(`template graph contract ok: ${Object.keys(graph.templates).length} templates`);
