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
- **Output:** `docs/dossier/<doc-id-slug>/<period>.html` — one HTML file using the shared design system (`assets/colors_and_type.css` + `assets/dossier.css` + `assets/dossier.js`). Plus a refreshed `docs/dossier/index.html`.
- **Length:** 800–1,300 words of prose. Not a summary — a short essay with a thesis.
- **Publish model:** auto-publish. Git is the safety net — if the piece is wrong, revert. No `draft/` folder, no editorial gate.

## Voice

Per the project's standing editorial notes:

1. **Cross-domain audience.** The reader is a researcher, operator, analyst, or editor who works at the seam of knowledge and execution — not an engineer embedded in the specific domain. Avoid jargon without translation. No acronym salad. If a primitive needs a name, give it the name and one clear sentence of what it does.
2. **Pretend a large audience is reading.** The actual traffic is small. The quality bar is as if it were large. No throwaway phrases, no draft-voice, no "I think" hedges, no ending with "thoughts?"
3. **Thesis first.** The opening paragraph must carry the one non-obvious thing the reader would take away. If the piece could be replaced by its lede without loss, rewrite until it can't be.
4. **Editorial, not promotional.** The doc's contents are evidence. The piece is a claim made from that evidence. Quote the doc's own pull-quotes where they are sharp; otherwise write original prose.

## Structure

Every dossier piece uses the same template spine. Keep the rhythm predictable so readers can scan and decide whether to read.

1. **Top bar** — `← All dossiers` back-link, logo, top-right meta (date · read time). Sticky on scroll, with a thin progress bar above it.
2. **Masthead** — eyebrow (`Monitoring · <Topic>`), headline, dek (italic-emphasis on the hook), meta row (author · date · read time · tags).
3. **TL;DR card** — two short paragraphs. First carries the non-obvious observation. Second carries the mechanism or stake. One `<em>` per paragraph, max.
4. **Prose body** — 3 to 5 `<h2>` sections. Each section resolves one claim. Pull from the doc's `moves`, `indicators`, `primitives`, and `period-notes` sections — but prose them, do not list them.
5. **Margin notes** (the distinguishing feature) — 5 to 9 per piece. Each note lives twice: once as a `<span class="fn-popover">` nested inside a `.fn-ref` superscript anchor in prose, and once as a `.note` in the `#rail` aside at the end of the body. Use notes for citations, caveats, and sharp details that would otherwise bloat the prose. Notes should read well on their own — not just "see source X" stubs.
6. **Pull quote** — one `<blockquote>`. Either from the doc's own citation feed or an on-record statement from the period. Cited with a margin note.
7. **Punchline card** — one `<div class="punchline">` — dark-bg single line, the thesis at its tightest.
8. **Watchlist** — `<h2>What to watch in <next period></h2>` followed by a numbered `<ol>` of 3 to 5 items, pulled from the period note's "focus for next period" field.
9. **Endnotes section** (`<section class="endnotes">`) — always shown at the bottom, mirroring the margin notes in the same order. Each `<li>` carries `id="fnN"` matching its `data-fn` number so the in-prose superscript anchor (`href="#fnN"`) jumps to it. The active target endnote highlights with an accent-tint wash via `:target`.
10. **Article end** — signoff (avatar + byline + living-doc link wrapped in `<em>`). Related dossiers grid (2-card).
11. **Rail aside** (`<aside class="rail">`) — the margin notes, one `<div class="note">` per footnote, ordered.

## Execution flow

### 1. Resolve the input

Accept either a file path (`docs/foo.json`) or a doc id (`doc:foo`). If only a doc is given with no period, use the most recent entry in `periods[]` whose window's end date is in the past or equal to today; if none have closed, use the current open period but mark the piece clearly as "period in progress."

### 2. Read the living doc

Load the JSON. Extract:
- `title`, `subtitle`, `docId`, `scope`
- The target period from `periods[]`
- All sections with `lastUpdatedInPeriod === <period>` — these are the cards that moved this period
- The period note from the `period-notes` section for that period
- The citation feed — sources added this period
- Any `callouts` on the doc root — they often carry the author's voice the piece should honour

### 3. Plan the margin notes before drafting the prose

The notes are load-bearing. Identify 5 to 9 specific places where a citation, a methodology caveat, a piece of structural context, or a sharp parenthetical would add value without bloating the main prose. Typical patterns:

