---
name: "relationship-map-alignment"
description: "Repair or block a living doc when relationship-map diagrams, acceptance criteria, and the objective are out of alignment. Use when Mermaid-backed relationship maps may overclaim, drift from criteria, omit objective-critical paths, or imply process/proof behavior not supported by the living doc."
---

# relationship-map-alignment

Use this when a living doc has `relationship-map` sections or Mermaid-backed maps and the question is whether those maps honestly represent the objective and acceptance criteria.

## Law

A diagram is a semantic projection, not proof. It must be anchored to the objective and acceptance criteria it helps inspect.

## Inputs

- Living doc JSON path.
- Objective and success condition.
- Acceptance criteria section/cards.
- `relationship-map` sections and their cards:
  - `claim`
  - `semanticRole`
  - `validationQuestion`
  - `driftRisk`
  - `diagrams`
  - `sectionIds`, `criterionIds`, `invariantIds`, `ticketIds`, `codeRefs`
- Governance fields when present: `objectiveFacets`, `coverage`, `invariants`, `metaFingerprint`.
- Related proof artifacts, issue state, or source files when a map points at them.

## Workflow

1. Read the living doc and identify every `relationship-map` card.
2. Check governance freshness before trusting coverage:
   ```bash
   node -e "import('./scripts/meta-fingerprint.mjs').then(async m => { const fs=await import('node:fs'); const doc=JSON.parse(await fs.promises.readFile('<doc>','utf8')); console.log(JSON.stringify(m.checkFingerprint(doc.metaFingerprint, doc.sections), null, 2)); })"
   ```
3. Build three ledgers:
   - Objective terms: accountable phrases from objective and success condition.
   - Acceptance criteria: criteria that make those terms testable.
   - Diagram claims: relationship-map claims, implied nodes/edges, anchors, and validation questions.
4. For each diagram/card, classify the relationship:
   - `aligned`: claim, diagram, anchors, and criteria agree.
   - `missing-acceptance-anchor`: diagram implies required behavior but no criterion tests it.
   - `missing-objective-anchor`: diagram describes a structure that is not tied to objective or success condition.
   - `overclaim`: diagram or claim implies completion/proof/control that criteria do not support.
   - `under-specified`: diagram is useful but lacks anchors, validation question, or drift risk.
   - `stale`: map contradicts current criteria, objective, issue state, code, or proof artifacts.
   - `blocked`: source evidence is required before the map can be judged.
5. Repair the living doc only when the correct repair is clear:
   - Tighten `claim`, `semanticRole`, `validationQuestion`, or `driftRisk`.
   - Add or correct `criterionIds`, `invariantIds`, `sectionIds`, tickets, or code refs.
   - Update Mermaid only when the relationship itself is wrong or stale.
   - Add a regression boundary if the map exposes a no-longer-legitimate shortcut.
6. Do not silently broaden the objective. If a diagram reveals missing acceptance criteria for the existing objective, add or propose an acceptance criterion. If the diagram points beyond the objective, mark that as out-of-scope, blocked, or follow-up.
7. Render the living doc after edits:
   ```bash
   node scripts/render-living-doc.mjs <doc>
   ```
8. If files changed, create a focused commit before finishing the run.

## Output

Return one of these states:

- `aligned`: diagrams, acceptance criteria, and objective agree.
- `repaired`: living doc maps or anchors were corrected.
- `criteria-gap`: diagram exposes missing acceptance criteria for the current objective.
- `objective-gap`: diagram points beyond or away from the objective.
- `stale-map`: relationship map is obsolete and must be updated or removed.
- `blocked`: direct evidence is missing.

Include:

- Relationship ledger summary.
- Changed cards/criteria, if any.
- Render or validation commands run.
- Next recommended skill, usually `objective-execution-readiness` after repair or `objective-acceptance-shaping` when a criteria gap exists.

## Guardrails

- Do not treat rendered SVG output as proof.
- Do not let a diagram add unapproved scope.
- Do not let Mermaid syntax replace semantic anchors.
- Do not delete a map just because it creates pressure; first decide whether the pressure exposes a real criteria or objective gap.

## Commit Rule

When this skill changes the living doc, rendered HTML, tickets, skills, or source artifacts, commit those changes in the same run. Use a detailed commit body that records:

- maps inspected
- alignment classifications
- repairs made or blocked
- acceptance/objective terms affected
- validation or render commands run
