---
name: "living-doc-perspective-reset"
description: "Reframe living-doc work when the current perspective is producing churn, repeated local fixes, unclear blockers, argument around symptoms, or progress that does not move the objective. Use to zoom up and down through the living doc objective, acceptance criteria, invariants, proof state, blockers, evidence, and the concrete problem so the next move is aimed at the real thing that needs to be solved."
---

# living-doc-perspective-reset

Use this when a living-doc driven session needs a new perspective before continuing.

This skill is not a repair skill. It is a frame-reset pass. It reads the living doc and the current problem, then reasons across several levels until the next move is aligned with the real objective instead of the nearest symptom.

## Trigger Signals

Invoke when one or more are visible:

- repeated small fixes do not move the living doc toward closure
- the same class of issue keeps returning
- acceptance criteria remain open while progress artifacts accumulate
- the session is arguing around symptoms, wording, or implementation slices
- the blocker is vague, over-broad, or suspiciously local
- the living doc objective says one thing but the work is drifting elsewhere
- a ticket or issue feels true but framed at the wrong level
- the user asks for a new perspective, zooming in/out, or what the real problem is

## Core Law

The skill must improve the quality of the next decision.

Do not optimize for a clever synthesis. Do not invent a new abstraction layer unless the living doc and evidence require it. Keep moving between the living doc's governing intent and the concrete evidence until the real thing that needs to be solved is stated at the right level.

## Inputs

- Living doc JSON path, or enough context to identify the relevant living doc.
- Current problem, ticket, blocker, user correction, failed run, or suspicious decision.
- Objective and success condition.
- Acceptance criteria or equivalent closure gates.
- Invariants, governance, section rationale, proof ladder, issues, relationship maps, and current stage when present.
- Concrete evidence such as source files, tickets, tests, commits, rendered docs, logs, artifacts, or user objections.

## Workflow

1. Identify the current working frame.
   - What is the session currently optimizing for?
   - Is it a code slice, ticket symptom, proof artifact, issue label, doc structure, user objection, or closure claim?
2. Keep the living-doc objective visible.
   - Do not summarize away accountable objective terms.
   - Ask what must become true in the real world or source system.
3. Read the acceptance criteria as pressure, not decoration.
   - Which criteria are still false, partial, unproven, or too weak?
   - Which criteria would reject the current direction?
4. Read invariants and governance as constraints.
   - What must not be broken, hidden, narrowed, or bypassed while solving this?
   - Which invariant is being ignored or over-weighted?
5. Zoom into the concrete evidence.
   - What artifact, ticket, run, file, command, issue, or user correction proves the current problem?
   - What is the smallest hard fact that cannot be explained away?
6. Zoom out to the living-doc system shape.
   - What larger objective, stage, relationship, or proof pattern does the local symptom belong to?
   - Is the work solving a symptom, a missing proof, a wrong frame, a bad objective, or a real source-system defect?
7. Zoom back down to the next move.
   - What has to change, be proven, clarified, or explicitly blocked next?
   - What should not be done because it would look productive while missing the real problem?

Repeat the up/down pass if the first answer is still framed as a symptom.

## Output Shape

Return a compact perspective pass:

```text
Current frame:
<what the work is currently treating as the problem>

Living-doc pressure:
- Objective: <accountable objective pressure>
- Acceptance: <criteria pressure>
- Invariants: <constraint pressure>
- Proof/state: <current stage or proof gap>

Concrete evidence:
- <specific ticket/artifact/file/test/user signal>
- <specific ticket/artifact/file/test/user signal>

Zoomed-out read:
<what larger living-doc problem this belongs to>

Zoomed-in read:
<the concrete thing that must change, be proven, clarified, or blocked>

Wrong next moves:
- <move that would treat the symptom but miss the real problem>

Right next move:
<one direct next action, or the next skill/check to invoke>
```

## Rules

- Do not repair by default. Reframe first.
- Do not collapse the problem to implementation details unless the living doc objective makes those details the real object.
- Do not treat proof artifacts as closure unless the acceptance criteria and invariants say they prove the objective.
- Do not add structure just because the current frame feels weak.
- Do not answer from vibes. Every perspective shift needs evidence.
- Prefer a smaller true reframe over a broad list of possible interpretations.
- If the next move is a repair skill, name why that skill follows from the living-doc pressure.

## Relationship To Other Skills

- Use `objective-acceptance-shaping` when the objective itself is too vague to drive the work.
- Use `objective-execution-readiness` when checking whether a fresh or repaired living doc can drive implementation.
- Use `living-doc-balance-scan` when the document is out of balance and needs repair classification.
- Use `objective-conservation-audit`, `reaction-path-validator`, and `activation-energy-review` for completion, stage transition, or closure claims.

This skill can precede any of those when the missing piece is perspective, not yet repair.
