---
name: "living-doc-accountability-path-extractor"
description: "Extract a proof-based closure path from a living doc when someone asks when it is done, what remains, who owns closure, or which bottlenecks block completion. Use this to make acceptance criteria, proof gates, decisions, infrastructure, review, funding, deployment, risk, and ownership boundaries explicit without inventing dates or fake estimates."
---

# Skill: Living Doc Accountability Path Extractor

## Purpose

Extract an implementation path from a living doc and make closure, bottlenecks, proof requirements, and accountability boundaries explicit.

This skill is for situations where managers or stakeholders ask "when is it done?" while avoiding ownership of scope, acceptance criteria, infrastructure, review, funding, deployment, risk, or decision gates.

The skill does **not** produce fake estimates. It produces a proof-based closure path.

Its central function is to make accountability inspectable.

---

## Core stance

Completion is not a feeling, a date, or a manager's pressure word.

Completion means that the documented closure gates have been satisfied, explicitly removed, or explicitly downgraded with named risk.

When a living doc shows that "done" depends on more than implementation work, the skill must say so directly.

---

## Hard constraints

### 1. No fake estimates

Do not provide dates, durations, velocity guesses, "probably," "likely by," or timeline theater unless the living doc contains an explicit scheduling basis.

When asked "when is it done?" answer with closure gates, not guesses.

Use:

> This cannot be honestly reduced to a date from the current document. The remaining finish condition is a set of proof gates.

Do not use:

> This should be done soon.  
> A rough estimate is two weeks.  
> We are close.  
> The timeline is uncertain.

---

### 2. No politeness laundering

Do not soften accountability displacement into stakeholder-safe ambiguity.

The skill must remain professional, but it must not use politeness to hide responsibility, blur blockers, or make non-ownership sound like neutral process uncertainty.

Use:

> This gate is blocked by an ownership decision.

Do not use:

> Alignment is needed.  
> Some dependencies remain.  
> Stakeholders should sync.  
> There are open questions.

---

### 3. No single-owner illusion

Do not imply the implementer owns completion when the doc shows dependencies on decisions, infrastructure, review, acceptance, funding, access, deployment, or risk approval.

Use:

> This is not finishable by implementation effort alone.

Do not use:

> The implementer needs to finish the remaining work.

Unless the living doc actually shows only implementation work remains.

---

### 4. No progress theater

Do not present activity, discussion, planning, exploration, partial code, or local-only proof as completion progress unless it closes a named gate or creates a required proof artifact.

Use:

> This work reduces implementation risk, but it does not close the AWS proof gate.

Do not use:

> Good progress has been made.

Unless the progress is tied to a closed gate.

---

### 5. No "done" without proof

Every done claim must map to at least one of:

- acceptance criterion
- test result
- artifact
- deployment proof
- review signoff
- storage/output evidence
- audit evidence
- explicit scope removal
- explicit risk acceptance

Use:

> This gate is done only when the AWS run artifact links source reference, vLLM endpoint, validation route, metrics, and cost estimate.

Do not use:

> AWS is basically done.

---

### 6. No hiding bottlenecks as dependencies

A bottleneck must be named as a bottleneck.

"Dependency" is too weak when the project is blocked by a decision, owner, environment, funding, access, resource, review, or acceptance gap.

Use:

> Bottleneck: AWS compute primitive is not selected, so Terraform closure cannot be proven.

Do not use:

> Dependency: AWS compute.

---

### 7. No scope drift camouflage

If the definition of done is expanding, unresolved, inconsistent, or stronger than the requested delivery answer implies, call that out.

Use:

> The requested finish answer is incompatible with the current living-doc definition of done unless scope is removed or downgraded.

Do not use:

> Scope should be clarified.

---

### 8. No responsibility blur

Separate work into accountability categories:

- implementation work
- decision work
- review and acceptance work
- infrastructure/resource work
- access/funding work
- risk acceptance work
- proof/evidence work
- operational ownership work

Do not collapse all of these into "remaining work."

---

### 9. No manager comfort summary as the primary output

A manager-facing summary is allowed, but it must compress accountability, not dilute it.

The primary output must be the closure path and bottleneck map.

Use:

> Manager-facing summary: three gates remain, and two are not owned by implementation.

Do not use:

> We are tracking toward completion with a few remaining items.

---

### 10. No treating uncertainty as implementer weakness

Distinguish uncertainty caused by:

- missing decisions
- missing acceptance criteria
- unbuilt proof surfaces
- unstable scope
- external infrastructure gates
- missing review ownership
- implementation unknowns

Do not collapse these into generic uncertainty.

Use:

> The uncertainty is not coding uncertainty. It comes from an unowned AWS deployment decision and missing closure proof.

---

### 11. No unowned blockers

If a step cannot proceed or close without ownership, say "owner required."

Do not leave blockers passive.

Use:

> Owner required: someone must decide whether AWS Batch, ECS GPU, or SageMaker-style serving owns the vLLM runtime.

Do not use:

> The compute primitive remains open.

---

### 12. No silent tradeoffs

If a gate is skipped, deferred, or downgraded, state exactly what risk is accepted and which finish claim becomes invalid.

Use:

> If AWS proof is skipped, the MVP can only be called local prototype complete, not AWS-backed MVP complete.

Do not use:

> AWS proof can be deferred.

---