- A specific number → note with the methodology and source
- A named study or paper → note with working-paper number, venue, date
- A contested framing → note with the disagreement it acknowledges
- A quoted person → note with the on-record context (where, when, in what forum)
- An acronym the reader might not know → note expanding it once

Avoid filler notes ("see appendix"). Every note should stand on its own as a sentence or two that a reader in hover or endnote mode will find informative.

### 4. Draft against the template

Use the existing pieces in `docs/dossier/<slug>/2026-H1.html` as reference implementations. Copy the file skeleton exactly — head meta tags, the two stylesheet links, the progress bar, the top bar, the article grid with body + rail, the article-end / related sections, the rail aside at the bottom. Only the content blocks change per piece.

Preserve these `<meta>` tags for the index builder:

```html
<meta name="dossier-title" content="...">
<meta name="dossier-period" content="...">
<meta name="dossier-living-doc" content="https://triadflow.github.io/living-doc-compositor/<slug>.html">
<meta name="dossier-living-doc-id" content="doc:...">
<meta name="dossier-published-at" content="YYYY-MM-DD">
<meta name="dossier-summary" content="One-sentence summary for the index card.">
```

**Link discipline.** Every link to a living doc, to an external source, or to another dossier piece should be absolute. The piece is meant to travel. The only permitted relative links are the three that travel as one bundle with the piece: `../index.html` (back to dossier index), `../<sibling-slug>/<period>.html` (related dossier card), and the two `../assets/*.css` / `../assets/dossier.js` stylesheets.

**Footnote wiring.** Each `<a class="fn-ref" href="#fnN" data-fn="N">` in prose has a matching `<div class="note" data-fn="N">` in the rail *and* a matching `<li id="fnN">` at position N in `<ol>` inside `<section class="endnotes">`. All three must stay in sync. The `id="fnN"` on each endnote is what makes the superscript anchor jump to the bottom — if you omit it the click silently fails.

### 5. Write to disk

- `docs/dossier/<doc-id-slug>/<period>.html` (create the subfolder if missing).
- Where `<doc-id-slug>` is `docId` with the `doc:` prefix stripped.
- Read-time in minutes = `round(body-word-count / 200)`, matching the top-bar meta and the masthead meta-row and the index card.

### 6. Refresh the index

Add a new entry to the `DOSSIERS` array in `docs/dossier/index.html`. The entry object shape:

```js
{
  slug: "<doc-id-slug>-<period>",
  cat: "Monitoring · <Topic>",
  tag: "monitoring",
  title: "<headline ending in period>",
  dek: "<one sentence from the TL;DR, stripped of em markup>",
  date: "Mmm DD, YYYY",
  year: "YYYY",
  read: "N min",
  livingDoc: "<absolute GH Pages URL>",
  href: "<doc-id-slug>/<period>.html"
}
```

Sort the array so newest `date` is first. Keep entries for all previously published pieces.

The filter chips are derived automatically from the `tag` field on each DOSSIERS entry — no manual chip authoring needed. A chip only appears when there is at least one piece behind it; the entire filter row hides when only one category is present. Display labels for tags live in `TAG_LABELS` at the top of the script (extend it if a tag's label needs capitalisation other than plain title case).

### 7. Report

Report four things to the user:

1. The dossier path — relative, clickable in a terminal that supports it.
2. The GH Pages URL.
3. The word count of the body prose (not the HTML chrome, not the notes). If under 800 or over 1,300, flag it.
4. The count of margin notes. If fewer than 5 or more than 9, flag it.

Do not open the file in a browser unless the user asks. Commit + push only if the user explicitly asked ("publish", "ship", "push", "commit").

## What not to do

- Do not flatten the piece into bullet points. The two permitted lists are the watchlist and the endnotes (the latter is for layout-variant fallback, not prose shape).
- Do not copy-paste the living doc's status badges, indicator cards, or move cards verbatim into the prose.
- Do not add a "TL;DR" heading above the card — the `.tldr .label` already handles it.
- Do not address the reader ("you might wonder…"). Write about the subject, not to the reader.
- Do not use emojis.
- Do not end with a "what do you think?" question.
- Do not claim the protocol/ecosystem/subject is "revolutionary" or "disruptive." Show, don't adjective.
- Do not leave stub notes ("See source." "Link in appendix."). Every margin note must carry its own small fact.
- Do not break the fn-ref / rail-note / endnote three-way mirror. If you add a note in prose, add it to both the rail and the endnotes; if you remove a note, remove it from all three.
