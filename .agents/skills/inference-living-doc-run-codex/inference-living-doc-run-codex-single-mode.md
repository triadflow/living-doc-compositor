---
name: inference-living-doc-run-codex
description: "Use when Codex must solve a complex, bounded objective through the inference-time living document harness: create a fresh governed run doc, use the living-doc tools, perform the objective work through the doc, verify the result, deliver source-system outcomes, and finalize both document and objective readiness."
---

# Inference Living Doc Run Codex

Use this skill when Codex is explicitly asked to solve a complex, bounded objective through the living-document harness.

This skill has one operating mode: **run the full harness and complete the objective**.

The user invokes this skill only for work that is complex enough to require the harness. Do not classify the task as small, choose a lighter mode, skip the doc, continue an old doc, or replace the harness with ordinary planning. Create a fresh objective-specific governed living document and use it as the run state for the current objective.

The living document is working memory, governance, and audit state. It is not the deliverable unless the objective itself is to create or update a living document. A complete document with an incomplete objective is not a successful run.

Codex remains the executor. The harness exists to improve completion of complex work; it does not replace implementation, investigation, verification, PR creation, issue updates, or other source-system work.

## Core Contract

For every run, track two separate readiness states:

- `documentReady`: the living doc is coherent, covered, governed, and rendered.
- `objectiveReady`: the actual user objective is complete, or a real evidenced blocker has been reached.

Coverage, governance, rendering, and checkpointing can support `documentReady`. They do not prove `objectiveReady`.

A run succeeds only when the objective’s success condition is satisfied by source evidence, implementation evidence, verification evidence, and delivered source-system state.

For delivered code, `objectiveReady=true` requires committed source changes, relevant verification, an opened or updated PR, PR linkage in the living doc, and an issue update when there is a focal issue.

## Control Priority

When requirements conflict, prioritize in this order:

1. Objective completion
2. Correctness and verification
3. Harness coherence
4. Audit completeness

Lower-priority concerns must not block higher-priority work unless they expose a real correctness, safety, source-ownership, or status-truth problem.

## Non-Negotiable Harness Posture

This skill is for complex tasks. Run the harness every time.

Do not introduce:

- tiny-task mode
- lightweight mode
- degraded mode
- planning-only mode
- continue-existing-doc mode
- no-doc mode
- no-PR delivery mode
- local-only delivery mode
- user-policy branches that weaken the harness

The run always creates a fresh objective-specific living doc. Related living docs may be linked as source material, but they are not the run doc.

The rule is:

> Keep the gates. Shorten the gate depth only when the gate is already satisfied by evidence. Force objective action after each gate.

## Momentum Rule

The harness exists to complete the objective.

Operate in this loop:

1. Advance the objective.
2. Update the living doc with the smallest useful state or evidence change.
3. Run the required governance, coverage, render, or checkpoint step.
4. Continue to the next objective-directed action.

Do not perform more than one pure-harness cycle in a row.

A pure-harness cycle is any sequence of structure refinement, coverage mapping, governance evaluation, rendering, or checkpointing without objective work such as code edits, source analysis, test execution, issue updates, source-system actions, or concrete investigation.

After one pure-harness cycle, the next step must be objective work unless a governance violation blocks it.

At every checkpoint, record one of:

- next implementation action
- next investigation action
- next verification action
- evidenced blocker

After a successful checkpoint, continue to that next action rather than stopping at documentation.

## Tool Assumptions

The living-doc toolchain is part of this skill. Use it directly.

Required tool surfaces:

- registry tools for selecting and explaining convergence types
- scaffold tools for creating the run doc
- source tools for adding, creating, and linking source material
- coverage tools for mapping facets and finding gaps
- governance tools for evaluating invariants and traps
- patch/render tools for validating, applying, and rendering changes
- source-system tools for GitHub issues, PRs, comments, commits, and links
- repo tools for code edits, tests, fixtures, docs, and local verification

Do not write fallback branches for missing tools. Tool absence is not an alternate mode for this skill. If a required tool unexpectedly fails, record the failure as an objective blocker only when it prevents completing the real objective, then checkpoint the blocked state and return `objectiveReady=false`.

## Workflow

### 1. Establish Scope

Record in the run doc:

- objective
- success condition
- target repo or source system
- focal issue, PR, ticket, or source artifact
- expected source-system outputs
- expected verification evidence
- final delivery condition

For GitHub-backed work, inspect:

- issue body and comments
- linked issues and PRs
- labels and current state
- branch and repo status
- relevant constraints from repo instructions

Do not mutate source systems before the initial governed doc exists unless the mutation is required to discover the objective.

### 2. Explore The Objective

