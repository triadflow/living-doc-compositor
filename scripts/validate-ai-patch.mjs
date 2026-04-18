// Lightweight validator for living-doc-ai-patch/v1.
//
// Three layers:
//   1. Shape — required fields, types, enums (hand-rolled against the schema).
//   2. Registry contract — card fields match the target section's convergence type.
//   3. Doc consistency — referenced sections, cards, facets exist; no silent orphan creation.
//
// Layer 1 always runs. Layers 2 and 3 run when a registry and/or doc are supplied.
//
// API: validatePatch(patch, { registry, doc }) -> ValidationResult
//
// ValidationResult:
//   { ok, violations, warnings, summary }
//
//   ok            — true iff no violations
//   violations    — hard failures; a patch with violations must not be applied
//   warnings      — soft notes (e.g. suggested invariant rationale missing)
//   summary       — { typeBoundariesOk, orphansCreated, referencedSectionsOk }

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _schema = null;
export async function loadSchema() {
  if (!_schema) {
    const raw = await readFile(path.join(__dirname, 'ai-patch-schema.json'), 'utf8');
    _schema = JSON.parse(raw);
  }
  return _schema;
}

const CHANGE_KINDS = new Set([
  'card-create', 'card-update', 'ticket-create',
  'coverage-add', 'coverage-remove',
  'invariant-suggest', 'rationale-update',
]);

const ENGINES = new Set(['claude-code', 'codex']);

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function push(arr, entry) { arr.push(entry); }

// ── Layer 1: shape ────────────────────────────────────────────────────────

function validateShape(patch, violations) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    push(violations, { path: '$', rule: 'shape', message: 'patch must be an object' });
    return;
  }
  if (patch.schema !== 'living-doc-ai-patch/v1') {
    push(violations, { path: '$.schema', rule: 'shape', message: `schema must be "living-doc-ai-patch/v1" (got ${JSON.stringify(patch.schema)})` });
  }
  if (typeof patch.requestId !== 'string' || !patch.requestId) {
    push(violations, { path: '$.requestId', rule: 'shape', message: 'requestId must be a non-empty string' });
  }
  if (typeof patch.summary !== 'string' || !patch.summary) {
    push(violations, { path: '$.summary', rule: 'shape', message: 'summary must be a non-empty string' });
  }
  if (patch.proposedBy !== undefined) {
    if (typeof patch.proposedBy !== 'object' || patch.proposedBy === null) {
      push(violations, { path: '$.proposedBy', rule: 'shape', message: 'proposedBy must be an object' });
    } else {
      if (!ENGINES.has(patch.proposedBy.engine)) {
        push(violations, { path: '$.proposedBy.engine', rule: 'shape', message: `engine must be one of: ${[...ENGINES].join(', ')}` });
      }
      if (typeof patch.proposedBy.action !== 'string' || !patch.proposedBy.action) {
        push(violations, { path: '$.proposedBy.action', rule: 'shape', message: 'action must be a non-empty string' });
      }
    }
  }
  if (!Array.isArray(patch.changes)) {
    push(violations, { path: '$.changes', rule: 'shape', message: 'changes must be an array' });
    return;
  }
  patch.changes.forEach((ch, i) => validateChangeShape(ch, i, violations));
}

