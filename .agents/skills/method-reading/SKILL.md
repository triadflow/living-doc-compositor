---
name: "method-reading"
description: "Read a living doc as a method surface and report objective, current state, ontology, control, evidence, value, and optional risk, solution-space, and convergence-advice sidecars with grounding."
---

# /method-reading

Read a living doc to understand the method behind it. This is a sidecar reading, not a rewrite of the living doc.

## Usage

```bash
/method-reading <path/to/doc.json>
/method-reading <path/to/doc.html>
/method-reading <path> --with-risk
/method-reading <path> --with-convergence-advice
/method-reading <path> --with-grounding
/method-reading <path> --dry-run
```

If the user gives a rendered HTML path, resolve the sibling JSON first when possible.

## What this skill does

It reads a living doc and produces a grounded sidecar reading across six questions:

1. What is the work trying to make true?
2. What is true now relative to that objective?
3. What counts as a thing here?
4. Where does control live?
5. What counts as evidence?
6. Where does the author think value comes from?

Use this skill when the user wants to assess how a person, team, or project thinks, not only what the document says.

When the user also wants strategic judgment, add an optional risk-and-solution-space pass on top of the method reading. That pass still stays outside the living doc.

When the user wants help turning the advice into a better document shape, add an optional convergence-advice pass. That also stays outside the living doc.

## Execution

### 1. Resolve and read the doc

Load:

- `title`
- `objective`
- `successCondition`
- `objectiveFacets`
- `coverage`
- `invariants`
- `metaFingerprint`
- every `section.id`, `section.title`, `section.convergenceType`, `section.rationale`
- every card's `id`, `name`, `status`, notes, and references

Also read `scripts/living-doc-registry.json` so convergence types are interpreted correctly.

If the input is an older rendered doc with sparse root metadata, treat section titles, convergence types, statuses, notes, and linked work as the primary surface.

### 2. Read enough grounding to trust the interpretation

The doc alone is often not enough.

Read the most relevant grounded materials referenced by the most important cards, for example:

- `codePaths`
- `artifactPaths`
- `ticketIds`
- linked issues or PRs
- cited URLs
- adjacent source docs

Read enough to answer whether the document's claimed current state matches the underlying work. Do not bulk-read everything.

### 3. Derive the sidecar reading

Produce six sections.

#### Objective read

Answer:

- what the work is trying to make true
- what the objective locks in
- what boundary the document is actually operating inside

Stay close to the document's own objective and success condition when they exist. If they do not exist, derive the objective from the strongest grounded sections and say that this is an inferred read.

#### Current state read

Answer:

- what is already solid
- what is partial
- what is unresolved
- what the current edge of the work appears to be

This is the first-order state read. Keep it concrete before moving into method interpretation.

#### Ontology

Answer:

- what gets first-class representation
- what kinds of sections dominate
- what the document treats as the central unit of work

Prefer readings like:

- teams / pipelines / tools
- claims / proofs / checkpoints
- periods / indicators / moves
- decisions / control points / invariants

#### Control model

Answer where coherence comes from:

- status
- decision surfaces
- proof ladders
- governance layer
- cadence / periods
- operator notes

Say what the doc seems to trust to keep the work sane.

#### Evidence model

Answer what counts as enough proof to move the doc forward.

Look for:

- code anchors
- shipped artifacts
- tickets
- citations
- metrics
- human notes
- benchmarks

If the evidence model is thin or mixed, say so directly.

#### Value model

Answer where the document implies value comes from.

Examples:

- architecture completeness
- reliable operations
- repeated output loops
- research freshness
- stronger governance / trust

Do not reduce this to the stated objective if the sections clearly imply a different center of gravity.

#### Current tension

Name the strongest live tension visible now, for example:

- system ambition ahead of proof
- rich governance with stale operational grounding
- strong output loop but weak control model
- good evidence surface but unresolved value path

This should be a current-state reading, not a generic critique.

### 4. Optional risk-and-solution-space pass

Use this only when the user asks for risk, mitigation, solution space, pivot options, or strategic concern assessment.

Build the risk pass on top of the first-order reads above. Do not skip objective read or current state read.

Assess only risks that matter relative to the work's objective. Prefer a compact frame:

#### Objective-target risk

- Is the work aimed at the right thing?
- Is the objective scoped too broadly, too narrowly, or at the wrong level of abstraction?

#### Model risk

- What risk follows from the chosen explicit or implicit model of the work?
- What is being over-weighted or under-weighted by that model?

#### Sequencing risk

- What appears to be getting built too early?
- What useful loop or proof step may be getting deferred too long?

#### Evidence risk

- Where is the ambition ahead of the proof surface?
- Which claims are still thinly grounded for the level of system ambition?

#### Control risk

- Which unresolved decisions, handoff seams, or autonomy boundaries still threaten coherence?

#### Operational risk

- Cost, activation, instrumentation, reliability, or coordination risks that could stall the work even if the model were otherwise sound.

Then add two forward-moving sections:

#### Mitigations

