#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

export const INDEX_SCHEMA = 'living-doc-source-index/v1';
export const DEFAULT_INDEX_DIR = '.living-doc-source-index';
export const DEFAULT_EMBEDDING_MODEL = 'local-hash-v1';
export const DEFAULT_EMBEDDING_DIMENSIONS = 64;

const SOURCE_REF_FIELDS = new Set([
  'ticketIds',
  'sourceRefs',
  'latestSourceRefs',
  'signalRefs',
  'codePaths',
  'scriptPaths',
  'artifactPaths',
  'workflowPaths',
  'automationPaths',
  'contractPaths',
  'servicePaths',
  'hookPaths',
  'screenPaths',
  'specRefs',
  'refs',
]);

const LOCAL_PATH_FIELDS = new Set([
  'codePaths',
  'scriptPaths',
  'artifactPaths',
  'workflowPaths',
  'automationPaths',
  'contractPaths',
  'servicePaths',
  'hookPaths',
  'screenPaths',
  'specRefs',
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const CONCEPT_ALIASES = {
  advisory: ['advisor', 'advice', 'profile', 'profiles', 'policy', 'default', 'ai'],
  profile: ['profiles', 'advisory', 'default', 'policy'],
  embedding: ['embed', 'embeddings', 'vector', 'vectors', 'semantic'],
  retrieval: ['retrieve', 'retrieval', 'search', 'shortlist', 'hydrate', 'hydration'],
  source: ['sources', 'material', 'canonical', 'provenance'],
  stale: ['freshness', 'changed', 'inaccessible', 'deleted', 'permission'],
};

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function shortHash(value, length = 16) {
  return sha256(value).slice(0, length);
}

function nowIso() {
  return new Date().toISOString();
}

function toPosix(value) {
  return String(value || '').split(path.sep).join('/');
}

function resolveRepoPath(value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function relativeRepoPath(value) {
  return toPosix(path.relative(repoRoot, resolveRepoPath(value)));
}

function stableSourceId(sourceType, canonicalValue) {
  return `src_${shortHash(`${sourceType}\0${canonicalValue}`)}`;
}

export function parseGitHubUrl(url) {
  const text = String(url || '').trim();
  const match = text.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/(\d+)(?:[?#].*)?$/i);
  if (!match) return null;
  const [, owner, repo, lane, number] = match;
  const kind = lane === 'pull' ? 'github-pr' : 'github-issue';
  return {
    owner,
    repo,
    fullRepo: `${owner}/${repo}`,
    kind,
    number,
    canonicalUrl: `https://github.com/${owner}/${repo}/${lane}/${number}`,
  };
}

function inferLocalSourceType(repoPath) {
  if (/\.json$/i.test(repoPath) && /(^|\/)(docs|tests\/fixtures)\//.test(repoPath)) return 'living-doc-json';
  if (/\.html$/i.test(repoPath)) return 'rendered-html';
  return 'local-file';
}

function baseRecord({ sourceType, canonical, context, label, status = 'queued', reason = '' }) {
  const canonicalValue = canonical.url || canonical.path || canonical.id || label;
  const sourceId = stableSourceId(sourceType, canonicalValue);
  return {
    schema: INDEX_SCHEMA,
    sourceId,
    sourceType,
    canonical,
    label: label || canonicalValue,
    status,
    statusReason: reason,
    freshness: {
      markerType: 'unknown',
      marker: '',
      contentHash: '',
      checkedAt: nowIso(),
    },
    permissions: {
      access: status === 'inaccessible' ? 'inaccessible' : 'unknown',
      visibility: 'unknown',
      reason,
    },
    provenance: {
      derived: true,
      discoveredAt: nowIso(),
      discoveredBy: 'source-material-index',
    },
    backlinks: context ? [context] : [],
    chunks: [],
    embedding: {
      provider: 'local-hash',
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    },
  };
}

export function normalizeSourceReference(value, context = {}) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'object' && !Array.isArray(value)) {
    const issueUrl = value.issueUrl || value.url;
    const parsed = parseGitHubUrl(issueUrl);
    if (parsed) {
      return baseRecord({
        sourceType: parsed.kind,
        canonical: {
          url: parsed.canonicalUrl,
          repo: parsed.fullRepo,
          owner: parsed.owner,
          name: parsed.repo,
          number: parsed.number,
        },
        label: value.title || value.issueNumber || parsed.canonicalUrl,
        context,
      });
    }
    if (value.path) {
      const repoPath = relativeRepoPath(value.path);
      return baseRecord({
        sourceType: inferLocalSourceType(repoPath),
        canonical: { path: repoPath },
        label: value.title || repoPath,
        context,
      });
    }
    if (value.id || value.title) {
      const label = String(value.id || value.title);
      return baseRecord({
        sourceType: 'connector-artifact',
        canonical: { id: label },
        label,
        status: 'unsupported',
        reason: 'Object reference does not include a supported canonical URL or path.',
        context,
      });
    }
    return null;
  }

  const text = String(value).trim();
  if (!text) return null;

  const parsed = parseGitHubUrl(text);
  if (parsed) {
    return baseRecord({
      sourceType: parsed.kind,
      canonical: {
        url: parsed.canonicalUrl,
        repo: parsed.fullRepo,
        owner: parsed.owner,
        name: parsed.repo,
        number: parsed.number,
      },
      label: parsed.canonicalUrl,
      context,
    });
  }

  if (/^https?:\/\//i.test(text)) {
    return baseRecord({
      sourceType: 'connector-artifact',
      canonical: { url: text },
      label: text,
      status: 'unsupported',
      reason: 'Remote non-GitHub source fetching is not implemented in the local-first index.',
      context,
    });
  }

  const field = context.field || '';
  const looksPathLike = text.includes('/') || text.startsWith('.') || path.extname(text);
  if (LOCAL_PATH_FIELDS.has(field) || looksPathLike) {
    const repoPath = relativeRepoPath(text);
    return baseRecord({
      sourceType: inferLocalSourceType(repoPath),
      canonical: { path: repoPath },
      label: repoPath,
      context,
    });
  }

  return baseRecord({
    sourceType: 'connector-artifact',
    canonical: { id: text },
    label: text,
    status: 'unsupported',
    reason: 'Symbolic source reference needs a connector-specific resolver before indexing.',
    context,
  });
}

function mergeBacklink(target, backlink) {
  if (!backlink) return;
  const key = JSON.stringify(backlink);
  const seen = new Set((target.backlinks || []).map((entry) => JSON.stringify(entry)));
  if (!seen.has(key)) target.backlinks.push(backlink);
}

function mergeRecords(records) {
  const byId = new Map();
  for (const record of records.filter(Boolean)) {
    const existing = byId.get(record.sourceId);
    if (!existing) {
      byId.set(record.sourceId, record);
      continue;
    }
    for (const backlink of record.backlinks || []) mergeBacklink(existing, backlink);
  }
  return [...byId.values()];
}

function pushReference(records, value, context) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => pushReference(records, item, { ...context, index }));
    return;
  }
  const record = normalizeSourceReference(value, context);
  if (record) records.push(record);
}

export function collectSourceReferences(doc, docPath = '') {
  const records = [];
  if (doc?.canonicalOrigin) {
    pushReference(records, doc.canonicalOrigin, {
      docPath,
      field: 'canonicalOrigin',
      edgeType: 'canonical-origin',
    });
  }
  for (const section of doc?.sections || []) {
    const cards = section.data || section.cards || [];
    for (const card of cards) {
      for (const [field, value] of Object.entries(card || {})) {
        if (!SOURCE_REF_FIELDS.has(field) && field !== 'url') continue;
        if (field === 'url' && !parseGitHubUrl(value)) continue;
        pushReference(records, value, {
          docPath,
          sectionId: section.id,
          cardId: card.id,
          field,
          edgeType: field === 'ticketIds' ? 'ticket' : 'references',
        });
      }
    }
  }
  return mergeRecords(records);
}

function tokenize(value) {
  const raw = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
  const expanded = [];
  for (const token of raw) {
    const stemmed = token.replace(/(ing|ed|es|s)$/i, '');
    expanded.push(token, stemmed);
    for (const [key, aliases] of Object.entries(CONCEPT_ALIASES)) {
      if (token === key || aliases.includes(token)) expanded.push(key, ...aliases);
    }
  }
  return expanded.filter(Boolean);
}

export function embedText(text, { dimensions = DEFAULT_EMBEDDING_DIMENSIONS } = {}) {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const token of tokenize(text)) {
    const hash = createHash('sha256').update(token).digest();
    const index = hash.readUInt16BE(0) % dimensions;
    const sign = hash[2] % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }
  const length = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  if (!length) return vector;
  return vector.map((value) => Number((value / length).toFixed(6)));
}

