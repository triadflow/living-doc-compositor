---
name: "living-doc-image-prompt"
description: "Turn a living doc into a polished image-generator prompt by reading its objective, success condition, typed sections, and current state. Use when a doc needs a visual explainer, engineering overview, or state snapshot."
---

# /living-doc-image-prompt

Write a high-quality image prompt from a living doc. Read the doc as a working system first, inspect the real work behind it, then turn that reading into a visual brief.

This skill is for prompt creation, not for silently generating the image. If the user also wants the image, hand the resulting prompt to the image generator after the prompt is agreed or clearly requested.

## Usage

```bash
/living-doc-image-prompt <path/to/doc.json>
/living-doc-image-prompt <path/to/doc.json> --mode engineering-overview
/living-doc-image-prompt <path/to/doc.json> --mode product-explainer
/living-doc-image-prompt <path/to/doc.json> --mode state-snapshot
```

If the user gives a rendered HTML path, resolve the sibling JSON first.

## What this skill does

It turns a living doc into one visual brief that communicates:

1. what the doc is trying to make true
2. what the current state of that objective is
3. what structure or tensions matter right now

The output should feel like it came from the document's real substrate and current work surface, not from a generic SaaS-image template.

## Execution

### 1. Resolve and read the doc

Load:

- `objective`
- `successCondition`
- `objectiveFacets`
- `periods`
- `updated`
- `sections[]` with:
  - `id`
  - `title`
  - `convergenceType`
  - `rationale`
  - `updated`
  - `data`
- root governance fields when present:
  - `coverage`
  - `invariants`
  - `metaFingerprint`

Also read `scripts/living-doc-registry.json` so the convergence types are interpreted correctly.

If a rendered HTML already exists and the user wants a product-like visual, read the HTML too so the prompt can reflect the actual document chrome rather than an invented UI.

### 2. Inspect the real work behind the doc

Do not treat the JSON as sufficient evidence of current state.

Read the grounded materials the doc points at. Use the fields actually present on the cards, for example:

- `codePaths`
- `artifactPaths`
- `ticketIds` via `gh issue view`
- `pullRequestUrls`
- `specRefIds`
- `notes` with URLs
- source docs, local files, adjacent rendered HTML, or cited public pages

Read enough to understand:

- what work exists underneath each important section
- what is actually shipped, blocked, pending, stale, contradicted, or still hypothetical
- where the document is crisp versus where it is aspirational

If the doc is time-sensitive and its state could have changed, verify against live sources rather than trusting stale prose.

Do not bulk-read everything. Read the materials that carry the current state.

### 3. Derive the real objective

Do not prompt from `objective` alone.

Resolve the real objective from both `objective` and `successCondition`:

- ask what reality the doc is trying to make legible, stable, ship-ready, or decision-ready
- prefer the finish line over the bookkeeping instrument
- if the doc says `track`, `watch`, `map`, or `monitor`, translate that into the concrete reader outcome

Write this as a short, concrete reading of the work:

`This doc exists to make <real work / system / decision surface> legible enough that <reader outcome>.`

The objective should stay close to the actual domain work. Do not reduce it to abstract brand language.

#### Older-doc fallback

Some older living docs do not carry `objective` or `successCondition`, or they carry them only weakly.

When that happens, derive the objective from:

- the title
- section titles
- convergence types used
- the highest-weight cards
- linked tickets, code paths, or cited materials

Ask:

- what work is this document organizing?
- what claim, operation, delivery surface, or editorial structure is it trying to make navigable?
- what would a competent operator use this document to decide, verify, or move forward?

Then write the objective from that reading.

Do not say the doc has no objective just because the field is blank.

### 4. Assess the current state by doing the real work

Read the doc as it stands now, not as an ideal template.

Build a detailed state reading from both the doc and the grounded materials.

Assess:

- status values across cards
- most recent period
- fresh vs stale sections
- open predictions, unresolved moves, active risks, blocked items
- position maps, indicator traces, ladders, or governance coverage when present
- live source material behind the most important cards
- whether the claimed state still matches code, tickets, cited sources, or rendered artifacts

Produce a work-surface reading, not a slogan.

Capture in detail:

- which sections are carrying the real operational weight
- which entities or workstreams are central right now
- which parts are stable, shipped, or trusted
- which parts are unresolved, drifting, blocked, or under construction
- what tension the reader is actually managing through this doc
- what current-state details must be visible in the image so it feels true to the work

Do not reduce the current state to 3-5 signals if the doc needs more structure than that.
Prefer a detailed operational reading over compression.

