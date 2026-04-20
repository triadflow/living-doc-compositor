# Living Doc Compositor

A living doc is a subgraph view — a navigable projection of entities and their relationships. Higher-order abstractions compress the search space for both humans and LLMs.

## Architecture

Three fundamentals:
- **Entity** — has identity, has own properties (Figma page, ticket, code file, API endpoint)
- **Edge** — typed relationship between entities (implements, specifies, tests, deploys)
- **Scope** — named convergence of entities. No own properties — borrows them from sources

Convergence types define which entity types converge. The combination is the type. The visual projection follows automatically.

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

Two skills in `.claude/skills/`:

- `/living-doc` — bootstrap skill. Connects a session to the relevant living docs, shows freshness, updates stale sections during work.
- `/convergence-advisor` — thinking partner. Helps discover convergence types through dialog, shows existing types as examples, writes registry entries.

## Constraints

- The document is the instruction. No orchestration layer needed.
- The registry is the vocabulary. New convergence types = new JSON entries, no code changes.
- The renderer is universal. One script, any document.
- Properties are always borrowed. A scope's status derives from its sources.
- Views are fixed per entity type. No layout configuration.
- Timestamps at full ISO precision (not just dates). Freshness matters at hour level.

## Adding a New Convergence Type

1. Add an entry to `scripts/living-doc-registry.json` under `convergenceTypes`
2. If needed, add a new status set under `statusSets`
3. If needed, add a new entity type under `entityTypes`
4. No renderer changes, no compositor changes — they read from the registry

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