function cosine(a, b) {
  let score = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) score += a[i] * b[i];
  return score;
}

export function chunkText(text, { maxChars = 1200 } = {}) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks = [];
  let buffer = '';
  let start = 0;
  for (const paragraph of paragraphs) {
    const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars && buffer) {
      chunks.push({ text: buffer, start, end: start + buffer.length });
      start += buffer.length + 2;
      buffer = paragraph;
    } else {
      buffer = next;
    }
  }
  if (buffer) chunks.push({ text: buffer, start, end: start + buffer.length });
  return chunks.map((chunk, index) => ({
    chunkId: `chunk_${String(index + 1).padStart(3, '0')}_${shortHash(chunk.text, 8)}`,
    range: { start: chunk.start, end: chunk.end },
    text: chunk.text,
    contentHash: sha256(chunk.text),
  }));
}

async function readLocalContent(record) {
  const repoPath = record.canonical?.path;
  const absPath = resolveRepoPath(repoPath);
  if (!repoPath || !existsSync(absPath)) {
    return {
      ok: false,
      status: 'inaccessible',
      reason: 'Local source path does not exist.',
    };
  }
  const stat = statSync(absPath);
  if (!stat.isFile()) {
    return {
      ok: false,
      status: 'unsupported',
      reason: 'Local source path is not a file.',
    };
  }
  if (!TEXT_EXTENSIONS.has(path.extname(absPath).toLowerCase())) {
    return {
      ok: false,
      status: 'unsupported',
      reason: 'Local source file extension is not indexed as text.',
    };
  }
  const content = await readFile(absPath, 'utf8');
  return {
    ok: true,
    content,
    freshness: {
      markerType: 'hash',
      marker: sha256(content),
      contentHash: sha256(content),
      checkedAt: nowIso(),
    },
  };
}

