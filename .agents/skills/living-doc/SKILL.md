---
name: "living-doc"
description: "Connect the current session to relevant living docs, assess freshness, and update them as part of ongoing work."
---

# /living-doc

Connect the current session to the relevant living docs. Read them, show what's stale, and update as part of ongoing work.

## Usage

```
/living-doc                    # Show living docs for the current repo
/living-doc <path/to/doc.json> # Open a specific living doc
```

## What This Skill Does

This skill is the **bootstrap** — it connects an LLM session to the living doc system. The documents are self-describing; this skill just opens the door.

1. Find the relevant living docs
2. Show their current state — what's fresh, what's stale
3. Let the session update them as a natural part of working

## Execution

### 1. DISCOVER LIVING DOCS

If a specific path is given, read that file directly.

Otherwise, discover living docs for the current working directory:

```bash
# Check if the docs/ folder has universal-format JSON files
ls docs/*.json 2>/dev/null
```

Also check the living docs registry:
```
cat ~/.gtd/living-docs.json
```

Filter for docs matching the current repo.

### 2. READ AND ASSESS

For each discovered doc, read the JSON and assess:

- **Title and objective** — what is this doc driving toward?
- **Success condition** — when is it met?
- **Sections** — list each section with its convergence type
- **Freshness** — check `updated` timestamps at doc, section, and item level. Compare against recent git activity:
  ```bash
  git log --oneline --since="24 hours ago" -- .
  ```
- **Staleness** — flag sections where the timestamp is older than the most recent relevant commit
- **Meta-layer freshness** — if the doc carries `objectiveFacets`, check `metaFingerprint` against the current sections.

Present a summary:

```
## Living Docs for <repo>

### <Doc Title>
Objective: <objective>
Sections: <N> (<list with convergence types>)
Last updated: <timestamp> (<relative>)
Stale sections: <list or "none">
Governance layer: <present | absent>
Meta fingerprint: <fresh | stale: reason | missing>
```

### 3. VERIFY META FRESHNESS BEFORE EDITING

If the doc carries governance data (`objectiveFacets`, `coverage`, `invariants`) and the session intends to edit the doc, run a freshness check before using any coverage edge for section targeting:

```bash
node -e "import('./scripts/meta-fingerprint.mjs').then(async m => {
  const fs=await import('node:fs');
  const doc=JSON.parse(await fs.promises.readFile('<path>','utf8'));
  console.log(JSON.stringify(m.checkFingerprint(doc.metaFingerprint, doc.sections), null, 2));
})"
```

**On mismatch:**

- Surface the staleness to the user. Example: *"Meta fingerprint on <doc.title> no longer matches its sections — coverage edges may point at the wrong cards."*
- Offer to run `/crystallize --refresh <path>`. If the session is non-interactive, run it automatically and note that it happened.
- **Do not trust `coverage` edges for deterministic section targeting until the fingerprint is current.** Fall back to prose re-derivation and explicitly note in your reasoning that you did so.

**On missing:** the doc has governance data but has never been crystallized. Offer `/crystallize <path>` before continuing.

**On fresh:** proceed normally. Coverage edges are trusted for targeting.

### 4. UPDATE DURING WORK

When working in the domain and you notice the living doc is stale or incomplete:

- Read the convergence type from the registry to know what entity types each section needs
- Read the `syncHints` for scope boundaries (repo, branch, Figma file, etc.)
- Find the actual entities from the codebase, tickets, or other sources
- Update the data arrays in the JSON
- Set `updated` to the current ISO timestamp (full precision, not just date)
- Re-render if the renderer is available:
  ```bash
  node scripts/render-living-doc.mjs <doc-path>
  ```

### 5. REPORT

After any updates, show what changed:

```
Updated <doc title>:
- <section>: added 2 items, updated 3 statuses
- <section>: no changes (fresh)
```

## Key Principles

1. **The document is the instruction.** Read the convergence types, sync hints, and objective. They tell you what to find and where to look.
2. **Don't force updates.** Only update sections relevant to the current work. A session fixing a bug doesn't need to sync the design alignment section.
3. **Full-precision timestamps.** Always write ISO timestamps with time, not just dates. Freshness matters at hour level.
4. **The registry is the vocabulary.** Look up convergence types in `scripts/living-doc-registry.json` to know what entity types each section expects.
5. **Render after updating.** If `render-living-doc.mjs` exists, re-render the HTML so the human-readable view stays in sync.
6. **Refresh the meta layer before trusting it.** If a doc has `objectiveFacets` but its fingerprint is stale, `coverage` is a liar — do not use it for section targeting until `/crystallize --refresh` runs.
