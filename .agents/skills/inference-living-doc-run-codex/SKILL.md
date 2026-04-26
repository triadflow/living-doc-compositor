---
name: inference-living-doc-run-codex
description: "Use when Codex should solve a bounded objective through an inference-time living doc harness: explore the objective deeply, create and render an objective-specific governed living doc, checkpoint-commit the doc, perform the work through that doc, reflect on structure, create/link source material, evaluate governance invariants, render, and commit checkpoint/final document state."
---

# Inference Living Doc Run Codex

Run a Codex-oriented objective harness over living docs. The skill's hypothesis is that Codex solves domain-heavy work better when its working state is captured in a typed living document: upfront objective structuring over well-designed convergence types, plus a governance layer that is evaluated and refined during inference.

This is a skill-first MVP with a local MCP substrate, not a full runtime. Prefer the living-doc MCP tools when available. Fall back to existing repo scripts and the helper in `scripts/ldoc-run-tools.mjs` for deterministic steps. Use MCP/app tools when available for source systems such as GitHub; otherwise use local CLIs such as `gh`.

## Operational Contract

This skill is an execution harness. When the user says to use this skill on an objective, issue, ticket, repo task, or source artifact, Codex must attempt to complete the objective itself in the current run. The living doc is working memory, governance, and visible state; it is not the deliverable unless the objective itself is to create or update a living document.

For a standalone run, create a fresh objective-specific working doc unless the user explicitly names an existing run doc to continue. Related living docs may be linked as source material, but they are not the run doc by default.

Do not downgrade the run into framing, planning, readiness, or handoff work. The requirement to complete the objective does not relax the doc-first harness. The run must create, render, govern, and checkpoint the working doc before substantive implementation or source-system mutation. If the objective is too broad, blocked, or unsafe to complete in one run, continue until the real blocker is evidenced, update the living doc with that blocker, checkpoint the doc, and return a blocked conclusion. A complete document with an incomplete objective is not a successful run.

Track two separate readiness states throughout the run:

- `documentReady`: the living doc is coherent, covered, governed, and rendered.
- `objectiveReady`: the actual objective has been completed or a real evidenced blocker has been reached.

Coverage and governance tools can support `documentReady`; they do not prove `objectiveReady` by themselves.

## Harness Tool Map

Use the explicit tool surface for each harness step. Prefer MCP when available, use the CLI fallback when not, and record the required output in the living doc before moving to the next gate.

| Harness step | Primary tools | CLI / local fallback | Required output |
| --- | --- | --- | --- |
| Scope and source target | Source MCP/app tools for the system named by the user | `gh issue view`, `gh pr view`, `gh issue list`, `git remote -v`, `git status --short` | Objective, success condition, source URLs/ids, write/commit policy |
| Deep objective exploration | GitHub MCP/app, repo/filesystem tools | `gh issue view --json ...`, `gh pr view --json ...`, `rg`, `git log`, `git show`, package scripts/docs reads | Issue facts, linked source material, initial code/test/doc anchors, constraints |
| Registry structure selection | `living_doc_registry_summary`, `living_doc_registry_match_objective` | `node .agents/skills/inference-living-doc-run-codex/scripts/ldoc-run-tools.mjs registry-summary`; `... match-structure` | Selected strategy, convergence types, deferred types, rationale |
| Type contract reading | `living_doc_registry_explain_type` | Read `scripts/living-doc-registry.json` entries for selected types | Type contracts, status fields, source shapes, prompt guidance |
| Objective decomposition | `living_doc_objective_decompose` | Manual decomposition recorded in doc JSON | Objective facets mapped to success condition |
| Initial doc creation | `living_doc_scaffold` | `node .agents/skills/inference-living-doc-run-codex/scripts/ldoc-run-tools.mjs scaffold`; manual JSON patch when needed | Fresh run doc JSON path with initial sections, cards, facets, invariants |
| Source/card hydration | `living_doc_sources_add` | Direct JSON edit/patch using source data from `gh`, `git`, `rg`, files | Typed cards, source refs, code anchors, issue orbit, findings, attempts |
| Coverage mapping | `living_doc_coverage_map`, `living_doc_coverage_find_gaps` | `node .agents/skills/inference-living-doc-run-codex/scripts/ldoc-run-tools.mjs coverage-check --doc <doc.json>` | Coverage edges, uncovered facets, invalid edges |
| Governance setup/check | `living_doc_governance_list_invariants`, `living_doc_governance_evaluate`, `living_doc_governance_suggest_invariant` | `node .agents/skills/inference-living-doc-run-codex/scripts/ldoc-run-tools.mjs governance-check --doc <doc.json>` | Operational invariants, violations, refinement actions |
| Render | `living_doc_render` | `node scripts/render-living-doc.mjs <doc.json>` | Rendered HTML path and render success/failure evidence |
| Checkpoint commit | GitHub/git tool if available | `git add <doc.json> <doc.html> <owned-artifacts>; git commit -m "ldoc: <gate> <objective>"` | Commit SHA containing only run-owned files |
| Implementation/source work | Normal Codex shell/edit/test tools plus source MCP/app tools | `apply_patch`, repo scripts, `npm test`, targeted package tests, `gh issue/pr` commands when in scope | Actual objective work, linked attempts/findings/evidence |
| Structure reflection | `living_doc_structure_reflect`, `living_doc_structure_refine` | coverage/governance checks plus manual doc patch | Confirmed structure or revised sections/types/rationales |
| Durable source creation | `living_doc_sources_create`, `living_doc_sources_link` | `gh issue create`, markdown/test fixture creation, direct doc linking | Created source artifact and backlink from doc card/section |
| Trap handling | `living_doc_governance_classify_trap`, `living_doc_governance_suggest_invariant`, `living_doc_governance_refine_invariant` | Manual invariant update plus governance check | Trap classification and durable invariant when warranted |
| Final readiness | `living_doc_coverage_evaluate_success_condition`, `living_doc_governance_evaluate`, `living_doc_render` | coverage-check, governance-check, renderer, repo tests | `documentReady`, `objectiveReady`, final doc paths, final commit SHA |

