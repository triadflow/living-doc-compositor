#!/usr/bin/env node
// Card-aware JSON diff for living docs.
// Given a JSON file and a git ref range, emits a structured changelog
// grouped by commit. Each entry names the card that changed, the kind
// of change (added / removed / updated), and a short field-level summary.
//
// Usage:
//   node scripts/living-doc-changelog.mjs docs/<doc>.json <from-ref> [to-ref] [flags]
//
// Flags:
//   --json           emit machine-readable JSON instead of human summary
//   --emit-section   emit a ready-to-paste change-log section object
//   --inject         write a change-log section into the doc in place
//
// Default to-ref is HEAD.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import { argv } from 'node:process';

const args = argv.slice(2);
const asJson = args.includes('--json');
const emitSection = args.includes('--emit-section');
const inject = args.includes('--inject');
const positional = args.filter((a) => !a.startsWith('--'));
const [docPathInput, fromRef, toRef = 'HEAD'] = positional;

function normalizeToRepoRelative(p) {
  if (!p) return p;
  // `git show <ref>:<path>` requires a path relative to the repo root.
  const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  if (isAbsolute(p)) return relative(repoRoot, p);
  // If already relative, assume it's relative to cwd; normalise against repo root.
  const abs = execSync(`cd "${process.cwd()}" && realpath "${p}"`, { encoding: 'utf8' }).trim();
  return relative(repoRoot, abs);
}

const docPath = docPathInput;
const docPathForGit = normalizeToRepoRelative(docPathInput);

if (!docPath || !fromRef) {
  console.error('Usage: node scripts/living-doc-changelog.mjs <json-file> <from-ref> [to-ref] [--json]');
  process.exit(1);
}

const SHORT_FIELDS = new Set(['name', 'trend', 'posture', 'state', 'outcome', 'movement', 'status']);
const SKIP_FIELDS = new Set(['lastUpdatedInPeriod']);

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function readJsonAt(ref, path) {
  try {
    const raw = sh(`git show ${ref}:${path}`);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function indexCards(doc) {
  // Returns Map<sectionId, Map<cardId, card>> plus a Map<sectionId, sectionMeta>.
  const sections = new Map();
  const sectionMeta = new Map();
  for (const section of doc?.sections ?? []) {
    if (!Array.isArray(section.data)) continue;
    const byId = new Map();
    for (const card of section.data) {
      if (card && card.id) byId.set(card.id, card);
    }
    sections.set(section.id, byId);
    sectionMeta.set(section.id, { title: section.title, convergenceType: section.convergenceType });
  }
  return { sections, sectionMeta };
}

function summarizeFieldChange(key, before, after) {
  if (SKIP_FIELDS.has(key)) return null;
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  if (SHORT_FIELDS.has(key) && typeof before === 'string' && typeof after === 'string') {
    return `${key}: ${before} → ${after}`;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const delta = after.length - before.length;
    if (delta > 0) return `${key}: +${delta} ${delta === 1 ? 'entry' : 'entries'}`;
    if (delta < 0) return `${key}: ${delta} ${Math.abs(delta) === 1 ? 'entry' : 'entries'}`;
    return `${key}: entries rewritten`;
  }
  if (before === undefined) return `${key}: added`;
  if (after === undefined) return `${key}: removed`;
  return `${key}: updated`;
}

function diffCards(before, after) {
  const changed = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (key === 'id') continue;
    const sum = summarizeFieldChange(key, before?.[key], after?.[key]);
    if (sum) changed.push(sum);
  }
  return changed;
}

function diffDocs(beforeDoc, afterDoc) {
  const before = indexCards(beforeDoc);
  const after = indexCards(afterDoc);
  const entries = [];
  const sectionIds = new Set([...before.sections.keys(), ...after.sections.keys()]);
  for (const sid of sectionIds) {
    const meta = after.sectionMeta.get(sid) ?? before.sectionMeta.get(sid);
    const beforeCards = before.sections.get(sid) ?? new Map();
    const afterCards = after.sections.get(sid) ?? new Map();
    const cardIds = new Set([...beforeCards.keys(), ...afterCards.keys()]);
    for (const cid of cardIds) {
      const b = beforeCards.get(cid);
      const a = afterCards.get(cid);
      if (!b && a) {
        entries.push({ section: sid, sectionTitle: meta?.title, card: cid, cardName: a.name, kind: 'added', fields: [] });
      } else if (b && !a) {
        entries.push({ section: sid, sectionTitle: meta?.title, card: cid, cardName: b.name, kind: 'removed', fields: [] });
      } else if (b && a) {
        const fields = diffCards(b, a);
        if (fields.length > 0) {
          entries.push({ section: sid, sectionTitle: meta?.title, card: cid, cardName: a.name ?? b.name, kind: 'updated', fields });
        }
      }
    }
  }
  return entries;
}

function commitsBetween(from, to, path) {
  const out = sh(`git log --format=%H%x1f%cI%x1f%s --reverse ${from}..${to} -- ${path}`);
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [sha, isoDate, subject] = line.split('\x1f');
    return { sha, isoDate, subject };
  });
}

