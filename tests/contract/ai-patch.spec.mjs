import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validatePatch, loadSchema } from '../../scripts/validate-ai-patch.mjs';

const registry = JSON.parse(await readFile('scripts/living-doc-registry.json', 'utf8'));
const doc = JSON.parse(await readFile('docs/ai-pass-flow-body-workstream.json', 'utf8'));

// ── Schema file sanity ────────────────────────────────────────────────────

const schema = await loadSchema();
assert.equal(schema.$id, 'https://triadflow.github.io/living-doc-compositor/schemas/ai-patch.schema.json');
assert.equal(schema.title, 'living-doc-ai-patch/v1');
for (const kind of ['card-create','card-update','ticket-create','coverage-add','coverage-remove','invariant-suggest','rationale-update']) {
  assert.ok(schema.definitions[kind], `schema missing definition for ${kind}`);
}

// ── Happy path: a realistic patch validates clean ─────────────────────────

const validPatch = {
  schema: 'living-doc-ai-patch/v1',
  requestId: 'req-001',
  summary: 'Enrich the validator card with shipping notes',
  proposedBy: { engine: 'claude-code', action: 'enrich-notes', cardRef: { sectionId: 'components', cardId: 'validator' } },
  changes: [
    {
      changeId: 'c1',
      kind: 'card-update',
      sectionId: 'components',
      cardId: 'validator',
      fields: {
        status: 'current',
        revision: 'abc1234',
      },
    },
    {
      changeId: 'c2',
      kind: 'ticket-create',
      repo: 'triadflow/living-doc-compositor',
      title: 'Follow-up: add JSON schema publishing step',
      body: 'Ship the schema to /schemas/ai-patch.schema.json on Pages so tools can resolve $id.',
    },
    {
      changeId: 'c3',
      kind: 'coverage-add',
      facetId: 'semantic-stability',
      sectionId: 'components',
      cardId: 'validator',
    },
    {
      changeId: 'c4',
      kind: 'invariant-suggest',
      invariantId: 'patch-request-id-unique',
      name: 'Request IDs must be unique within the server session',
      statement: 'Two incoming patches with the same requestId are a server bug; drop the second.',
      appliesTo: ['components'],
      note: 'Proposed by AI; user has not yet accepted it as an invariant.',
    },
    {
      changeId: 'c5',
      kind: 'rationale-update',
      sectionId: 'attempts',
      rationale: 'Track skill-prompt iterations; we add cards as we try and observe per-engine behaviour.',
    },
  ],
};

const good = validatePatch(validPatch, { registry, doc });
assert.equal(good.ok, true, `valid patch should pass; violations: ${JSON.stringify(good.violations, null, 2)}`);
assert.equal(good.summary.typeBoundariesOk, true);
assert.equal(good.summary.referencedSectionsOk, true);

// ── Layer 1 rejections: shape errors ──────────────────────────────────────

const badSchema = { ...validPatch, schema: 'wrong' };
const r1 = validatePatch(badSchema, { registry, doc });
assert.equal(r1.ok, false);
assert.ok(r1.violations.some((v) => v.rule === 'shape' && v.path === '$.schema'));

const missingChanges = { ...validPatch, changes: undefined };
const r2 = validatePatch(missingChanges, { registry, doc });
assert.equal(r2.ok, false);

// card-create missing required fields
const badCardCreate = {
  ...validPatch,
  changes: [{ changeId: 'x', kind: 'card-create', sectionId: 'components', card: { name: 'no id' } }],
};
const r3 = validatePatch(badCardCreate, { registry, doc });
assert.equal(r3.ok, false);
assert.ok(r3.violations.some((v) => v.path.endsWith('.card.id')));

// ticket-create with bad repo
const badRepo = {
  ...validPatch,
  changes: [{ changeId: 'x', kind: 'ticket-create', repo: 'not-a-repo', title: 't' }],
};
const r4 = validatePatch(badRepo, { registry, doc });
assert.equal(r4.ok, false);
assert.ok(r4.violations.some((v) => v.path.endsWith('.repo')));

// ── Layer 2: type-contract ────────────────────────────────────────────────

// status value not in the target type's status set
const badStatus = {
  ...validPatch,
  changes: [{
    changeId: 'x',
    kind: 'card-update',
    sectionId: 'components',           // uses code-anchor → code-anchor-status
    cardId: 'validator',
    fields: { status: 'ready' },       // 'ready' is not in code-anchor-status
  }],
};
const r5 = validatePatch(badStatus, { registry, doc });
assert.equal(r5.ok, false);
assert.ok(r5.violations.some((v) => v.rule === 'type-contract'));

// malformed ticketIds entry
const badTickets = {
  ...validPatch,
  changes: [{
    changeId: 'x',
    kind: 'card-update',
    sectionId: 'components',
    cardId: 'validator',
    fields: { ticketIds: [{ issueNumber: '#99' /* missing issueUrl */ }] },
  }],
};
const r6 = validatePatch(badTickets, { registry, doc });
assert.equal(r6.ok, false);
assert.ok(r6.violations.some((v) => v.rule === 'type-contract' && v.path.includes('ticketIds')));

// ── Layer 3: doc-consistency ──────────────────────────────────────────────

const missingSection = {
  ...validPatch,
  changes: [{ changeId: 'x', kind: 'card-update', sectionId: 'does-not-exist', cardId: 'whatever', fields: { status: 'current' } }],
};
const r7 = validatePatch(missingSection, { registry, doc });
assert.equal(r7.ok, false);
assert.ok(r7.violations.some((v) => v.rule === 'doc-consistency' && v.path.endsWith('.sectionId')));

const missingCard = {
  ...validPatch,
  changes: [{ changeId: 'x', kind: 'card-update', sectionId: 'components', cardId: 'no-such-card', fields: { status: 'current' } }],
};
const r8 = validatePatch(missingCard, { registry, doc });
assert.equal(r8.ok, false);
assert.ok(r8.violations.some((v) => v.rule === 'doc-consistency' && v.path.endsWith('.cardId')));

// Duplicate card id on create
const duplicateCard = {
  ...validPatch,
  changes: [{ changeId: 'x', kind: 'card-create', sectionId: 'components', card: { id: 'validator', name: 'conflict' } }],
};
const r9 = validatePatch(duplicateCard, { registry, doc });
assert.equal(r9.ok, false);
assert.ok(r9.violations.some((v) => v.rule === 'doc-consistency' && v.path.endsWith('.card.id')));

// ── Orphan detection ──────────────────────────────────────────────────────

// Remove the only carrier of a facet, without adding a replacement.
const orphanMaker = {
  ...validPatch,
  changes: [
    { changeId: 'r1', kind: 'coverage-remove', facetId: 'local-only', sectionId: 'decisions',  cardId: 'transport-local-server' },
    { changeId: 'r2', kind: 'coverage-remove', facetId: 'local-only', sectionId: 'components', cardId: 'server-endpoints' },
  ],
};
const r10 = validatePatch(orphanMaker, { registry, doc });
// Orphan creation is a summary signal, not a violation by itself; the UI warns.
assert.ok(r10.summary.orphansCreated >= 1, `expected orphansCreated >= 1, got ${r10.summary.orphansCreated}`);

console.log('ai-patch contract spec: all assertions passed');
