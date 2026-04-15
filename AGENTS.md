# Living Doc Compositor — Agent Instructions

## What This Repo Is

A tool for composing, rendering, and sharing living documents. A living doc is a structured view that brings together entities from different systems (Figma, GitHub, code, APIs) into one navigable page.

## How to Work With It

### When asked to render a document
```bash
node scripts/render-living-doc.mjs <path-to-doc.json>
```
This produces a self-contained HTML file with the compositor embedded.

### When asked to render a registry overview
```bash
node scripts/render-registry-overview.mjs
```
This produces `docs/living-doc-registry-overview.html`, a self-contained HTML overview of the current registry types.

### When asked to find or re-render an existing living doc
Check `~/.gtd/living-docs.json` first. This is the catalog of known living docs across repos, and entries include the owning repo, the rendered HTML path, and the sync skill.

If a catalog entry points to an HTML file like `/path/to/doc.html`, the source JSON is usually the sibling `/path/to/doc.json`. Render that JSON with this repo's renderer:
```bash
node scripts/render-living-doc.mjs /absolute/path/to/doc.json
```

Do not assume every living doc lives in this repo. The registry defines document types; the catalog in `~/.gtd/living-docs.json` tells you where actual documents live.

### When asked to add a convergence type
Add an entry to `scripts/living-doc-registry.json` under `convergenceTypes`. Define: name, icon (SVG path), projection (card-grid or edge-table), sources (entity types), statusFields, and promptGuidance with operatingThesis, keepDistinct, inspect, update, and avoid. Optionally define textFields/detailsFields. No code changes needed.

### When asked to add a language
Add a new locale key to `scripts/living-doc-i18n.json` with all the same keys as the `en` locale. The compositor and rendered docs pick it up automatically.

### When asked to modify the compositor GUI
Edit `docs/living-doc-compositor.html`. This is a single self-contained HTML file. The same file is embedded in every rendered living doc via srcdoc iframe. Changes here propagate to all newly rendered docs.

### When asked to create a living doc for a domain
1. Create a JSON file following the universal format (see `docs/living-doc-empty.json` for the skeleton)
2. Add `sections` with `convergenceType` references to types in the registry
3. Populate `data` arrays with the actual entities
4. Render with `node scripts/render-living-doc.mjs`

## Key Constraints

- Never simplify or rewrite content when moving it between files. Carry it exactly.
- The registry is the single source of truth for convergence types. Never hard-code type knowledge in the renderer or compositor.
- Every rendered HTML must be fully standalone — no external dependencies.
- Timestamps must be full ISO precision, not just dates.
- The compositor embedded in rendered docs must be the COMPLETE tool, not a reduced version.
