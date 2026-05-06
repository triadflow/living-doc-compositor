---
name: "reaction-path-validator"
description: "Validate proposed living-doc stage transitions, especially movement toward ready, complete, final, closed, deferred, or pivoted states, using objectives, invariants, proof state, issue state, convergence types, and generated semantic context when available."
---

# reaction-path-validator

Use this before changing a living doc or issue to `ready`, `complete`, `final`, `closed`, `deferred`, or `pivoted`.

## Law

State transitions have allowed reaction paths. Partial proof cannot jump directly to completion.

## Inputs

- Current living doc stage/status and proposed next state.
- Objective and success condition.
- Invariants, proof ladder, decisions, issue state, and coverage.
- Convergence types from `scripts/living-doc-registry.json`.
- Generated semantic context when available:
  - `living_doc_semantic_context`
  - `living_doc_relationship_gaps`
  - `living_doc_stage_diagnostics`
  - `living_doc_valid_stage_operations`

## Workflow

1. Name the current state and proposed transition.
2. Identify what the proposed transition requires from the objective, proof, issues, and source artifacts.
3. If generated semantic context exists, use stage diagnostics and valid operations instead of inventing stage rules from prose.
4. Check invariants and governance freshness before trusting coverage-based claims.
5. Decide whether the transition is valid.
6. If invalid, name the nearest honest stage and the required operation.
7. Patch the living doc or issue state only when the transition is supported.

## Output

Return one of these states:

- `transition-valid`: proposed state is supported.
- `transition-blocked`: proposed state is unsupported.
- `nearest-honest-stage`: provide the stage/status that should be used instead.
- `required-operation`: provide the concrete operation needed to make the transition valid.
- `pivot-required`: the objective changed and must be recorded as a pivot, not completion.

## Transition Rule

Do not let a useful slice become final closure. A transition to completion must be supported by objective conservation, proof threshold, governance state, and issue/source reality.
