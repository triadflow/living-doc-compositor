---
name: inference-unit-chain-extension
description: Use when adding, changing, or reviewing a living-doc harness inference-unit type, allowed transition, routing policy, side-effect gate, handoff artifact, artifact-ref surface, dashboard graph surface, or generated chaining report behavior. Ensures new chain behavior is developed with controller-owned routing, positive and negative handoff tests, artifact-ref continuity, and generated report evidence instead of relying on prose or isolated unit tests.
---

# Inference Unit Chain Extension

Use this skill to keep inference-unit chain development honest. A new type or policy is not done when it is registered or when one isolated test passes. It is done when the controller-owned handoff is proven in a chain, the failure path is covered, and the report shows the actual artifacts.

## Rule

Every new inference-unit type or routing policy must add:

- one positive chain path showing what selects it, what it consumes, what it emits, and what the controller selects next
- one negative path showing malformed, missing, invalid, or policy-disallowed handoff behavior
- one system invariant check when the change touches cross-run refs, decision-unit routing, blocker precedence, or lifecycle sequencing
- artifact-ref continuity when any path crosses a run, iteration, or dashboard boundary
- generated report evidence when the behavior changes the chain timeline

Do not let units directly invoke the next unit. Units produce typed claims and artifacts; the harness controller produces authority.

## Starting Point

Read only the files needed for the requested change:

- unit registry and transition policy: `scripts/living-doc-harness-inference-unit-types.mjs`
- unit execution and validation: `scripts/living-doc-harness-inference-unit.mjs`
- controller selection/finalization: `scripts/living-doc-harness-iteration.mjs`
- lifecycle handoff/output-input: `scripts/living-doc-harness-lifecycle.mjs`
- selected-unit input construction: `scripts/living-doc-harness-runner.mjs`
- artifact refs: `scripts/living-doc-harness-artifact-ref.mjs`
- dashboard graph if visible: `scripts/living-doc-harness-dashboard-server.mjs`
- chain fixtures: `tests/fixtures/inference-unit-chain-fixtures.mjs`
- current chain tests:
  - `tests/contract/living-doc-harness-inference-unit-chaining.spec.mjs`
  - `tests/contract/living-doc-harness-controller-selected-chaining.spec.mjs`
  - `tests/contract/living-doc-harness-maximal-chain.spec.mjs`
  - `tests/contract/living-doc-harness-artifact-ref-surfaces.spec.mjs`
- generated report: `scripts/render-inference-unit-chaining-test-report.mjs`

## Workflow

1. **Name the chain role**
   State whether the change adds a unit type, a policy, a gate, a side-effect contract, or a dashboard/report surface.

2. **Update the registry/policy**
   Add or change the unit type, input contract, output contract, allowed next units, side-effect permissions, and closure implications in the registry/policy source. Keep the controller as the only scheduler.

3. **Update fixtures**
   Extend `tests/fixtures/inference-unit-chain-fixtures.mjs` only enough to produce real-shaped fixture input/output contracts for the new type or policy.

4. **Add a positive chain path**
   Add a deterministic test showing:
   - current unit
   - controller-selected next unit
   - required input paths/refs
   - output contract
   - validation artifact
   - gate before/after state, when relevant
   - next selected unit after the new type or policy runs

5. **Add a negative handoff/policy path**
   Cover at least one failure that would otherwise create false confidence:
   - invalid next unit
   - missing artifact
   - malformed `living-doc-artifact-ref/v1`
   - stale/mismatched iteration evidence
   - policy-disallowed selection
   - blocked side-effect gate
   - closure attempted without closure-review authority

6. **Check artifact-ref surface**
   If a new `*Path` field crosses a run, iteration, lifecycle, dashboard, or report boundary, add a paired `*Ref` field and update `tests/contract/living-doc-harness-artifact-ref-surfaces.spec.mjs`.

7. **Check system-wide invariants**
   If the change touches handoff, policy, blockers, or sequencing, add or update invariant tests so the harness cannot regress to local string paths or special-cased routing. Prefer tests that run a representative fixture and inspect the produced artifacts, not tests that only grep source.

   Required invariant families:
   - **Runtime artifact-ref invariant:** cross-run or cross-iteration handoff artifacts must carry `living-doc-artifact-ref/v1` object refs, not only loose relative paths.
   - **Dashboard artifact-ref consumption:** graph cards, side pane data, log links, contract arrows, and node tail APIs must resolve object refs when they appear in lifecycle artifacts.
   - **Policy table authority:** every decision-capable unit output must route through the registered matrix/policy table or record a contract-visible rejection.
   - **Stale blocker precedence:** a newer valid unit recommendation must win over an older blocker condition, or the controller must reject it with explicit contract evidence.
   - **No hard-coded sequence:** after bootstrap, the controller must not pre-plan worker/reviewer/repair chains outside contract output plus policy validation.

8. **Check dashboard/report surfaces**
   If the new type or policy changes graph shape, selected-unit metadata, gate state, or visible chain evidence:
   - update dashboard tests if the graph consumes the new artifact
   - update `scripts/render-inference-unit-chaining-test-report.mjs` if the generated report should show the behavior

9. **Run focused proof**
   Run the smallest relevant commands first:
   ```bash
   node tests/contract/living-doc-harness-artifact-ref-surfaces.spec.mjs
   node tests/contract/living-doc-harness-inference-unit-chaining.spec.mjs
   node tests/contract/living-doc-harness-controller-selected-chaining.spec.mjs
   node tests/contract/living-doc-harness-maximal-chain.spec.mjs
   npm run test:harness-chaining-report
   ```

10. **Run full contract proof**
   Before claiming the chain extension is ready:
   ```bash
   npm run test:contract
   ```

## Report Requirement

If the chain semantics changed, the generated report must make the change visible. The report should show the unit or policy by name, selected next unit, artifact paths, input carryover, gate before/after state, status, timing, and stdout/stderr.

Do not hand-edit reports. Patch the generator or tests, then regenerate:

```bash
npm run test:harness-chaining-report
```

## Closure Check

Before final response, answer these directly:

- What new type or policy was added?
- What selected it?
- What did it consume?
- What did it emit?
- What did the controller select next?
- What negative path now fails deterministically?
- Which artifact refs or dashboard/report surfaces changed?
- Which system-wide invariant prevents a narrow slice from looking done?
- Which proof commands passed?

If any answer is missing, the chain extension is not ready.