function validateChangeShape(ch, i, violations) {
  const base = `$.changes[${i}]`;
  if (!ch || typeof ch !== 'object') {
    push(violations, { path: base, rule: 'shape', message: 'change must be an object' });
    return;
  }
  if (typeof ch.changeId !== 'string' || !ch.changeId) {
    push(violations, { path: `${base}.changeId`, rule: 'shape', message: 'changeId must be a non-empty string' });
  }
  if (!CHANGE_KINDS.has(ch.kind)) {
    push(violations, { path: `${base}.kind`, rule: 'shape', message: `kind must be one of: ${[...CHANGE_KINDS].join(', ')}` });
    return;
  }
  const req = (k) => (typeof ch[k] === 'string' && ch[k].length > 0);
  switch (ch.kind) {
    case 'card-create':
      if (!req('sectionId')) push(violations, { path: `${base}.sectionId`, changeId: ch.changeId, rule: 'shape', message: 'sectionId required' });
      if (!ch.card || typeof ch.card !== 'object') {
        push(violations, { path: `${base}.card`, changeId: ch.changeId, rule: 'shape', message: 'card object required' });
      } else {
        if (typeof ch.card.id !== 'string' || !SLUG.test(ch.card.id)) {
          push(violations, { path: `${base}.card.id`, changeId: ch.changeId, rule: 'shape', message: 'card.id must be a kebab-case slug' });
        }
        if (typeof ch.card.name !== 'string' || !ch.card.name) {
          push(violations, { path: `${base}.card.name`, changeId: ch.changeId, rule: 'shape', message: 'card.name must be a non-empty string' });
        }
      }
      break;
    case 'card-update':
      if (!req('sectionId')) push(violations, { path: `${base}.sectionId`, changeId: ch.changeId, rule: 'shape', message: 'sectionId required' });
      if (!req('cardId'))    push(violations, { path: `${base}.cardId`,    changeId: ch.changeId, rule: 'shape', message: 'cardId required' });
      if (!ch.fields || typeof ch.fields !== 'object' || Object.keys(ch.fields).length === 0) {
        push(violations, { path: `${base}.fields`, changeId: ch.changeId, rule: 'shape', message: 'fields must be a non-empty object' });
      }
      break;
    case 'ticket-create':
      if (typeof ch.repo !== 'string' || !REPO.test(ch.repo)) {
        push(violations, { path: `${base}.repo`, changeId: ch.changeId, rule: 'shape', message: 'repo must match owner/name' });
      }
      if (!req('title')) push(violations, { path: `${base}.title`, changeId: ch.changeId, rule: 'shape', message: 'title required' });
      break;
    case 'coverage-add':
    case 'coverage-remove':
      if (!req('facetId'))   push(violations, { path: `${base}.facetId`,   changeId: ch.changeId, rule: 'shape', message: 'facetId required' });
      if (!req('sectionId')) push(violations, { path: `${base}.sectionId`, changeId: ch.changeId, rule: 'shape', message: 'sectionId required' });
      if (!req('cardId'))    push(violations, { path: `${base}.cardId`,    changeId: ch.changeId, rule: 'shape', message: 'cardId required' });
      break;
    case 'invariant-suggest':
      if (typeof ch.invariantId !== 'string' || !SLUG.test(ch.invariantId)) {
        push(violations, { path: `${base}.invariantId`, changeId: ch.changeId, rule: 'shape', message: 'invariantId must be a kebab-case slug' });
      }
      if (!req('name'))      push(violations, { path: `${base}.name`,      changeId: ch.changeId, rule: 'shape', message: 'name required' });
      if (!req('statement')) push(violations, { path: `${base}.statement`, changeId: ch.changeId, rule: 'shape', message: 'statement required' });
      if (!Array.isArray(ch.appliesTo) || ch.appliesTo.length === 0) {
        push(violations, { path: `${base}.appliesTo`, changeId: ch.changeId, rule: 'shape', message: 'appliesTo must be a non-empty array' });
      }
      break;
    case 'rationale-update':
      if (!req('sectionId')) push(violations, { path: `${base}.sectionId`, changeId: ch.changeId, rule: 'shape', message: 'sectionId required' });
      if (!req('rationale')) push(violations, { path: `${base}.rationale`, changeId: ch.changeId, rule: 'shape', message: 'rationale required' });
      break;
  }
}

// ── Layer 2: registry contract ─────────────────────────────────────────────

function validateAgainstRegistry(patch, registry, doc, violations, warnings) {
  if (!registry || typeof registry !== 'object') return;
  const sectionsById = doc
    ? Object.fromEntries((doc.sections || []).map((s) => [s.id, s]))
    : null;
  for (let i = 0; i < patch.changes.length; i += 1) {
    const ch = patch.changes[i];
    const base = `$.changes[${i}]`;
    if (ch.kind !== 'card-create' && ch.kind !== 'card-update') continue;

    // Need the target section to know the convergence type.
    if (!sectionsById) continue;
    const section = sectionsById[ch.sectionId];
    if (!section) continue; // layer 3 flags this
    const typeId = section.convergenceType;
    const typeDef = registry.convergenceTypes?.[typeId];
    if (!typeDef) {
      push(warnings, { path: `${base}.sectionId`, changeId: ch.changeId, message: `section "${ch.sectionId}" uses unknown convergence type "${typeId}"` });
      continue;
    }
    validateCardAgainstType(ch, typeDef, registry, base, violations, warnings);
  }
}

