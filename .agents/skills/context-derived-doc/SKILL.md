---
name: "context-derived-doc"
description: "Compose a first normal living doc from authorized context before native adoption, plus an optional derivation memo kept outside the doc."
---

# /context-derived-doc

Build a first living doc from authorized context. This skill is for cases where the subject, team, or project does not already maintain a living doc, but enough source material exists to model the work.

## Usage

```bash
/context-derived-doc <target-name>
/context-derived-doc <target-name> --sources "<brief source envelope>"
/context-derived-doc <target-name> --dry-run
```

## What this skill does

It turns a set of allowed sources into:

- one normal living doc about the work
- one optional derivation memo about how that doc was assembled and what remains uncertain

Use it when:

- a founder, team, or collaborator has not adopted the format yet
- the work already exists across conversations, tickets, repos, notes, and artifacts
- you need a coherent model now

This skill creates a draft living doc. The living doc stays about the work itself, not about our interpretation process.

## Execution

### 1. Define the source envelope

Before reading broadly, name the allowed source set.

Typical inputs:

- conversations or transcripts
- issue threads
- repos and code
- internal or public docs
- working notes
- declared goals
- screenshots or artifacts

Do not read outside the authorized boundary.

### 2. Decide the modeled scope

Do not try to model the entire person or organization.

Pick one bounded scope:

- a method
- a system
- a workstream
- a decision field
- a value loop

If the scope is too broad, narrow it before drafting.

### 3. Read until structure repeats

Read across enough surfaces that a real pattern begins to recur.

Stop accumulating sources once you can answer:

- what the work is trying to do
- what the current state is relative to that objective
- what the main moving parts are
- what counts as evidence
- what is still unresolved
- what next moves seem most likely to create value

The point is not exhaustive reading. The point is a stable enough model to draft from.

### 4. Keep derivation separate from the living doc

During composition, keep these distinct in your own reasoning or in a sidecar memo:

- `Observed`
  direct statements, visible artifacts, explicit statuses, concrete code or ticket evidence
- `Inferred`
  likely objective, control model, value model, current reading
- `Unknown`
  missing facts the source set does not justify
- `Contested`
  conflicting signals that point to more than one reading

Do not flatten these into one confident voice.

### 5. Draft the living doc

Start from `docs/living-doc-empty.json`.

Draft:

- `title`
- `objective`
- `successCondition` when justified
- `sourceCoverage`
- sections that match the bounded scope
- cards that carry the work itself

The resulting doc should stay in the normal living-doc shape. It should answer:

- what the work is trying to make true
- what is true now
- what evidence supports that
- what remains unresolved
- what next moves are most useful

When useful, create sections that hold:

- current system shape
- proof surface
- decision surface
- operating surfaces
- value loops
- unresolved questions

Favor a small strong doc over a broad weak one.

### 6. Do not integrate derivation structure into the doc

Do not make these first-class living-doc structure:

- observed / inferred / unknown / contested taxonomies
- method-reading fields
- control-model commentary
- value-model commentary
- provenance frameworks as durable section structure

If those are useful, put them in the separate derivation memo.

Inside the living doc, keep only what belongs to the work surface itself. `sourceCoverage` is enough to say where the doc came from.

### 7. Stabilize the draft

After the first draft:

- set full ISO `updated` timestamps
- render the doc
- recommend `/crystallize` only after the shape is stable
- recommend `/explainability-sync` if a short reading would help later sessions

## Output

Produce:

- one draft living doc
- one short derivation note describing:
  - modeled scope
  - source envelope used
  - strongest objective read
  - strongest current-state read
  - major unknowns or contested areas

## Key principles

1. Authorized context only.
2. Model one bounded scope, not the whole world.
3. Objective and current state come first.
4. Stop when structure repeats.
5. Keep derivation separate from the living doc.
6. Draft a correction surface, not a polished mythology.
