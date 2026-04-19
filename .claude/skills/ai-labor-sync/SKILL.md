# /ai-labor-sync

Check the AI-labor monitoring living doc against sources published in the current period, propose stance updates per expert, ingest new citations, suggest prediction resolutions, flag indicator changes, and draft the period note. Output is a `living-doc-ai-patch/v1` patch — the human reviews and applies in the compositor.

## Usage

```
/ai-labor-sync                        # Sync for the current period (inferred from today's date)
/ai-labor-sync 2026-H2                # Sync explicitly for named period
/ai-labor-sync --dry-run 2026-H2      # Show proposed changes without writing a patch
```

## Background

- Target doc: `docs/ai-labor-monitor.json`
- Convergence types used: `expert-stance-track`, `indicator-trace`, `citation-feed`, `position-cluster-map`, `proof-ladder`, `decision-record`
- Companion skills: `/crystallize` (restamp fingerprint once the patch is applied)
- Cadence: every 6 months (H1 / H2 per calendar year)

## What this skill does

A longitudinal monitoring doc needs the same archaeology done every period: scan per-thinker feeds, read what's landed, notice stance shifts, ingest new sources, test predictions against fresh evidence, update the numeric dashboard, and draft a period note. This skill does that archaeology and proposes a patch. It never mutates the doc directly — every change lands in the compositor for human review.

## Execution

### 1. Resolve the period

- Parse the argument. Accepted forms: `YYYY-H1`, `YYYY-H2`, or empty (infer from today).
- If empty: today's date → H1 if Jan–Jun, else H2.
- Validate the period window: `YYYY-H1` → `YYYY-01-01 → YYYY-06-30`; `YYYY-H2` → `YYYY-07-01 → YYYY-12-31`.
- Read `docs/ai-labor-monitor.json`. Check whether the target period already exists in `periods[]`:
  - **Exists**: you're refreshing within the period. Continue.
  - **Does not exist**: you're opening a new period. Propose adding it to `periods[]` in the patch.

### 2. Gather per-thinker source candidates

For each expert in the `experts` section, walk their known feeds filtered to the period window. Do not invent sources.

| Expert | Feeds to check |
|---|---|
| Andrew McAfee | `geekway.substack.com`, LinkedIn posts, MIT Sloan publications, interviews in major outlets |
| David Autor | NBER (`nber.org/papers` under his author page), MIT Economics faculty page, Issues in Science and Technology, Brookings |
| Daron Acemoglu | NBER, MIT Economics, Project Syndicate, Brookings, MIT Technology Review |
| Erik Brynjolfsson | Stanford Digital Economy Lab, Fortune op-eds, arXiv recent submissions, NBER |
| Philippe Aghion | Project Syndicate, LSE / Collège de France publications, SF Fed working papers, MoneyWeek |

Practical checks:

- `WebFetch` the author's publication page; extract titles + dates in the period window.
- For NBER: search by author slug on `nber.org/people/...`.
- Interviews / op-eds: scan major outlets (`fortune.com`, `project-syndicate.org`, `technologyreview.com`, `issues.org`, `brookings.edu`, `moneyweek.com`) for the author name in the period window.
- Do not include anything whose publication date is outside `[period.window.start, period.window.end]` — retroactive additions require an explicit `--retro` flag (not in v1).

### 3. Propose stance updates per expert

For each expert, compare the new sources against their current `coreView`, `stanceLabel`, and prior `evolutionSinceLastPeriod`. Look for:

- **Stance shift signals**: explicit retraction, softening language, a new emphasis that contradicts the prior core view.
- **Reinforcement**: new evidence supporting the same stance with fresh numbers.
- **Topic expansion**: the expert now addresses a dimension they hadn't before.

Emit a `card-update` for each expert whose stance or evolution changed:

```json
{
  "changeId": "c1",
  "kind": "card-update",
  "sectionId": "experts",
  "cardId": "<expert>",
  "rationale": "New <venue> piece dated <date> — softening on <topic>.",
  "fields": {
    "stance": "softened",         // only when evidence supports a status change
    "evolutionSinceLastPeriod": "<one-paragraph summary grounded in specific sources>",
    "lastUpdatedInPeriod": "<period-id>"
  }
}
```

Never flip `stance` on weak evidence. If a shift is plausible but not certain, leave `stance` at its current value and describe the uncertainty in `evolutionSinceLastPeriod`.

### 4. Ingest new sources into the citation feed

For each source identified in step 2, emit a `card-create` against the `sources` section:

