import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-render-'));
const jsonPath = path.join(tmpDir, 'feature-doc.json');
const htmlPath = path.join(tmpDir, 'feature-doc.html');
const aiJsonPath = path.join(tmpDir, 'ai-enhanced-doc.json');
const aiHtmlPath = path.join(tmpDir, 'ai-enhanced-doc.html');

await copyFile('tests/fixtures/feature-doc.json', jsonPath);
await copyFile('tests/fixtures/ai-enhanced-doc.json', aiJsonPath);

const render = spawnSync(process.execPath, ['scripts/render-living-doc.mjs', jsonPath], {
  encoding: 'utf8',
});

assert.equal(render.status, 0, render.stderr || render.stdout);

const html = await readFile(htmlPath, 'utf8');

assert.match(html, /<script type="application\/json" id="doc-meta">/, 'rendered HTML should include doc-meta');
assert.match(html, /Fixture Feature Living Doc/, 'rendered HTML should include fixture title');
assert.match(html, /Portable Snapshot/, 'rendered HTML should include snapshot identity panel');
assert.match(html, /Identity and lineage/, 'rendered HTML should include lineage heading');
assert.match(html, /data-target="status-snapshot"/, 'rendered HTML should include section navigation');
assert.match(html, /data-view-target="board"/, 'rendered HTML should include board view switch');
assert.match(html, /id="board-view"/, 'rendered HTML should include registry-derived board view');
assert.match(html, /Tooling Surface · Status/, 'board should expose the status dimension for boardable sections');
assert.match(html, /<span>Trusted<\/span>/, 'board should render status-set lanes from the registry');
assert.match(html, /id="comp-iframe" srcdoc="/, 'rendered HTML should embed compositor iframe');
assert.match(html, /Living Doc Compositor/, 'rendered HTML should include embedded compositor source');

const aiRender = spawnSync(process.execPath, ['scripts/render-living-doc.mjs', aiJsonPath], {
  encoding: 'utf8',
});

assert.equal(aiRender.status, 0, aiRender.stderr || aiRender.stdout);

const aiHtml = await readFile(aiHtmlPath, 'utf8');
const aiSpecMatch = aiHtml.match(/<script type="application\/ai-render-graph\+json" id="doc-ai-spec">([\s\S]*?)<\/script>/);
assert.ok(aiSpecMatch?.[1], 'enhanced rendered HTML should expose the raw ai-render-graph spec payload');
const aiSpecPayload = aiSpecMatch[1];

assert.match(aiHtml, /<script type="application\/ai-render-graph\+json" id="doc-ai-spec">/, 'enhanced rendered HTML should include embedded AI spec');
assert.match(aiHtml, /<script type="application\/json" id="doc-ai-meta">/, 'enhanced rendered HTML should include separate advisory metadata');
assert.match(aiHtml, /Section advisory/, 'enhanced rendered HTML should include document-native advisory UI');
assert.match(aiHtml, /data-ai-source="surface-flow"/, 'enhanced rendered HTML should mark AI source sections');
assert.match(aiHtml, /data-ai-task="surface-flow:surface-brief"/, 'enhanced rendered HTML should include task bindings for design-code-spec-flow');
assert.match(aiHtml, /data-ai-task="verification-main:verification-brief"/, 'enhanced rendered HTML should include task bindings for verification-surface');
assert.match(aiHtml, /data-ai-task="proof-ladder:proof-state-brief"/, 'enhanced rendered HTML should include task bindings for proof-ladder');
assert.match(aiHtml, /"from": "props\.sources\.surface-flow\.text"/, 'enhanced rendered HTML should use ai-render-graph source bindings for section text');
assert.doesNotMatch(aiSpecPayload, /"runtime":/, 'ai-render-graph spec should not embed living-doc runtime metadata');
assert.doesNotMatch(aiSpecPayload, /"resultAliases":/, 'ai-render-graph spec should not embed living-doc alias metadata');
assert.match(aiHtml, /Run section pass/, 'enhanced rendered HTML should include a local section action affordance');
assert.match(aiHtml, /This pass reads the current section only and writes no source data\./, 'enhanced rendered HTML should explain the grounding boundary');

console.log(`render contract ok: ${htmlPath}`);
