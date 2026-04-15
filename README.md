# Living Doc Compositor

**Squeeze the intel out of that token.**

A living doc brings scattered work — designs, code, tickets, workflows, decisions — into one structured page that stays connected to the sources. The compositor is the tool that lets you define, render, and share those documents.

## What it does

- **Compose** living doc structures from convergence types — typed combinations of source entities
- **Render** any living doc with one universal command
- **Share** a single HTML file that is both the document and the tool
- **Grow** the structure over time as new patterns emerge from work

Every rendered document has the full compositor embedded. Recipients see the content, click the pencil icon, and can explore the tool, modify the structure, or create their own.

## Quick start

```bash
# Render a living doc
node scripts/render-living-doc.mjs docs/my-doc.json

# Render the current registry overview
node scripts/render-registry-overview.mjs

# Serve the compositor with library discovery
cd docs && python3 -m http.server 8111
# Open http://localhost:8111/living-doc-compositor.html

# Or just open the compositor directly
open docs/living-doc-compositor.html
```

## How it works

Three fundamentals:

| | |
|---|---|
| **Entity** | Has identity, has own properties. A Figma page, a ticket, a code file, an API endpoint. |
| **Edge** | A typed relationship between entities. Implements, specifies, tests, deploys. |
| **Scope** | A named convergence of entities. No own properties — borrows them from its sources. |

A **convergence type** is a specific combination of source entity types. The combination *is* the type. The visual projection (card grid or edge table) follows automatically — there is no layout choice.

## Convergence types

Eight types ship with the registry:

| Type | Sources | Projection |
|------|---------|-----------|
| Design–Code–Spec Flow | Figma pages, code files, UX specs, interactions, tickets | Card grid |
| Component Status | Code paths, tickets | Card grid |
| Design–Implementation Alignment | Figma nodes ↔ code files, with status on the edge | Edge table |
| Deployment Verification | Pages, interactions, automation, APIs, tickets | Card grid |
| Mediated Operation | Workflows, inputs, tickets | Card grid |
| Stack-Depth Integration | Figma nodes, screens, hooks, services, contracts | Card grid |
| Behavior Fidelity | Figma nodes, code paths, expected vs actual behavior | Card grid |
| Decision Record | Tickets, status, notes | Edge table |

Adding a new type = one JSON entry in `scripts/living-doc-registry.json`. No code changes.

## Files

```
scripts/
  living-doc-registry.json    # Convergence types, entity types, status sets
  living-doc-i18n.json        # UI strings (EN, NL, ID)
  render-living-doc.mjs       # Universal renderer
  render-registry-overview.mjs # Registry-to-HTML overview generator

docs/
  living-doc-compositor.html  # Standalone compositor GUI
  living-doc-empty.json       # Empty document template
  living-doc-empty.html       # Empty rendered deliverable
  living-doc-registry-overview.html # Generated registry overview page
```

## Internationalization

The compositor and all rendered documents support English, Dutch, and Indonesian. Language auto-detects from the browser. Adding a language = adding a key to `scripts/living-doc-i18n.json`.

## Skills

Two skills for LLM-assisted workflows:

**`/living-doc`** — Connects a session to the relevant living docs. Shows what exists, what's stale, and updates sections as part of ongoing work. The bootstrap.

**`/convergence-advisor`** — Helps discover which convergence types fit a domain through dialog. Shows existing types as examples, identifies new patterns, writes registry entries. The thinking partner.

## Sharing

Two ways to share:

1. **With a document** — Render your living doc to HTML. The recipient sees the content and has the full compositor embedded.
2. **Without a document** — Click "Share tool" in the compositor header. Downloads a clean HTML with just the tool — no proprietary data.

Both produce a single self-contained HTML file. No server, no install, no dependencies.

## License

MIT. See [LICENSE](LICENSE).
