# /living-doc-ai-pass-codex

Codex counterpart of `living-doc-ai-pass-claude`. Same input and output contract; same validator downstream; tuned for Codex's strengths — terser prose, code-anchor-centric checks, and revision comparison. Invoked by the local doc server when the user picks **Codex** as the engine in the Cmd+K palette.

## Contract

### Input (JSON on stdin)

```json
{
  "requestId": "req-...",
  "docPath": "/abs/path/to/doc.json",
  "cardRef": { "sectionId": "components", "cardId": "validator" },
  "action": "check-revision-drift",
  "extra": {
    "registryFingerprint": "sha256:...",
    "docFingerprint": "sha256:..."
  }
}
```

### Output (JSON on stdout, nothing else)

A single `living-doc-ai-patch/v1` object matching `scripts/ai-patch-schema.json`. Piped through `scripts/validate-ai-patch.mjs`. No prose, no code fences, no commentary.

## Why a separate skill from the Claude one

Codex leans terser and code-anchor-oriented. When the action touches source code (revision drift, status-from-commits, find-shipping-commit), Codex usually lands tighter. When the action is pure prose (enrich-notes, summarise), Claude usually lands richer. Keeping the two skills separate lets us tune prompts per provider without a lowest-common-denominator compromise — but the patch contract is identical, so the server can swap engines transparently.

## Execution

### 1. Gather context

Read, in order:

1. `input.registry` — the server passes the full registry inline. Use it. Fall back to `scripts/living-doc-registry.json` only if absent.
2. `input.docPath` — absolute path to the doc JSON. Read it.
3. **You run in `input.docRepoRoot`** — the repo owning the doc. `gh`, `git`, and any relative code paths resolve against it. Don't cd elsewhere.
4. `scripts/ai-patch-schema.json` (optional, for contract reference).

From the doc:

- Locate the target section by `cardRef.sectionId`. Its `convergenceType` is the constraint.
- Find the card in `section.data`. Absent → empty patch + warning.
- Sibling cards are the style guide.
- Note the invariants whose `appliesTo` includes the section id or `"*"`.

### 2. Route the action

- Look up `action` in `registry.generalAiActions` first.
- If not found, look up in `registry.convergenceTypes[type].aiActions`.
- If not found anywhere → empty patch + `meta.warnings: ["unsupported action '${action}' for type '${type}'"]`.

Output frame for every action:

```json
{
  "schema": "living-doc-ai-patch/v1",
  "requestId": "<echo>",
  "summary": "<one line>",
  "proposedBy": {
    "engine": "codex",
    "action": "<echo>",
    "cardRef": { "sectionId": "...", "cardId": "..." }
  },
  "changes": [ ... ],
  "meta": { "typeBoundariesOk": true, "orphansCreated": 0 }
}
```

### 3. General actions — tight variants

#### `decompose`

Emit `ticket-create` + `card-create` per sub-unit + one `card-update` on the umbrella. Keep sub-card names short and action-first (e.g. *"Build the batch selection harness"* rather than *"L4.2 — Build the batch selection harness from raw S3 supporting surface"*). Put the longer framing in the ticket body, not the card name.

#### `enrich-notes`

One `card-update` with a new `notes` array. Match neighbour card shape. Prefer bullet points and short clauses over long prose paragraphs. Preserve existing notes unless `extra.rewrite` is truthy.

#### `verify-invariants`

For each applicable invariant, check the card. Violations → one `invariant-suggest` each, quoting the rule. If clean, empty `changes` + `summary: "verified N invariants — clean"`.

#### `propose-coverage`

Emit `coverage-add` only for facets the card genuinely carries. Do not guess — when the fit is weak, skip. Add `meta.warnings` for facets the user expected but the card does not carry.

#### `summarise`

Read-only. `changes: []`. Summary goes in the top-level `summary`.

### 4. Type-specific actions (Codex sweet spots)

#### `code-anchor` → `check-revision-drift`

- Read the pinned `revision`. Shell out to `git` or use tool calls to compare the file at that revision vs. current main.
- If the range has moved, propose `card-update { fields: { status: "changed-since-issue", revision: <latest sha of last touch on that path> } }` with a short `rationale`.
- If the file has moved, pair with `propose-replacement-anchor` output (next action).
- If unchanged, empty patch + `summary: "revision still current"`.

#### `code-anchor` → `propose-replacement-anchor`

