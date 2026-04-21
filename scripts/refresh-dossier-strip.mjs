#!/usr/bin/env node
// Auto-generate (or refresh) the "Since this piece was published" aside
// on a dossier period piece. Reads the dossier's own meta tags to find
// the source commit and the paired living-doc id, runs the card-aware
// changelog, and replaces the aside in place. Nothing else in the HTML
// is touched.
//
// Usage:
//   node scripts/refresh-dossier-strip.mjs <path-to-dossier-html>
//   node scripts/refresh-dossier-strip.mjs --all
//
// Requires: <meta name="dossier-source-commit" content="<sha>"> and
// <meta name="dossier-living-doc-id" content="doc:<slug>"> in the file.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv } from 'node:process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = argv.slice(2);
const all = args.includes('--all');
const paths = args.filter((a) => !a.startsWith('--'));

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function readMeta(html, name) {
  const re = new RegExp(`<meta\\s+name=\"${name}\"\\s+content=\"([^\"]*)\"\\s*/?>`);
  const m = html.match(re);
  return m ? m[1] : null;
}

function slugFromDocId(docId) {
  return docId.startsWith('doc:') ? docId.slice(4) : docId;
}

function runChangelog(jsonPath, fromRef) {
  const raw = sh(`node ${join(repoRoot, 'scripts/living-doc-changelog.mjs')} ${jsonPath} ${fromRef} HEAD --json`);
  if (!raw) return [];
  return JSON.parse(raw);
}

const ASIDE_START = '<aside class="since-publish"';
const ASIDE_END = '</aside>';

function renderAside(sourceCommit, livingDocUrl, entries) {
  const counts = { added: 0, updated: 0, removed: 0 };
  for (const c of entries) for (const e of c.entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  const total = counts.added + counts.updated + counts.removed;

  if (total === 0) {
    return `<aside class="since-publish" data-total="0" style="margin:36px 0 24px;padding:16px 20px;border:1px solid var(--r-line);border-radius:12px;background:var(--r-card);font-size:13.5px;line-height:1.55;color:var(--r-muted)">
      <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--r-accent);margin-right:10px">Since this piece was published</span>
      The living doc has not moved since <code>${sourceCommit}</code>. No card-level changes.
    </aside>`;
  }

  const summaryBits = [];
  if (counts.updated) summaryBits.push(`${counts.updated} update${counts.updated === 1 ? '' : 's'}`);
  if (counts.added) summaryBits.push(`${counts.added} addition${counts.added === 1 ? '' : 's'}`);
  if (counts.removed) summaryBits.push(`${counts.removed} removal${counts.removed === 1 ? '' : 's'}`);

  const items = [];
  for (const c of entries) {
    for (const e of c.entries) {
      const fieldHint = e.fields.length > 0 ? ` — ${e.fields.slice(0, 3).join('; ')}${e.fields.length > 3 ? '…' : ''}` : '';
      items.push(`<li><strong>${e.kind}</strong> · <code>${e.section}/${e.card}</code>${fieldHint}</li>`);
    }
  }

  return `<aside class="since-publish" data-total="${total}" style="margin:36px 0 24px;padding:18px 20px;border:1px solid var(--r-line);border-radius:12px;background:color-mix(in srgb, var(--r-accent) 3%, var(--r-card));font-size:14px;line-height:1.55">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--r-accent)">Since this piece was published</span>
        <span style="color:var(--r-muted);font-size:12.5px">frozen at commit <code style="font-family:ui-monospace, SFMono-Regular, monospace;font-size:12px">${sourceCommit}</code> · ${total} card-level change${total === 1 ? '' : 's'} on the living doc since</span>
      </div>
      <div style="color:var(--r-ink);margin-bottom:8px">${summaryBits.join(', ')}.</div>
      <ul style="margin:0;padding-left:20px;color:var(--r-muted);font-size:13.5px">${items.join('')}</ul>
      <div style="margin-top:12px;font-size:13px">
        <a href="${livingDocUrl}#change-log" style="color:var(--r-accent);border-bottom:1px solid color-mix(in srgb,var(--r-accent) 35%,transparent)">Open the full change-log on the living doc →</a>
      </div>
    </aside>`;
}

function findAsideRange(html) {
  const start = html.indexOf(ASIDE_START);
  if (start < 0) return null;
  const endIdx = html.indexOf(ASIDE_END, start);
  if (endIdx < 0) return null;
  return [start, endIdx + ASIDE_END.length];
}

function findInsertionPoint(html) {
  // Prefer inserting just before the related section. Fall back to before the main closing </article>.
  const beforeRelated = html.indexOf('<section class="related"');
  if (beforeRelated >= 0) return beforeRelated;
  const beforeArticleEnd = html.indexOf('</article>');
  return beforeArticleEnd >= 0 ? beforeArticleEnd : -1;
}

function refresh(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const sourceCommit = readMeta(html, 'dossier-source-commit');
  const livingDocId = readMeta(html, 'dossier-living-doc-id');
  const livingDocUrl = readMeta(html, 'dossier-living-doc');
  if (!sourceCommit) {
    console.error(`[skip] ${htmlPath}: no <meta name="dossier-source-commit">`);
    return { skipped: true };
  }
  if (!livingDocId) {
    console.error(`[skip] ${htmlPath}: no <meta name="dossier-living-doc-id">`);
    return { skipped: true };
  }
  const slug = slugFromDocId(livingDocId);
  const jsonPath = join(repoRoot, 'docs', `${slug}.json`);
  const entries = runChangelog(jsonPath, sourceCommit);
  const aside = renderAside(sourceCommit, livingDocUrl ?? `https://triadflow.github.io/living-doc-compositor/${slug}.html`, entries);

  const existing = findAsideRange(html);
  let next;
  if (existing) {
    next = html.slice(0, existing[0]) + aside + html.slice(existing[1]);
  } else {
    const insertAt = findInsertionPoint(html);
    if (insertAt < 0) {
      console.error(`[skip] ${htmlPath}: could not find insertion point`);
      return { skipped: true };
    }
    next = html.slice(0, insertAt) + `    ${aside}\n\n    ` + html.slice(insertAt);
  }
  writeFileSync(htmlPath, next);
  const total = (entries ?? []).reduce((n, c) => n + c.entries.length, 0);
  console.error(`[ok] ${htmlPath}: ${total} card change${total === 1 ? '' : 's'} since ${sourceCommit}`);
  return { total };
}

function collectAllDossierPieces() {
  const out = [];
  const root = join(repoRoot, 'docs/dossier');
  for (const dir of readdirSync(root)) {
    const fullDir = join(root, dir);
    if (!statSync(fullDir).isDirectory()) continue;
    for (const file of readdirSync(fullDir)) {
      if (file.endsWith('.html')) out.push(join(fullDir, file));
    }
  }
  return out;
}

if (!all && paths.length === 0) {
  console.error('Usage: node scripts/refresh-dossier-strip.mjs <dossier.html> [..] | --all');
  process.exit(1);
}

const targets = all ? collectAllDossierPieces() : paths;
for (const t of targets) refresh(t);
