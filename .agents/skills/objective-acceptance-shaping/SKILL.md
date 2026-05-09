---
name: "objective-acceptance-shaping"
description: "Critique and shape a rough or session-derived living-doc objective into a clear accountable objective with tight acceptance criteria. Use when a new living doc is being created from an ongoing Codex or Claude Code session, when the objective is broad, general, aspirational, or not yet deeply accountable, or when the user asks to propose the first objective and acceptance criteria."
---

# objective-acceptance-shaping

Use this before a living doc is ready for execution. The job is to turn rough session intent into an objective that can later drive work, proof, tickets, and closure.

This skill is earlier than `objective-execution-readiness`.

- This skill asks: what should the objective and acceptance criteria be?
- `objective-execution-readiness` asks: can the living doc now drive implementation?

## Law

A living-doc objective is usable only when a later agent can tell what must become true, what evidence would prove it, and what is not included.

Do not optimize for a nice summary. Optimize for accountable closure.

## Inputs

Use the available session context and any existing draft living doc material:

- rough objective or user intent
- current conversation history
- source-system references mentioned in the session
- proposed or existing convergence types
- implied deliverables, constraints, risks, and proof surfaces
- any existing acceptance criteria, tickets, or implementation slices

If the living doc JSON already exists, read it. If not, work from the session and produce a candidate objective block.

## Workflow

1. Keep the user's raw intent visible. Do not summarize it away too early.
2. Separate:
   - motivation: why the work matters
   - objective: what must become true
   - approach: how it may be done
   - evidence: how truth will be checked
   - scope boundary: what is not part of this objective
3. Identify accountable terms:
   - nouns that name source surfaces, systems, files, docs, tools, users, or workflows
   - verbs that imply a required transformation
   - adjectives that imply a standard, such as deterministic, stable, complete, generated, rendered, queryable, or production-ready
4. Critique the current objective:
   - too broad
   - too abstract
   - not tied to a source system
   - describes activity instead of outcome
   - mixes objective, approach, and motivation
   - lacks closure gates
   - hides uncertainty behind confident wording
   - can be satisfied by a useful slice while missing the real target
5. Draft one clear objective.
   - Preserve the user's real intent.
   - Make the objective literal enough to close against.
   - Prefer one strong paragraph over many soft bullets.
   - Include source surfaces when they matter.
   - Do not include implementation steps unless they are part of the actual outcome.
6. Draft acceptance criteria that are tight to the objective.
   - Each criterion must prove an accountable objective term.
   - Each criterion must name the evidence or source-system proof.
   - Criteria should fail if only a partial or decorative artifact exists.
   - Avoid criteria that only say the document was updated, rendered, or reviewed unless that is the actual objective.
7. Name explicit out-of-scope boundaries.
8. Name open questions only where the objective cannot honestly be shaped from context.
9. If the user asked to update a living doc, patch the doc and render it. Otherwise, return the shaped objective package only.

## Acceptance Criteria Rules

Good acceptance criteria are content-tied, not structure-tied.

Weak:

- "The living doc has an acceptance criteria section."
- "The template is updated."
- "The page renders."

Stronger:

- "Every accountable term in the objective has a closure gate with named proof."
- "The source system can regenerate the derived artifact deterministically."
- "A later agent can query the contract at inference time and get the same semantics used by the generated registry."
- "The work cannot close while any objective-owned source surface remains unverified."

## Output

Use this shape:

```text
Objective critique:
- <problem>: <why it weakens execution>

Proposed objective:
<one clear objective paragraph>

Acceptance criteria:
- <criterion> — proof: <source-system evidence, command, artifact, issue state, or rendered state>

Out of scope:
- <boundary>

Open questions:
- <question or "none">

Decision:
<one direct paragraph explaining whether this is ready to become the living-doc objective or still needs user choice>
```

## If Editing A Living Doc

When asked to write the result into a living doc:

- preserve existing user-authored content unless replacing the explicitly rough objective
- update `objective`
- update or add objective-tied acceptance criteria using the existing convergence type if present
- add scope boundaries where the document already has a suitable section
- keep timestamps in full ISO precision
- render with:
  ```bash
  node scripts/render-living-doc.mjs <path-to-doc.json>
  ```

Do not start implementation. This skill only shapes the objective and acceptance criteria.

## Boundary

This skill does not decide completion. Use `objective-conservation-audit`, `activation-energy-review`, or `reaction-path-validator` for completion, proof, or stage-transition claims.
