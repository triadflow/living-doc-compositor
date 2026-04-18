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

You run in `input.docRepoRoot`, so relative paths resolve. Extract `card.revision`, `card.path`.

1. `revision` empty / `"not yet committed"`: pin to HEAD. `card-update { status: "current", revision: <git rev-parse HEAD> }`.
2. `git ls-files -- <path>` empty: file gone. `card-update { status: "deprecated" }`. Don't try to guess a replacement here — that's `propose-replacement-anchor`.
3. `git log --oneline <revision>..HEAD -- <path>`:
   - Empty → no drift. Empty patch, `summary: "revision still current for <path>"`.
   - Non-empty → drift. Last-touch SHA via `git log -1 --format=%H -- <path>`. `card-update { status: "changed-since-issue", revision: <sha> }` with a rationale naming the commit count and latest subject.
4. Git error → empty patch + `meta.warnings: ["git: <msg>"]`.

#### `attempt-log` → `find-shipping-commit`

Signals: card name, what_tried, ticketIds. Priority searches:

1. `git log --all --oneline --grep="#<ticket-num>" -i` (if ticket present).
2. `git log --all --oneline --grep="<distinctive-phrase>" -i` (function name, etc.).
3. `git log --all --oneline -S "<code-snippet>"` to find commits that added that literal.

On single high-confidence match: build URL from `git remote get-url origin` (normalise to `https://github.com/OWNER/REPO/commit/<sha>`). Emit `card-update { shipped_in: <url>, status: "workaround-shipped" }` with commit subject in rationale.

Multiple candidates or none → empty + `meta.warnings: ["no clear shipping commit — candidates: [...]"]`. Don't guess.

#### `issue-orbit` → `refresh-github-state`

Parse `owner/repo` + number from `card.url`. Run `gh issue view <num> --repo <owner/repo> --json state,closedByPullRequestsReferences` (or `gh pr view`). Compare.

Mapping:
- `OPEN` → `github_state: "open"`, keep `status: "open-active"`.
- `CLOSED` + closing PR → `github_state: "closed"`, `status: "closed-fixed"`, `closed_by_pr: <url>`.
- `CLOSED` + no PR → `status: "closed-wontfix"` unless user already set otherwise.

Emit `card-update` only if anything actually changed. On gh error → empty + warning.

#### `capability-surface` → `propose-status-from-commits`

For each path in `card.codePaths`:
- `git log --oneline --since="30 days ago" -- <path>` → activity level.
- `git ls-files -- <path>` → exists at HEAD?

Flip only on clear signal:
- File gone → `not-built` / `gap`.
- Active commits + file present → `built` (if was `partial`).
- No recent activity but file exists → leave as-is.

Emit single `card-update { status: <new> }`. Weak signal → empty + warning. Do not flip status on guesses.

#### `maintainer-stance` → `check-evolution`

Extract issue/PR URL and stakeholder handle from `card.stakeholder`, `card.stated_at`. Run `gh issue view <num> --repo <owner/repo> --comments`. Filter comments by the handle, timestamps > `stated_at`.

If newer comments:
- Summarise direction of change into `evolution` field.
- Adjust status: retracted → `retracted`, softened → `softened`, reinforced → keep `current`.
- Emit one `card-update`.

No newer comments → empty + `summary: "stance unchanged since <stated_at>"`.

#### `code-anchor` → `propose-replacement-anchor`

Infer new path/range via symbol or content hash of original snippet. Single `card-update { path, range, revision, status: "current" }`.

#### `attempt-log` → `propose-supersession`

Scan newer siblings. If one productionises the same insight, `card-update { status: "superseded" }` on the older card, rationale names the superseder.

#### `issue-orbit` → `reclassify-relationship`

Re-read sibling issue. Challenge current relationship classification. `card-update { relationship, relevance }`.

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
