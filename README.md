# Living Doc Compositor

**Stop paying the hidden cost of fragmented work.**

Designs live in Figma. Code in the repo. Decisions in Slack. A living doc converges those sources into one structured page, still anchored to where they actually live. Complete, current, immediately usable. For humans and AI.

Landing: https://triadflow.github.io/living-doc-compositor/

## Get running in 60 seconds

```bash
git clone https://github.com/triadflow/living-doc-compositor
cd living-doc-compositor

# Render the empty template
node scripts/render-living-doc.mjs docs/living-doc-empty.json

# Open the compositor
open docs/living-doc-compositor.html
```

No install. No runtime dependencies. Node 18+ for the renderer, a browser for everything else. The optional test suite uses npm dev dependencies.

Every rendered doc is both a document and a tool: click the pencil icon to open the compositor inline.

## The model

Three concepts. That's the whole thing.

| | |
|---|---|
| **Entity** | Has identity, has own properties. A Figma page, a ticket, a code file. |
| **Edge** | A typed relationship. Implements, specifies, tests, deploys. |
| **Scope** | A named convergence of entities. No own properties. Borrows them from its sources. |

A **convergence type** is a specific combination of source entity types. The combination *is* the type. The visual projection (card grid or edge table) derives automatically.

## Make your own living doc

Copy a starter, edit the JSON, render.

```bash
cp docs/living-doc-template-starter-ship-feature.json docs/my-feature.json

# Edit title, scope, sources, status in your editor
# Then render:
node scripts/render-living-doc.mjs docs/my-feature.json

open docs/my-feature.html
```

Starters available:

| Starter | For |
|---|---|
| `living-doc-template-starter-ship-feature.json` | Shipping a feature end-to-end |
| `living-doc-template-starter-prove-claim.json` | Defending a single claim with evidence |
| `living-doc-template-starter-run-support-ops.json` | Running support and operations |
| `living-doc-template-starter-write-book.json` | Drafting long-form without losing chapter focus |

Full templates (more depth): `architect-manuscript`, `map-themes-storylines`, `operations-support`, `proof-canonicality`, `surface-delivery`, `monitoring-tracker`. All in `docs/`.

## Add a convergence type

One entry in `scripts/living-doc-registry.json`. No code changes, no renderer updates.

```json
{
  "convergenceTypes": {
    "my-new-type": {
      "name": "My New Type",
      "category": "delivery",
      "description": "What this type converges and when to use it.",
      "projection": "card-grid",
      "sources": [
        { "key": "codePaths", "entityType": "code-file", "label": "Code" },
        { "key": "ticketIds", "entityType": "ticket",    "label": "Tickets" }
      ],
      "statusFields": [
        { "key": "status", "statusSet": "delivery-status" }
      ]
    }
  }
}
```

The renderer reads this on every render. Re-render any doc and the new type is available.

See `docs/living-doc-registry-overview.html` (also live at the Pages URL) for the 26 convergence types, 19 entity types, and 15 status sets that ship with the registry.

## Use with AI

A living doc is a plain HTML file, so any agent (Claude Code, OpenAI Codex, Cursor, etc.) can read it. Two surfaces turn that into real workflow: session skills, and an in-compositor action palette.

### Session skills

Two Claude Code skills in `.claude/skills/`:

| Skill | Purpose |
|---|---|
| `/living-doc` | Connects a session to the relevant living doc. Shows what's stale, updates sections during work. |
| `/convergence-advisor` | Helps discover which type fits a new domain through dialog. Writes registry entries for you. |

The skills package turns the doc into a stable starting point for a session rather than rediscovery.

### Cmd+K palette on cards

In the flow-body view, select a card and press **Cmd+K** (or Ctrl+K) to open the AI-pass palette. Actions come from the registry — five general actions plus any type-specific actions declared under that section's convergence type. The chosen engine (`claude` or `codex`) proposes a diff in a sidebar; you review and apply.

This needs the local ai-pass server on `localhost:4322`:

```bash
node scripts/ai-pass-server.mjs
```

Requirements:

- `claude` and/or `codex` CLI on your `PATH` (the server auto-detects which engines are available)
- Server keeps running while you use the palette; stop it with Ctrl+C

If the palette shows "no engine available", the server isn't running or neither CLI is on `PATH`. See `docs/ai-actions-wiring.html` for how actions resolve from the registry per convergence type.

## Share a doc

One file. The recipient gets content and tool in the same artifact.

```bash
# Attach to email, drop into Slack, upload anywhere that serves HTML
cp docs/my-feature.html /path/to/destination/
```

No backend. No account. No install. Works offline.

To share just the tool with no proprietary data, click **Share tool** in the compositor header.

## Serve locally (optional)

Needed for library discovery (one doc finding its siblings). Open any file directly otherwise.

```bash
cd docs && python3 -m http.server 8111
# http://localhost:8111/living-doc-compositor.html
```

## Test the living-doc system

The deployment test suite has two layers: fast Node contract checks and Playwright browser E2E tests against a static server.

```bash
npm install
npx playwright install chromium

# Contract checks plus local browser E2E
npm test

# Contract checks only
npm run test:contract

# Local browser E2E only
npm run test:e2e

# Smoke-test the published GitHub Pages site
npm run test:deploy
```

The local suite uses deterministic fixtures under `tests/fixtures/` and does not require private `~/.gtd` data. It checks locale parity, registry contracts, renderer output, compositor boot, Guide localization, template/prompt behavior, load/export downloads, fixture library manifests, and embedded compositor behavior in rendered HTML.

## Project layout

```
scripts/
  living-doc-registry.json       # Convergence types, entity types, status sets
  living-doc-i18n.json           # UI strings (EN, NL, ID)
  render-living-doc.mjs          # Universal renderer
  render-registry-overview.mjs   # Registry-to-HTML overview generator

tests/
  contract/                      # Node checks for i18n, registry, renderer output
  e2e/                           # Playwright browser integration tests
  fixtures/                      # Deterministic living-doc test data

docs/
  index.html                              # Landing page
  living-doc-compositor.html              # Standalone compositor GUI
  living-doc-registry-overview.html       # Registry overview (generated)
  living-doc-empty.html / .json           # Empty template
  living-doc-template-starter-*.html/json # 4 starters
  living-doc-template-*.html / .json      # 5 full templates
  compositor-development-overview.html    # Active dev overview doc
  assets/landing/                         # Landing page screenshots
```

## Companion mobile app

`mobile/` contains a small Expo app (iOS + Android) that lists your living docs, opens them in-app, and receives push notifications from GitHub Actions. GitHub-mobile-style UX. See [mobile/README.md](mobile/README.md) for setup.

## Internationalization

English, Dutch, Indonesian ship by default. The compositor and all rendered docs auto-detect the browser language. Add a language by adding a key to `scripts/living-doc-i18n.json`. No code changes.

## License

MIT. See [LICENSE](LICENSE). Free to use, modify, and share.
