#!/usr/bin/env node
// Local AI-pass server for the living-doc flow body.
//
// Three endpoints:
//   GET  /api/ai-pass/engines               — probe available engines + preferred
//   PUT  /api/ai-pass/engines/preferred     — persist engine preference
//   POST /api/ai-pass/propose               — run engine skill, return validated patch
//   POST /api/ai-pass/apply                 — apply accepted changes to disk
//
// No runtime dependencies beyond Node's stdlib. Validation is delegated to
// scripts/validate-ai-patch.mjs. Mutation is delegated to scripts/apply-ai-patch.mjs.
//
// Run:
//   node scripts/ai-pass-server.mjs                   # port 4322 (default)
//   PORT=4333 node scripts/ai-pass-server.mjs         # custom port
//   node scripts/ai-pass-server.mjs --mock-engine <path>   # use a fixture patch
//
// Engine config lives at ~/.living-doc-compositor/ai-pass-config.json:
//   {
//     "preferred": "claude-code",
//     "engines": {
//       "claude-code": { "command": ["claude", "-p"], "skillPrefix": "/living-doc-ai-pass-claude" },
//       "codex":       { "command": ["codex", "exec"], "skillPrefix": "/living-doc-ai-pass-codex" }
//     }
//   }
// Missing config → sensible defaults written on first start.

import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { validatePatch } from './validate-ai-patch.mjs';
import { applyAiPatch, wireTicketLink } from './apply-ai-patch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT || 4322);
const TIMEOUT_MS = Number(process.env.AI_PASS_TIMEOUT_MS || 120_000);
const CONFIG_DIR  = path.join(os.homedir(), '.living-doc-compositor');
const CONFIG_PATH = path.join(CONFIG_DIR, 'ai-pass-config.json');

const DEFAULT_CONFIG = {
  preferred: null,
  engines: {
    'claude-code': { command: ['claude', '-p'], skillPrefix: '/living-doc-ai-pass-claude' },
    'codex':       { command: ['codex', 'exec'], skillPrefix: '/living-doc-ai-pass-codex' },
  },
};

const args = process.argv.slice(2);
const mockEngineIdx = args.indexOf('--mock-engine');
const MOCK_PATCH_PATH = mockEngineIdx >= 0 ? args[mockEngineIdx + 1] : null;

// In-memory patch store. Restarting the server drops pending patches;
// that's fine — the UI can re-request.
const patchStore = new Map();

// ── config ─────────────────────────────────────────────────────────────────

async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    return structuredClone(DEFAULT_CONFIG);
  }
}

async function saveConfig(cfg) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

function probeEngine(engineCfg) {
  if (!engineCfg?.command?.length) return false;
  const cmd = engineCfg.command[0];
  const r = spawnSync('which', [cmd], { stdio: 'ignore' });
  return r.status === 0;
}

async function listEngines() {
  const cfg = await loadConfig();
  const available = [];
  for (const [name, ec] of Object.entries(cfg.engines || {})) {
    if (probeEngine(ec)) available.push(name);
  }
  return { available, preferred: cfg.preferred };
}

// ── engine invocation ─────────────────────────────────────────────────────

// Walk up from a file path until we find a .git directory; return that
// directory as the repo root. Falls back to the living-doc-compositor repo
// if no .git is found (e.g. a loose doc outside any repo).
function findRepoRoot(filePath) {
  let dir = path.resolve(path.dirname(filePath));
  while (dir !== path.parse(dir).root) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return repoRoot;
}

