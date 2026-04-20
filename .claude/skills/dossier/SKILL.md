---
name: dossier
description: Publish a short, sharp piece drawn from a living doc at a period boundary. Output: one self-contained HTML file in docs/dossier/<doc-id>/<period>.html plus an index refresh. Voice: cross-domain complex-work audience, not engineers. Pretend a large readership; edit to that bar regardless of actual traffic.
---

# /dossier

Publishes a dossier piece from a research-style living document. One living doc, one period, one essay. The living doc is the working surface; the dossier piece is the stable reading artifact.

## When to invoke

- User says `/dossier <living-doc.json>` (or a doc id) — write a piece for the current period.
- User says `/dossier <living-doc.json> <period-id>` — write a piece for a specific period.
- Called after a period closes and the living doc has been updated with that period's moves, indicator deltas, and period note.

## Contract

- **Input:** a `docs/<slug>.json` living doc following the compositor registry, with at least one entry in `periods[]`.
- **Output:** `docs/dossier/<doc-id>/<period>.html` — one self-contained HTML file using the typography template (serif body, single column, ~640px max-width, drop-cap lede, pull-quote block, watchlist block, sources strip). Plus a refreshed `docs/dossier/index.html`.
- **Length:** 800–1,200 words of prose. Not a summary — a short essay with a thesis.
- **Publish model:** auto-publish is fine. Git is the safety net — if the piece is wrong, revert. Do not gate behind a `draft/` step.

## Voice

Per the project's standing editorial notes:

1. **Cross-domain audience.** The reader is a researcher, operator, analyst, or editor who works at the seam of knowledge and execution — not an engineer embedded in the specific domain. Avoid jargon without translation. No acronym salad. If a primitive needs a name, give it the name and one clear sentence of what it does.
2. **Pretend a large audience is reading.** The actual traffic is small. The quality bar is as if it were large. No throwaway phrases, no draft-voice, no "I think" hedges, no ending with "thoughts?"
3. **Thesis first.** The opening paragraph must carry the one non-obvious thing the reader would take away. If the piece could be replaced by its lede without loss, rewrite until it can't be.
4. **Editorial, not promotional.** The doc's contents are evidence. The piece is a claim made from that evidence. Quote the doc's own pull-quotes where they are sharp; otherwise write original prose.

## Structure

Every dossier piece has the same seven-part spine. Keep the rhythm predictable so readers can scan and decide whether to read.

1. **Meta bar** — dossier · period · publish date · link back to living doc.
2. **Kicker + headline + dek** — kicker names the living doc and period; headline is the thesis; dek is one italicised sentence.
3. **Lede with drop-cap** — the one-paragraph argument. Name the non-obvious thing. End with a hook that forces the reader into the body.
4. **Body** — 3 to 5 `<h2>` sections. Each section resolves one claim. Pull from the doc's `moves`, `indicators`, `primitives`, and `period-notes` sections — but prose them, do not list them.
5. **Pull quote** — one. Either from the doc's own citation feed (a source that said something sharp) or an on-record statement from the period. Cited with attribution.
6. **Watchlist** — numbered list of 3 to 5 items from the period note's "focus for next period" field. This is the one explicitly list-shaped block in the piece.
7. **Sources strip** — footer. The sources cited in prose plus a link to the living doc.

## Execution flow

### 1. Resolve the input

Accept either a file path (`docs/foo.json`) or a doc id (`doc:foo`). If only a doc is given with no period, use the most recent entry in `periods[]` whose window's end date is in the past or equal to today; if none have closed, use the current open period but mark the piece clearly as "period in progress."

### 2. Read the living doc

Load the JSON. Extract:
- `title`, `subtitle`, `docId`, `scope`
- The target period from `periods[]`
- All sections with `lastUpdatedInPeriod === <period>` — these are the cards that moved this period
- The period note from `sections.find(s => s.id === 'period-notes')` for that period
- The citation feed — sources added this period
- Any `callouts` on the doc root — they often carry the author's voice the piece should honour

### 3. Draft the piece

Write the prose directly into the HTML template. Do not use a markdown intermediate — it adds a step and makes typography decisions harder to hold.

The template lives at `docs/dossier/mcp-protocol-monitor/2026-H1.html` as the reference implementation. Copy its structure exactly: the `<head>` meta tags, the CSS block (inlined), the `.meta-bar` → `header.article-head` → `<article>` → `.watchlist` → `<footer.sources>` → `.back` shape.

Preserve these `<meta>` tags for the index builder:

```html
<meta name="dossier-title" content="...">
<meta name="dossier-period" content="...">
<meta name="dossier-living-doc" content="../../<slug>.html">
<meta name="dossier-living-doc-id" content="doc:...">
<meta name="dossier-published-at" content="YYYY-MM-DD">
<meta name="dossier-summary" content="One-sentence summary for the index card.">
```

### 4. Write to disk

- `docs/dossier/<doc-id-slug>/<period>.html` (create the subfolder if missing).
- Where `<doc-id-slug>` is `docId` with the `doc:` prefix stripped.

### 5. Refresh the index

Read every `docs/dossier/*/*.html` file. Pull the `<meta name="dossier-*">` tags. Rebuild `docs/dossier/index.html` with one `<article class="piece">` entry per file, sorted by `dossier-published-at` descending. Preserve the existing header, dek, and intro.

### 6. Report

Report two things to the user:

1. The dossier path — relative, clickable in a terminal that supports it.
2. The word count of the body prose (not the HTML chrome). If under 800 or over 1,300, flag it.

Do not open the file in a browser unless the user asks. Do not create a git commit unless the user asks.

## What not to do

- Do not flatten the piece into bullet points. The one permitted list is the watchlist.
- Do not copy-paste the living doc's status badges or cards into the prose.
- Do not add "TL;DR" at the top — the dek already does that work.
- Do not address the reader ("you might wonder…"). Write about the subject, not to the reader.
- Do not use emojis.
- Do not end with a "what do you think?" question.
- Do not claim the protocol/ecosystem/subject is "revolutionary" or "disruptive." Show, don't adjective.
