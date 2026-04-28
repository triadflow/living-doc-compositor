---
name: integrate-source
description: Take a single source (YouTube URL, web article, transcript, file, or pasted text), assess its relevance to each monitoring living doc, and apply the relevant updates across JSON sources, re-rendered HTML, and the matching dossier period pieces. Honest scoring, surgical edits, cite the source.
---

# /integrate-source

One source in. Zero, one, or several living docs updated — each with the source cited. The skill's job is *investigation first, implementation second*: look at what exists, score honestly what the source actually touches, then apply surgical edits only where the source is load-carrying.

## When to invoke

- User says `/integrate-source <URL or path>` — run the full flow.
- User says `/integrate-source` (no args) — ask for the source.
- Triggered after `/transcribe` when the user says "now feed this into the docs" or similar.
- After a conference talk, article, press release, or primary-source material that touches monitoring domains (frontier labs, inference economics, eval ecosystem, datacenters, labor, protocols, or any future tracked topic).

## Contract

- **Input:** a single source pointer — YouTube URL, web article URL, local file path (audio/video/PDF/text/transcript JSON), or pasted raw text.
- **Output:**
  1. One **impact table** (markdown) scoring every monitoring living doc NONE / LOW / MED / MED-HIGH / HIGH, with one-line rationale per row.
  2. Edits to the JSON living docs scored MED or higher: new cards, updated profiles, new indicators, new strategic-move entries, new citation-feed entries.
  3. Re-rendered HTML for each edited JSON via `scripts/render-living-doc.mjs`.
  4. Optional edits to the matching dossier period piece(s) under `docs/dossier/<slug>/<period>.html` when the source adds thesis-affecting facts. New footnote added to the fn-ref / rail-note / endnotes three-way mirror.
  5. A final **report** listing changes per doc and flagging any dossier-piece word-count or note-count spec violations.
- **Publish model:** commit only if the user explicitly says "commit" / "publish" / "push". Git is the safety net.

## Principles

1. **Honest scoring beats aggressive integration.** If the source doesn't touch a doc, say NONE and move on. A wave of shallow updates is worse than two real ones.
2. **The source must be citable.** Every fact pulled from the source lands in a `notes[].role=reference` entry and/or a `citation-feed` source card. Every dossier-piece change carries a new footnote.
3. **Surgical over structural.** Update existing cards where possible. Add new cards only when the source introduces a new entity, move, or indicator that the existing structure cannot carry.
4. **Don't restate the thesis from thin evidence.** If one talk contradicts a dossier thesis, flag it as a watchlist item or a footnote caveat, not a thesis rewrite. Rewrites need multiple independent sources.
5. **Respect the methodology decision-records.** If a living doc has declared its benchmark set or its tracking axes, the source update fits inside those choices. Don't silently change methodology.

## Execution flow

### 1. Resolve the source

| Input kind | Action |
|---|---|
| YouTube / other video URL | Invoke `/transcribe`. Use the resulting transcript file (`/tmp/transcribe-readable.txt`) as the source content, and the talk URL + metadata as the citation. |
| Web article URL | `WebFetch` with a prompt asking for the article's full text, speakers, dates, claimed figures. |
| Local audio/video file | Invoke `/transcribe` with the path. |
| PDF | `Read` with `pages` parameter if > 10 pages. |
| Plain text file | `Read` the file directly. |
| Pasted text | Use the text the user provided. |

Regardless of input type, end this step with:
- **Content blob** (transcript / article body / excerpt).
- **Citation metadata**: title, author(s), venue, publication date, canonical URL.
- **Short key-facts list** (5–12 bullets) extracted from the content — named entities, hard numbers, dated events.
- **Source contribution map** (3–6 bullets) separating:
  - Measurement claims: prices, benchmark numbers, latency, usage counts, dates.
  - Strategic / economic mechanism claims: funnels, monetization paths, adoption loops, platform lock-in, supply constraints, distribution strategy.
  - Thesis pressure: whether the source strengthens, weakens, or reframes an existing dossier thesis even if it adds no new measurement axis.

If the source was a transcription, it is already saved to the graph by `/transcribe`. If the source was a web article, consider saving it as a note via `/projectgraph:zettel` only if the user asks — not by default.

### 2. Inventory the monitoring living docs

Enumerate `docs/*.json` and filter to monitoring/dossier-connected docs. Exclude:
- Templates (`docId` starting with `template:`)
- Compositor-meta docs (`compositor:`, `living-doc-compositor:`)
- Example fixtures (`doc:living-doc-example-*`)
- Blog-editorial, workstream docs, single-issue deep-dives

For each remaining doc, read `title`, `docId`, `subtitle`, `scope`, and the most recent period note. Build a mental model of what the doc tracks and at what granularity. This is the substrate the scoring step reads against.

### 3. Score relevance per doc