- Specific ways to reduce the risks without changing the whole objective.
- Prefer sequence changes, proof gates, smaller loops, or sharper boundary decisions over abstract advice.

#### Pivot options

- Plausible changes in emphasis or scope if the current model is pointed at the wrong thing.
- Present these as options, not verdicts.
- If one option appears strongest, say why.

The tone must stay constructive. The point is not to sound critical. The point is to reveal the solution space clearly enough that a path forward becomes easier to discuss.

### 5. Optional convergence-advice pass

Use this only when the user asks how the work could be re-shaped in living-doc terms, how a pivot could be expressed structurally, or which convergence types would help.

Ground the advice in the current objective, current state, and risk pass. Then ask:

- Which document shapes would help the work pivot cleanly?
- Which shapes would make the next proof loop, decision boundary, or active frontier more visible?
- Which shapes would reduce the current model risk?

Always read the registry before advising. Prefer existing convergence types first. Only suggest a new type when the pivot cannot be expressed cleanly with current types.

The convergence-advice output should contain:

#### Recommended existing convergence types

For each recommendation, name:

- the type
- what problem it would solve in this case
- what section or companion doc it would belong in
- why it fits better than the current shape

Good examples of pivot-oriented advice:

- `proof-ladder` when the real need is staged proof rather than broad machine status
- `verification-checkpoints` when the next step is a small set of concrete validations
- `decision-record` when unresolved boundaries are creating drag
- `operating-surface` when one bounded lane needs focus
- `capability-surface` when parallel subsystem state is still the right view
- `content-production` or `content-outline` when the work should be steered by output cadence
- `indicator-trace` when the pivot requires empirical monitoring rather than architecture talk

#### Suggested doc re-shape

Explain whether the best move is:

- revise an existing section
- add one new section
- split the work into a second living doc
- keep the current doc and add only a sidecar

#### Governance advice

Say explicitly whether governance is:

- premature
- useful now
- or overdue

Then advise what layer, if any, should be added or tightened:

- a sharper `objective`
- a clearer `successCondition`
- `explainability-layer`
- `objectiveFacets`
- `coverage`
- `invariants`
- `coherence-map`

Also say whether `/explainability-sync` or `/crystallize` is the right follow-on move, or whether both are still too early.

Be specific about what governance would solve in this case:

- tighter objective targeting
- clearer current-state reading
- better proof gating
- stronger section coherence
- less drift between the work and the doc

Be equally specific when governance would be the wrong move:

- when the objective is still too vague
- when the proof surface is still too thin
- when governance would only formalize confusion
- when the next need is execution or verification, not meta-structure

Governance advice should help people decide whether to strengthen the doc's steering layer, not encourage governance for its own sake.

#### Candidate new convergence type

Only include this when existing types are not enough.

If needed, give:

- the problem shape that is still missing
- the source entities that recur together
- the likely projection (`card-grid` or `edge-table`)
- the status or derivation logic that would matter

When a genuinely new type seems needed, say explicitly that `/convergence-advisor` is the follow-on tool for defining it.

### 6. Keep direct reading separate from inference

The output must distinguish:

- `Observed in doc`
- `Observed in grounded sources`
- `Inference`

Do not collapse these together. The method reading can be sharp, but it cannot pretend certainty where only inference exists.

### 7. Keep it outside the living doc

This skill produces a sidecar reading only.

- Do not write ontology, control-model, evidence-model, or value-model analysis into the living doc.
- Do not write risk assessment, mitigations, or pivot options into the living doc.
- Do not write convergence-type advice or restructuring advice into the living doc as first-class content.
- Do not turn the sidecar reading into first-class document structure.
- If the user later wants the living doc updated, only update the normal work-centered parts of the doc: objective, current state, evidence, unresolved decisions, and next useful moves.

### 8. Report, do not mutate

Default behavior is read-only.

Do not edit the doc unless the user explicitly asks for a follow-on pass such as:

- `/explainability-sync`
- `/crystallize`
- article writing from the reading

## Output shape

Use a compact report with this structure:

```text
Method reading for <doc title>

Objective read:
<1 short paragraph>

Current state read:
<1 short paragraph>

Ontology:
<paragraph>

Control model:
<paragraph>

Evidence model:
<paragraph>

Value model:
<paragraph>

Current tension:
<paragraph>

Optional risk pass:
- objective-target risk: ...
- model risk: ...
- sequencing risk: ...
- evidence risk: ...
- control risk: ...
- operational risk: ...
- mitigations: ...
- pivot options: ...

Optional convergence advice:
- recommended types: ...
- suggested doc re-shape: ...
- governance advice: ...
- candidate new type: ... (only if needed)

Grounding:
- observed in doc: ...
- observed in sources: ...
- inference: ...
```

## Key principles

1. Objective and current state come first.
2. Read the method, not just the content.
3. Ground the interpretation in the real work when possible.
4. Keep observation and inference separate.
5. Risk passes are constructive and solution-oriented, not performative critique.
6. Convergence advice uses existing types first and new types only when necessary.
7. Keep the whole reading outside the living doc.
8. Do not silently edit the doc.