function validateCardAgainstType(ch, typeDef, registry, base, violations, warnings) {
  const candidate = ch.kind === 'card-create' ? ch.card : ch.fields;
  if (!candidate || typeof candidate !== 'object') return;

  // Status value must be in the type's status set.
  for (const sf of typeDef.statusFields || []) {
    const v = candidate[sf.key];
    if (v === undefined) continue;
    const allowed = registry.statusSets?.[sf.statusSet]?.values;
    if (allowed && !allowed.includes(v)) {
      push(violations, {
        path: `${base}.${ch.kind === 'card-create' ? 'card' : 'fields'}.${sf.key}`,
        changeId: ch.changeId,
        rule: 'type-contract',
        message: `status "${v}" not in set "${sf.statusSet}" (${typeDef.name}); allowed: ${allowed.join(', ')}`,
      });
    }
  }

  // Ticket source values must be objects with issueNumber+issueUrl.
  for (const src of typeDef.sources || []) {
    if (src.entityType !== 'ticket') continue;
    const v = candidate[src.key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) {
      push(violations, { path: `${base}.${src.key}`, changeId: ch.changeId, rule: 'type-contract', message: `${src.key} must be an array of ticket refs` });
      continue;
    }
    v.forEach((t, j) => {
      if (!t || typeof t !== 'object' || typeof t.issueNumber !== 'string' || typeof t.issueUrl !== 'string') {
        push(violations, { path: `${base}.${src.key}[${j}]`, changeId: ch.changeId, rule: 'type-contract', message: 'ticket ref must be {issueNumber, issueUrl}' });
      }
    });
  }
}

// ── Layer 3: doc consistency ──────────────────────────────────────────────

function validateAgainstDoc(patch, doc, violations, warnings, summary) {
  if (!doc || typeof doc !== 'object') return;
  const sectionsById = Object.fromEntries((doc.sections || []).map((s) => [s.id, s]));
  const facetsById   = Object.fromEntries((doc.objectiveFacets || []).map((f) => [f.id, f]));

  for (let i = 0; i < patch.changes.length; i += 1) {
    const ch = patch.changes[i];
    const base = `$.changes[${i}]`;
    switch (ch.kind) {
      case 'card-update':
      case 'rationale-update': {
        const s = sectionsById[ch.sectionId];
        if (!s) {
          push(violations, { path: `${base}.sectionId`, changeId: ch.changeId, rule: 'doc-consistency', message: `section "${ch.sectionId}" does not exist in doc` });
          break;
        }
        if (ch.kind === 'card-update') {
          const data = s.data || s.cards || [];
          const card = data.find((c) => c && c.id === ch.cardId);
          if (!card) {
            push(violations, { path: `${base}.cardId`, changeId: ch.changeId, rule: 'doc-consistency', message: `card "${ch.cardId}" does not exist in section "${ch.sectionId}"` });
          }
        }
        break;
      }
      case 'card-create': {
        const s = sectionsById[ch.sectionId];
        if (!s) {
          push(violations, { path: `${base}.sectionId`, changeId: ch.changeId, rule: 'doc-consistency', message: `section "${ch.sectionId}" does not exist in doc` });
          break;
        }
        const data = s.data || s.cards || [];
        if (data.some((c) => c && c.id === ch.card?.id)) {
          push(violations, { path: `${base}.card.id`, changeId: ch.changeId, rule: 'doc-consistency', message: `card id "${ch.card.id}" already exists in section "${ch.sectionId}"` });
        }
        break;
      }
      case 'coverage-add':
      case 'coverage-remove': {
        const facet = facetsById[ch.facetId];
        const section = sectionsById[ch.sectionId];
        if (!facet) {
          push(violations, { path: `${base}.facetId`, changeId: ch.changeId, rule: 'doc-consistency', message: `facet "${ch.facetId}" does not exist in doc` });
        }
        if (!section) {
          push(violations, { path: `${base}.sectionId`, changeId: ch.changeId, rule: 'doc-consistency', message: `section "${ch.sectionId}" does not exist in doc` });
        }
        if (section) {
          const data = section.data || section.cards || [];
          if (!data.some((c) => c && c.id === ch.cardId)) {
            push(warnings, { path: `${base}.cardId`, changeId: ch.changeId, message: `card "${ch.cardId}" not present at validation time — may be created by another change in this patch` });
          }
        }
        break;
      }
      case 'ticket-create': {
        if (ch.linkTo) {
          if (!sectionsById[ch.linkTo.sectionId]) {
            push(violations, { path: `${base}.linkTo.sectionId`, changeId: ch.changeId, rule: 'doc-consistency', message: `linkTo.sectionId "${ch.linkTo.sectionId}" does not exist` });
          }
        }
        break;
      }
    }
  }

  // Orphan detection: simulate the patch on a shallow copy of facets+coverage
  // and count how many facets would have zero carriers afterwards.
  summary.orphansCreated = computeOrphansCreated(patch, doc);
  summary.typeBoundariesOk = violations.filter((v) => v.rule === 'type-contract').length === 0;
  summary.referencedSectionsOk = violations.filter((v) => v.rule === 'doc-consistency').length === 0;
}