Explore enough source context to make the initial doc substantive rather than a shallow scaffold.

For GitHub issues, normally inspect:

- issue body, comments, labels, linked issues, linked PRs, and current state
- relevant repo files, tests, fixtures, docs, package scripts, and constraints
- recent history named or implied by the issue
- existing living docs only as source material

This phase is not implementation. It is source hydration for the initial governed doc.

### 3. Select The Living-Doc Structure

Use the registry as the type system.

Run:

```text
living_doc_registry_summary
living_doc_registry_match_objective
living_doc_registry_explain_type
```

Explain every convergence type before adding cards to that section.

Decide and record:

- solving strategy
- selected template or scaffold shape
- convergence types needed now
- convergence types intentionally deferred
- objective facets
- governance expectations
- likely invariants

Do not invent type semantics in prose when the registry defines them.

### 4. Create The Fresh Governed Run Doc

Create a fresh objective-specific living doc for the current run.

Run:

```text
living_doc_scaffold
```

The initial doc must include:

- objective
- success condition
- source targets
- selected structure and rationale
- objective facets
- source anchors from exploration
- typed source cards or placeholders
- coverage edges from facets to carriers
- invariants that prevent false completion, source ownership mistakes, type-boundary drift, and unverified status upgrades
- current phase
- next concrete objective action
- `documentReady=false`
- `objectiveReady=false`

Render immediately:

```text
living_doc_render
```

Checkpoint-commit the initial governed doc JSON and rendered HTML:

```bash
git add <doc.json> <doc.html>
git commit -m "ldoc: initialize <objective>"
```

Run governance evaluation after the initial checkpoint and record the result in the doc:

```text
living_doc_governance_evaluate
```

If governance is out of bounds in a way that affects correctness, repair the doc before source work.

### 5. Hydrate Sources Through Typed Sections

Use source tools and typed sections to add substantive state.

Run as needed:

```text
living_doc_sources_add
living_doc_coverage_map
living_doc_coverage_find_gaps
```

Add source entities to the section whose type actually matches the convergence.

Use canonical source systems actively:

- GitHub issues own issue state, comments, review context, follow-up tickets, and external coordination.
- Pull requests own delivered code review state.
- Repo files own code, tests, docs, fixtures, and executable verification.
- Living docs summarize, link, converge, and govern source material.

Do not paste large canonical artifacts into the doc when a source system should own them.

After meaningful hydration:

```text
living_doc_render
living_doc_governance_evaluate
```

Then checkpoint:

```bash
git add <doc.json> <doc.html>
git commit -m "ldoc: hydrate <objective> sources"
```

### 6. Perform The Objective Work

Do the actual work through the living doc.

Objective work includes:

- code edits
- source analysis
- issue or PR updates
- test creation or repair
- fixture creation
- documentation changes
- design decisions
- concrete investigation
- verification runs
- follow-up ticket creation
- PR creation or update

For each objective facet, keep three states explicit:

- `represented`: the doc has a section or card carrying the facet.
- `worked`: Codex performed concrete work against it.
- `verified`: evidence supports the current status.

Do not mark implementation, resolution, migration, delivery, or productization facets complete from prose alone.

Status upgrades require linked evidence from source systems, code, tests, issue state, PR state, or reproducible investigation.

After each meaningful objective action:

```text
living_doc_sources_add
living_doc_coverage_map
living_doc_render
```

Run governance before status upgrades, source writes, source commits, PR creation, and major phase transitions:

```text
living_doc_governance_evaluate
```

### 7. Reflect On Structure During Work

After meaningful discoveries, failed attempts, new constraints, or source-shape pressure, evaluate whether the structure still fits.

Run:

```text
living_doc_structure_reflect
living_doc_coverage_find_gaps
living_doc_governance_evaluate
```

Refine the structure when:

- a facet has no carrier
- a section mixes incompatible convergence types
- source relationships do not match the type contract
- repeated source pressure cannot fit the selected structure
- governance exposes status or source-boundary drift

Run structural refinement only for real structural edits:

```text
living_doc_structure_refine
```

After structural edits, render, evaluate governance, and checkpoint.

### 8. Create Durable Source Material

When work produces detail that should outlive the run doc, create first-class source material.

Run:

```text
living_doc_sources_create
living_doc_sources_link
```

Create or update:

- GitHub issues for follow-up work or residual risk
- GitHub issue comments for progress, blockers, verification, or PR status
- pull requests for delivered code
- PR comments or checklists for review coordination
- markdown design notes for reusable decisions
- test fixtures for executable verification
- repo docs for user-facing or maintainer-facing changes

Link each created source artifact back into the relevant living-doc card or section.

The living doc should summarize and converge sources, not replace them.

