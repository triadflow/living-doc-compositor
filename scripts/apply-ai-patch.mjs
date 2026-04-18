// Apply a validated living-doc-ai-patch/v1 to a doc.
//
// Pure function. Returns:
//   {
//     doc,         // deep-copied, mutated doc
//     log,         // array of { changeId, kind, message } describing what was applied
//     sideEffects, // array of commands the caller must execute (gh issue create, etc.)
//   }
//
// The caller is responsible for:
//   - running side effects (e.g. gh issue create) in order
//   - applying `linkTo` ticketIds back to cards after issues are created
//   - recomputing metaFingerprint and rerendering HTML after all mutations
//
// Split this way so the mutation logic stays unit-testable.

export function applyAiPatch(doc, patch, { acceptedChangeIds = null } = {}) {
  const next = structuredClone(doc);
  const log = [];
  const sideEffects = [];

  const accepted = acceptedChangeIds
    ? new Set(acceptedChangeIds)
    : new Set(patch.changes.map((c) => c.changeId));

  const changes = patch.changes.filter((c) => accepted.has(c.changeId));

  // ── Pass 1: surface ticket-create side effects ──────────────────────────
  // Tickets must be created BEFORE any card-update that references their
  // issueNumber, so the server creates them first and then applies the
  // linkTo edits.
  for (const ch of changes) {
    if (ch.kind === 'ticket-create') {
      sideEffects.push({
        kind: 'gh-issue-create',
        changeId: ch.changeId,
        repo: ch.repo,
        title: ch.title,
        body: ch.body || '',
        labels: ch.labels || [],
        linkTo: ch.linkTo || null,
      });
      log.push({ changeId: ch.changeId, kind: ch.kind, message: `queued gh issue create on ${ch.repo}: ${ch.title}` });
    }
  }

  // ── Pass 2: doc mutations ───────────────────────────────────────────────
  for (const ch of changes) {
    switch (ch.kind) {
      case 'card-create':     applyCardCreate(next, ch, log); break;
      case 'card-update':     applyCardUpdate(next, ch, log); break;
      case 'coverage-add':    applyCoverageAdd(next, ch, log); break;
      case 'coverage-remove': applyCoverageRemove(next, ch, log); break;
      case 'rationale-update': applyRationaleUpdate(next, ch, log); break;
      case 'invariant-suggest': applyInvariantSuggest(next, ch, log); break;
      case 'ticket-create':   break; // handled in pass 1
      default:
        log.push({ changeId: ch.changeId, kind: ch.kind, message: `unknown kind — skipped` });
    }
  }

  // ── Pass 3: timestamp bumps on touched sections and doc root ────────────
  const now = new Date().toISOString();
  const touchedSections = new Set();
  for (const ch of changes) {
    if (ch.sectionId) touchedSections.add(ch.sectionId);
  }
  for (const s of next.sections || []) {
    if (touchedSections.has(s.id)) s.updated = now;
  }
  next.updated = now;

  return { doc: next, log, sideEffects };
}

// ── kind-specific handlers ─────────────────────────────────────────────────

function findSection(doc, sectionId) {
  return (doc.sections || []).find((s) => s && s.id === sectionId);
}

function getCards(section) {
  // Section data lives under `data` (canonical) or `cards` (legacy).
  if (Array.isArray(section.data))  return section.data;
  if (Array.isArray(section.cards)) return section.cards;
  section.data = [];
  return section.data;
}

function applyCardCreate(doc, ch, log) {
  const section = findSection(doc, ch.sectionId);
  if (!section) {
    log.push({ changeId: ch.changeId, kind: ch.kind, message: `section "${ch.sectionId}" missing — skipped` });
    return;
  }
  const cards = getCards(section);
  if (cards.some((c) => c && c.id === ch.card?.id)) {
    log.push({ changeId: ch.changeId, kind: ch.kind, message: `card id "${ch.card.id}" already exists in "${ch.sectionId}" — skipped` });
    return;
  }
  let insertIdx = cards.length;
  if (ch.insertAfterCardId) {
    const i = cards.findIndex((c) => c && c.id === ch.insertAfterCardId);
    if (i >= 0) insertIdx = i + 1;
  }
  cards.splice(insertIdx, 0, { ...ch.card });
  log.push({ changeId: ch.changeId, kind: ch.kind, message: `created card "${ch.card.id}" in "${ch.sectionId}"` });
}