export function normalizeGitHubPayload(payload, parsedUrl) {
  const parsed = typeof parsedUrl === 'string' ? parseGitHubUrl(parsedUrl) : parsedUrl;
  const labels = (payload.labels || []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean);
  const comments = (payload.comments || []).map((comment, index) => {
    const author = comment.author?.login || comment.user?.login || comment.author || 'unknown';
    return `Comment ${index + 1} by ${author}:\n${comment.body || ''}`;
  });
  const text = [
    `Title: ${payload.title || ''}`,
    `State: ${payload.state || ''}`,
    labels.length ? `Labels: ${labels.join(', ')}` : '',
    payload.body || '',
    ...comments,
  ].filter(Boolean).join('\n\n');
  const updatedAt = payload.updatedAt || payload.updated_at || '';
  const record = baseRecord({
    sourceType: parsed?.kind || 'github-issue',
    canonical: {
      url: parsed?.canonicalUrl || payload.url || payload.html_url || '',
      repo: parsed?.fullRepo || payload.repository || '',
      owner: parsed?.owner || '',
      name: parsed?.repo || '',
      number: String(parsed?.number || payload.number || ''),
    },
    label: payload.title || parsed?.canonicalUrl || payload.url || payload.html_url || '',
    status: 'indexed',
  });
  record.github = {
    title: payload.title || '',
    state: payload.state || '',
    labels,
    author: payload.author?.login || payload.user?.login || '',
    createdAt: payload.createdAt || payload.created_at || '',
    updatedAt,
    commentCount: comments.length,
  };
  record.sourceText = text;
  record.freshness = {
    markerType: updatedAt ? 'updatedAt' : 'hash',
    marker: updatedAt || sha256(text),
    contentHash: sha256(text),
    checkedAt: nowIso(),
  };
  record.permissions = {
    access: 'accessible',
    visibility: 'unknown',
    reason: '',
  };
  return hydrateChunks(record, text);
}

