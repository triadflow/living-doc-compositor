import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const check = spawnSync(process.execPath, ['scripts/generate-living-doc-template-artifacts.mjs', '--check'], {
  encoding: 'utf8',
});
assert.equal(check.status, 0, check.stderr || check.stdout);

const graph = JSON.parse(await readFile('scripts/generated/living-doc-template-graphs.json', 'utf8'));
const diagrams = JSON.parse(await readFile('scripts/generated/living-doc-template-diagrams.json', 'utf8'));

for (const [templateId, templateGraph] of Object.entries(graph.templates || {})) {
  const template = JSON.parse(await readFile(templateGraph.templatePath, 'utf8'));
  const semanticDefinition = template.templateMeta?.semanticDefinition;

  assert.ok(semanticDefinition, `${templateId} missing templateMeta.semanticDefinition`);
  assert.equal(semanticDefinition.schema, 'living-doc-template-semantic-definition/v1');
  assert.equal(semanticDefinition.definitionId, templateId);
  assert.equal(semanticDefinition.generatedFrom, graph.generatedFrom);
  assert.equal(semanticDefinition.graph.schema, graph.schema);
  assert.equal(semanticDefinition.graph.artifactPath, 'scripts/generated/living-doc-template-graphs.json');
  assert.equal(semanticDefinition.diagram.schema, diagrams.schema);
  assert.equal(semanticDefinition.diagram.artifactPath, 'scripts/generated/living-doc-template-diagrams.json');
  assert.equal(semanticDefinition.diagram.mermaid, diagrams.templates[templateId].mermaid);
  assert.equal(semanticDefinition.objectiveRole, templateGraph.objectiveRole);
  assert.equal(semanticDefinition.templateObjective, template.objective || '');
  assert.equal(semanticDefinition.templateSuccessCondition, template.successCondition || '');
  assert.deepEqual(semanticDefinition.sections, templateGraph.sections);
  assert.deepEqual(semanticDefinition.relationships, templateGraph.relationships);
  assert.deepEqual(semanticDefinition.stageSignals, templateGraph.stageSignals);
  assert.deepEqual(semanticDefinition.validOperations, templateGraph.validOperations);
  assert.deepEqual(semanticDefinition.counts, {
    sections: templateGraph.sections.length,
    relationships: templateGraph.relationships.length,
    stageSignals: templateGraph.stageSignals.length,
    validOperations: templateGraph.validOperations.length,
  });
}

console.log(`template artifact contract ok: ${Object.keys(graph.templates || {}).length} templates`);