Do not treat this table as advisory. If a primary tool is unavailable, use the fallback and record that fallback in the doc. If both primary and fallback are blocked, record the blocker and stop at the next checkpoint with `objectiveReady=false`.

## Workflow

### 1. Establish Scope

Start from the user's objective. Identify:

- objective and success condition
- target repo or source systems
- allowed writable source systems, such as GitHub issues or local markdown files
- commit mode: checkpoint commits, final commit, audit commits, or no commits

If the user has not specified commit/source-write policy, make this default assumption for standalone runs: checkpoint-commit the living doc artifacts at harness gates, but do not commit source-code or source-system changes unless the objective requires it or the user requests it. Keep checkpoint commits scoped to the run doc JSON/HTML and directly owned source artifacts. If the user explicitly says no commits, still create and render the doc, but record that the audit trail is uncommitted.

### 2. Deeply Explore The Objective

Explore enough source context to make the initial living doc substantive rather than a shallow scaffold. For a GitHub issue, this normally includes:

- the issue body, comments, labels, linked issues/PRs, and current state
- relevant repo files, tests, docs, fixtures, and recent history named or implied by the issue
- existing living docs only as context or source material, unless the user explicitly says to continue one
- constraints from AGENTS.md, package scripts, CI, and local tooling

This is not implementation yet. It is source hydration for the initial governed doc. Avoid code edits and source-system writes during this phase unless they are required to discover the objective.

### 3. Select The Structure From The Explored Objective

Choose the document structure that best fits how the objective is likely solved, using the deep exploration as evidence rather than relying only on the issue title.

Use the registry as the type system. Prefer MCP:

```text
living_doc_registry_summary
living_doc_registry_match_objective
```

CLI fallback:

```bash
node .agents/skills/inference-living-doc-run-codex/scripts/ldoc-run-tools.mjs registry-summary
node .agents/skills/inference-living-doc-run-codex/scripts/ldoc-run-tools.mjs match-structure \
  --objective "<objective>" \
  --success "<success condition>"
```

Decide:

- likely solving strategy
- starter template or new scaffold
- convergence types needed now
- convergence types to defer until hydration reveals a need
- initial objective facets
- governance expectations and likely invariants

Do not treat this as a final taxonomy decision. It is the first reasoning frame.

### 4. Create The Governed Working Doc

Create a fresh objective-specific living doc for a standalone run. Only use an existing doc when the user explicitly identifies it as the run doc to continue. The initial doc must be based on the deep exploration and should already contain useful source cards, code anchors, issue orbit, findings, attempts, verification targets, or decisions as appropriate to the selected types.

Prefer MCP:

```text
living_doc_scaffold
```

CLI fallback:

```bash
node .agents/skills/inference-living-doc-run-codex/scripts/ldoc-run-tools.mjs scaffold \
  --objective "<objective>" \
  --success "<success condition>" \
  --title "<short title>" \
  --out docs/<objective-slug>.json
```

Before rendering, add a governance layer strong enough to steer the run:

- objective facets that map to the success condition
- coverage edges from facets to initial section/card carriers
- invariants that prevent false completion, source/detail ownership mistakes, type-boundary drift, and unverified status upgrades
- section rationales explaining why each convergence type is present

Render immediately after creating or editing:

```bash
node scripts/render-living-doc.mjs docs/<objective-slug>.json
```

Then checkpoint-commit the initial governed doc JSON and rendered HTML before implementation work:

```bash
git add docs/<objective-slug>.json docs/<objective-slug>.html
git commit -m "ldoc: initialize <objective>"
```