- Infer the new path/range by symbol (function name) or by content hash of the original snippet.
- `card-update { fields: { path, range, revision, status: "current" } }`.

#### `capability-surface` → `propose-status-from-commits`

- Pull recent commits touching the card's `codePaths`.
- Propose a status transition (built / partial / not-built / gap / blocked) based on what landed and what's missing from the last touches.
- Single `card-update`.

#### `attempt-log` → `find-shipping-commit`

- Search the referenced repo(s) for commits matching the attempt's description or the linked ticket.
- If found, `card-update { fields: { shipped_in: <url>, status: "workaround-shipped" } }`.
- If not found, empty + warning.

#### `attempt-log` → `propose-supersession`

- Scan newer attempts in the same section for ones that productionize the same insight.
- `card-update { fields: { status: "superseded" } }` with a rationale naming the newer attempt.

#### `issue-orbit` → `refresh-github-state`

- Fetch the linked issue/PR.
- `card-update { fields: { github_state, status, closed_by_pr } }` reflecting current GitHub state.

#### `issue-orbit` → `reclassify-relationship`

- Re-read the sibling issue and challenge the current relationship classification.
- `card-update { fields: { relationship: <new-value>, relevance: <updated> } }`.

#### `symptom-observation`, `maintainer-stance`, `proof-ladder`, `decision-record`, `investigation-findings`

Same patterns — read the current card, verify against recent signal (commits, sessions, thread), emit a single `card-update` or an empty patch with a warning.

Actions not yet implemented → empty patch + `meta.warnings: ["not yet implemented: ${action}"]`. Do not guess.

### 5. Respect type contracts

Before emitting `card-create` or `card-update`:

- `status` must use a value from the type's status set (`registry.statusSets[typeDef.statusFields[0].statusSet].values`).
- `ticketIds` must be `[{ issueNumber, issueUrl }, ...]`.
- Required fields on a new card must be present.

### 6. Self-check

Walk the three validator layers before emitting:

1. **Shape** — top-level fields present; every change has `changeId`, `kind`, kind-specific required fields.
2. **Registry contract** — status values and ticket-ref shapes match the type.
3. **Doc consistency** — every referenced `sectionId`, `cardId`, `facetId` exists.

Fix or drop offending changes. Do not ship a patch you would reject as a reviewer.

### 7. Emit

Single JSON object to stdout. No prose, no code fences, nothing after.

## Principles

1. **Terse > lyrical.** Codex's strength is precision. Short names, short clauses, concrete anchors.
2. **Code anchors over prose edits** when both are in play. Prefer a `revision` bump over a prose rewrite.
3. **Never invent repos, paths, or SHAs.** If any identifier isn't derivable from the doc or the card, emit a warning and stop.
4. **Stable change ids.** `c1`, `c2`, `c3`, … in emission order.
5. **One rationale per change.** One sentence, not a paragraph.
6. **Unknown action = empty + warning.** Never guess at type-specific actions; the registry is the source of truth.

## Example

### `check-revision-drift` on a code-anchor card

Input:
```json
{"requestId":"req-900","docPath":"/.../ai-pass-flow-body-workstream.json","cardRef":{"sectionId":"components","cardId":"validator"},"action":"check-revision-drift"}
```

Scenario: the card's pinned `revision` is 5 commits behind the current main for the referenced path, and the range has shifted by 12 lines because a helper was added above.

Output:
```json
{
  "schema": "living-doc-ai-patch/v1",
  "requestId": "req-900",
  "summary": "validator code moved; revision behind by 5 commits, range shifted by 12 lines",
  "proposedBy": { "engine": "codex", "action": "check-revision-drift", "cardRef": { "sectionId": "components", "cardId": "validator" } },
  "changes": [
    {
      "changeId": "c1",
      "kind": "card-update",
      "sectionId": "components",
      "cardId": "validator",
      "rationale": "File touched by 3 commits since the pin; ranges shifted after a pre-validator helper was added.",
      "fields": {
        "status": "changed-since-issue",
        "revision": "abc1234"
      }
    }
  ],
  "meta": { "typeBoundariesOk": true, "orphansCreated": 0 }
}
```

## Notes

- **The server runs `codex` CLI.** This file is the entire skill; no companion code.
- **Do not invoke `gh` or write to disk directly.** The server applies the patch.
- **Valid JSON always.** When in doubt, emit fewer changes with warnings over more changes that might fail the validator.
