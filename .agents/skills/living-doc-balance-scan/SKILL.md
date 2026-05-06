---
name: "living-doc-balance-scan"
description: "Triage an out-of-balance living doc before repair by classifying objective/governance instability signals, assigning likely imbalance types, and recommending an ordered sequence of governance-chemistry repair skills to run."
---

# living-doc-balance-scan

Use this when a living doc feels wrong, stale, prematurely closed, over-proofed, under-proofed, contradictory, or hard to classify. This skill does not repair first. It scans, classifies, and recommends the repair order.

## Purpose

An out-of-balance living doc may have several failures at once. Do not force a single label. Produce a multi-label diagnosis with confidence, evidence, and an ordered skill sequence.

## Imbalance Types

- `equilibrium-shift`: new user, source, issue, commit, test, or artifact evidence destabilized the current doc state.
  - Usually run: `equilibrium-rebalance`
- `conservation-leak`: objective or success-condition terms disappeared, were narrowed, or became hidden as vague future work.
  - Usually run: `objective-conservation-audit`
- `illegal-transition`: the doc jumped to ready, complete, closed, deferred, or pivoted without a valid stage path.
  - Usually run: `reaction-path-validator`
- `activation-shortfall`: completion evidence exists, but the proof threshold implied by the objective was not crossed.
  - Usually run: `activation-energy-review`
- `compound-instability`: multiple high-confidence imbalances fire together, or the user explicitly challenges the agent's reasoning/closure behavior.
  - Usually run: `catalytic-repair-run`
- `fresh-but-open`: the doc is coherent and current, but the objective is simply not finished.
  - Usually continue normal living-doc work.
- `classification-unclear`: signals conflict or evidence is insufficient.
  - Usually gather source/issue/doc evidence before repair.

## Inputs

- Living doc JSON path, or enough context to identify the relevant living doc.
- Objective and success condition.
- Status snapshot, proof ladder, decisions, attempts, findings, and issue references.
- Governance fields when present: `objectiveFacets`, `coverage`, `invariants`, `metaFingerprint`.
- Recent source evidence: commits, rendered HTML, tests, generated artifacts, GitHub issue state, and user objections.

## Workflow

1. Find and read the relevant living doc. If no path is provided, use the normal living-doc discovery path first.
2. Record the claimed current state: open, active, partial, ready, complete, closed, deferred, pivoted, or unclear.
3. If governance fields exist, check freshness before trusting `coverage`:
   ```bash
   node -e "import('./scripts/meta-fingerprint.mjs').then(async m => { const fs=await import('node:fs'); const doc=JSON.parse(await fs.promises.readFile('<doc>','utf8')); console.log(JSON.stringify(m.checkFingerprint(doc.metaFingerprint, doc.sections), null, 2)); })"
   ```
4. Gather quick signals:
   - user rejection or correction
   - stale or missing `metaFingerprint`
   - objective terms missing from proof/decisions/issues
   - closed issues while objective terms remain unaccounted
   - final-proof language before adversarial review
   - deferred work without trigger
   - stage/status jump without supporting proof
   - tests/artifacts proving only a slice
   - source artifacts contradicting proof cards
5. Assign one primary imbalance and any secondary imbalances. Use `confidence: low | medium | high`.
6. Recommend an ordered skill sequence. Default order:
   - `equilibrium-rebalance` first when freshness or new evidence destabilizes the doc.
   - `objective-conservation-audit` before any closure judgment.
   - `reaction-path-validator` before changing stage/status.
   - `activation-energy-review` before final completion proof.
   - `catalytic-repair-run` when multiple high-confidence imbalances are present or the user is actively challenging drift.
7. Say what should not happen yet, such as closing the issue, rewriting the objective, or adding more schema.
8. If this scan only diagnoses, do not commit. If the scan changes files or issue-linked artifacts despite the default no-repair posture, create a focused commit before finishing.

## Output Shape

Return a concise diagnosis:

```text
Claimed state: <state>
Primary imbalance: <type> (<confidence>)
Secondary imbalances: <type> (<confidence>), ...
Evidence:
- <specific doc/source/issue/user signal>
- <specific doc/source/issue/user signal>
Recommended skill order:
1. <skill>
2. <skill>
3. <skill>
Do not do yet:
- <closure/rewrite/schema/action to avoid>
Next action:
- <first concrete action>
```

## Scan Rules

- Do not repair before classification unless the user explicitly asks for immediate repair.
- Do not classify from vibes. Every label needs at least one concrete signal.
- Do not reduce multi-faceted instability to one label for neatness.
- Do not recommend closure until conservation, transition, and activation questions have been answered.
- Prefer existing governance and source-system evidence over adding new living-doc structure.

## Commit Rule

This skill normally produces diagnosis only, so it usually does not commit. If it changes the living doc, rendered HTML, skills, or source artifacts, commit those changes in the same run with a detailed message explaining why the scan crossed from diagnosis into state change.
