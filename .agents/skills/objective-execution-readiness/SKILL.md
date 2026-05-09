---
name: "objective-execution-readiness"
description: "Check whether a fresh living doc is executable enough to drive objective work without drifting, premature closure, or substituting progress artifacts for objective satisfaction. Use before starting implementation from a new or newly repaired living doc."
---

# objective-execution-readiness

Use this when a living doc is fresh or newly created and the question is: can this document actually drive the work to its objective?

This is a pre-flight check, not a completion audit. It checks whether the doc has enough objective structure, closure gates, source-system spine, and proof discipline to avoid the drift described in `docs/living-doc-objective-execution-analysis.html`.

## Law

A fresh living doc is executable only when a later agent can tell exactly what remains false.

If the doc mostly narrates intent, lists useful work, or contains attractive artifacts without objective-bound closure gates, it is not ready to drive implementation.

## Inputs

- Living doc JSON path.
- Objective and success condition.
- Governance fields when present: `objectiveFacets`, `coverage`, `invariants`, `metaFingerprint`.
- Sections, section rationales, convergence types, and current cards.
- Acceptance criteria or equivalent closure gates.
- Issue/ticket spine when available.
- Proof ladder, attempt log, tooling surface, and code anchors when present.
- Generated semantic context when the doc matches a template.

## Workflow

1. Read the living doc.
2. If governance exists, check `metaFingerprint` before trusting coverage:
   ```bash
   node -e "import('./scripts/meta-fingerprint.mjs').then(async m => { const fs=await import('node:fs'); const doc=JSON.parse(await fs.promises.readFile('<doc>','utf8')); console.log(JSON.stringify(m.checkFingerprint(doc.metaFingerprint, doc.sections), null, 2)); })"
   ```
3. Keep the objective text visible. Do not summarize it away.
4. Decompose the objective and success condition into accountable terms.
5. Check whether each accountable term has an explicit closure gate:
   - acceptance criterion
   - proof requirement
   - acceptance test
   - linked issue or source-system output when implementation is needed
6. Check whether the doc distinguishes:
   - objective terms
   - implementation slices
   - proof artifacts
   - generated artifacts
   - compatibility or runtime preservation
   - drift-prevention checks
7. Check whether each section has a real role in reaching the objective:
   - section rationale names why the section exists
   - convergence type fits the role
   - cards are not generic backlog items unless the type is explicitly a backlog-like surface
8. For each convergence type used in the doc, prefer direct contract lookup when MCP is available:
   ```text
   living_doc_convergence_type_contract
   living_doc_semantic_context
   living_doc_relationship_gaps
   living_doc_stage_diagnostics
   living_doc_valid_stage_operations
   ```
9. Check whether the next action is obvious from the doc:
   - first ticket or implementation slice
   - proof expected for that slice
   - what must remain open after the slice
10. Identify false-closure risks:
   - green tests could be mistaken for objective closure
   - rendered page could be mistaken for source-system completion
   - closed issue could hide unresolved objective terms
   - generated artifact could prove machinery but not the objective
   - template-level work could satisfy only a downstream surface, not the ground-level objective

## Readiness Criteria

Return `executable` only when all are true:

- The objective wording is stable enough that it should not be narrowed during implementation.
- Accountable objective terms are represented as closure gates.
- Each closure gate names required proof and an acceptance test.
- Implementation work is mapped to objective terms, not just to convenient code slices.
- The living doc says what remains open after partial progress.
- Governance/fingerprint state is fresh or explicitly absent.
- Required source-system outputs are named.
- Validation commands or proof surfaces are identified.
- The next action is clear.

## Output

Return one of these states:

- `executable`: the doc can drive implementation now.
- `repair-first`: the objective is clear, but the doc needs added closure gates, rationale, issue spine, or proof surfaces before implementation.
- `too-vague`: the objective cannot yet produce accountable terms without more user input.
- `blocked`: a required source, issue, permission, or system surface is missing.
- `misframed`: the doc is centered on a useful artifact or abstraction that does not match the objective's ground level.

Use this report shape:

```text
State: <executable | repair-first | too-vague | blocked | misframed>

Objective terms:
- <term>: <covered | missing | ambiguous> — <closure gate or gap>

Execution spine:
- First action:
- Required proof:
- What remains open after that action:

False-closure risks:
- <risk> — <why it could fool the run>

Required repairs:
- <repair or "none">

Decision:
<one direct paragraph explaining whether implementation should start now>
```

## Repair Rule

If the user asked only to check, do not edit. If the user asked to make the doc ready, patch the living doc before implementation:

- add missing acceptance criteria or equivalent closure gates
- add or tighten section rationale
- add issue/ticket references when the source-system spine exists
- add proof-ladder entries for expected proof
- refresh `metaFingerprint`
- render the doc

Do not start implementation work until the readiness state is `executable`, unless the user explicitly overrides the check.

## Boundary

This skill does not decide whether the objective is complete. Use `objective-conservation-audit` and `activation-energy-review` for completion or closure claims.
