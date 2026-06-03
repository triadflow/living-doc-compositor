---
name: objective-closure-plan
description: Create or refresh a living doc objective-closure-plan card from the current objective, success condition, issue lanes, acceptance criteria, proof ladder, and closure path, including management summary, Mermaid closure graph, gates, next goal candidates, and freshness fingerprint.
---

# Objective Closure Plan

Use this skill when asked to create, update, inspect, or refresh an `objective-closure-plan` section in a living doc.

## Source Discipline

- Treat the living doc JSON as the source, not the rendered HTML.
- Read the root `objective` and `successCondition` first.
- Read the source sections before writing the plan:
  - `issue-lanes`
  - `acceptance-criteria`
  - `proof-ladder`
  - `closure-path`
- Do not query GitHub, AWS, dashboards, or logs as part of the freshness check. If source-system evidence matters, update the living doc from that evidence first, then refresh the closure plan.
- Do not duplicate issue lanes, acceptance criteria, proof ladder, or closure path as a second source of truth. The plan references them and explains closure intent.

## Required Card Shape

Create one plan card per objective unless the document has genuinely separate objective scopes.

Required fields:

- `id`
- `name`
- `state`
- `managementSummary`
- `planningQuestion`
- `objectiveRef`
- `successConditionRef`
- `freshnessBasis`
- `staleWhen`
- `watchedSections`
- `watchedCards`
- `closureGates`
- `nextGoalCandidates`
- `check`
- `diagrams`

Use `managementSummary` for management-facing synthesis based on the objective closure path. Keep it concrete:

- what is already proven
- what remains before closure
- what decision or proof would close the objective
- whether the work is implementation, audit, deploy-proof alignment, or risk acceptance

Avoid approval theater, vague readiness claims, and broad comfort summaries.

## Plan Construction Workflow

1. Identify watched sections.
   - Default: `issue-lanes`, `acceptance-criteria`, `proof-ladder`, `closure-path`.
   - Add other sections only when the objective closure actually depends on them.

2. Identify watched cards.
   - Include open, partial, unsatisfied, audit-open, blocked, or unclear cards.
   - Include source cards for gates that are already mostly proven but not formally accepted.
   - Do not include cards just to make the plan look exhaustive.

3. Write closure gates.
   - Each gate must name `sourceCardIds`, target state, and exit criterion.
   - Gates should answer: “What must become true before this objective can honestly close?”
   - Do not convert implementation tasks into gates unless the objective closure depends on them.

4. Write next goal candidates.
   - Each candidate must explain why it is next and what “done” means.
   - Prefer the smallest goal that moves objective closure, not a broad backlog item.

