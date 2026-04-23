---
name: "crystallize"
description: "Crystallize the governance layer of a living doc by deriving objective facets, coverage edges, invariants, section rationale, and a meta fingerprint from the document's content."
---

# /crystallize

Crystallize the governance layer of a living doc. Derive `objectiveFacets`, `coverage` edges, `invariants`, and per-section `rationale` from the doc's content, then stamp a `metaFingerprint`. Second-pass refinement — not an authoring gate.

## Usage

```
/crystallize                             # Interactive, picks the most relevant doc
/crystallize <path/to/doc.json>          # Crystallize a specific doc
/crystallize <path> --refresh            # Idempotent re-run, preserves author-edited meta
/crystallize <path> --dry-run            # Print proposals without writing
```

## Background

- Proposal: `docs/living-doc-meta-layer-proposal.html` (what and why)
- Mechanics: `docs/living-doc-coherence-pass-skill.html` (lifecycle, freshness, gains)
- Schema reference: `docs/living-doc-empty.json` (opt-in governance fields)
- Registry: `scripts/living-doc-registry.json` (governance category, `coherence-map` type)
- Fingerprint helper: `scripts/meta-fingerprint.mjs`

## What This Skill Does

Moves the reasoning that otherwise happens silently on every LLM pass into structured data inside the document. Run it after a doc's shape has stabilized, not while sections are still being discovered.

## Execution

### 1. READ THE DOC

Load the JSON. Read `objective`, `successCondition`, every `section.id`, `section.title`, `section.convergenceType`, and every card's `id` / `name` / `status` / references.

If there is no `objective`, stop and tell the user the doc is too early for crystallization.

### 2. PROPOSE `objectiveFacets`

Decompose the free-form `objective` sentence into typed facets. Treat enumerated nouns in the objective ("UI fidelity, repo connection, push runtime") as strong candidates. Cross-reference section titles and card ids — if a section is called "Verification Plan" and the objective mentions "verified end-to-end," that is one facet.

Shape:

```json
{ "id": "<slug>", "name": "<short-title>", "description": "<one-sentence>" }
```

- Ids are kebab-case, derived from `name`.
- Prefer ~5–10 facets. If you find fewer than 3 or more than 15, the objective is probably under-specified or over-specified; surface that observation.

### 3. PROPOSE `coverage` EDGES

Scan section cards. For each facet, emit tuples:

```json
{ "facetId": "<facet-id>", "sectionId": "<section-id>", "cardId": "<card-id>" }
```

- A facet can (and often should) be carried by more than one section.
- Only emit an edge when the card's content clearly relates to the facet — verification gates typically map to facets as proof, capabilities map as implementation, decisions map as settled scope.
- If a facet has no carrier, do **not** fabricate one. Flag it as orphan for the user.

### 4. DETECT `invariants`

Observe patterns the doc already follows. Examples:

- Every card in `capability-surface` has at least one `codePaths` entry → `{ "capability-needs-code-path", appliesTo: ["<that-section-id>"] }`.
- Every `verification-surface` card is referenced by a ticket → `{ "verification-has-ticket", appliesTo: ["<section>"] }`.
- Decisions never appear inside `verification-surface` in this doc → `{ "decisions-migrate-out-of-verification", appliesTo: ["<verification-id>", "<decisions-id>"] }`.

Do not invent contracts the doc does not already follow. Surface only observed regularities. A doc may produce zero invariants; that is fine.

Shape:

```json
{
  "id": "<slug>",
  "name": "<short-title>",
  "statement": "<one-sentence rule>",
  "appliesTo": ["<section-id>", "..."] | ["*"]
}
```

### 5. PROPOSE PER-SECTION `rationale`

For each section, write one sentence that explains why the chosen `convergenceType` is right for this section in this doc's context. Derive from:

- The convergence type's `structuralContract` in the registry
- What the section actually contains

Do not restate the type's generic description. Say why *this* data wanted *this* shape.

Attach as `section.rationale`.

### 6. WRITE AND CONFIRM

**Default mode (interactive):**

Show the user a summary:

```
Proposed crystallization for <doc.title>:

Objective facets (<N>):
  - ui-fidelity       UI fidelity
  - repo-connect      Repo connection
  ...

Coverage (<N> edges):
  ui-fidelity       -> mobile-capabilities/auth-sign-in
  ui-fidelity       -> verification-plan/pixel-match
  ...

Invariants (<N>):
  - capability-needs-code-path applies to [mobile-capabilities]
  ...

Section rationale updates: <N> sections

Orphaned facets: <list or "none">
Dropped / drifted coverage: <list or "none">
```

Ask the user to accept, reject, or edit.

On accept, write the fields into the JSON doc-root in this order:

```
objective, objectiveFacets, coverage, invariants, metaFingerprint, sections
```

and attach `rationale` per section.

**--refresh mode:**

- Use the doc's existing `objectiveFacets`, `invariants`, and any author-edited `section.rationale` as priors.
- Recompute `coverage` from current sections.
- Preserve existing facet ids and invariant ids unless the user explicitly removes them.
- If nothing changed, exit as a no-op and report "meta is current."

**--dry-run mode:**

- Print the proposals.
- Do not modify any file.
- Report what would change.

### 7. STAMP THE FINGERPRINT

After writing governance fields, compute the fingerprint from the current sections and write `metaFingerprint` to the doc root:

```js
import { computeSectionFingerprint } from './scripts/meta-fingerprint.mjs';
const fingerprint = computeSectionFingerprint(doc.sections);
doc.metaFingerprint = fingerprint;
```

or equivalently via a one-liner:

```bash
node -e "import('./scripts/meta-fingerprint.mjs').then(async m => { const fs=await import('node:fs'); const doc=JSON.parse(await fs.promises.readFile('<path>','utf8')); console.log(m.computeSectionFingerprint(doc.sections)); })"
```

Write the result to `metaFingerprint` in the doc.

### 8. RE-RENDER

```bash
node scripts/render-living-doc.mjs <doc-path>
```

The coherence-map section (if the doc has one) will pick up the derived items automatically. The freshness banner should disappear.

## Reporting

After a successful crystallization, report:

```
Crystallized <doc.title>:
- <N> facets proposed
- <N> coverage edges
- <N> invariants
- <N> section rationales
- orphaned facets: <list or none>
- fingerprint: <sha256:prefix...>
```

## Key Principles

1. **Meta is derived, not invented.** Every facet, edge, invariant, and rationale must be traceable to something already in the doc.
2. **Preserve author intent on refresh.** Explicit edits to rationale, invariants, or facet descriptions survive re-crystallization unless the structure forces a change.
3. **Surface orphans, do not paper over them.** An orphan facet is a signal — either the objective has a gap or the sections have a gap. Either way, show it.
4. **Stamp the fingerprint last.** It pins the meta to the exact sections that were inspected.
5. **Crystallize when the shape is stable.** If the user is still shaping the doc, say so and wait.