### 9. Handle Traps

When Codex loops, makes a wrong assumption, skips evidence, overloads the doc, or violates a type boundary, run:

```text
living_doc_governance_classify_trap
living_doc_governance_suggest_invariant
living_doc_governance_refine_invariant
living_doc_governance_evaluate
```

Then record:

- trap classification
- affected section, card, or facet
- invariant that should prevent recurrence
- repair action
- next objective-directed action

Good invariants are operational:

- Do not mark implementation complete without linked verification evidence.
- Do not treat rendered HTML as canonical when sibling JSON exists.
- Do not inline operational follow-up detail when a scoped ticket should own it.
- Do not update status from prose alone when code, tests, issue state, or PR state are available.
- Do not claim delivered code is objective-ready without committed source changes, verification, PR linkage, and issue update.

## Delivery Requirements

### Code Delivery

For delivered code, complete all of the following:

- implement the source changes
- add or update tests, fixtures, docs, or verification paths as needed
- run relevant verification
- commit source changes separately from pure living-doc checkpoints when practical
- push the branch
- open a draft PR or update the existing relevant PR
- link the PR in the living doc
- update the focal issue with progress, verification, blocker, or PR status
- record commit SHA, PR link, issue update link, and verification evidence in the doc

Do not set `objectiveReady=true` until this path is complete.

### Non-Code Delivery

For research, diagnosis, design, operational, or documentation-heavy work, complete all of the following:

- identify the source artifact that owns the final output
- create or update that artifact
- link it into the living doc
- record evidence and confidence limits
- verify the answer against source material
- create follow-up tickets for unresolved operational work
- checkpoint and render final doc state

Do not set `objectiveReady=true` until the durable source artifact exists and is linked.

## Tool Sequence

Use this sequence unless the objective requires a stricter ordering:

1. `living_doc_registry_summary`
2. `living_doc_registry_match_objective`
3. `living_doc_registry_explain_type`
4. `living_doc_scaffold`
5. `living_doc_sources_add`
6. `living_doc_coverage_map`
7. `living_doc_governance_evaluate`
8. `living_doc_render`
9. checkpoint commit
10. objective work through repo/source-system tools
11. `living_doc_sources_add`
12. `living_doc_coverage_map`
13. `living_doc_structure_reflect`
14. `living_doc_governance_evaluate`
15. render and checkpoint
16. source commit, push, PR, and issue update when delivering code
17. `living_doc_sources_create` and `living_doc_sources_link` for durable artifacts
18. `living_doc_coverage_evaluate_success_condition`
19. `living_doc_governance_evaluate`
20. `living_doc_render`
21. final checkpoint commit

Do not treat tool success as objective completion. Tool success only means the harness state advanced.

## Finalization

Before answering, run:

```text
living_doc_coverage_evaluate_success_condition
living_doc_governance_evaluate
living_doc_render
```

Commit the final rendered doc state:

```bash
git add <doc.json> <doc.html>
git commit -m "ldoc: finalize <objective>"
```

Finalization gates:

- `documentReady=true` requires rendered JSON/HTML, valid coverage, and no unhandled governance violations.
- `objectiveReady=true` requires the success condition to be satisfied by implementation, source-system, and verification evidence.
- Delivered code requires committed source changes, pushed branch, PR path, issue update, verification evidence, and doc linkage.
- Durable non-code output requires a created or updated source artifact, verification against source material, doc linkage, and residual-risk handling.
- If any objective-critical card remains planned, partial, gap, not-built, or blocked, continue working or return `objectiveReady=false` with blocker evidence.

## Final Response Format

Return:

- implemented solution or blocked conclusion
- `documentReady`
- `objectiveReady`
- living doc JSON path
- rendered HTML path
- source artifacts created or updated
- PR opened or updated
- issue comments or tickets created
- verification performed
- commits made
- residual risks
- unresolved blockers or uncovered facets

Do not claim success from documentation alone.

## Principles

1. **One mode.** This skill always runs the complex-task living-doc harness.
2. **Fresh run doc.** Every run creates a fresh objective-specific governed living doc.
3. **Objective first.** The harness supports execution; it does not replace execution.
4. **Truthful readiness.** Keep `documentReady` and `objectiveReady` separate.
5. **Evidence over prose.** Status upgrades require source, code, test, issue, PR, or investigation evidence.
6. **Tools are present.** Use the living-doc tools directly rather than designing fallbacks.
7. **Sources own durable detail.** The doc links and summarizes; canonical systems own operational detail.
8. **Governance catches failure modes.** Invariants prevent false completion, source drift, and unverified claims.
9. **Do not stop at the doc.** After every harness gate, return to objective-directed work.