For older docs with sparse metadata, treat section payloads and notes as the primary state surface. In those docs:

- `status` plus `notes` often carry the real current state
- section sequencing often encodes the real work model
- decision records and proof ladders often contain the unresolved tension more clearly than any root field

Do not emit a numeric dashboard summary unless the doc itself is fundamentally numeric.

### 5. Choose the visual frame

Default mode is `engineering-overview`.

Use these modes:

- `engineering-overview`
  - system structure, flows, typed sections, current operational state
- `product-explainer`
  - artifact + tool + shareability, more polished hero treatment
- `state-snapshot`
  - current period, tensions, what is settled vs moving

If the user does not specify a mode, choose the one that best matches the ask and say which one you chose.

### 6. Map the doc to visual language

Translate doc structure into visible composition.

Use the actual convergence types and section roles:

- source-collection sections become input streams, evidence surfaces, feeds, or source clusters
- status/card-grid sections become structured tiles, columns, tracks, or grouped carriers
- edge-table sections become relationships, mappings, or dependency lattices
- governance sections become coverage wires, objective facets, invariants, or constraints
- map sections become axes, clusters, or relative positioning
- proof / prediction sections become ladders, pending rungs, resolution states, or confidence bands

Current-state cues should come from the doc:

- many `planned` / `open` / `blocked` states: show motion, incompleteness, or unresolved edges
- mostly `current` / `trusted` / `ground-truth`: show stability, crispness, and strong structure
- period tracker docs: show time horizon, latest period, drift, or momentum
- governance-heavy docs: show explicit rules, coverage, and what is being held together
- active implementation or operational docs: show the actual working pieces, bottlenecks, and handoffs rather than abstract icons
- mixed-state docs: show asymmetry, with some surfaces crisp and clearly central and others visibly provisional

Do not invent charts, metrics, or source systems that the doc does not imply.

### 7. Write the prompt

Output one polished prompt with this shape:

```text
Create a high-end [illustration / concept image / editorial systems visual] for <doc title>.

Core idea to communicate:
<1 paragraph on the real work this doc exists to make legible or controllable>

Current state to communicate:
<1 paragraph grounded in the actual current state: what is stable, what is active, what is blocked, what is still unresolved>

What the image must show:
- <artifact at center>
- <typed structure>
- <specific work surfaces from the document>
- <specific state cues grounded in the current work>

Composition:
- left: <inputs / source worlds / drivers>
- center: <living doc or system surface>
- right: <decision/output/share surface>
- beneath/around: <semantic or governance layer>

Semantic layer that must be visible:
- <entity/edge/scope or equivalent typed grammar from this doc>
- <how projection follows structure>

Current-state layer that must be visible:
- <live tensions, unresolved items, period state, status distribution, active work, or blocking surfaces>

Tone and style:
<editorial / technical / product-art direction>

If text appears in the image, keep it sparse and believable:
- <3-8 doc-specific labels>

Avoid:
- <anti-patterns that would flatten this doc into dashboard slop>

Output:
<what one good image should achieve>
```

Then add:

```text
Optional negative prompt:
<comma-separated anti-patterns>
```

### 8. Ground the prompt in the document

After the prompt, include a grounding block:

```md
## Grounding
- Objective: ...
- Real work inspected: ...
- Current state: ...
- Visual anchors: ...
```

`Real work inspected` should name the concrete materials or work surfaces you actually used:

- code paths
- tickets
- cited pages
- rendered artifacts
- key sections and cards

This is not part of the image prompt. It is there so the user can see why the prompt took this shape and whether the current-state reading is grounded.

## Guardrails

- Do not produce a generic dashboard prompt.
- Do not market the doc as a product hero if the real ask is a state snapshot.
- Do not ignore `successCondition` when the `objective` is vague.
- Do not infer current state from the doc alone when the doc points at stronger live evidence.
- Do not fail on older docs just because root metadata is sparse.
- Do not flatten typed sections into random rectangles.
- Do not invent source systems, teams, or workflows unsupported by the doc.
- Do not overpack the image with tiny illegible UI.
- Do not use empty AI clichés: brains, neon meshes, hologram swirls, floating code rain.
- Prefer one strong composition over a collage of every section.
- Do not replace real operational detail with abstract product-copy compression.

## Success test

A reader should be able to look at the prompt and see:

- what this doc is for
- what state it is currently in
- what actual work that state was derived from
- what structure carries that meaning
- why the resulting image would look specific to this doc rather than reusable for any software tool
