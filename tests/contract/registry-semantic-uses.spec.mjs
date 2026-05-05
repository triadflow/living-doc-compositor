import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const check = spawnSync(process.execPath, ['scripts/generate-living-doc-registry-semantics.mjs', '--check'], {
  encoding: 'utf8',
});
assert.equal(check.status, 0, check.stderr || check.stdout);

const registry = JSON.parse(await readFile('scripts/living-doc-registry.json', 'utf8'));
const graph = JSON.parse(await readFile('scripts/generated/living-doc-template-graphs.json', 'utf8'));
const usedTypes = new Set();

for (const template of Object.values(graph.templates || {})) {
  for (const section of template.sections || []) {
    usedTypes.add(section.convergenceType);
  }
}

for (const typeId of usedTypes) {
  const typeDef = registry.convergenceTypes?.[typeId];
  assert.ok(typeDef, `missing registry type ${typeId}`);
  assert.equal(typeDef.semanticUses?.schema, 'living-doc-convergence-type-semantic-uses/v1', `${typeId} missing semanticUses`);
  assert.equal(typeDef.semanticUses.generatedFrom, graph.generatedFrom);
  assert.equal(typeDef.semanticUses.graphArtifactPath, 'scripts/generated/living-doc-template-graphs.json');
  assert.ok(Array.isArray(typeDef.semanticUses.templates), `${typeId} templates must be an array`);
  assert.ok(typeDef.semanticUses.templates.length > 0, `${typeId} must have at least one template use`);

  for (const use of typeDef.semanticUses.templates) {
    const template = graph.templates?.[use.templateId];
    assert.ok(template, `${typeId} semantic use references unknown template ${use.templateId}`);
    assert.equal(use.templateName, template.name);
    assert.equal(use.templatePath, template.templatePath);
    assert.ok(use.sectionIds.length > 0, `${typeId}.${use.templateId} missing sectionIds`);
    for (const sectionId of use.sectionIds) {
      assert.ok(
        template.sections.some((section) => section.id === sectionId && section.convergenceType === typeId),
        `${typeId}.${use.templateId} references invalid section ${sectionId}`,
      );
    }
    for (const direction of ['incoming', 'outgoing']) {
      for (const relationship of use.relationships[direction] || []) {
        assert.ok(
          template.relationships.some((item) => item.id === relationship.id),
          `${typeId}.${use.templateId} references invalid relationship ${relationship.id}`,
        );
      }
    }
  }
}

console.log(`registry semantic uses contract ok: ${usedTypes.size} convergence types`);
