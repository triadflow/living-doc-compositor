---
name: living-doc-card-status-check
description: Check and repair living-doc card status drift against each section's registered convergence type status sets. Use when editing living doc cards, before accepting status changes, after inference-generated doc updates, or when a card/status label looks invented or inconsistent.
---

# Living Doc Card Status Check

Use this skill whenever a living doc card status may have drifted from the registered convergence type contract.

## Rule

Card statuses are not free text. A section's `convergenceType` defines which status fields exist and which registered `statusSet` values are allowed.

Do not add or accept invented statuses because they sound useful. Either:

- map the card to an existing registered status value with evidence, or
- leave the checker finding unresolved and update the convergence type/status set through an explicit type-design change.

## Workflow

1. Run the checker on the living doc JSON, not the rendered HTML.

   ```bash
   node /Users/rene/projects/living-doc-compositor/scripts/check-card-statuses.mjs <living-doc.json>
   ```

2. If the checker reports `normalizable`, use the conservative fixer.

   ```bash
   node /Users/rene/projects/living-doc-compositor/scripts/check-card-statuses.mjs <living-doc.json> --fix
   ```

   This only fixes obvious casing/spacing/separator drift, such as `Current` to `current`.

3. If the checker reports `invalid`, do not guess.

   - Read the convergence type status field and status set from the checker output.
   - Choose an existing allowed value only when it genuinely means the same thing.
   - If no allowed value fits, create or update a convergence type/status-set design ticket before changing the registry.

4. Re-run the checker.

   ```bash
   node /Users/rene/projects/living-doc-compositor/scripts/check-card-statuses.mjs <living-doc.json>
   ```

5. Render only after the status checker is clean. The renderer enforces this and exits without writing HTML when card statuses diverge.

   ```bash
   node /Users/rene/projects/living-doc-compositor/scripts/render-living-doc.mjs <living-doc.json>
   ```

If rendering fails with `Render blocked`, fix the living-doc JSON first. Do not bypass the renderer or hand-edit generated HTML.

## Targeted Checks

Use these when reviewing one section or card:

```bash
node /Users/rene/projects/living-doc-compositor/scripts/check-card-statuses.mjs <living-doc.json> --section <section-id>
node /Users/rene/projects/living-doc-compositor/scripts/check-card-statuses.mjs <living-doc.json> --section <section-id> --card <card-id>
```

Use JSON output when another script or dashboard needs to consume findings:

```bash
node /Users/rene/projects/living-doc-compositor/scripts/check-card-statuses.mjs <living-doc.json> --json
```

## Guardrails

- Do not update rendered HTML by hand.
- Do not add a new status value just to silence a finding.
- Do not treat a status as valid because it appears in one card.
- Do not use `--fix` as semantic repair. It is only spelling/case/separator normalization against existing allowed values.
- If changing a convergence type or status set is necessary, update the code-defined type/registry source, regenerate registry artifacts, run tests, and then re-check the living doc.