function hydrateChunks(record, text, model = DEFAULT_EMBEDDING_MODEL) {
  const chunks = chunkText(text).map((chunk) => ({
    ...chunk,
    embedding: {
      provider: 'local-hash',
      model,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      vector: embedText(chunk.text),
    },
  }));
  return {
    ...record,
    status: record.status === 'queued' ? 'indexed' : record.status,
    chunks,
    embedding: {
      provider: 'local-hash',
      model,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    },
  };
}

async function hydrateRecord(record, { model = DEFAULT_EMBEDDING_MODEL } = {}) {
  if (record.status === 'unsupported') return record;
  if (['local-file', 'living-doc-json', 'rendered-html'].includes(record.sourceType)) {
    const local = await readLocalContent(record);
    if (!local.ok) {
      return {
        ...record,
        status: local.status,
        statusReason: local.reason,
        permissions: {
          ...record.permissions,
          access: local.status === 'inaccessible' ? 'inaccessible' : record.permissions.access,
          reason: local.reason,
        },
      };
    }
    return hydrateChunks({
      ...record,
      status: 'indexed',
      sourceText: local.content,
      freshness: local.freshness,
      permissions: {
        access: 'accessible',
        visibility: 'local',
        reason: '',
      },
    }, local.content, model);
  }
  if (record.sourceType === 'github-issue' || record.sourceType === 'github-pr') {
    return {
      ...record,
      status: 'queued',
      statusReason: 'GitHub source requires fetch before chunking.',
    };
  }
  return record;
}

function emptyIndex(model = DEFAULT_EMBEDDING_MODEL) {
  const timestamp = nowIso();
  return {
    schema: INDEX_SCHEMA,
    createdAt: timestamp,
    updatedAt: timestamp,
    embedding: {
      provider: 'local-hash',
      model,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    },
    sources: {},
    queue: [],
  };
}

async function readIndex(indexDir, model = DEFAULT_EMBEDDING_MODEL) {
  const indexPath = path.join(resolveRepoPath(indexDir), 'source-index.json');
  if (!existsSync(indexPath)) return emptyIndex(model);
  return JSON.parse(await readFile(indexPath, 'utf8'));
}

async function writeIndex(indexDir, index) {
  const resolved = resolveRepoPath(indexDir);
  await mkdir(resolved, { recursive: true });
  await writeFile(path.join(resolved, 'source-index.json'), `${JSON.stringify(index, null, 2)}\n`);
}

function actionForRecord(previous, next, model) {
  if (next.status === 'unsupported') return 'unsupported';
  if (next.status === 'inaccessible') return 'inaccessible';
  if (!previous) return next.status === 'indexed' ? 'indexed' : 'queued';
  if (previous.status === 'failed') return 'queued';
  if (previous.freshness?.contentHash && next.freshness?.contentHash && previous.freshness.contentHash !== next.freshness.contentHash) return 'changed';
  if (previous.embedding?.model && previous.embedding.model !== model) return 'embedding-model-stale';
  if (next.status === 'queued') return 'queued';
  return 'skipped';
}

