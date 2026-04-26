import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  INDEX_SCHEMA,
  normalizeGitHubPayload,
  parseGitHubUrl,
  queryIndex,
  scanLivingDoc,
} from '../../scripts/source-material-index.mjs';

const issueUrl = 'https://github.com/triadflow/living-doc-compositor/issues/140';
const prUrl = 'https://github.com/triadflow/living-doc-compositor/pull/102';

assert.deepEqual(parseGitHubUrl(issueUrl), {
  owner: 'triadflow',
  repo: 'living-doc-compositor',
  fullRepo: 'triadflow/living-doc-compositor',
  kind: 'github-issue',
  number: '140',
  canonicalUrl: issueUrl,
});
assert.equal(parseGitHubUrl(prUrl).kind, 'github-pr');

const normalizedIssue = normalizeGitHubPayload({
  number: 140,
  title: 'Source-material embedding index',
  state: 'OPEN',
  body: 'Build semantic retrieval for living-doc source materials.',
  labels: [{ name: 'enhancement' }],
  author: { login: 'triadflow' },
  updatedAt: '2026-04-26T14:05:35Z',
  comments: [
    { author: { login: 'codex' }, body: 'Keep retrieval derived, not canonical.' },
  ],
}, issueUrl);

assert.equal(normalizedIssue.schema, INDEX_SCHEMA);
assert.equal(normalizedIssue.sourceType, 'github-issue');
assert.equal(normalizedIssue.canonical.url, issueUrl);
assert.equal(normalizedIssue.freshness.markerType, 'updatedAt');
assert.ok(normalizedIssue.chunks.length >= 1, 'GitHub payload should produce chunks for indexing');

const normalizedPr = normalizeGitHubPayload({
  number: 102,
  title: 'Add index PR',
  state: 'OPEN',
  body: 'PR body',
  labels: [],
  updated_at: '2026-04-26T14:06:00Z',
}, prUrl);

assert.equal(normalizedPr.sourceType, 'github-pr');
assert.equal(normalizedPr.canonical.url, prUrl);

const normalizedWithModel = normalizeGitHubPayload({
  number: 140,
  title: 'Source-material embedding index',
  state: 'OPEN',
  body: 'Build semantic retrieval for living-doc source materials.',
}, issueUrl, { model: 'local-hash-v2' });
assert.equal(normalizedWithModel.embedding.model, 'local-hash-v2');
assert.equal(normalizedWithModel.chunks[0].embedding.model, 'local-hash-v2');

const indexDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-source-index-'));
const firstScan = await scanLivingDoc('tests/fixtures/source-index-doc.json', {
  indexDir,
  write: true,
});

assert.equal(firstScan.schema, INDEX_SCHEMA);
assert.equal(firstScan.actionCounts.indexed, 2, 'canonical JSON and markdown source should be indexed');
assert.equal(firstScan.actionCounts.queued, 2, 'GitHub issue and PR should be queued for canonical fetch');
assert.equal(firstScan.actionCounts.inaccessible, 1, 'missing local source should be explicit');
assert.equal(firstScan.actionCounts.unsupported, 1, 'symbolic connector source should not disappear silently');

const index = JSON.parse(await readFile(path.join(indexDir, 'source-index.json'), 'utf8'));
const sources = Object.values(index.sources);
const markdown = sources.find((source) => source.canonical.path === 'tests/fixtures/source-index-policy.md');
assert.ok(markdown, 'markdown source should be stored in index');
assert.equal(markdown.status, 'indexed');
assert.ok(markdown.chunks[0].embedding.vector.length > 0, 'indexed chunks should include local vectors');
assert.ok(markdown.backlinks.some((link) => link.sectionId === 'policy' && link.cardId === 'default-advisory-policy'));

const secondScan = await scanLivingDoc('tests/fixtures/source-index-doc.json', {
  indexDir,
  write: true,
});
assert.ok(secondScan.actionCounts.skipped >= 2, 'unchanged indexed local sources should be skipped');

const staleModelScan = await scanLivingDoc('tests/fixtures/source-index-doc.json', {
  indexDir,
  model: 'local-hash-v2',
  write: false,
});
assert.ok(staleModelScan.actionCounts['embedding-model-stale'] >= 1, 'model changes should be reported explicitly');

const changeFixtureDir = path.join('test-results', `source-index-change-${Date.now()}`);
await mkdir(changeFixtureDir, { recursive: true });
const changingSource = path.join(changeFixtureDir, 'changing-source.md');
const changingDoc = path.join(changeFixtureDir, 'changing-doc.json');
await writeFile(changingSource, '# Changing Source\n\nFirst version.\n');
await writeFile(changingDoc, JSON.stringify({
  docId: 'test:source-index-change',
  title: 'Source Index Change Fixture',
  canonicalOrigin: changingDoc,
  updated: '2026-04-26T14:30:00.000Z',
  sections: [
    {
      id: 'sources',
      title: 'Sources',
      convergenceType: 'decision-record',
      data: [
        {
          id: 'changing-source',
          name: 'Changing source',
          status: 'ground-truth',
          sourceRefs: [changingSource],
        },
      ],
    },
  ],
}, null, 2));
const changeIndexDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-source-index-change-'));
await scanLivingDoc(changingDoc, { indexDir: changeIndexDir, write: true });
await writeFile(changingSource, '# Changing Source\n\nSecond version with retrieval content.\n');
const changedScan = await scanLivingDoc(changingDoc, { indexDir: changeIndexDir, write: false });
assert.equal(changedScan.actionCounts.changed, 1, 'content hash changes should be reported explicitly');

