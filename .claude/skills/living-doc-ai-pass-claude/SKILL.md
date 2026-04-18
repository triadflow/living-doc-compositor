# /living-doc-ai-pass-claude

Receive a card-level AI-pass request, read the doc and registry, reason about the target card in context, and emit a validated `living-doc-ai-patch/v1` JSON on stdout. The local doc server invokes this skill when a user selects **Claude Code** as the engine in the Cmd+K palette.

## Contract

### Input (JSON on stdin)

```json
{
  "requestId": "req-...",
  "docPath": "/abs/path/to/doc.json",
  "cardRef": { "sectionId": "components", "cardId": "validator" },
  "action": "enrich-notes",
  "extra": {
    "registryFingerprint": "sha256:...",
    "docFingerprint": "sha256:..."
  }
}
```

### Output (JSON on stdout, nothing else)

A single `living-doc-ai-patch/v1` object matching `scripts/ai-patch-schema.json`. It will be piped through `scripts/validate-ai-patch.mjs`. Prose around the JSON breaks the pipeline — emit the object and nothing else.

## Execution

### 1. Gather context

Read, in order:

1. `input.registry` — the server passes the full registry inline so you never need to shell out to disk for it. If absent (older server), fall back to reading `scripts/living-doc-registry.json` relative to cwd.
2. `input.docPath` — absolute path to the living doc JSON. Read it.
3. **You are running in `input.docRepoRoot`** (the repo that owns the doc). `gh` commands default to the right remote; relative code paths on cards resolve against this cwd. Do not cd elsewhere.
4. `scripts/ai-patch-schema.json` (relative to the living-doc-compositor repo, if you need to double-check the contract).

From the doc:

- Locate the target section by `cardRef.sectionId`. Its `convergenceType` is the type contract you must respect.
- Find the target card in `section.data` (or `section.cards`). If absent, the request is malformed — emit a patch with an empty `changes` array and a `meta.warnings` note.
- Identify sibling cards in the same section (for style/shape matching).
- Read `objectiveFacets`, `invariants`, `coverage`.
- Note the invariants whose `appliesTo` includes the section id or `"*"` — those constrain any change on this card.

### 2. Pick the right handler for the action

Look up `action` in the registry:

- `registry.generalAiActions` — always available.
- `registry.convergenceTypes[type].aiActions` — available only when operating on a card of that type.

If `action` is neither general nor listed on the target type, return an empty patch with `meta.warnings: ["unsupported action '${action}' for type '${type}'"]`.

Each handler below describes how to construct the patch. All handlers share the frame:

```json
{
  "schema": "living-doc-ai-patch/v1",
  "requestId": "<echo from input>",
  "summary": "<one-line human description>",
  "proposedBy": {
    "engine": "claude-code",
    "action": "<echo>",
    "cardRef": { "sectionId": "...", "cardId": "..." }
  },
  "changes": [ ... ],
  "meta": { "typeBoundariesOk": true, "orphansCreated": 0 }
}
```

### 3. General action handlers

#### `decompose`

Applicable when the card is an umbrella / planned / thin. Produce sub-cards under the same section plus `ticket-create` changes per sub-card.

