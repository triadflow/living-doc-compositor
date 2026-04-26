---
name: "living-doc-ai-pass-claude"
description: "Handle card-level living doc AI-pass requests for Claude Code and emit JSON-only `living-doc-ai-patch/v1` output."
---

# /living-doc-ai-pass-claude

> **YOUR STDOUT IS JSON ONLY.** Whatever the action, whatever the answer (including *"no change needed"*), your entire stdout must be a single valid `living-doc-ai-patch/v1` JSON object. No markdown headers, no prose, no code fences, no commentary before or after. The server pipes your stdout straight into a JSON parser.
>
> *No change needed* is still a patch — emit it with `"changes": []` and put the finding in the `summary` string. The verdict prose belongs **inside** the JSON's `summary` field, not outside it.

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

Look up `registry.convergenceTypes[type].aiActions` for the target type and route by `action.id`. Handlers below are fully spec'd. Any action declared in the registry but not handled here should emit an empty patch with `meta.warnings: ["not yet implemented: ${action}"]` rather than being guessed at.

#### `code-anchor` → `check-revision-drift`

Determine whether the card's pinned revision still reflects the current state of the pointed-to file, and propose a status transition when it doesn't.

You run in `input.docRepoRoot`, so relative `path` values resolve and `git` commands see the right history.

1. Extract `card.revision`, `card.path`, `card.range` from the target card.
2. If `revision` is missing, empty, or the literal string `"not yet committed"`:
   - The card was pinned pre-implementation. Emit a single `card-update` with `fields: { status: "current", revision: <git rev-parse HEAD> }` and a rationale like *"First revision pin — file exists at HEAD."*
3. If `card.path` does not exist at HEAD (`git ls-files -- <path>` returns nothing):
   - Emit `card-update` with `fields: { status: "deprecated" }` and a rationale naming what you checked. Do not try to guess a replacement — that's `propose-replacement-anchor`.
4. Otherwise check for drift:
   - Run `git log --oneline ${revision}..HEAD -- ${path}`.
   - **Empty output** → the file hasn't been touched since the pin. Emit an empty-changes patch with `summary: "revision still current for <path> (<N> commits behind HEAD, none touched this file)"`. No changes.
   - **Non-empty output** → drift. Get the latest commit that touched the path with `git log -1 --format=%H -- ${path}`. Emit a single `card-update`:
     ```json
     {
       "changeId": "c1",
       "kind": "card-update",
       "sectionId": "<section>",
       "cardId": "<card>",
       "rationale": "<N> commit(s) touched <path> since the pinned revision — latest: <short sha> <short subject>.",
       "fields": {
         "status": "changed-since-issue",
         "revision": "<full latest sha>"
       }
     }
     ```
5. If any git invocation fails (not a repo, bad revision, etc.), emit an empty patch with `meta.warnings: ["git error: <msg>"]`. Do not fabricate.

#### `attempt-log` → `find-shipping-commit`

For an attempt card whose `shipped_in` is empty or vague, find the commit that productionized it.

1. Gather signals: `card.name`, `card.what_tried[].text`, any `ticketIds`, and the name of the section (for semantic hints).
2. Search commit messages in priority order:
   - If the card references a ticket number: `git log --all --oneline --grep="#<num>" -i`
   - If the card carries a distinctive phrase (e.g. a function name or `_watch_app_focus`): `git log --all --oneline --grep="<phrase>" -i`
   - Broader: `git log --all --oneline -S "<code-like snippet>"` to find commits that added the literal text.
3. If a high-confidence single match emerges, build its URL from `git remote get-url origin`:
   - Normalize `git@github.com:OWNER/REPO.git` → `https://github.com/OWNER/REPO/commit/<sha>`.
   - Emit one `card-update` with `fields: { shipped_in: "<url>", status: "workaround-shipped" }` and a rationale quoting the commit subject.
4. If multiple candidates remain ambiguous or nothing matches, emit an empty patch with `meta.warnings: ["no clear shipping commit found — candidates: [...]"]`. Do not guess.

#### `issue-orbit` → `refresh-github-state`

For an issue-orbit card whose `url` points to a GitHub issue or PR, pull the current state.

