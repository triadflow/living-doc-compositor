---
name: "objective-conservation-audit"
description: "Audit a living doc completion, deferral, pivot, or proof claim by checking whether every accountable term in the original objective and success condition is conserved as completed, blocked, deferred with trigger, pivoted, follow-up, or explicitly out of scope."
---

# objective-conservation-audit

Use this when a living doc is being closed, a user challenges completion, a proof claim feels too narrow, or work artifacts may be substituting for the objective.

## Law

The original objective cannot disappear during transformation. Any unresolved objective mass must reappear as one of:

- completed
- blocked
- deferred with trigger
- pivoted with rationale
- follow-up issue
- explicitly outside the objective

## Inputs

- Living doc JSON path.
- Original `objective` and `successCondition`.
- Governance fields when present: `objectiveFacets`, `coverage`, `invariants`, `metaFingerprint`.
- Current proof, decisions, attempts, status snapshot, and issue references.
- Relevant source reality: commits, generated artifacts, rendered HTML, GitHub issue state, and test output.

## Workflow

1. Read the living doc.
2. If governance exists, check `metaFingerprint` before trusting `coverage`:
   ```bash
   node -e "import('./scripts/meta-fingerprint.mjs').then(async m => { const fs=await import('node:fs'); const doc=JSON.parse(await fs.promises.readFile('<doc>','utf8')); console.log(JSON.stringify(m.checkFingerprint(doc.metaFingerprint, doc.sections), null, 2)); })"
   ```
3. Break the objective and success condition into accountable terms. Keep the original wording visible.
4. Build a conservation ledger. For each term, assign exactly one state: completed, blocked, deferred, pivoted, follow-up, outside-objective, or unaccounted.
5. Ground each assignment in a specific card, issue, commit, generated artifact, rendered artifact, or test result.
6. If any term is unaccounted, do not recommend closure. Patch the living doc or create/link an issue so the missing mass becomes visible.
7. Render the living doc after edits:
   ```bash
   node scripts/render-living-doc.mjs <doc>
   ```
8. If files changed, create a focused commit before finishing the run. The commit message must name the repaired conservation failure, not just say "update doc".

## Output

Return one of these states:

- `continue`: objective is open and next work is known.
- `repair`: doc or issue state was dishonest and has been corrected.
- `block`: a rate-limiting objective term prevents closure.
- `defer`: unresolved work is outside the current objective and has a trigger.
- `pivot`: the objective changed and the old objective is not claimed as complete.
- `close`: every accountable term is conserved and no plausible user rejection remains.

## Closure Rule

Do not close when any accountable objective term is unaccounted. Do not narrow the objective after implementation to fit completed work.

## Commit Rule

When this skill changes the living doc, rendered HTML, skills, or source artifacts, commit those changes in the same run. Use a detailed commit body that records:

- the objective terms that were unaccounted
- the state they were moved to
- any issue changes made
- validation or render commands run
