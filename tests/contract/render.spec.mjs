import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-render-'));
const jsonPath = path.join(tmpDir, 'feature-doc.json');
const htmlPath = path.join(tmpDir, 'feature-doc.html');

await copyFile('tests/fixtures/feature-doc.json', jsonPath);

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

console.log(`render contract ok: ${htmlPath}`);
