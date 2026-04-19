# /competitor-sync

Check a competitor-watcher living doc against what each tracked competitor did in the current monitoring period, propose posture updates, log discrete strategic moves, suggest prediction resolutions, flag indicator changes, and draft the period note. Output is a `living-doc-ai-patch/v1` patch — the human reviews and applies in the compositor.

## Usage

```
/competitor-sync <doc-path>                       # Sync for the current period (inferred from today)
/competitor-sync <doc-path> 2026-H2               # Sync explicitly for named period
/competitor-sync --dry-run <doc-path> 2026-H2     # Show proposed changes without writing a patch
```

The target doc must already exist, forked from `docs/living-doc-template-competitor-watcher.json` (or equivalent) and filled in with the competitors, indicators, and predictions relevant to the market being tracked.

## Background

- Template: `docs/living-doc-template-competitor-watcher.json`
- Convergence types used: `competitor-stance-track`, `strategic-move-log`, `proof-ladder`, `indicator-trace`, `position-cluster-map`, `citation-feed`, `decision-record`
- Companion skills: `/crystallize` (restamp `metaFingerprint` after applying a patch)
- Cadence: every monitoring period (typically quarterly or half-yearly — whatever the doc declares)

## What this skill does

A competitor-watcher doc needs the same kind of scan every period: what did each tracked competitor ship, price, buy, hire, or retire since the last period? What does that say about their strategy? Which of last period's predictions moved? Which indicators have fresh values? This skill does that scan from public sources and proposes a patch. It never mutates the doc directly.

## Execution

### 1. Resolve the period

- Parse argument. Accepted: `YYYY-H1`, `YYYY-H2`, `YYYY-Q1..Q4`, or empty (infer from today).
- Validate the period window as declared by the doc's `periods[]`; if the target period doesn't exist, propose adding it to `periods[]` in the patch.
- If the doc declares a different cadence (e.g. quarterly) and the argument doesn't match, bail with a clear error rather than guessing.

### 2. Gather per-competitor signals

For each card in the `competitors` section, walk public feeds filtered to the period window. Only public material.

Per-competitor feeds to check (adapt to what the company actually publishes):

- **Company blog / announcements page** — `WebFetch` the blog index, extract posts dated in the window.
- **Press releases** — often a separate `/press/` or `/newsroom/` page; same extraction.
- **Pricing page** — fetch current version; diff against prior period if possible (rendered text changes are signal).
- **Product pages** — check for new product slugs, retired products, or repositioning.
- **Earnings transcripts** — for public companies, `WebFetch` IR page or `seekingalpha.com` / comparable source for the transcript.
- **Hiring signals** — LinkedIn company page "recently hired" shows executive hires; job board for new role types opening.
- **Major interviews / features** — search major outlets for the company name in the window.

Skip anything behind a subscription paywall or ToS-restricted scraping target. If a feed is unreachable, record `meta.warnings: ["feed unreachable: <url>"]` rather than guessing at content.

### 3. Log strategic moves

Each discrete, dated action is a new card in the `moves` section. Emit a `card-create`:

```json
{
  "changeId": "c1",
  "kind": "card-create",
  "sectionId": "moves",
  "card": {
    "id": "move-<company-slug>-<short-slug>",
    "name": "<Short title, e.g. 'Competitor X launches enterprise tier'>",
    "outcome": "pending-evaluation",
    "byCompany": "<Competitor name matching a tracked card>",
    "moveType": "launch | pricing | acquisition | hire | partnership | exit | product-retired",
    "dateOf": "<YYYY-MM-DD>",
    "intent": "<One sentence on what the competitor is trying to achieve.>",
    "observedEffect": "<What has changed since the move, or 'too early to tell' if recent.>",
    "linkedIndicators": ["<indicator card id this move is expected to affect>"],
    "notes": [{ "role": "reference", "text": "<primary source URL>" }],
    "lastUpdatedInPeriod": "<period-id>"
  }
}
```

Rules:

- **Moves require a dated primary source.** Press releases, product-page snapshots, earnings commentary. No rumors.
- **Moves need a moveType from the fixed set.** Don't invent new types. If it doesn't fit, it's probably a `partnership` or a `hire` — pick the closest.
- **By-company must match a tracked competitor card.** If the action was taken by a company not in the `competitors` section, it's not in scope for this sync.

### 4. Propose posture updates per competitor

For each competitor card, compare the new moves and signals against their current `strategicPosture` and `currentBet`. Look for:

- **Posture shift signals**: exit from a segment, entry into a new segment, pricing model change, leadership change, acquisition of a non-core capability.
- **Reinforcement**: new moves aligned with the existing bet with fresh evidence.
- **Ambiguity**: signals pointing in multiple directions — record in evolution, don't flip posture.

Emit a `card-update` per competitor whose posture or evolution changed:

```json
{
  "changeId": "c5",
  "kind": "card-update",
  "sectionId": "competitors",
  "cardId": "<competitor-id>",
  "rationale": "<why this update is justified, citing specific moves from this period>",
  "fields": {
    "posture": "softened",
    "strategicPosture": "<updated label if shifted>",
    "currentBet": "<updated prose if shifted>",
    "evolutionSinceLastPeriod": "<prose describing what shifted, citing moves in this period>",
    "lastUpdatedInPeriod": "<period-id>"
  }
}
```

Never flip `posture` on a single move. Strategic shifts require corroborating signals across the period.

