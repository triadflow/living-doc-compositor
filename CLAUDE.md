# Living Doc Compositor

A living doc is a subgraph view — a navigable projection of entities and their relationships. Higher-order abstractions compress the search space for both humans and LLMs.

## Architecture

Three fundamentals:
- **Entity** — has identity, has own properties (Figma page, ticket, code file, API endpoint)
- **Edge** — typed relationship between entities (implements, specifies, tests, deploys)
- **Scope** — named convergence of entities. No own properties — borrows them from sources

Convergence types define which entity types converge. The combination is the type. The visual projection follows automatically.

## Two kinds of convergence type

Every entry in the registry declares `kind: "act" | "surface"`. This is the first disambiguator when proposing a new type — it answers a different question than `category` does.

- **Act type** — cards record a kind of *thinking-action* the user (or agent) performs. The work is in producing each card. Examples: `decision-record`, `attempt-log`, `proof-ladder`, `investigation-findings`, `transcript-argument-frame`.
- **Surface type** — cards reflect things that exist independently of this section: capabilities with status, items in a lifecycle, positions held by external actors. The work is in surfacing them, not authoring them. Examples: `capability-surface`, `status-snapshot`, `expert-stance-track`, `competitor-stance-track`, `code-anchor`.

The disambiguating test: if you stopped maintaining this section, would the underlying state still change in the world? If yes, it is a surface. If the recorded thinking would simply stop accumulating, it is an act.

Borderline cases worth knowing:
- **`attempt-log`** is act, but **`strategic-move-log`** is surface — both are "logs", but attempt-log records *our* actions while strategic-move-log tracks *external* actors' moves.
- **`design-implementation-alignment`** is surface — the alignment exists in the world; the section reveals it but does not author it.
- **`experiment-evidence-surface`** is named "surface" but is **act** — each card represents an experiment performed and the evidence it produced.
- **`maintainer-stance`** is surface — stances live in stakeholders; the section tracks them.

Do not collapse this distinction back into `category`. Categories group by *domain* (governance, verification, content, monitoring, …); kinds group by *what kind of thing the section holds*. A `verification` category has both kinds inside it.

## Tiny experiments vs attempts vs evidence cohorts

Three act types in the verification category sit close together and should not be collapsed:

- **`tiny-experiment`** — a single pact. Carries a hypothesis, a window (start → end), the signals being watched, and a closure that picks one of three legitimate moves: persist, pause, or pivot. Inspired by Anne-Laure Le Cunff's *Tiny Experiments* (2025). The closure is what makes it an experiment.
- **`attempt-log`** — actions taken against a problem and what each one proved. No hypothesis required, no window. Use for tried fixes, probes, and shipped workarounds. An experiment may *contain* attempts in its evidence; the experiment is the frame, the attempt is the action.
- **`experiment-evidence-surface`** — a cohort view across many experiments where evidence accumulates from multiple lanes converging on one question. The horizontal section a reader scans to see what's been learned across many tries.

A test for which to use: if you can name the hypothesis and the window, it's a `tiny-experiment`. If you only know the action and its outcome, it's an `attempt-log`. If you have many of either rolling up to one bigger question, it's an `experiment-evidence-surface`.

## Design system types — surface, taste, alignment, derivation

Four convergence types in the `design-system` category sit close together and should not be collapsed:

- **`design-system-surface`** is **surface** — tokens, components, motifs as pointers. The primitives live in Figma / tokens.json / a code repo; the section reveals them. If the section stopped being maintained, the primitives would still change in their canonical sources.
- **`taste-signature`** is **surface** — recurring traits across the designer's prior systems. Taste lives in the prior work; the section reveals it. Recurring requires at least two prior-system pointers — one is anecdotal.
- **`brief-to-system-alignment`** is **act** — each card records one paired thinking-action: a brief constraint on one side, a design response on the other. Without maintenance, the recorded alignments simply stop accumulating.
- **`design-system-derivation`** is **act** — each card is a derivation move (kept / swapped / inverted / scaled / dropped) from a prior system into the new one, with rationale. Without maintenance, the derivation chain disappears even though the new system still exists.

Borderline tests:
- `design-system-surface` vs `design-code-spec-flow` — flow is one *product surface* viewed through design / code / spec / interaction. Surface is *the design system itself*.
- `taste-signature` vs `expert-stance-track` / `competitor-stance-track` — those track external actors. Taste-signature is self-stance.
- `brief-to-system-alignment` vs `decision-record` — decision-record is one decision with rationale. Alignment cards are paired (constraint ↔ response) and serial; they map a brief end-to-end.
- `design-system-derivation` vs `attempt-log` — attempt-log is "what I tried and what it proved". Derivation is "what I carried from prior systems and why" — every card has a `priorSystemRef`.
- `design-system-derivation` vs `brief-to-system-alignment` — alignment maps brief → response. Derivation maps prior system → new system. Both can co-exist in one engagement.

Pointer-first principle: cards in `design-system-surface` reference where the primitive lives (Figma variable, tokens.json key, repo path) — they never own the value. This is the same entity/scope distinction applied to design system primitives.

## Key Files

| File | Purpose |
|------|---------|
| `scripts/living-doc-registry.json` | Convergence type + entity type + status set definitions |
| `scripts/living-doc-i18n.json` | i18n strings (EN, NL, ID) |
| `scripts/render-living-doc.mjs` | Universal renderer: JSON in, HTML out |
| `docs/living-doc-compositor.html` | Standalone compositor GUI |
| `docs/living-doc-empty.json` | Empty doc template |

## Usage

```bash
# Render a living doc
node scripts/render-living-doc.mjs docs/my-doc.json

# Serve docs locally (enables library discovery)
cd docs && python3 -m http.server 8111
```

## Skills

Three skills in `.claude/skills/`:

- `/living-doc` — bootstrap skill. Connects a session to the relevant living docs, shows freshness, updates stale sections during work.
- `/convergence-advisor` — thinking partner. Helps discover convergence types through dialog, shows existing types as examples, writes registry entries.
- `/tiny-experiment` — pact runner. Bootstraps a pacts living doc from the template, adds new experiments (hypothesis, window, signals), and closes them with persist/pause/pivot + rationale.

## Constraints

- The document is the instruction. No orchestration layer needed.
- The registry is the vocabulary. New convergence types = new JSON entries, no code changes.
- The renderer is universal. One script, any document.
- Properties are always borrowed. A scope's status derives from its sources.
- Views are fixed per entity type. No layout configuration.
- Timestamps at full ISO precision (not just dates). Freshness matters at hour level.

## Adding a New Convergence Type

1. Add an entry to `scripts/living-doc-registry.json` under `convergenceTypes` — must declare `kind: "act" | "surface"` (see "Two kinds" above)
2. If needed, add a new status set under `statusSets`
3. If needed, add a new entity type under `entityTypes`
4. Run `node scripts/sync-compositor-embeds.mjs` to update the embedded registry inside `docs/living-doc-compositor.html`
5. No renderer changes — it reads from the registry

## Writing style

Banned words — do not use in prose, tickets, or rendered copy:
- **load-bearing** — overused filler. Say what the thing actually does: "required", "central to the decision", "the discipline that holds the dossier together". Pick one. If none fit, the sentence probably doesn't need the emphasis.

## Rendered Output

Every rendered HTML file:
- Is a self-contained living doc with sidebar navigation
- Has the full compositor embedded (opens via pencil icon in sidebar)
- Includes i18n (EN/NL/ID), guide, CTA nudge, export, share
- Carries a version stamp from the git hash
- Works offline as a standalone file