function applyCardUpdate(doc, ch, log) {
  const section = findSection(doc, ch.sectionId);
  if (!section) {
    log.push({ changeId: ch.changeId, kind: ch.kind, message: `section "${ch.sectionId}" missing — skipped` });
    return;
  }
  const cards = getCards(section);
  const card = cards.find((c) => c && c.id === ch.cardId);
  if (!card) {
    log.push({ changeId: ch.changeId, kind: ch.kind, message: `card "${ch.cardId}" missing — skipped` });
    return;
  }
  for (const [k, v] of Object.entries(ch.fields || {})) {
    card[k] = v;
  }
  log.push({ changeId: ch.changeId, kind: ch.kind, message: `updated card "${ch.cardId}" (${Object.keys(ch.fields || {}).join(', ')})` });
}

function applyCoverageAdd(doc, ch, log) {
  if (!Array.isArray(doc.coverage)) doc.coverage = [];
  const exists = doc.coverage.some((e) => e.facetId === ch.facetId && e.sectionId === ch.sectionId && e.cardId === ch.cardId);
  if (exists) {
    log.push({ changeId: ch.changeId, kind: ch.kind, message: `coverage edge already present — skipped` });
    return;
  }
  doc.coverage.push({ facetId: ch.facetId, sectionId: ch.sectionId, cardId: ch.cardId });
  log.push({ changeId: ch.changeId, kind: ch.kind, message: `added coverage ${ch.facetId} → ${ch.sectionId}/${ch.cardId}` });
}

function applyCoverageRemove(doc, ch, log) {
  if (!Array.isArray(doc.coverage)) return;
  const before = doc.coverage.length;
  doc.coverage = doc.coverage.filter((e) => !(e.facetId === ch.facetId && e.sectionId === ch.sectionId && e.cardId === ch.cardId));
  if (doc.coverage.length === before) {
    log.push({ changeId: ch.changeId, kind: ch.kind, message: `coverage edge not found — skipped` });
  } else {
    log.push({ changeId: ch.changeId, kind: ch.kind, message: `removed coverage ${ch.facetId} → ${ch.sectionId}/${ch.cardId}` });
  }
}

function applyRationaleUpdate(doc, ch, log) {
  const section = findSection(doc, ch.sectionId);
  if (!section) {
    log.push({ changeId: ch.changeId, kind: ch.kind, message: `section "${ch.sectionId}" missing — skipped` });
    return;
  }
  section.rationale = ch.rationale;
  log.push({ changeId: ch.changeId, kind: ch.kind, message: `updated rationale on "${ch.sectionId}"` });
}

function applyInvariantSuggest(doc, ch, log) {
  // Invariant suggestions persist as real invariants with a `suggestedBy: "ai"`
  // marker so the reader can see the provenance and choose to refine or drop.
  if (!Array.isArray(doc.invariants)) doc.invariants = [];
  if (doc.invariants.some((inv) => inv && inv.id === ch.invariantId)) {
    log.push({ changeId: ch.changeId, kind: ch.kind, message: `invariant id "${ch.invariantId}" already exists — skipped` });
    return;
  }
  doc.invariants.push({
    id: ch.invariantId,
    name: ch.name,
    statement: ch.statement,
    appliesTo: ch.appliesTo,
    suggestedBy: 'ai',
  });
  log.push({ changeId: ch.changeId, kind: ch.kind, message: `added invariant suggestion "${ch.invariantId}"` });
}

// ── Helpers for the server to apply gh-issue-create results ────────────────

// After a ticket-create side effect succeeds, the server calls this to wire
// the new issueNumber back into the linked card's ticketIds (if linkTo was set).
export function wireTicketLink(doc, { linkTo, issueNumber, issueUrl }, log = []) {
  if (!linkTo) return doc;
  const section = findSection(doc, linkTo.sectionId);
  if (!section) return doc;
  const cards = getCards(section);
  const card = cards.find((c) => c && c.id === linkTo.cardId);
  if (!card) return doc;
  if (!Array.isArray(card.ticketIds)) card.ticketIds = [];
  if (!card.ticketIds.some((t) => t && t.issueUrl === issueUrl)) {
    card.ticketIds.push({ issueNumber, issueUrl });
    log.push({ kind: 'wire-ticket', message: `linked ${issueNumber} to ${linkTo.sectionId}/${linkTo.cardId}` });
  }
  return doc;
}