1. Parse the URL: extract `owner/repo` and the issue/PR number.
2. Run `gh issue view <num> --repo <owner/repo> --json state,closedByPullRequestsReferences` (or `gh pr view` if the URL is a PR path).
3. Compare to `card.github_state`, `card.status`, `card.closed_by_pr` (if present).
4. Only emit a `card-update` if something changed. Map the GitHub state:
   - `OPEN` → `card.github_state: "open"`; status stays `open-active` unless stale signal tells you otherwise.
   - `CLOSED` with a closing PR → `github_state: "closed"`, `status: "closed-fixed"`, `closed_by_pr: "<url>"`.
   - `CLOSED` with no closing PR → `status: "closed-wontfix"` (unless the user already set otherwise — then preserve).
5. If `gh` errors (not authenticated, rate-limited, URL malformed), empty patch + `meta.warnings`.

#### `capability-surface` → `propose-status-from-commits`

For a capability-surface card with a `codePaths` field, infer whether the status should flip based on recent commit activity.

1. For each path in `card.codePaths`, run:
   - `git log --oneline -n 20 -- <path>` — recent history.
   - `git log --oneline --since="30 days ago" -- <path>` — recent activity intensity.
2. Apply a conservative heuristic:
   - Many recent commits landing on the path AND the file currently exists → leans `built` (if was `partial` / `not-built`).
   - No recent commits but path exists → leans `partial` (keep if already set).
   - Path removed from HEAD → `not-built` or `gap`.
3. Emit a single `card-update { fields: { status: "<new>" } }` **only when the shift is clear**. Otherwise, empty + `meta.warnings` listing the ambiguity. Do not flip status on weak evidence — a wrong status erodes the board.

#### `maintainer-stance` → `check-evolution`

For a stance card, see if the named stakeholder has updated their position since `stated_at`.

1. Extract the issue/PR URL and stakeholder handle from `card.stakeholder` and `card.stated_at`.
2. Run `gh issue view <num> --repo <owner/repo> --comments --json comments` (or `gh pr view ...`).
3. Filter comments to those authored by the stakeholder with timestamps after `stated_at`.
4. If there are newer comments from the same stakeholder:
   - Summarise the direction of change in a `card-update` to the `evolution` field.
   - Adjust `status`: if the stakeholder explicitly retracted → `retracted`; softened their take → `softened`; reinforced → leave `current`.
5. If no newer comments, empty patch + `summary: "stance unchanged — no comments from <handle> since <stated_at>"`.

#### `code-anchor` → `propose-replacement-anchor`

Ship `path`, `range`, `revision` for a moved or renamed file. Use `git log --follow --format=%H -- <new candidate>` against symbol/content signals from the original snippet. Single `card-update { fields: { path, range, revision, status: "current" } }`.

#### `attempt-log` → `propose-supersession`

Read sibling attempts in the same section. If a newer card ships the same insight, `card-update { fields: { status: "superseded" } }` on the older card with a rationale naming the superseder.

#### Other declared actions

`symptom-observation → suggest-environment-variants`, `symptom-observation → check-contradictions`, `issue-orbit → reclassify-relationship`, `proof-ladder → check-monotonic-invariant`, `decision-record → check-if-still-current`, `investigation-findings → check-still-holding` — declared in the registry but not yet fully prompted here. Emit an empty patch with `meta.warnings: ["not yet implemented: <action>"]` for any of these.

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

### Example 3: no-change-needed is still JSON

When the action runs and the conclusion is "nothing to change" — for example `find-shipping-commit` on a card whose `shipped_in` is already set and still verifies — put your reasoning in the `summary` string. Do not write a markdown explanation outside the JSON.

```json
{
  "schema": "living-doc-ai-patch/v1",
  "requestId": "req-877",
  "summary": "shipped_in already set to 8ce3409; verified against GitHub — PR #991 by jjallaire productionises the described pattern. No mutation needed.",
  "proposedBy": { "engine": "claude-code", "action": "find-shipping-commit", "cardRef": { "sectionId": "attempts", "cardId": "inspect-ai-patch" } },
  "changes": [],
  "meta": { "typeBoundariesOk": true, "orphansCreated": 0, "warnings": [] }
}
```

### Example 4: decompose on an umbrella card

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