function updateQueue(index, record, action) {
  index.queue = (index.queue || []).filter((item) => item.sourceId !== record.sourceId);
  if (['queued', 'changed', 'embedding-model-stale', 'inaccessible', 'unsupported'].includes(action)) {
    index.queue.push({
      sourceId: record.sourceId,
      sourceType: record.sourceType,
      canonical: record.canonical,
      action,
      status: record.status,
      reason: record.statusReason || '',
      queuedAt: nowIso(),
    });
  }
}

export async function scanLivingDoc(docPath, options = {}) {
  const model = options.model || DEFAULT_EMBEDDING_MODEL;
  const indexDir = options.indexDir || DEFAULT_INDEX_DIR;
  const resolvedDocPath = resolveRepoPath(docPath);
  const doc = JSON.parse(await readFile(resolvedDocPath, 'utf8'));
  const refs = collectSourceReferences(doc, relativeRepoPath(resolvedDocPath));
  const index = await readIndex(indexDir, model);
  const actions = [];

  for (const ref of refs) {
    const hydrated = await hydrateRecord(ref, { model });
    const previous = index.sources?.[hydrated.sourceId];
    const action = actionForRecord(previous, hydrated, model);
    const record = action === 'skipped' ? {
      ...previous,
      backlinks: [...previous.backlinks || []],
      lastSeenAt: nowIso(),
    } : hydrated;
    for (const backlink of hydrated.backlinks || []) mergeBacklink(record, backlink);
    record.lastAction = action;
    record.lastSeenAt = nowIso();
    index.sources[record.sourceId] = record;
    updateQueue(index, record, action);
    actions.push({
      action,
      sourceId: record.sourceId,
      sourceType: record.sourceType,
      status: record.status,
      canonical: record.canonical,
      backlinks: record.backlinks,
      freshness: record.freshness,
      permissions: record.permissions,
      chunks: record.chunks?.map((chunk) => ({ chunkId: chunk.chunkId, range: chunk.range })) || [],
    });
  }

  index.updatedAt = nowIso();
  index.embedding = {
    provider: 'local-hash',
    model,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
  };
  if (options.write) await writeIndex(indexDir, index);
  return {
    schema: INDEX_SCHEMA,
    docPath: relativeRepoPath(resolvedDocPath),
    indexDir,
    write: options.write === true,
    actionCounts: actions.reduce((acc, item) => {
      acc[item.action] = (acc[item.action] || 0) + 1;
      return acc;
    }, {}),
    actions,
  };
}

export async function queryIndex(query, options = {}) {
  const model = options.model || DEFAULT_EMBEDDING_MODEL;
  const index = await readIndex(options.indexDir || DEFAULT_INDEX_DIR, model);
  const queryVector = embedText(query);
  const matches = [];
  for (const source of Object.values(index.sources || {})) {
    for (const chunk of source.chunks || []) {
      const vector = chunk.embedding?.vector || [];
      if (!vector.length) continue;
      matches.push({
        source,
        chunk,
        score: cosine(queryVector, vector),
      });
    }
  }
  const bySource = new Map();
  for (const match of matches.sort((a, b) => b.score - a.score)) {
    const current = bySource.get(match.source.sourceId);
    const chunkMatch = {
      chunkId: match.chunk.chunkId,
      score: Number(match.score.toFixed(6)),
      range: match.chunk.range,
      textPreview: match.chunk.text.slice(0, 240),
    };
    if (!current) {
      bySource.set(match.source.sourceId, {
        sourceId: match.source.sourceId,
        sourceType: match.source.sourceType,
        canonical: match.source.canonical,
        score: chunkMatch.score,
        status: match.source.status,
        freshness: match.source.freshness,
        permissions: match.source.permissions,
        provenance: match.source.provenance,
        backlinks: match.source.backlinks || [],
        verificationRequired: true,
        retrievalNote: `Matched local derived chunk ${chunkMatch.chunkId}; verify ${match.source.canonical?.url || match.source.canonical?.path || match.source.sourceId} before acting.`,
        chunks: [chunkMatch],
      });
    } else if (current.chunks.length < 3) {
      current.chunks.push(chunkMatch);
      current.score = Math.max(current.score, chunkMatch.score);
    }
  }
  return {
    schema: INDEX_SCHEMA,
    query,
    model,
    warning: 'Retrieval results are derived hydration candidates, not verification evidence. Re-check canonical sources before status changes or source-system actions.',
    results: [...bySource.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, Number(options.limit || 10)),
  };
}

