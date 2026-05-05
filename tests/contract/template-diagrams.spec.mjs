import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const check = spawnSync(process.execPath, ['scripts/generate-living-doc-semantic-diagrams.mjs', '--check'], {
  encoding: 'utf8',
});
assert.equal(check.status, 0, check.stderr || check.stdout);

const graph = JSON.parse(await readFile('scripts/generated/living-doc-template-graphs.json', 'utf8'));
const diagrams = JSON.parse(await readFile('scripts/generated/living-doc-template-diagrams.json', 'utf8'));

assert.equal(diagrams.schema, 'living-doc-semantic-diagrams/v1');
assert.deepEqual(
  Object.keys(diagrams.templates).sort(),
  Object.keys(graph.templates).sort(),
  'diagram templates should match semantic graph templates',
);

for (const [templateId, diagram] of Object.entries(diagrams.templates)) {
  assert.match(diagram.mermaid, /^flowchart LR\n/, `${templateId} diagram should be a Mermaid LR flowchart`);
  for (const relationship of graph.templates[templateId].relationships || []) {
    assert.ok(
      diagram.mermaid.includes(`-- "${relationship.relation}" -->`),
      `${templateId} diagram missing relation ${relationship.relation}`,
    );
  }
}

assert.ok(
  diagrams.templates['surface-delivery'].mermaid.includes('design_implementation_alignment -- "requires-verification" --> verification_checkpoints'),
  'surface-delivery diagram should include alignment -> verification edge',
);
assert.ok(
  diagrams.templates['proof-canonicality'].mermaid.includes('model_assertion -- "requires-proof" --> proof_ladder'),
  'proof-canonicality diagram should include assertion -> proof edge',
);

console.log(`template diagram contract ok: ${Object.keys(diagrams.templates).length} templates`);