### 5. Propose prediction resolutions

For each rung in `predictions`, check whether the period's evidence moves it:

- Read the resolution criterion from the rung's notes.
- Check whether the moves logged in step 3 or the indicator updates in step 6 satisfy or refute the criterion.
- Transition status: `planned → partial`, `planned → ready`, `planned → blocked` (refuted).
- Preserve prior evidence; append new rationale.

Never resolve silently. Every status change carries a rationale citing the moves or indicator shifts that triggered it.

### 6. Flag indicator changes

For each indicator card, check whether a newer print has landed — earnings numbers, analyst estimates, public filings, pricing-page revenue proxies, headcount signals.

```json
{
  "changeId": "c9",
  "kind": "card-update",
  "sectionId": "indicators",
  "cardId": "<indicator-id>",
  "fields": {
    "latestValue": "<new value>",
    "asOf": "<new as-of date>",
    "deltaVsLastPeriod": "<computed delta prose>",
    "trend": "rising | stable | falling | resolved",
    "lastUpdatedInPeriod": "<period-id>"
  }
}
```

Update `latestValue` and `asOf` together. Set `trend` only when multiple data points support it.

### 7. Update the position map

For each competitor whose posture shifted in step 4, re-derive `axisX` / `axisY` and emit a `card-update` on the matching `positions` card. Preserve the prior position:

```json
"priorPosition": "<previous axisX / axisY summary> (from <previous-period-id>)"
```

If no posture shifted, the map doesn't change.

### 8. Ingest new citations

Any source you consulted that wasn't a primary-signal for a move — analyst reports, industry articles, commentary, interviews — gets a new `citation-feed` card under the current period:

```json
{
  "changeId": "c12",
  "kind": "card-create",
  "sectionId": "sources",
  "card": {
    "id": "src-<author-slug>-<short-slug>",
    "name": "<title>",
    "state": "recent",
    "author": "<author or outlet>",
    "venue": "<publication>",
    "publishedAt": "<YYYY-MM>",
    "url": "<url>",
    "cardsReferenced": ["competitors/<competitor>", "indicators/<indicator>"],
    "lastUpdatedInPeriod": "<period-id>"
  }
}
```

Do not duplicate sources already in prior periods (check by URL).

### 9. Draft the period note

Emit a `card-create` against the `period-notes` section:

```json
{
  "changeId": "c15",
  "kind": "card-create",
  "sectionId": "period-notes",
  "card": {
    "id": "note-<period-id>",
    "name": "Period <period-id> — <1–3 word summary>",
    "status": "ground-truth",
    "notes": [
      { "role": "paragraph", "text": "<Summary of postures shifted, moves logged, predictions resolved, indicators moved.>" },
      { "role": "callout", "tone": "info", "title": "Focus for next period", "items": [
        "<specific thing to watch>",
        "<specific thing to watch>",
        "<specific thing to watch>"
      ]}
    ],
    "lastUpdatedInPeriod": "<period-id>"
  }
}
```

If a note for the current period already exists, emit a `card-update` instead.

### 10. Self-check

Before emitting the patch, walk the doc-local invariants:

- Every competitor-posture card cites at least one signal from the current or prior period.
- Every move has a `dateOf` and a `byCompany`.
- Every prediction rung carries a resolution status.
- Every indicator card has a dated `latestValue`.
- Every source has a `publishedAt`.
- The position map covers every competitor.
- The period note for the current period exists.

If any invariant would be violated by the patch, fix or drop the offending change before emitting.

### 11. Emit the patch

Write a single `living-doc-ai-patch/v1` object to stdout. No prose around it. The compositor server validates and presents the diff for human review.

## Principles

1. **Moves vs. citations stay separate.** A press release is both a move (the company shipped) and a source you read about it. File the move in `moves`; file the article about the move in `sources`. Do not conflate.
2. **Public sources only, licensed content excluded.** Work from press releases, earnings transcripts, product pages, SEC filings, job postings, public interviews, pricing pages. Do not republish paywalled analyst reports or subscription data. Public-source trackers are fine to share; trackers that draw on confidential intel (private sales calls, paid research) should stay private.
3. **Distinguish inference from fact in the prose itself.** Observed: "Competitor X raised enterprise pricing 20% in March" (from their pricing page). Inferred: "Competitor X is repositioning toward larger accounts" (read based on several signals). Write so the reader can tell which kind of claim each is.
4. **Infer intent with evidence.** Marketing narrative is not strategy; behavior is.
5. **Never flip posture on a single data point.** A pricing tweak isn't a pivot. A pricing change + repositioned landing page + exec hire might be — but say "might be" in the evolution field if the read is uncertain.
6. **Preserve history.** Evolution notes and prior positions are the durable record. Append, never overwrite.
7. **Defamation still applies.** False and damaging statements are actionable regardless of whether sources were public. Write only what evidence supports.
8. **Honest unknowns.** Unreachable feed, ambiguous signal, failed fetch — record in `meta.warnings` rather than guessing.

## Notes

- The skill is whole-doc, not per-card. Invoked like `/crystallize`, not like the Cmd+K palette actions.
- After the patch is applied, run `/crystallize <doc-path>` to restamp the `metaFingerprint`.
- Long outputs are fine — a busy period may produce 20+ changes. Keep the JSON valid throughout.
- If the target doc doesn't exist or isn't a competitor-watcher, stop and tell the user. Do not attempt to infer structure from an unrelated doc.