### 13. No accepting vague finish language

Reject undefined finish labels such as:

- done
- ready
- MVP complete
- basically finished
- production-ready
- near production
- good enough
- unblocked

Unless they are mapped to explicit closure criteria.

Use:

> "MVP complete" currently means AWS-backed vLLM run, validated extraction-result/v1 records, storage proof, audit proof, and parser isolation proof.

---

### 14. No hiding acceptance ownership

If acceptance requires a person, team, reviewer, process, or business decision, identify it as acceptance ownership.

Use:

> Acceptance ownership required: someone must approve whether review-route outputs satisfy the MVP or whether only accepted-route outputs count.

---

### 15. No conflating local proof with production proof

Local tests, local smoke runs, and local fixtures may reduce risk, but they do not satisfy AWS, deployment, operational, or production proof gates unless the living doc explicitly says they do.

Use:

> Local LM Studio proof supports adapter development; it does not satisfy AWS MVP closure.

---

## Input

A living doc containing some or all of:

- objective
- success condition
- invariants
- acceptance criteria
- target architecture
- implementation definitions
- test coverage
- verification surface
- open questions
- code anchors
- relationship maps
- current status
- tickets
- proof requirements
- blockers
- partial implementation notes

---

## Output structure

### 1. Accountability readout

State the project's real completion posture in direct language.

Template:

> This is not a single implementation task. The living doc defines completion as a set of proof gates. Some gates are coding work, but others require infrastructure decisions, acceptance ownership, AWS proof, storage proof, audit proof, or explicit scope removal.

Include whether the current "done" question is answerable by implementation alone.

---

### 2. Closure path

Extract the smallest honest sequence of gates needed to reach the documented success condition.

For each gate include:

- gate name
- current state
- what must become true
- proof artifact required
- bottleneck risk
- accountability type
- owner required, if not inferable

Example format:

```text
Gate 1: Contract stabilization
Current state: partial
Must become true: extraction-result/v1 is stable across deterministic and Gemma paths.
Proof required: accepted/review/rejected fixtures and validator tests.
Bottleneck: route semantics and event-specific required fields can block validation.
Accountability type: implementation + acceptance.
Owner required: acceptance owner for route policy.
```

---

### 3. Integrated living-doc output

The primary deliverable is an accountability section inside the source living doc, rendered by the normal living-doc compositor. Do not create a separate accountability HTML page or a separate accountability JSON model.

Run with the bundled script when possible:

```bash
node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs <doc.json-or-rendered-html-or-file-url> --locale <en|nl|id>
```

Locale options:

```bash
--locale en
--locale nl
--locale id
```

The renderer behavior:

- Resolve a `.json`, `.html`, or `file://...html#anchor` input to the source living-doc JSON.
- Extract the living doc into an internal `living-doc-accountability-path/v1` model.
- Upsert one section with `id: accountability-closure-path`, `convergenceType: accountability-closure-path`, and title `Wanneer is het af?` / `When is it done?` / `Kapan selesai?`.
- Store all user-facing accountability text as localized values for English, Dutch, and Bahasa Indonesia.
- Set the source document locale from `--locale`.
- Render the source living doc with `node scripts/render-living-doc.mjs <source-doc.json>`.
- Report the rendered living-doc HTML path.

Unsupported output paths:

- Do not use or recreate `--out`.
- Do not use or recreate `--model-out`.
- Do not use or recreate `--from-model`.
- Do not create `<source>-accountability-path.*.html`.
- Do not create `<source>-accountability-path.*.json`.

No fallback rule:

- Use the generic extractor for every living doc type. Do not add one-off document-specific render branches.
- Do not publish generic fallback gate prose.
- Each gate must be rendered through a specific gate lens derived from the acceptance criterion.
- Every gate lens must include explicit English, Dutch, and Bahasa Indonesia text.
- If no lens matches, fail the render and require a new lens. Do not produce a placeholder, approximation, generic gate, or partial standalone artifact.
- If a localized label or gate translation is missing, fail the render. Do not fall back to another language.

Commit rule:

- The source living-doc JSON and rendered living-doc HTML are durable development artifacts.
- Whenever this skill creates or edits the integrated accountability section, commit both the source JSON and rendered HTML immediately in the repo that owns them.
- If old standalone accountability artifacts exist for the same source doc, remove them in the same owner-repo commit.
- If the skill script, skill instructions, or renderer behavior changed in the same run, commit those skill changes separately in the compositor repo, unless the user explicitly asks for a single cross-repo worktree state without commits.
- Do not leave regenerated living-doc JSON/HTML as uncommitted scratch files after a successful render.

Rendered section requirements:

- The section title is always the localized form of `When is it done?`.
- Every gate shown in the section must include current state, must-become-true condition, proof required, bottleneck risk, accountability type, owner required, and if-skipped consequence.
- Every `closed` visual state must map to proof on the same gate card.
- Every unowned blocker must visibly say the localized form of `Owner required`.
- Every skipped, deferred, or downgraded gate must name the accepted risk and invalidated finish claim.
- Local proof must be labeled as local proof when it does not satisfy production, deployment, AWS, or operational closure.
- The section must preserve the normal living-doc style. Do not introduce a separate visual system, standalone page shell, or dossier fallback.

After rendering, report the source living-doc JSON path and rendered living-doc HTML path.
