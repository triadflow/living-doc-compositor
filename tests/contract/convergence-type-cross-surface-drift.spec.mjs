import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { convergenceTypeDefinitions } from '../../scripts/living-doc-definitions/index.mjs';

const checks = [
  ['scripts/generate-living-doc-registry-from-definitions.mjs', '--check', '--strict'],
  ['scripts/generate-living-doc-semantic-graph.mjs', '--check'],
  ['scripts/generate-living-doc-template-artifacts.mjs', '--check'],
  ['scripts/generate-living-doc-registry-semantics.mjs', '--check'],
  ['scripts/sync-compositor-embeds.mjs', '--check'],
];

for (const args of checks) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

const definitions = new Map(convergenceTypeDefinitions.map((definition) => [definition.id, definition]));
const registry = JSON.parse(await readFile('scripts/living-doc-registry.json', 'utf8'));
const docsRegistry = JSON.parse(await readFile('docs/scripts/living-doc-registry.json', 'utf8'));
assert.deepEqual(docsRegistry, registry, 'docs/scripts registry mirror drifted from generated registry');

const compositorHtml = await readFile('docs/living-doc-compositor.html', 'utf8');
const embeddedRegistry = extractEmbeddedJson(compositorHtml, 'const EMBEDDED_REGISTRY = ', ';\n  /* </generated:embedded-registry> */');
assert.deepEqual(embeddedRegistry, registry, 'embedded compositor registry drifted from generated registry');

const graph = JSON.parse(await readFile('scripts/generated/living-doc-template-graphs.json', 'utf8'));
for (const [templateId, templateGraph] of Object.entries(graph.templates || {})) {
  for (const [typeId, composedContract] of Object.entries(templateGraph.convergenceTypes || {})) {
    const definition = definitions.get(typeId);
    assert.ok(definition, `${templateId} composes unknown convergence type ${typeId}`);
    assert.deepEqual(
      composedContract,
      {
        ...definition.registryEntry,
        generatedFields: definition.generatedFields,
      },
      `${templateId}.${typeId} template graph contract drifted from code definition`,
    );
  }
}

const surfaceTemplate = JSON.parse(await readFile('docs/living-doc-template-surface-delivery.json', 'utf8'));
assert.deepEqual(
  surfaceTemplate.templateMeta.semanticDefinition.convergenceTypes,
  graph.templates['surface-delivery'].convergenceTypes,
  'surface-delivery template artifact drifted from template graph convergenceTypes',
);

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-cross-surface-drift-'));
const semanticJsonPath = path.join(tmpDir, 'surface-delivery-template.json');
const semanticHtmlPath = path.join(tmpDir, 'surface-delivery-template.html');
await copyFile('docs/living-doc-template-surface-delivery.json', semanticJsonPath);
const render = spawnSync(process.execPath, ['scripts/render-living-doc.mjs', semanticJsonPath], { encoding: 'utf8' });
assert.equal(render.status, 0, render.stderr || render.stdout);
const renderedHtml = await readFile(semanticHtmlPath, 'utf8');
const semanticContext = extractScriptJson(renderedHtml, 'doc-semantic-context');
assert.deepEqual(
  semanticContext.graph.template.convergenceTypes,
  graph.templates['surface-delivery'].convergenceTypes,
  'rendered semantic context drifted from generated template graph convergenceTypes',
);

console.log(`convergence type cross-surface drift contract ok: ${definitions.size} code-defined type(s)`);

function extractEmbeddedJson(source, prefix, suffix) {
  const start = source.indexOf(prefix);
  assert.ok(start >= 0, `missing embedded JSON prefix ${prefix}`);
  const bodyStart = start + prefix.length;
  const end = source.indexOf(suffix, bodyStart);
  assert.ok(end > bodyStart, `missing embedded JSON suffix ${suffix}`);
  return JSON.parse(source.slice(bodyStart, end));
}

function extractScriptJson(html, id) {
  const pattern = new RegExp(`<script\\b(?=[^>]*\\bid=["']${id}["'])(?=[^>]*\\btype=["']application/json["'])[^>]*>([\\s\\S]*?)<\\/script>`, 'i');
  const match = html.match(pattern);
  assert.ok(match?.[1], `missing script JSON ${id}`);
  return JSON.parse(match[1].replace(/<\\\/script/gi, '</script'));
}
