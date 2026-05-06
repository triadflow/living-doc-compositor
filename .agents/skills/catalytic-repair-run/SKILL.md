---
name: "catalytic-repair-run"
description: "Run a full deep-repair pass when living-doc objective drift is detected, composing objective conservation, activation energy review, equilibrium rebalance, and reaction path validation into concrete doc, render, issue, and verification changes."
---

# catalytic-repair-run

Use this when the user says the agent is drifting, not finishing, narrowing the objective, defending closure, or when several governance-chemistry signals fire together.

## Law

A skill is a catalyst: it lowers the cost of the correct transformation. It must produce repaired source-system state, not just a better explanation.

## Inputs

- Living doc JSON path.
- Objective and success condition.
- Governance layer and fingerprint state.
- Recent commits, rendered artifacts, tests, and GitHub issues.
- Outputs from related reasoning passes when available:
  - objective-conservation-audit
  - activation-energy-review
  - equilibrium-rebalance
  - reaction-path-validator

## Workflow

1. Pause normal implementation or closure.
2. Run an objective conservation audit: account for every objective/success-condition term.
3. Run activation energy review: test whether completion proof crossed the objective threshold.
4. Run equilibrium rebalance: incorporate new user/source/issue evidence and repair stale state.
5. Run reaction path validation: block illegal jumps and name the nearest honest stage.
6. Patch the living doc to the honest state.
7. Render the doc:
   ```bash
   node scripts/render-living-doc.mjs <doc>
   ```
8. Update GitHub issues where needed: create, reopen, close, link, or comment.
9. Run targeted validation that matches the repaired state.
10. Report the resulting state and next action concisely.

## Output

Return one of these states:

- `repaired-and-continuing`: work resumes from a corrected open state.
- `repaired-and-blocked`: a blocker is explicit and tracked.
- `repaired-and-pivoted`: objective changed without pretending the old objective completed.
- `repaired-and-closed`: closure survived conservation and activation review.
- `unable-to-repair-without-user-decision`: a real decision is required.

## Repair Rule

Do not end with analysis only. A catalytic repair run should leave the living doc JSON, rendered HTML, GitHub issue state, and final answer saying the same honest thing.