5. Write the Mermaid graph.
   - Use a `flowchart LR` or `flowchart TD`.
   - The graph must be understandable to a human first, and auditable to living-doc source ids second. Do not use raw ids as the primary visible story.
   - Use plain-language labels that explain what the node means, then put source ids/statuses on a second line.
   - Include one node for the root objective and one for the root success condition, but label them by meaning, not just `root.objective`.
   - Include one section node for each watched section. The first line should be a plain-language section meaning; the second line should show section id and convergence type, for example `Acceptance criteria\nacceptance-criteria / acceptance-criteria`.
   - Include card nodes for the watched cards that drive closure. The first line should explain the issue, criterion, proof, or gate in normal language; the second line should show the actual card id and current status/state.
   - Include gate nodes for every `closureGates[]` entry and wire them from their `sourceCardIds`.
   - Include goal nodes for every `nextGoalCandidates[]` entry and wire them from the gate or watched card they advance.
   - Include a decision node that leads either to objective closure or to precise next tickets.
   - Include an in-diagram legend subgraph that explains the color meanings in closure-path terms.
   - Use the renderer-supported one-level Mermaid form `subgraph Legend["Legend"] ... end` for the legend. Keep legend nodes unconnected from the production workflow so the legend cannot be mistaken for a process step.
   - Color nodes by role and closure meaning:
     - objective/success condition
     - watched sections
     - proven/current cards
     - partial/audit cards
     - open/blocking cards
     - closure gates
     - next goal candidates
     - closure decision
   - Use node ids derived from living-doc ids where practical, with Mermaid-safe characters. Do not rename the conceptual source; keep the living-doc id visible in the label.
   - If the graph cannot show how a gate traces back to source cards, the plan is not ready.
   - Before accepting the graph, read it as if the viewer has not read the JSON. If the viewer cannot understand what each box means without decoding ids, rewrite the labels.
   - Avoid labels like `criterion-governed-deploy` as standalone text. Prefer `Deployment proof still missing\ncriterion-governed-deploy / unsatisfied`.

   Preferred graph skeleton:

   ```mermaid
   flowchart LR
     Objective["Production Gemma email processing\nroot.objective"] --> Success["What must work before closure\nroot.successCondition"]

     Success --> SecIssues["Open and closed work lanes\nissue-lanes / issue-orbit"]
     Success --> SecCriteria["Closure requirements\nacceptance-criteria / acceptance-criteria"]
     Success --> SecProof["Evidence strength\nproof-ladder / proof-ladder"]
     Success --> SecClosure["Closure gates\nclosure-path / accountability-closure-path"]

     SecCriteria --> CritDeploy["Deployment proof still missing\ncriterion-governed-deploy / unsatisfied"]
     SecIssues --> Issue371["Residual owner-history audit remains\nissue-371-residual-cross-owner-history / open-active"]
     SecClosure --> GateOwner["Decide owner-history audit outcome\ngate-residual-owner-history-audit"]

     Issue371 --> GateOwner
     CritDeploy --> GateDeploy["Align deploy proof\ngate-governed-deploy-evidence"]

     GateOwner --> Goal371["Run residual history audit\ngoal-audit-residual-cross-owner-history"]
     GateDeploy --> GoalDeploy["Refresh governed deploy proof\ngoal-governed-deploy-proof-refresh"]

     Goal371 --> Decision{"Can the objective close?"}
     GoalDeploy --> Decision
     Decision -->|yes| Closed["Objective closed"]
     Decision -->|no| Ticket["Create precise next ticket"]

     subgraph Legend["Legend"]
       LRoot["Objective / success condition"]
       LSection["Watched source section"]
       LProven["Proven / closed"]
       LAudit["Partial or audit needed"]
       LOpen["Open blocker / missing proof"]
       LGate["Closure gate"]
       LGoal["Next goal candidate"]
       LDecision{"Closure decision"}
     end

     classDef root fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
     classDef section fill:#f8fafc,stroke:#64748b,color:#0f172a
     classDef proven fill:#dcfce7,stroke:#16a34a,color:#14532d
     classDef audit fill:#fef3c7,stroke:#d97706,color:#78350f
     classDef open fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
     classDef gate fill:#ede9fe,stroke:#7c3aed,color:#3b0764
     classDef goal fill:#fce7f3,stroke:#db2777,color:#831843
     classDef decision fill:#f3e8ff,stroke:#7c3aed,color:#3b0764
   ```

6. Compute and store freshness.
   - First write `check: []`.
   - Run:
     ```bash
     node /Users/rene/projects/living-doc-compositor/scripts/check-objective-closure-plan.mjs <living-doc.json>
     ```
   - If the checker reports missing fingerprint, compute it with:
     ```bash
     node --input-type=module - <<'NODE'
     import { readFile } from 'node:fs/promises';
     import { computeObjectiveClosurePlanFingerprint } from '/Users/rene/projects/living-doc-compositor/scripts/check-objective-closure-plan.mjs';
     const path = process.argv[2];
     const doc = JSON.parse(await readFile(path, 'utf8'));
     const section = doc.sections.find((s) => s.convergenceType === 'objective-closure-plan');
     const plan = section.data[0];
     console.log(computeObjectiveClosurePlanFingerprint(doc, plan));
     NODE
     ```
   - Store that value in `check[0].basisFingerprint`, set `check[0].status` to `current`, and run the checker again.

7. Render the living doc.
   ```bash
   node /Users/rene/projects/living-doc-compositor/scripts/render-living-doc.mjs <living-doc.json>
   ```

8. Verify.
   - `jq empty <living-doc.json>`
   - `node /Users/rene/projects/living-doc-compositor/scripts/check-objective-closure-plan.mjs <living-doc.json>`
   - Confirm the rendered HTML contains the plan section, management summary, and Mermaid diagram.

## Guardrails

- Do not hardcode account-specific behavior into general planning logic.
- Do not invent generic rules from one sample.
- Do not mark a plan current when watched source cards changed and the fingerprint was not refreshed.
- Do not say the objective is closed because tickets are closed. Closure follows the objective, success condition, acceptance criteria, and proof gates.
- Do not draw a Mermaid diagram that cannot be audited against watchedSections, watchedCards, closureGates, and nextGoalCandidates.
- Do not make humans decode raw ids to understand the diagram. Raw ids are traceability, not the explanation.
