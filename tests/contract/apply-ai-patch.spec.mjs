import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyAiPatch, wireTicketLink } from '../../scripts/apply-ai-patch.mjs';

const doc = JSON.parse(await readFile('docs/ai-pass-flow-body-workstream.json', 'utf8'));

// ── card-update merges fields; doc stays intact ───────────────────────────

{
  const patch = {
    schema: 'living-doc-ai-patch/v1',
    requestId: 'req-a',
    summary: 'update validator card',
    changes: [
      { changeId: 'c1', kind: 'card-update', sectionId: 'components', cardId: 'validator',
        fields: { status: 'current', revision: 'deadbeef' } },
    ],
  };
  const { doc: after, log } = applyAiPatch(doc, patch);
  const card = after.sections.find((s) => s.id === 'components').data.find((c) => c.id === 'validator');
  assert.equal(card.status, 'current');
  assert.equal(card.revision, 'deadbeef');
  // preserved fields
  assert.ok(card.what_it_does);
  assert.equal(log.length, 1);
  // original doc untouched — revision should not match the patched value
  const origCard = doc.sections.find((s) => s.id === 'components').data.find((c) => c.id === 'validator');
  assert.notEqual(origCard.revision, 'deadbeef', 'original doc should not be mutated');
}

// ── card-create appends (and respects insertAfterCardId) ──────────────────

{
  const patch = {
    schema: 'living-doc-ai-patch/v1',
    requestId: 'req-b',
    summary: 'add card',
    changes: [
      { changeId: 'c1', kind: 'card-create', sectionId: 'attempts', insertAfterCardId: 'patch-schema-v1-shipped',
        card: { id: 'new-probe', name: 'New probe', status: 'probe' } },
    ],
  };
  const { doc: after } = applyAiPatch(doc, patch);
  const attempts = after.sections.find((s) => s.id === 'attempts').data;
  const ix = attempts.findIndex((c) => c.id === 'new-probe');
  assert.ok(ix > 0, 'new card should exist');
  const prevIdx = attempts.findIndex((c) => c.id === 'patch-schema-v1-shipped');
  assert.equal(ix, prevIdx + 1, 'new card should be inserted after the reference');
}

// ── coverage add/remove ───────────────────────────────────────────────────

{
  const patch = {
    schema: 'living-doc-ai-patch/v1',
    requestId: 'req-c',
    summary: 'move coverage',
    changes: [
      { changeId: 'c1', kind: 'coverage-add',    facetId: 'registry-guardrail', sectionId: 'actions',    cardId: 'general-verify' },
      { changeId: 'c2', kind: 'coverage-remove', facetId: 'registry-guardrail', sectionId: 'components', cardId: 'registry-actions' },
    ],
  };
  const { doc: after } = applyAiPatch(doc, patch);
  const has = (f, s, c) => after.coverage.some((e) => e.facetId === f && e.sectionId === s && e.cardId === c);
  assert.ok(has('registry-guardrail', 'actions', 'general-verify'), 'added coverage should be present');
  assert.ok(!has('registry-guardrail', 'components', 'registry-actions'), 'removed coverage should be gone');
}

// ── rationale-update writes to section ────────────────────────────────────

{
  const patch = {
    schema: 'living-doc-ai-patch/v1',
    requestId: 'req-d',
    summary: 'rewrite rationale',
    changes: [{ changeId: 'c1', kind: 'rationale-update', sectionId: 'attempts', rationale: 'NEW rationale text' }],
  };
  const { doc: after } = applyAiPatch(doc, patch);
  const s = after.sections.find((x) => x.id === 'attempts');
  assert.equal(s.rationale, 'NEW rationale text');
}

// ── invariant-suggest persists with suggestedBy marker ────────────────────

{
  const patch = {
    schema: 'living-doc-ai-patch/v1',
    requestId: 'req-e',
    summary: 'new invariant suggestion',
    changes: [{ changeId: 'c1', kind: 'invariant-suggest',
      invariantId: 'test-invariant', name: 'Test',
      statement: 'The validator runs on every patch.', appliesTo: ['components'] }],
  };
  const { doc: after } = applyAiPatch(doc, patch);
  const inv = after.invariants.find((i) => i.id === 'test-invariant');
  assert.ok(inv, 'invariant should be added');
  assert.equal(inv.suggestedBy, 'ai');
}

// ── ticket-create queues a side effect (no doc mutation directly) ─────────

{
  const patch = {
    schema: 'living-doc-ai-patch/v1',
    requestId: 'req-f',
    summary: 'create ticket',
    changes: [{ changeId: 'c1', kind: 'ticket-create',
      repo: 'triadflow/living-doc-compositor', title: 'Test ticket', body: '',
      linkTo: { sectionId: 'components', cardId: 'validator' } }],
  };
  const { sideEffects } = applyAiPatch(doc, patch);
  assert.equal(sideEffects.length, 1);
  assert.equal(sideEffects[0].kind, 'gh-issue-create');
  assert.equal(sideEffects[0].repo, 'triadflow/living-doc-compositor');
  assert.ok(sideEffects[0].linkTo);
}

// ── acceptedChangeIds filters ─────────────────────────────────────────────

{
  const patch = {
    schema: 'living-doc-ai-patch/v1',
    requestId: 'req-g',
    summary: 'two changes',
    changes: [
      { changeId: 'keep', kind: 'card-update', sectionId: 'components', cardId: 'validator', fields: { revision: 'keep' } },
      { changeId: 'drop', kind: 'card-update', sectionId: 'components', cardId: 'validator', fields: { revision: 'drop' } },
    ],
  };
  const { doc: after, log } = applyAiPatch(doc, patch, { acceptedChangeIds: ['keep'] });
  const card = after.sections.find((s) => s.id === 'components').data.find((c) => c.id === 'validator');
  assert.equal(card.revision, 'keep');
  assert.equal(log.length, 1);
}

// ── wireTicketLink appends to ticketIds ───────────────────────────────────

{
  const fresh = JSON.parse(JSON.stringify(doc));
  wireTicketLink(fresh, {
    linkTo: { sectionId: 'components', cardId: 'validator' },
    issueNumber: '#999',
    issueUrl: 'https://github.com/triadflow/living-doc-compositor/issues/999',
  });
  const card = fresh.sections.find((s) => s.id === 'components').data.find((c) => c.id === 'validator');
  assert.ok(card.ticketIds.some((t) => t.issueNumber === '#999'));
}

console.log('apply-ai-patch contract spec: all assertions passed');