const commits = commitsBetween(fromRef, toRef, docPathForGit);
if (commits.length === 0) {
  console.error(`No commits for ${docPath} in ${fromRef}..${toRef}.`);
  process.exit(0);
}

const changelog = [];
for (const commit of commits) {
  const before = readJsonAt(`${commit.sha}^`, docPathForGit);
  const after = readJsonAt(commit.sha, docPathForGit);
  if (!before || !after) continue;
  const entries = diffDocs(before, after);
  if (entries.length === 0) continue;
  changelog.push({
    commit: commit.sha,
    shortSha: commit.sha.slice(0, 7),
    date: commit.isoDate,
    subject: commit.subject,
    entries
  });
}

function buildSectionCards(changelog) {
  const cards = [];
  for (const c of changelog) {
    for (const e of c.entries) {
      const id = `chg-${c.shortSha}-${e.section}-${e.card}`.replace(/[^a-zA-Z0-9\-_]/g, '-');
      const fieldsSummary = e.fields.length > 0 ? e.fields.join('; ') : null;
      const whatChanged = {
        added: `New card in ${e.sectionTitle ?? e.section}`,
        removed: `Card removed from ${e.sectionTitle ?? e.section}`,
        updated: fieldsSummary ?? 'card updated'
      }[e.kind];
      cards.push({
        id,
        name: e.cardName ?? e.card,
        changeKind: e.kind,
        commit: c.shortSha,
        date: c.date.slice(0, 10),
        subject: c.subject,
        cardRef: `${e.section}/${e.card}`,
        sectionRef: e.sectionTitle ?? e.section,
        fieldChanges: e.fields.length > 0 ? e.fields : undefined,
        notes: [{ role: 'paragraph', text: whatChanged }],
        lastUpdatedInPeriod: '2026-H1'
      });
    }
  }
  return cards;
}

function buildSectionObject(changelog, fromRef) {
  const cards = buildSectionCards(changelog);
  return {
    id: 'change-log',
    title: 'Changes since publish',
    convergenceType: 'change-log',
    rationale: `Card-level diff of this living doc between the paired dossier's source commit (${fromRef}) and HEAD. Auto-generated by scripts/living-doc-changelog.mjs — do not hand-edit. Reader of the dossier can use this to see what has moved on the substrate since the piece was frozen.`,
    updated: new Date().toISOString(),
    data: cards
  };
}

if (emitSection) {
  console.log(JSON.stringify(buildSectionObject(changelog, fromRef), null, 2));
} else if (inject) {
  // Text-splice to preserve the existing file's formatting. We locate the
  // sections array's closing bracket, remove any prior change-log section,
  // and append the freshly generated one just before the close.
  const raw = readFileSync(docPath, 'utf8');
  const section = buildSectionObject(changelog, fromRef);
  const sectionJson = JSON.stringify(section, null, 2).replace(/\n/g, '\n    ');

  // Find "sections": [ ... ]
  const sectionsStart = raw.indexOf('"sections":');
  if (sectionsStart < 0) {
    console.error('No "sections" key found in doc.');
    process.exit(1);
  }
  const openBracket = raw.indexOf('[', sectionsStart);
  // Walk bracket depth to find matching close.
  let depth = 0;
  let i = openBracket;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  const closeBracket = i;
  if (depth !== 0) {
    console.error('Could not locate closing bracket of sections array.');
    process.exit(1);
  }

  let body = raw.slice(openBracket + 1, closeBracket);
  // Strip any existing change-log section we previously appended.
  // Strategy: find "id": "change-log" occurrences and remove the enclosing
  // { ... } object plus any trailing comma/whitespace.
  const chgRe = /,?\s*\{\s*"id":\s*"change-log"[\s\S]*?\n\s*\}/g;
  body = body.replace(chgRe, '');
  // Trim trailing whitespace before close.
  body = body.replace(/\s+$/, '');
  // Decide whether we need a comma separator before our insertion.
  const trimmed = body.trimEnd();
  const needsComma = trimmed.length > 0 && !trimmed.endsWith(',') && !trimmed.endsWith('[');
  const newBody = `${body}${needsComma ? ',' : ''}\n    ${sectionJson}\n  `;

  const out = raw.slice(0, openBracket + 1) + newBody + raw.slice(closeBracket);
  writeFileSync(docPath, out);
  console.error(`Injected change-log section into ${docPath} (${section.data.length} entries from ${fromRef}..${toRef}).`);
} else if (asJson) {
  console.log(JSON.stringify(changelog, null, 2));
} else {
  for (const c of changelog) {
    console.log(`${c.shortSha}  ${c.date.slice(0, 10)}  ${c.subject}`);
    for (const e of c.entries) {
      const badge = e.kind.toUpperCase().padEnd(7);
      console.log(`  ${badge} ${e.section}/${e.card} — ${e.cardName ?? ''}`);
      for (const f of e.fields) console.log(`          · ${f}`);
    }
    console.log('');
  }
}
