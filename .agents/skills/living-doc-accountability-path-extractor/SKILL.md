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

### 3. Statische HTML-pagina

The primary deliverable is a standalone Dutch proof dossier page, not a chat-only report.

Render with the bundled script when possible:

```bash
node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs <doc.json-or-rendered-html-or-file-url>
```

Useful options:

```bash
node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs <doc> --out <path>
node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs <doc> --model-out <path>
node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs --from-model <model.json> --out <path>
```

The renderer is JSON-model based:

- Extract the living doc into a `living-doc-accountability-path/v1` model.
- Render HTML from that model.
- Use the generic extractor for every living doc type. Do not add one-off document-specific render branches.
- The rendered page title is always `Wanneer is het af?`.
- The visible HTML is Dutch-only. Do not show raw English objectives, success conditions, acceptance text, or source-card prose on the page. Keep source paths, ids, and raw card references in the JSON model.
- Use `--model-out` when the accountability model should be inspectable, versioned, or rendered again later.
- Use `--from-model` to render an existing model without rereading the living doc.
- Output is Dutch only. Do not create English accountability pages or English accountability JSON models.
- Default artifact names must use `.nl`: `<source-doc-slug>-accountability-path.nl.html` and `<source-doc-slug>-accountability-path.nl.json`.

Commit rule:

- The generated accountability JSON model and generated accountability HTML page are durable development artifacts.
- Whenever this skill creates or edits either artifact, commit both the JSON and HTML immediately in the repo that owns them.
- Commit only Dutch accountability artifacts: `.nl.html` and `.nl.json`.
- If the skill script, skill instructions, or renderer behavior changed in the same run, commit those skill changes separately in the compositor repo, unless the user explicitly asks for a single cross-repo worktree state without commits.
- Do not leave regenerated accountability artifacts as uncommitted scratch files after a successful render.

Create the page at:

```text
docs/<source-doc-slug>-accountability-path.nl.html
```

If the source living doc is outside this repo, create the HTML next to the source JSON unless the user asks for another location.

The page must be fully standalone:

- inline CSS
- inline JavaScript only if it materially improves scanning or filtering
- no external fonts
- no external scripts
- no CDN assets
- no network calls
- no dependency on the compositor iframe

The page must preserve the accountability stance of this skill. Visual polish must not soften, hide, rename, or dilute blockers.

Required page structure:

```text
1. Bewijsdossier-header
   - fixed title: Wanneer is het af?
   - generated timestamp
   - gate count
   - source reference label without dumping raw source prose

2. Left review rail
   - direct no-date verdict
   - explicit implementation-alone yes/no line
   - compact counts by state
   - owner-required count

3. Memo
   - accountability readout
   - finish-label meaning
   - incompatibility between vague finish language and open proof gates

4. Afsluitpoorten
   - one dossier block per gate
   - state badge
   - accountability type badges
   - owner-required badge when ownership is missing
   - proof required
   - bottleneck risk

5. Knelpunten
   - only real bottlenecks
   - each bottleneck names what it blocks, why it blocks closure, owner required, and risk if skipped

6. Bewijsboekhouding
   - proven
   - partial
   - missing
   - invalid for closure

7. Samenvatting
   - short summary that compresses accountability without comfort language
```

Visual requirements:

- Use a serious proof-dossier style: paper-like, restrained, readable, and print-friendly.
- Use a warm light background with high-contrast text.
- Use color as status semantics, not decoration.
- Suggested status colors:
  - closed: green
  - partial: amber
  - open: blue
  - blocked: red
  - unclear: gray
- Use a wide desktop layout with a sticky left review rail when there is enough space.
- Collapse to a single-column mobile layout.
- Keep cards at 8px radius or less.
- Do not use decorative gradients, blobs, oversized hero treatment, marketing copy, or dashboard theater.
- Do not hide required proof or owner-required labels behind hover-only UI.
- Make the page printable: avoid dark backgrounds, preserve section breaks, and include timestamp. Source path and raw source references belong in the JSON model.

Content requirements:

- Every gate shown on the page must include current state, must-become-true condition, proof required, bottleneck risk, accountability type, and owner required.
- Every "done" or "closed" visual state must map to proof on the same gate block.
- Every unowned blocker must visibly say `Owner required`.
- Every skipped, deferred, or downgraded gate must name the accepted risk and invalidated finish claim.
- Local proof must be labeled as local proof when it does not satisfy production, deployment, AWS, or operational closure.
- Do not embed the full raw living doc JSON. Show extracted accountability evidence and source references only.

Suggested file footer:

```text
Generated by living-doc-accountability-path-extractor. This page is a proof-based closure path, not a schedule estimate.
```

After creating the page, report the generated HTML path, generated JSON path when created, and the source living doc path.