For each monitoring doc, assign:

- **HIGH** — the source introduces named entities, hard numbers, or strategic moves central to the doc's scope. At least one new card expected; likely an indicator update and a citation entry.
- **MED-HIGH** — the source updates an existing actor's posture or adds a non-trivial move. Card edits + citation entry expected; no new indicator or section.
- **MED** — the source adds a new citation worth tracking plus a minor update to one card. Light touch.
- **LOW** — the source is tangentially on-topic but adds no concrete fact the doc can act on.
- **NONE** — the source does not touch this doc's scope.

Present the impact table to the user before applying edits. This is a good moment to pause if the user wants to adjust scope or add a doc to the skipped list.

Score on two axes before choosing the final score:

| Axis | Question |
|---|---|
| Methodology / card fit | Does the source introduce a fact that fits this doc's declared indicators, benchmarks, actors, or card schema? |
| Thesis / market-structure fit | Does the source explain why an existing fact matters, shift the strategic mechanism behind a dossier claim, or connect tracked actors to monetization, distribution, capacity, regulation, or adoption loops? |

Do not let a methodology rejection on one claim suppress a thesis/market-structure contribution from the same source. Example: if a video cites an out-of-methodology benchmark but also argues that open-weight models are a developer funnel into hosted cloud inference, the benchmark may be LOW while the cloud-inference funnel may still be MED for an inference-economics doc.

**Scoring heuristics:**
- Named entity match + a dated event = MED or higher.
- Numeric claim (price, benchmark score, download count, headcount) that slots into an existing indicator = MED-HIGH or HIGH.
- Posture shift for a tracked actor = HIGH.
- Strategic / economic mechanism that explains a tracked actor's monetization, distribution, adoption, capacity, or lock-in path = MED or MED-HIGH even without a new number.
- New entity that doesn't exist in the doc yet = HIGH if the doc's scope covers that entity class; otherwise LOW.
- Quoted voice = MED if the doc has an `expert-stance-track`; lower otherwise.

**Reasoning capture for skipped or downgraded docs:**
- If a doc is scored LOW/NONE despite sharing a named actor, model family, market, or dossier theme with the source, include a skip note with:
  1. `considered`: the strongest possible fit for that doc.
  2. `rejected because`: the specific missing fact, method fit, or source-quality issue.
  3. `would become actionable if`: the trigger that would raise it to MED+ next time.
- If the source has both an invalid/out-of-scope measurement claim and a valid strategic mechanism claim, report them separately. The invalid measurement claim cannot be the only rationale for skipping the doc.

### 4. Implement changes to JSON living docs (MED and above)

For each MED+ doc, make targeted edits:

**Common edit patterns:**
- **Update an actor's `competitor-stance-track` card** — extend `currentBet`, append to `activeInitiatives`, bump `evolutionSinceLastPeriod`, add a `notes[].role=reference` pointing to the source.
- **Add a `strategic-move-log` entry** — use the source's dated event. Fill `dateOf`, `byCompany`, `moveType`, `intent`, `observedEffect`. Link to relevant indicators.
- **Update an `indicator-trace` card** — adjust `latestValue`, `trend`, `asOf`, `forecast`. Keep the methodology intact.
- **Add a new indicator** — only if the source introduces a measurement axis that the doc lacks and the axis is trackable period-over-period. Never invent single-point-in-time numbers as if they were recurring indicators.
- **Update a `position-cluster-map` card** — if the actor's position on the map has moved. Preserve `priorPosition`.
- **Always add a `citation-feed` source entry** — every change must reference it via `cardsReferenced`.

**Timestamping:**
- Bump the doc-root `updated` timestamp to today's ISO datetime.
- Do NOT bump per-section `updated` timestamps unless the whole section was refreshed — the per-section stamps are for period boundaries, not source integrations.
- Keep `lastUpdatedInPeriod` on each card consistent with the current period.

**Period-note update:**
- If the source shifts counts (more models tracked, more moves logged), update the period summary prose and the focus-for-next-period list.
- Append a one-line "Refreshed YYYY-MM-DD from <source title>" breadcrumb to the period note if appropriate.

After edits, run `node scripts/render-living-doc.mjs <path.json>` on each touched doc.

### 4b. Refresh the change-log and drift signals

Every integrate-source run that modifies a living-doc JSON becomes a commit that lands in the paired dossier's change-log. After committing the JSON edits (or before, if the integrate-source commit is the same one that ships the changes), run:

```
# regenerate the "Since this piece was published" aside on every dossier
node scripts/refresh-dossier-strip.mjs --all

# regenerate drift badges on the dossier index
node scripts/refresh-dossier-index.mjs
```

Both scripts read the `<meta name="dossier-source-commit">` stamped on each dossier piece, run `scripts/living-doc-changelog.mjs` from that commit to HEAD, and write results in place. They are idempotent. Do **not** hand-edit the since-publish aside — the script is the source of truth.