If the worktree is dirty, stage only the run doc paths and directly owned source artifacts. Do not include unrelated user changes. If commits are disabled by user policy, record the missing checkpoint in the doc and continue.

### 5. Hydrate Sources Through Typed Sections

Read the selected convergence type definitions before adding data. Add source entities to the section whose type actually matches the convergence.

Use source tools/CLIs directly when needed:

- `git` for code paths, commits, history, and changed files
- `gh` or GitHub MCP for issues, PRs, comments, checks, and new issues
- local files for specs, fixtures, docs, logs, and tests
- project-specific tools when the doc's `syncHints` point to them

Keep the living doc as a convergence surface. Do not paste large artifacts into it when a source system should own them.

After a meaningful hydration pass, render and checkpoint-commit the doc again:

```bash
node scripts/render-living-doc.mjs <doc.json>
git add <doc.json> <doc.html>
git commit -m "ldoc: hydrate <objective> sources"
```

### 6. Work Through The Doc

During implementation or investigation, use the living doc to drive the actual work. Do not stop after populating cards.

- keep objective facets in view
- perform the code, research, source-system, design, test, or operational work required by the objective
- map evidence to cards and coverage edges
- update section/card state with full ISO timestamps
- preserve registry status fields and source reference shapes
- prefer structured patches or direct JSON updates with a clear diff
- render after doc changes that matter to the run
- checkpoint-commit doc state after major attempts, blockers, and verification milestones

For each objective facet, keep the distinction explicit:

- represented: the doc has a section/card carrying the facet
- worked: Codex performed concrete work against that facet
- verified: evidence supports the current status

Do not mark `implement-or-resolve`, equivalent delivery facets, or productization tracks as ready/built/complete when the doc only contains planned, partial, gap, or blocked cards. If the work cannot be completed, make the blocker the outcome and link evidence.

Before any source-code edit or source-system write, verify:

- the working doc JSON exists
- the rendered HTML exists or render failure is recorded as an evidenced blocker
- the intended edit maps to at least one objective facet and card
- governance has no unresolved violation that would make the edit incoherent

Use existing scripts where relevant:

```bash
node scripts/render-living-doc.mjs <doc.json>
node scripts/validate-ai-patch.mjs <patch.json>
node scripts/render-living-doc.mjs <doc.json> --commit --message "<message>"
```

### 7. Reflect On Structure During Work

After meaningful discoveries, pause and ask whether the structure still fits.

Use MCP:

```text
living_doc_structure_reflect
living_doc_coverage_find_gaps
living_doc_governance_evaluate
```

CLI fallback:

```bash
node .agents/skills/inference-living-doc-run-codex/scripts/ldoc-run-tools.mjs coverage-check --doc <doc.json>
node .agents/skills/inference-living-doc-run-codex/scripts/ldoc-run-tools.mjs governance-check --doc <doc.json>
```

Refine when needed:

- add a section when an objective facet has no carrier
- split a section when it mixes distinct convergence types
- swap a convergence type when source relationships do not match the type contract
- propose a new registry type only when repeated structure pressure cannot be represented by existing types
- re-run or update governance after structural edits

Make structural evolution visible in the doc, render it, and checkpoint-commit it.

### 8. Create Source Material When The Doc Is Not The Owner

When work produces durable detail, decide whether it belongs in a first-class source system.

Create source material when it is in scope and useful beyond the doc:

- GitHub issue for follow-up work or residual risk
- markdown design note for reusable decisions/specs
- test fixture for executable verification evidence
- PR/checklist artifact for review coordination
- support/ops ticket for operational handoff

Then link the new source entity back into the relevant doc card/section. The doc should summarize and converge sources, not replace them.

### 9. Evaluate Governance And Traps

Treat governance as an inference control layer.

The initial doc must contain operational invariants, and those invariants must be evaluated at every checkpoint: before implementation, before source writes, before status upgrades, before commits, and before finalization.

When Codex loops, makes a wrong assumption, skips evidence, overloads the doc, or violates a type boundary:

1. classify the trap
2. check existing invariants
3. suggest or add a durable invariant when the lesson should govern future work
4. link the invariant to affected sections, cards, or facets
5. re-run governance checks

Good invariants are operational:

- Do not mark implementation complete without linked verification evidence.
- Do not treat rendered HTML as canonical when sibling JSON exists.
- Do not inline operational follow-up detail when a scoped ticket can own it.
- Do not update status from prose alone when code, tests, or issue state are available.

Use `/crystallize` or its logic when the doc shape has stabilized and governance should be derived/refreshed.

### 10. Finalize

Before answering, evaluate both document readiness and objective readiness.

Prefer MCP:

```text
living_doc_coverage_evaluate_success_condition
living_doc_governance_evaluate
living_doc_render
```

CLI fallback:

```bash
node .agents/skills/inference-living-doc-run-codex/scripts/ldoc-run-tools.mjs coverage-check --doc <doc.json>
node .agents/skills/inference-living-doc-run-codex/scripts/ldoc-run-tools.mjs governance-check --doc <doc.json>
node scripts/render-living-doc.mjs <doc.json>
```

Commit the final rendered doc state unless the user explicitly disabled commits:

```bash
node scripts/render-living-doc.mjs <doc.json> --commit --message "ldoc: finalize <objective>"
```

Finalization gates:

- `documentReady` requires rendered JSON/HTML, no invalid coverage edges, and no unhandled governance violations.
- `objectiveReady` requires the actual success condition to be satisfied by implementation/source evidence, or a real blocker to be evidenced and recorded.
- A passing coverage/governance evaluation is not enough to set `objectiveReady=true`.
- If any objective-critical card remains `planned`, `partial`, `gap`, `not-built`, or `blocked`, either continue working or return `objectiveReady=false` with the blocker/residual work.

Return:

- implemented solution or blocked conclusion
- doc JSON path
- rendered HTML path
- source artifacts created
- coverage/governance status
- `documentReady` and `objectiveReady`
- commits made, if any
- residual risks and uncovered facets

## Deterministic Helper

The helper script is intentionally modest. Use it for repeatable scaffolding and checks:

```bash
node .agents/skills/inference-living-doc-run-codex/scripts/ldoc-run-tools.mjs --help
```

The local MCP server exposes the semantic tool surface for the current harness:

```bash
npm run ldoc:mcp
```

Tool groups:

- Registry: `living_doc_registry_summary`, `living_doc_registry_explain_type`, `living_doc_registry_match_objective`, `living_doc_registry_propose_type_gap`
- Objective/structure: `living_doc_objective_decompose`, `living_doc_structure_select`, `living_doc_structure_reflect`, `living_doc_structure_refine`
- Sources: `living_doc_sources_add`, `living_doc_sources_create`, `living_doc_sources_link`
- Coverage: `living_doc_coverage_map`, `living_doc_coverage_find_gaps`, `living_doc_coverage_evaluate_success_condition`
- Governance: `living_doc_governance_list_invariants`, `living_doc_governance_evaluate`, `living_doc_governance_classify_trap`, `living_doc_governance_suggest_invariant`, `living_doc_governance_refine_invariant`, `living_doc_governance_check_patch`
- Patch/render: `living_doc_patch_validate`, `living_doc_patch_apply`, `living_doc_render`

Read `references/cli-mcp-boundary.md` only when designing or extending the tool boundary.

## MCP Operating Pattern

When MCP tools are available, follow this sequence unless the user asks for a narrower operation:

1. `living_doc_registry_match_objective` to select the first solving frame.
2. `living_doc_registry_explain_type` for every convergence type before adding cards to that section.
3. `living_doc_scaffold` when no existing doc fits the objective.
4. `living_doc_sources_add` only after the target section/type is known.
5. `living_doc_coverage_map` whenever a card carries an objective facet.
6. `living_doc_sources_create` and `living_doc_sources_link` when detail belongs in a source artifact.
7. `living_doc_structure_reflect` after meaningful discoveries or failed attempts.
8. `living_doc_governance_evaluate` before status upgrades, source writes, commits, and finalization.
9. `living_doc_governance_classify_trap` plus `living_doc_governance_suggest_invariant` when the same mistake or ambiguity repeats.
10. `living_doc_patch_validate` before applying any structured patch; `living_doc_patch_apply` only after validation passes.
11. `living_doc_coverage_evaluate_success_condition` and `living_doc_render` before returning. Treat this as document readiness input, not proof that the real objective is complete.

Use `living_doc_structure_refine` only for explicit structural edits: adding a missing section, changing a section type, updating rationale, or removing an empty section. Use `living_doc_registry_propose_type_gap` only when repeated source pressure cannot fit existing convergence types.

Do not treat MCP output as decorative. Coverage gaps, governance violations, and structure recommendations are work items unless the final answer explicitly explains why they remain unresolved.

Do not treat MCP success output as objective completion. If `successReady` is true but the implementation work is still partial, report `documentReady=true` and `objectiveReady=false`.

## Principles

1. **Codex remains the executor.** This skill gives Codex a domain-capture harness; it does not replace Codex's normal code, shell, git, and review abilities.
2. **The registry is the type system.** Do not invent type semantics in prose when `scripts/living-doc-registry.json` defines them.
3. **Governance is active.** Invariants should be evaluated and refined during the run, not treated as decorative metadata.
4. **Structure comes first, then hydration.** Pick a solving frame before deep source gathering, then revise it when the domain pushes back.
5. **Sources own durable detail.** The doc links and summarizes; source systems own large, canonical, operational, or executable material.