const recoveryFixtureDir = path.join('test-results', `source-index-recovery-${Date.now()}`);
await mkdir(recoveryFixtureDir, { recursive: true });
const recoveringSource = path.join(recoveryFixtureDir, 'recovering-source.md');
const recoveringDoc = path.join(recoveryFixtureDir, 'recovering-doc.json');
await writeFile(recoveringDoc, JSON.stringify({
  docId: 'test:source-index-recovery',
  title: 'Source Index Recovery Fixture',
  canonicalOrigin: recoveringDoc,
  updated: '2026-04-26T14:30:00.000Z',
  sections: [
    {
      id: 'sources',
      title: 'Sources',
      convergenceType: 'decision-record',
      data: [
        {
          id: 'recovering-source',
          name: 'Recovering source',
          status: 'ground-truth',
          sourceRefs: [recoveringSource],
        },
      ],
    },
  ],
}, null, 2));
const recoveryIndexDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-source-index-recovery-'));
const missingScan = await scanLivingDoc(recoveringDoc, { indexDir: recoveryIndexDir, write: true });
assert.equal(missingScan.actionCounts.inaccessible, 1, 'missing local source starts inaccessible');
await writeFile(recoveringSource, '# Recovering Source\n\nNow present.\n');
const recoveredScan = await scanLivingDoc(recoveringDoc, { indexDir: recoveryIndexDir, write: true });
assert.equal(recoveredScan.actionCounts.indexed, 1, 'previously inaccessible local source should recover when it appears');
const recoveryIndex = JSON.parse(await readFile(path.join(recoveryIndexDir, 'source-index.json'), 'utf8'));
const recovered = Object.values(recoveryIndex.sources).find((source) => source.canonical.path === recoveringSource);
assert.equal(recovered.status, 'indexed');
assert.ok(recovered.chunks.length > 0, 'recovered source should store chunks');

const fakeGhDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-source-index-gh-'));
const fakeGh = path.join(fakeGhDir, 'gh');
await writeFile(fakeGh, `#!/usr/bin/env node
const args = process.argv.slice(2);
const pathArg = args[1] || '';
if (args[0] !== 'api') process.exit(1);
if (pathArg.endsWith('/comments')) {
  console.log(JSON.stringify([{ author: { login: 'reviewer' }, body: 'Preserve backlinks.' }]));
  process.exit(0);
}
console.log(JSON.stringify({
  number: 101,
  html_url: 'https://github.com/triadflow/living-doc-compositor/issues/101',
  title: 'Fetched issue 101',
  state: 'OPEN',
  body: 'Fetched issue body for source index.',
  labels: [{ name: 'enhancement' }],
  user: { login: 'triadflow' },
  updated_at: '2026-04-26T14:44:00Z'
}));
`);
await chmod(fakeGh, 0o755);
const fetchResult = spawnSync(process.execPath, [
  'scripts/source-material-index.mjs',
  'fetch-github',
  'https://github.com/triadflow/living-doc-compositor/issues/101',
  '--index-dir',
  indexDir,
  '--write',
  '--model',
  'local-hash-v2',
], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: { ...process.env, PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH || ''}` },
});
assert.equal(fetchResult.status, 0, fetchResult.stderr || fetchResult.stdout);
const fetchedIndex = JSON.parse(await readFile(path.join(indexDir, 'source-index.json'), 'utf8'));
const fetchedIssue = Object.values(fetchedIndex.sources).find((source) => source.canonical.url === 'https://github.com/triadflow/living-doc-compositor/issues/101');
assert.ok(fetchedIssue.backlinks.some((link) => link.sectionId === 'policy' && link.cardId === 'default-advisory-policy'), 'fetch-github --write should preserve scanned backlinks');
assert.equal(fetchedIssue.embedding.model, 'local-hash-v2');
assert.equal(fetchedIssue.chunks[0].embedding.model, 'local-hash-v2');

const retrieval = await queryIndex('default advisory profiles', { indexDir, limit: 3 });
assert.equal(retrieval.schema, INDEX_SCHEMA);
assert.match(retrieval.warning, /derived hydration candidates/);
assert.ok(retrieval.results.length >= 1, 'query should return ranked candidates');
assert.equal(retrieval.results[0].canonical.path, 'tests/fixtures/source-index-policy.md');
assert.equal(retrieval.results[0].verificationRequired, true);
assert.ok(retrieval.results[0].chunks[0].chunkId, 'retrieval result should include chunk ids');

console.log('source material index contract ok');