If a living-doc JSON is touched but the paired dossier hasn't been republished for this period yet, the change-log simply grows. That is the point: the dossier reader sees the substrate accumulating changes since publication. When the dossier is re-published, the `/dossier` skill will stamp a new `dossier-source-commit`, which resets the anchor.

### 5. Update matching dossier period pieces (thesis-affecting sources only)

A dossier period piece at `docs/dossier/<doc-id-slug>/<period>.html` needs a touch-up when:
- The source produces a number the piece's prose relies on but didn't have (strengthens a claim).
- The source introduces a named actor the piece's thesis didn't include.
- The source materially challenges a thesis the piece committed to in print.
- The source gives a compact strategic/economic mechanism that materially clarifies an existing thesis, especially around monetization, distribution, adoption loops, unit economics, capacity constraints, or platform lock-in.

When touching a dossier piece:
- **Preserve the thesis.** If the source challenges it, flag as a watchlist item or a footnote caveat, not a rewrite.
- **Add exactly one new footnote** per source with the key facts the prose now cites — maintain the fn-ref / rail-note / endnotes three-way mirror (see `/dossier` skill for the mechanics).
- **Renumber downstream footnotes only if necessary.** Inserting at the end is cleanest.
- **Update the masthead / top-bar date and read-time** if the piece materially grew.
- **Update the dossier index card** for that piece: `date`, `read`, and `dek` if the refresh changed the lede.
- **Update related-grid cards on sibling pieces** that point to this piece with the old date / read-time.

Do NOT touch dossier pieces for ordinary MED-only JSON updates. A single citation-feed addition doesn't warrant a prose change. Exception: a MED strategic/economic mechanism can justify a small dossier watchlist note or footnote if it clarifies the dossier's central claim better than the existing sources.

### 6. Report

Report to the user:

1. **Impact table** (from step 3).
2. **Changes made** — per doc: number of cards edited, new entries added, source citation, re-render status.
3. **Dossier pieces touched** (if any) — new note number, new word count, flag if over 1,300 or under 800, flag if notes exceed 9.
4. **Uncommitted** — list file changes, wait for user instruction on commit/push.

## What not to do

- Don't invent facts the source didn't state. If a number is directional in the source ("a lot", "many users"), keep it directional in the edit.
- Don't let Whisper transcription errors leak into the doc. Fix proper nouns in the extracted key-facts list before writing to cards (Whisper routinely mangles "Gemma" as "Jemma" / "Jam", "llama.cpp" as "lama CPP", "vLLM" as "BLLM", etc.).
- Don't update a doc scored LOW or NONE. Better to skip honestly than pad.
- Don't bypass the methodology-decision-record of a living doc. If the source introduces a benchmark the doc doesn't track, the right move is a watchlist item, not a silent addition to the tracked set.
- Don't rewrite a dossier's thesis from a single source. Multiple independent sources, or a user's explicit decision, are the triggers for a thesis-level rewrite.
- Don't commit / push without an explicit instruction.
- Don't delete source citations on existing cards when adding new ones — the citation-feed accumulates.
- Don't hand-edit the "Since this piece was published" aside on a dossier — `scripts/refresh-dossier-strip.mjs` is the source of truth. Same rule for the drift badge on the dossier index (`scripts/refresh-dossier-index.mjs`).

## Edge cases

- **Source is a transcript with known transcription errors** — read the transcript, extract key facts to a clean list, then reason from the clean list when writing to JSON. Never paste raw transcript into `notes[].text`.
- **Source contradicts an existing card** — log as a watchlist item or add a caveat note; do not overwrite the existing card silently. The contradiction itself is a signal worth preserving.
- **Source covers a topic none of the tracked docs own** — report back to the user that no existing doc is a fit, and suggest either (a) skipping, (b) adding a new convergence-type or section to an existing doc, or (c) creating a new living doc from a template. Do not force-fit into the closest doc.
- **Source mentions a domain name that matches a doc title but no shared entities** — score LOW. Surface-level topic overlap isn't enough; actor or indicator overlap is.

## Relation to other skills

- `/transcribe` — upstream of this skill when the source is a video/audio. `/integrate-source` on a YouTube URL chains automatically into `/transcribe`.
- `/dossier` — downstream when a period closes. If this skill updates a living doc heavily mid-period, the next `/dossier` run on that doc's current period will carry the refresh.
- `/convergence-advisor` — parallel. If the source suggests a new convergence type is needed (repeated shape that doesn't fit any existing type), hand off to `/convergence-advisor` rather than silently extending the registry.
- `/competitor-sync`, `/ai-labor-sync` — more narrowly scoped syncs for specific docs. `/integrate-source` is the generic version when the source touches multiple docs.