function computeOrphansCreated(patch, doc) {
  const facets = (doc.objectiveFacets || []).map((f) => f.id);

  // Simulate the coverage set after applying the patch, then compare facet-coverage.
  let sim = [...(doc.coverage || [])];
  for (const ch of patch.changes) {
    if (ch.kind === 'coverage-add') {
      sim.push({ facetId: ch.facetId, sectionId: ch.sectionId, cardId: ch.cardId });
    } else if (ch.kind === 'coverage-remove') {
      sim = sim.filter((e) => !(e.facetId === ch.facetId && e.sectionId === ch.sectionId && e.cardId === ch.cardId));
    }
  }

  const initialCovered = new Set((doc.coverage || []).map((e) => e.facetId));
  const afterCovered   = new Set(sim.map((e) => e.facetId));
  const initialOrphans = facets.filter((f) => !initialCovered.has(f));
  const afterOrphans   = facets.filter((f) => !afterCovered.has(f));
  return Math.max(0, afterOrphans.length - initialOrphans.length);
}

// ── Public ─────────────────────────────────────────────────────────────────

export function validatePatch(patch, { registry = null, doc = null } = {}) {
  const violations = [];
  const warnings = [];
  const summary = {
    typeBoundariesOk: true,
    referencedSectionsOk: true,
    orphansCreated: 0,
  };

  validateShape(patch, violations);
  if (violations.length === 0 || violations.every((v) => v.rule !== 'shape' || v.path.startsWith('$.changes'))) {
    // We can still attempt registry/doc checks even if some shape errors exist,
    // as long as the top-level structure is intact.
    if (patch && Array.isArray(patch.changes)) {
      validateAgainstRegistry(patch, registry, doc, violations, warnings);
      validateAgainstDoc(patch, doc, violations, warnings, summary);
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    warnings,
    summary,
  };
}

// CLI passthrough — `node scripts/validate-ai-patch.mjs patch.json [doc.json]`
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const [patchPath, docPath] = process.argv.slice(2);
  if (!patchPath) {
    console.error('usage: validate-ai-patch.mjs <patch.json> [doc.json]');
    process.exit(2);
  }
  const patch = JSON.parse(await readFile(patchPath, 'utf8'));
  const registry = JSON.parse(await readFile(path.join(__dirname, 'living-doc-registry.json'), 'utf8'));
  const doc = docPath ? JSON.parse(await readFile(docPath, 'utf8')) : null;
  const result = validatePatch(patch, { registry, doc });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