async function invokeEngine(engineName, request, cwd) {
  if (MOCK_PATCH_PATH) {
    const raw = await readFile(path.resolve(MOCK_PATCH_PATH), 'utf8');
    return JSON.parse(raw);
  }

  const cfg = await loadConfig();
  const ec = cfg.engines?.[engineName];
  if (!ec) throw new Error(`unknown engine: ${engineName}`);

  // Run the engine in the repo owning the doc so `gh` commands default to
  // the right remote, relative code-anchor paths resolve, and git-backed
  // checks (revision drift, commit searches) see the right history.
  const [bin, ...preArgs] = ec.command;
  const child = spawn(bin, [...preArgs, ec.skillPrefix], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: cwd || repoRoot,
  });

  const chunks = [];
  const errChunks = [];
  child.stdout.on('data', (d) => chunks.push(d));
  child.stderr.on('data', (d) => errChunks.push(d));
  child.stdin.write(JSON.stringify(request));
  child.stdin.end();

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`engine ${engineName} timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`engine ${engineName} exited ${code}: ${Buffer.concat(errChunks).toString()}`));
        return;
      }
      resolve(Buffer.concat(chunks).toString());
    });
  });

  return extractPatchJson(result, engineName);
}

// Engines sometimes wrap the patch in prose or ```json fences despite being
// told not to. Be liberal in what we accept: try direct parse, then fenced
// code blocks, then the first balanced {...} block.
function extractPatchJson(stdout, engineName) {
  const tries = [];
  const tryParse = (label, s) => {
    try { return { ok: true, value: JSON.parse(s) }; }
    catch (e) { tries.push(`${label}: ${e.message}`); return { ok: false }; }
  };

  const trimmed = stdout.trim();

  // 1. Direct parse.
  let r = tryParse('direct', trimmed);
  if (r.ok) return r.value;

  // 2. Fenced block ```json ... ``` or ``` ... ```
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    r = tryParse('fenced', fence[1].trim());
    if (r.ok) return r.value;
  }

  // 3. First balanced {...} block at top level.
  const start = trimmed.indexOf('{');
  if (start >= 0) {
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > start) {
      r = tryParse('balanced', trimmed.slice(start, end + 1));
      if (r.ok) return r.value;
    }
  }

  throw new Error(
    `engine ${engineName} output was not valid JSON. Attempts:\n  ${tries.join('\n  ')}\n--- output (first 1200 chars) ---\n${stdout.slice(0, 1200)}`
  );
}

// ── apply side effects (gh, fingerprint, render) ──────────────────────────

async function runGhIssueCreate({ repo, title, body, labels = [] }) {
  const ghArgs = ['issue', 'create', '--repo', repo, '--title', title];
  if (body) { ghArgs.push('--body', body); }
  for (const l of labels) { ghArgs.push('--label', l); }
  const r = spawnSync('gh', ghArgs, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gh issue create failed: ${r.stderr || r.stdout}`);
  const url = (r.stdout || '').trim();
  const m = url.match(/\/issues\/(\d+)/);
  return { issueUrl: url, issueNumber: m ? `#${m[1]}` : url };
}

async function restampFingerprint(doc) {
  const m = await import('./meta-fingerprint.mjs');
  doc.metaFingerprint = m.computeSectionFingerprint(doc.sections);
  return doc;
}

async function rerender(docPath) {
  const r = spawnSync('node', ['scripts/render-living-doc.mjs', docPath], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`render failed: ${r.stderr || r.stdout}`);
}

// ── HTTP ──────────────────────────────────────────────────────────────────

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, body) {
  cors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error(`invalid JSON body: ${e.message}`)); }
    });
    req.on('error', reject);
  });
}