async function fetchGitHubSource(url, options = {}) {
  const parsed = parseGitHubUrl(url);
  if (!parsed) throw new Error(`Unsupported GitHub URL: ${url}`);
  const apiPath = parsed.kind === 'github-pr'
    ? `repos/${parsed.fullRepo}/pulls/${parsed.number}`
    : `repos/${parsed.fullRepo}/issues/${parsed.number}`;
  const commentsPath = `repos/${parsed.fullRepo}/issues/${parsed.number}/comments`;
  const main = spawnSync('gh', ['api', apiPath], { cwd: repoRoot, encoding: 'utf8' });
  if (main.status !== 0) {
    return baseRecord({
      sourceType: parsed.kind,
      canonical: { url: parsed.canonicalUrl, repo: parsed.fullRepo, owner: parsed.owner, name: parsed.repo, number: parsed.number },
      status: 'inaccessible',
      reason: main.stderr || main.stdout || 'gh api failed',
    });
  }
  const comments = spawnSync('gh', ['api', commentsPath], { cwd: repoRoot, encoding: 'utf8' });
  const payload = JSON.parse(main.stdout);
  const commentPayload = comments.status === 0 ? JSON.parse(comments.stdout) : [];
  const normalized = normalizeGitHubPayload({
    ...payload,
    comments: commentPayload,
  }, parsed);
  if (options.write) {
    const index = await readIndex(options.indexDir || DEFAULT_INDEX_DIR, options.model || DEFAULT_EMBEDDING_MODEL);
    index.sources[normalized.sourceId] = normalized;
    index.updatedAt = nowIso();
    index.queue = (index.queue || []).filter((item) => item.sourceId !== normalized.sourceId);
    await writeIndex(options.indexDir || DEFAULT_INDEX_DIR, index);
  }
  return normalized;
}

function printUsage() {
  console.error([
    'Usage:',
    '  node scripts/source-material-index.mjs scan <doc.json> [--index-dir DIR] [--write] [--model NAME]',
    '  node scripts/source-material-index.mjs query <text> [--index-dir DIR] [--limit N] [--model NAME]',
    '  node scripts/source-material-index.mjs fetch-github <issue-or-pr-url> [--index-dir DIR] [--write] [--model NAME]',
  ].join('\n'));
}

function parseOptions(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write') {
      options.write = true;
      continue;
    }
    if (arg === '--index-dir') {
      options.indexDir = argv[++i];
      continue;
    }
    if (arg === '--model') {
      options.model = argv[++i];
      continue;
    }
    if (arg === '--limit') {
      options.limit = Number(argv[++i]);
      continue;
    }
    positional.push(arg);
  }
  return { positional, options };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, options } = parseOptions(rest);
  try {
    if (command === 'scan') {
      if (!positional[0]) throw new Error('scan requires <doc.json>');
      console.log(JSON.stringify(await scanLivingDoc(positional[0], options), null, 2));
      return;
    }
    if (command === 'query') {
      if (!positional.length) throw new Error('query requires text');
      console.log(JSON.stringify(await queryIndex(positional.join(' '), options), null, 2));
      return;
    }
    if (command === 'fetch-github') {
      if (!positional[0]) throw new Error('fetch-github requires a GitHub issue or PR URL');
      console.log(JSON.stringify(await fetchGitHubSource(positional[0], options), null, 2));
      return;
    }
    printUsage();
    process.exit(command ? 1 : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
