#!/usr/bin/env node
// Refresh the drift count on every DOSSIERS entry in docs/dossier/index.html.
// For each entry, reads the paired dossier HTML's dossier-source-commit meta,
// runs the card-aware changelog against the living-doc JSON, and writes a
// drift: N field into the entry in place via text-splice.
//
// Usage:
//   node scripts/refresh-dossier-index.mjs

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(repoRoot, 'docs/dossier/index.html');
const dossierRoot = join(repoRoot, 'docs/dossier');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function readMeta(html, name) {
  const re = new RegExp(`<meta\\s+name=\"${name}\"\\s+content=\"([^\"]*)\"\\s*/?>`);
  const m = html.match(re);
  return m ? m[1] : null;
}

function slugFromDocId(id) {
  return id?.startsWith('doc:') ? id.slice(4) : id;
}

function driftForPiece(hrefRelative) {
  const htmlPath = join(dossierRoot, hrefRelative);
  let html;
  try {
    html = readFileSync(htmlPath, 'utf8');
  } catch {
    return { drift: null, reason: 'not-found' };
  }
  const sourceCommit = readMeta(html, 'dossier-source-commit');
  const livingDocId = readMeta(html, 'dossier-living-doc-id');
  if (!sourceCommit || !livingDocId) return { drift: null, reason: 'missing-meta' };
  const slug = slugFromDocId(livingDocId);
  const jsonPath = join(repoRoot, 'docs', `${slug}.json`);
  try {
    const raw = sh(`node ${join(repoRoot, 'scripts/living-doc-changelog.mjs')} ${jsonPath} ${sourceCommit} HEAD --json`);
    const parsed = raw ? JSON.parse(raw) : [];
    const drift = parsed.reduce((n, c) => n + c.entries.length, 0);
    return { drift };
  } catch (e) {
    return { drift: null, reason: 'script-failed', error: String(e) };
  }
}

const raw = readFileSync(indexPath, 'utf8');

// Walk the DOSSIERS array entries and splice drift: N into each.
// Entries start with `{` and close with `}` (balanced braces at object depth 1
// inside the array). We match by `href: "..."` to locate each entry, then
// update or insert `drift: N,` right before the closing brace of that entry.

const entryOpenRe = /\{\s*slug:\s*"[^"]+",[\s\S]*?href:\s*"([^"]+)"[\s\S]*?\n\s*\}/g;

let out = raw;
let changes = 0;

// We have to walk the text and operate right-to-left so that splices don't
// shift earlier offsets. Collect first, apply in reverse.
const matches = [];
for (const m of raw.matchAll(entryOpenRe)) {
  matches.push({ index: m.index, length: m[0].length, body: m[0], href: m[1] });
}

for (let i = matches.length - 1; i >= 0; i--) {
  const { index, length, body, href } = matches[i];
  const { drift, reason } = driftForPiece(href);
  if (drift === null) {
    console.error(`  ${href}: drift skipped (${reason})`);
    continue;
  }
  // Remove any existing `drift: N,` lines before re-inserting.
  let cleaned = body.replace(/\s*drift:\s*\d+,?\n?/g, '\n');
  // Insert `drift: N` right before the closing `}` of the entry.
  // Match the final newline + whitespace + `}` of the entry.
  const closeRe = /\n(\s*)\}\s*$/;
  const closeMatch = cleaned.match(closeRe);
  if (!closeMatch) {
    console.error(`  ${href}: could not locate closing brace`);
    continue;
  }
  const indent = closeMatch[1];
  const fieldIndent = indent + '  ';
  // Only prepend a comma if the preceding non-whitespace text isn't already one.
  const beforeClose = cleaned.slice(0, closeMatch.index).trimEnd();
  const needsComma = !beforeClose.endsWith(',') && !beforeClose.endsWith('{');
  const next = cleaned.replace(closeRe, `${needsComma ? ',' : ''}\n${fieldIndent}drift: ${drift}\n${indent}}`);
  out = out.slice(0, index) + next + out.slice(index + length);
  console.error(`  ${href}: drift = ${drift}`);
  changes++;
}

if (changes > 0) {
  writeFileSync(indexPath, out);
  console.error(`Updated ${changes} DOSSIERS entries in ${indexPath}`);
} else {
  console.error('No changes written.');
}