- For each proposed sub-unit:
  - `ticket-create` in the target repo (infer from `doc.canonicalOrigin` or `docPath`'s surrounding git remote; when uncertain, inherit from an existing `ticketIds[].issueUrl` on the target card).
  - `card-create` with a new id, name, status appropriate for the convergence type, and any type-specific fields. Link the new ticket via `linkTo` on the `ticket-create` so `ticketIds` are wired after apply.
- `card-update` on the original card: append the new ticket refs (if still an umbrella) or propose a state change reflecting that the work is now decomposed.
- `coverage-add` for any facet carried by the new sub-cards.
- Never omit `changeId` values; every change needs a stable id within this patch (e.g. `c1`, `c2`, …).

#### `enrich-notes`

Thin card → richer notes matching neighbour style.

- Emit a single `card-update` with `fields: { notes: [...], updated: <iso now> }`.
- Mimic the shape of neighbour cards' notes — if they use `{ role: "callout", tone: "info", text: "..." }` items, you do too. Preserve existing notes by copying them into the new array and appending, unless the user's implicit intent is to rewrite (signaled by `extra.rewrite: true`).

#### `verify-invariants`

Read the invariants that apply to the target section (or `"*"`). For each, check whether the card satisfies the rule. If one is violated, emit an `invariant-suggest` describing the tension; do not auto-apply a fix. If all hold, emit an empty `changes` array with `summary: "verified against N invariants, no violations"` and `meta.warnings: []`.

#### `propose-coverage`

Infer which `objectiveFacets` the target card is actually carrying based on its content, neighbouring cards, and the facet descriptions. For each real match:

- `coverage-add { facetId, sectionId: cardRef.sectionId, cardId: cardRef.cardId }` unless the edge already exists.

Facets with no clear carrier on the card should NOT be fabricated. If they were expected (e.g. the user is in a "fill orphan" flow), surface as `meta.warnings: ["no carrier found for facet X"]`.

#### `summarise`

Read-only. Produce no `changes`. Put the summary in the top-level `summary` field.

### 4. Type-specific action handlers

Look up `registry.convergenceTypes[type].aiActions` for the target type and route by `action.id`. These handlers are opt-in and the registry describes their intent. Typical patterns:

- Status transitions → `card-update { fields: { status: "..." } }` with a short `rationale`.
- Revision checks (code-anchor) → `card-update { fields: { status: "changed-since-issue" | "current", revision: "..." } }`.
- Evolution / retraction of stances → `card-update` on existing fields rather than a new card.
- Refresh external state (GitHub) → `card-update { fields: { github_state: "...", status: "..." } }`.

If an action is declared in the registry but not implemented here, emit an empty patch with `meta.warnings: ["not yet implemented: ${action}"]` instead of guessing.

### 5. Respect type contracts

Before emitting a `card-create` or `card-update`:

- The card's `status` field must use a value from the convergence type's status set (look up via `registry.statusSets[typeDef.statusFields[0].statusSet].values`).
- Any `ticketIds` field must be `[{ issueNumber, issueUrl }, ...]`.
- Required fields per the convergence type's structural contract must be present on a `card-create`.

The validator will reject violations. Do not emit a patch you wouldn't accept as a reviewer.

### 6. Self-check before emitting

After building the patch object, mentally walk the validator's three layers:

- **Shape**: all required top-level fields present; every change has `changeId`, `kind`, and its kind-specific required fields.
- **Registry contract**: status values and ticket-ref shapes match the type.
- **Doc consistency**: every `sectionId` and `cardId` you reference exists in the loaded doc; every `facetId` exists.

If any layer fails, fix or drop the offending change before emitting.

### 7. Emit

Write the patch as a single JSON object to stdout. No prose. No code fences. Nothing after.

## Principles

1. **Type contracts are hard constraints.** The validator is downstream; its job is to catch mistakes, not to be your crutch. Emit patches you would apply yourself.
2. **Never invent facets or coverage.** If the card doesn't genuinely carry a facet, say so via `meta.warnings`.
3. **Preserve author intent.** Existing notes and rationale survive unless the action is explicitly rewrite-scoped.
4. **Change ids are stable within the patch.** Use `c1`, `c2`, `c3`, … in emission order.
5. **Summaries describe the patch, not your process.** Human-readable, one line, no hedging.
6. **Silent mutations are forbidden.** Every proposed change must have a `rationale` field with one sentence saying why.
7. **Unknown = empty patch + warning.** When in doubt about a type-specific action or an ambiguous request, emit an empty-changes patch with a clear warning instead of guessing.

## Examples

### Example 1: enrich-notes on a thin code-anchor card

Input:
```json
{"requestId":"req-123","docPath":"/.../ai-pass-flow-body-workstream.json","cardRef":{"sectionId":"components","cardId":"validator"},"action":"enrich-notes"}
```

Output:
```json
{
  "schema": "living-doc-ai-patch/v1",
  "requestId": "req-123",
  "summary": "Enrich validator card with notes on three-layer approach and the no-Ajv choice",
  "proposedBy": { "engine": "claude-code", "action": "enrich-notes", "cardRef": { "sectionId": "components", "cardId": "validator" } },
  "changes": [
    {
      "changeId": "c1",
      "kind": "card-update",
      "sectionId": "components",
      "cardId": "validator",
      "rationale": "Thin notes; match the ship-feature style of other code-anchor cards which carry a 'why it matters' with one-sentence detail.",
      "fields": {
        "why_it_matters": [
          { "type": "info", "text": "Enforces type contracts by layer — shape, registry, doc. No Ajv dependency; lightweight enough to run in the server hot path." }
        ]
      }
    }
  ],
  "meta": { "typeBoundariesOk": true, "orphansCreated": 0 }
}
```

### Example 2: verify-invariants returns empty on a clean card

Output:
```json
{
  "schema": "living-doc-ai-patch/v1",
  "requestId": "req-124",
  "summary": "Verified 2 applicable invariants — no violations",
  "proposedBy": { "engine": "claude-code", "action": "verify-invariants", "cardRef": { "sectionId": "components", "cardId": "validator" } },
  "changes": [],
  "meta": { "typeBoundariesOk": true, "orphansCreated": 0, "warnings": [] }
}
```

### Example 3: decompose on an umbrella card

For a thin umbrella card with one existing ticket (say `#147` proof level 4), the patch looks like:

- 5 × `ticket-create` (new sub-tickets in the same repo as the existing one)
- 5 × `card-create` under the same section, each `linkTo`-wired to its new ticket
- 1 × `card-update` on the umbrella (replace the thin note with a richer prose + callout + reference, and append the new ticket refs to `ticketIds`)
- N × `coverage-add` for each new sub-card that carries an existing facet

Each change gets a distinct `changeId`, a `rationale`, and respects the convergence type's status set.

## Notes

- **Do not hallucinate repo names.** If the target repo isn't derivable from the card, the doc root, or an existing ticket ref, emit an empty patch with a warning rather than guessing.
- **Do not invoke gh yourself.** The server applies `ticket-create` changes after user consent.
- **Long outputs are fine.** The patch can be hundreds of lines for a large decomposition. Keep it valid JSON throughout.
