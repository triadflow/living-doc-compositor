import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-ai-render-graph-spec-'));
const jsonPath = path.join(tmpDir, 'ai-enhanced-doc.json');
const htmlPath = path.join(tmpDir, 'ai-enhanced-doc.html');

await copyFile('tests/fixtures/ai-enhanced-doc.json', jsonPath);

const render = spawnSync(process.execPath, ['scripts/render-living-doc.mjs', jsonPath], {
  encoding: 'utf8',
});

assert.equal(render.status, 0, render.stderr || render.stdout);

const html = await readFile(htmlPath, 'utf8');
const specMatch = html.match(/<script type="application\/ai-render-graph\+json" id="doc-ai-spec">([\s\S]*?)<\/script>/);
const metaMatch = html.match(/<script type="application\/json" id="doc-ai-meta">([\s\S]*?)<\/script>/);

assert.ok(specMatch?.[1], 'rendered HTML should include an ai-render-graph spec payload');
assert.ok(metaMatch?.[1], 'rendered HTML should include AI advisory metadata payload');

const spec = JSON.parse(specMatch[1]);
const meta = JSON.parse(metaMatch[1]);

assert.equal(spec && typeof spec, 'object', 'ai-render-graph spec should be an object');
assert.equal(spec.layout?.type, 'static-html', 'ai-render-graph spec should declare a static HTML layout');
assert.equal(spec.runtime, undefined, 'ai-render-graph spec should not include living-doc runtime metadata');
assert.equal(spec.resultAliases, undefined, 'ai-render-graph spec should not include living-doc alias metadata');
assert.ok(spec.tasks && typeof spec.tasks === 'object', 'ai-render-graph spec should expose tasks');
assert.ok(Object.keys(spec.tasks).length >= 3, 'ai-render-graph spec should expose the first three type tasks');
for (const [taskId, task] of Object.entries(spec.tasks)) {
  assert.equal(task.type, 'inference', `${taskId} should be an inference task`);
  assert.equal(typeof task.prompt, 'string', `${taskId} should include a prompt`);
  assert.ok(task.input && typeof task.input === 'object', `${taskId} should include task input bindings`);
  assert.equal(task.input.sourceText?.from, `props.sources.${taskId.split(':')[0]}.text`, `${taskId} should bind to section source text`);
  assert.equal(task.outputSchema?.type, 'object', `${taskId} should include an object output schema`);
}
assert.equal(typeof meta.runtime?.endpoint, 'string', 'AI advisory metadata should expose runtime.endpoint');
assert.equal(typeof meta.runtime?.model, 'string', 'AI advisory metadata should expose runtime.model');
assert.ok(Array.isArray(meta.sections), 'AI advisory metadata should expose section task groups');
assert.ok(meta.taskMeta && typeof meta.taskMeta === 'object', 'AI advisory metadata should expose task metadata');

console.log(`ai-render-graph spec contract ok: ${htmlPath}`);
