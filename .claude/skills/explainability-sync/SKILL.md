# /explainability-sync

Add or refresh an explainability section on a living doc. This is not a board-building pass. It produces one extremely short explanation of the document.

## Usage

```bash
/explainability-sync <path/to/doc.json>
/explainability-sync <path/to/doc.json> --refresh
/explainability-sync <path/to/doc.json> --dry-run
```

## What This Skill Does

Turns the document's implicit reading into one short explanation that says:

1. What the objective really means
2. What the current state is

Use it when the document is precise enough that an LLM could misread it and take a locally plausible but globally wrong path.

## Execution

### 1. Read the doc as a whole

Load the JSON and read:

- `objective`
- `successCondition`
- `objectiveFacets`
- `coverage`
- `invariants`
- every `section.id`, `section.title`, `section.convergenceType`, `section.rationale`
- every card's `id`, `name`, `status`, notes, and references

Also read `scripts/living-doc-registry.json` so you understand what each section's convergence type is supposed to mean.

### 2. Read grounded source materials

Do not explain from the doc alone when stronger grounding is available.

Read the most relevant materials referenced by the doc, for example:

- `codePaths`
- `ticketIds` via `gh issue view`
- `specRefIds`
- `issue-orbit` links
- adjacent source docs explicitly named in notes

Read enough to understand the document's intended reading. Do not bulk-read every linked artifact.

### 3. Derive the interpretation

Reduce what you learned to two things only:

- the real objective
- the current state

Resolve the real objective from both `objective` and `successCondition`, not from `objective` alone.

- If `objective` uses weak monitoring language like `track`, `watch`, `map`, `audit`, or `monitor`, but `successCondition` names a concrete finish line, the explainability text must teach the finish line.
- Prefer the destination over the instrument.
- Ask: **"What has to become true for this doc to be done?"** That answer is usually the explainability objective.
- Then go one step further: phrase the objective as the real state change, not as the document's bookkeeping instrument.
- Prefer verbs like `get`, `make`, `prove`, `ship`, `remove`, `enforce`, `close`, or `stabilize`.
- Avoid objective lines that only describe the document looking at work, such as `track the ladder`, `monitor the rollout`, or `map the system`, when the real goal is to change the system state underneath.

Everything else is only input. Do not emit section taxonomy, false-friend lists, or operator manuals unless the user explicitly asks for them.

### 4. Write or refresh the explainability section

Use convergence type `explainability-layer`.

Default section shape:

```json
{
  "id": "explainability",
  "title": "Explain this doc",
  "convergenceType": "explainability-layer"
}
```

Hard rule:

- one card by default
- five sentences maximum across the whole section
- spend most of the sentence budget on the objective explanation
- the rest goes to current state

Preferred card shape:

```json
{
  "id": "explain-doc",
  "name": "Objective and current state",
  "objectiveExplanation": "<2-3 sentences>",
  "currentState": "<1-2 sentences>"
}
```

### 5. Guardrails

- Do not invent new constraints unsupported by the doc or grounded sources.
- Do not turn this into another mini-doc with multiple cards.
- Do not spend sentences on references, caveats, or meta-commentary.
- Do not parrot weak process language when the doc is clearly driving toward a stronger outcome.
- Do not confuse the scorecard with the goal. If the ladder, board, map, or tracker is only an instrument, explain the state change it is trying to force.
- Do not add `coverage` edges for explainability cards by default.
- Preserve exact wording when copying source text. Otherwise paraphrase tightly.

### 6. Finish

- Update the section and doc `updated` timestamps with full ISO precision.
- If `scripts/meta-fingerprint.mjs` exists, refresh `metaFingerprint` after adding or removing cards/sections.
- Re-render with:

```bash
node scripts/render-living-doc.mjs <path/to/doc.json>
```

## Success Test

After the pass, a fresh agent should be able to answer:

- What is this doc optimizing for?
- What is the current state of that objective?