async function handlePropose(req, res) {
  const body = await readBody(req);
  if (!body) return json(res, 400, { error: 'missing body' });
  const { docPath, cardRef, action, engine, extra } = body;
  if (!docPath || !cardRef || !action || !engine) {
    return json(res, 400, { error: 'missing required: docPath, cardRef, action, engine' });
  }

  // Accept .html paths by flipping to the matching .json alongside.
  let normalizedDocPath = docPath;
  if (normalizedDocPath.endsWith('.html')) {
    normalizedDocPath = normalizedDocPath.replace(/\.html$/, '.json');
  }
  if (!existsSync(normalizedDocPath)) {
    return json(res, 400, { error: `docPath does not exist: ${normalizedDocPath}` });
  }

  const docRepoRoot = findRepoRoot(normalizedDocPath);
  const registry = JSON.parse(await readFile(path.join(repoRoot, 'scripts/living-doc-registry.json'), 'utf8'));
  const doc = JSON.parse(await readFile(normalizedDocPath, 'utf8'));

  // The request payload now includes the registry inline so the skill
  // doesn't need to read from the cwd (which may not have the file).
  const requestId = 'req-' + crypto.randomBytes(6).toString('hex');
  const engineReq = {
    requestId,
    docPath: normalizedDocPath,
    docRepoRoot,
    cardRef,
    action,
    registry,
    extra: extra || {},
  };

  let patch;
  try {
    patch = await invokeEngine(engine, engineReq, docRepoRoot);
  } catch (e) {
    return json(res, 502, { error: String(e.message || e) });
  }
  const validation = validatePatch(patch, { registry, doc });

  const patchId = 'ptch-' + crypto.randomBytes(6).toString('hex');
  patchStore.set(patchId, { patch, docPath: normalizedDocPath, docRepoRoot, createdAt: Date.now() });
  // Expire old patches (15 min) so the server memory doesn't grow forever.
  for (const [id, entry] of patchStore) {
    if (Date.now() - entry.createdAt > 15 * 60_000) patchStore.delete(id);
  }

  return json(res, 200, { patchId, patch, validation });
}

async function handleApply(req, res) {
  const body = await readBody(req);
  if (!body) return json(res, 400, { error: 'missing body' });
  const { patchId, acceptedChangeIds } = body;
  if (!patchId) return json(res, 400, { error: 'missing patchId' });

  const entry = patchStore.get(patchId);
  if (!entry) return json(res, 404, { error: `patch ${patchId} not found or expired` });

  const docPath = entry.docPath;
  const doc = JSON.parse(await readFile(docPath, 'utf8'));

  const { doc: mutated, log, sideEffects } = applyAiPatch(doc, entry.patch, { acceptedChangeIds });

  // Execute gh-issue-create side effects, then wire the linkTo edits.
  const sideResults = [];
  let working = mutated;
  for (const se of sideEffects) {
    if (se.kind === 'gh-issue-create') {
      try {
        const { issueNumber, issueUrl } = await runGhIssueCreate(se);
        sideResults.push({ changeId: se.changeId, ok: true, issueNumber, issueUrl });
        if (se.linkTo) wireTicketLink(working, { linkTo: se.linkTo, issueNumber, issueUrl }, log);
      } catch (e) {
        sideResults.push({ changeId: se.changeId, ok: false, error: String(e.message || e) });
      }
    }
  }

  await restampFingerprint(working);
  await writeFile(docPath, JSON.stringify(working, null, 2) + '\n');
  try { await rerender(docPath); } catch (e) {
    return json(res, 200, { ok: true, log, sideResults, renderWarning: String(e.message || e), doc: working });
  }

  patchStore.delete(patchId);
  return json(res, 200, { ok: true, log, sideResults, doc: working });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { cors(res); res.statusCode = 204; res.end(); return; }
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/api/ai-pass/engines') {
      return json(res, 200, await listEngines());
    }
    if (req.method === 'PUT' && url.pathname === '/api/ai-pass/engines/preferred') {
      const body = await readBody(req);
      if (!body?.engine) return json(res, 400, { error: 'missing engine' });
      const cfg = await loadConfig();
      if (!cfg.engines?.[body.engine]) return json(res, 400, { error: `unknown engine: ${body.engine}` });
      cfg.preferred = body.engine;
      await saveConfig(cfg);
      return json(res, 200, { preferred: cfg.preferred });
    }
    if (req.method === 'POST' && url.pathname === '/api/ai-pass/propose') {
      return await handlePropose(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/api/ai-pass/apply') {
      return await handleApply(req, res);
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`ai-pass server listening on http://localhost:${PORT}`);
  if (MOCK_PATCH_PATH) console.log(`  (mock engine: all propose requests return ${MOCK_PATCH_PATH})`);
  console.log(`  config: ${CONFIG_PATH}`);
});