```json
{
  "changeId": "c2",
  "kind": "card-create",
  "sectionId": "sources",
  "card": {
    "id": "src-<author-slug>-<short-slug>",
    "name": "<title>",
    "state": "recent",
    "author": "<author(s)>",
    "venue": "<venue>",
    "publishedAt": "<YYYY-MM>",
    "url": "<url>",
    "cardsReferenced": ["experts/<expert>", ...],
    "lastUpdatedInPeriod": "<period-id>"
  }
}
```

Do not duplicate sources already present in prior periods. Check by URL match.

### 5. Propose prediction resolutions

For each rung in the `predictions` section, check whether the period's evidence moves it toward resolution:

- **`productivity-persists`**: look at BLS TFP prints + recent Fortune/Fed coverage. If the 2025 ~2.7% level holds with AI-exposed attribution, propose `status: ready` (confirmed). If it retraces below 1.5%, propose `status: blocked` (refuted). If partial, propose `status: partial` with a rationale quoting the data.
- **`entry-level-employment`**: check for Brynjolfsson follow-ups or Fed / Dallas Fed replications on the 22–25yo cohort. Same transition logic.
- **`wage-dispersion`**: Autor's ongoing NBER work on wage dispersion in AI-exposed occupations.
- **`flexicurity-adoption`**: any OECD economy passing AI-motivated wage insurance. Confirm only with a named bill or regulation.

Emit `card-update` on each rung that moved. Preserve prior evidence notes; append new ones. Never flip resolution silently.

### 6. Flag indicator changes

For each indicator card, check whether a newer print has been released. If yes, emit a `card-update`:

```json
{
  "changeId": "c7",
  "kind": "card-update",
  "sectionId": "indicators",
  "cardId": "<indicator>",
  "fields": {
    "latestValue": "<new value>",
    "asOf": "<new as-of date>",
    "deltaVsLastPeriod": "<computed delta>",
    "trend": "<rising|stable|falling|resolved — only if supported>",
    "lastUpdatedInPeriod": "<period-id>"
  }
}
```

Update `latestValue` and `asOf` **together** — never update one without the other. Update `trend` only when the delta supports it.

### 7. Update the divergence map

For each thinker whose stance shifted in step 3, re-derive `axisX` / `axisY` based on the new position and emit a `card-update` on the matching `divergence` section card. Always preserve the prior position in `priorPosition` so the delta is inspectable:

```json
"priorPosition": "<previous axisX / axisY summary> (from <previous-period-id>)"
```

If no stance shifted, the map does not change.

### 8. Draft the period note

Emit a `card-create` against the `period-notes` section with:

- `id`: `note-<period-id>`
- `name`: `Period <period-id> — <1–3 word summary>`
- `status`: `ground-truth`
- `notes`: paragraphs summarising shifts, resolved predictions, indicator movements, plus a callout listing "focus for next period".

If the period already has a note card, emit a `card-update` instead.

### 9. Self-check

Walk the doc-local invariants before emitting the patch:

- Every expert-position card cites at least one source from the current or prior period.
- Every prediction rung carries a resolution status.
- Every indicator card has a dated `latestValue`.
- Every source has a `publishedAt`.
- The period note for the current period exists.
- The divergence map covers every thinker in the experts section.

If any invariant would be violated, fix the patch before emitting.

### 10. Emit the patch

Write a single `living-doc-ai-patch/v1` object to stdout. No prose around it. The compositor server validates and presents the diff. The human reviews each change, accepts or declines, and applies.

## Principles

1. **Period windows are hard boundaries.** A source dated outside the period does not belong in the period's citation group without explicit retro flag.
2. **Never fabricate a shift.** If an expert's position looks unchanged on the evidence you found, leave `stance` alone and say so in the evolution field.
3. **Preserve history.** Evolution notes and prior positions are the durable record. Append, never overwrite.
4. **Trend changes need support.** Do not flip `trend` on a single data point if the series is noisy.
5. **Honest unknowns.** If a feed is unreachable, emit a `meta.warnings` note rather than guessing at the content.
6. **One patch per period.** Don't split the sync into multiple runs unless the human explicitly asks for a partial sync.

## Notes

- The skill is whole-doc, not per-card. It's invoked like `/crystallize`, not like the Cmd+K palette actions.
- After the patch is applied, run `/crystallize docs/ai-labor-monitor.json` to restamp the `metaFingerprint`.
- Long outputs are fine — a dense period can produce 15+ changes. Keep the JSON valid throughout.
- If the target doc doesn't exist, stop and tell the user where to seed from (`docs/ai-labor-monitor.json` is expected).
