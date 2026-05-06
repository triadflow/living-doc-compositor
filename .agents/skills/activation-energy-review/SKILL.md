---
name: "activation-energy-review"
description: "Review whether a living doc completion claim has crossed the real proof threshold required by the objective, instead of merely accumulating closure-shaped artifacts such as green tests, closed tickets, commits, or rendered pages."
---

# activation-energy-review

Use this when tests pass, issues are being closed, a final proof appears, or a doc moves toward `ready`, `complete`, `final`, or `closed`.

## Law

Closure requires activation energy: a threshold proof event that survives contradiction against the objective. Administrative closure is heat, not proof.

## Inputs

- Living doc objective and success condition.
- Proof ladder, verification, findings, decisions, attempts, and status snapshot.
- Test output, generated artifacts, rendered HTML, commits, GitHub issue state, and user objections.

## Workflow

1. State the claimed completion in one sentence.
2. Identify the proof threshold implied by the objective and success condition.
3. List the current closure signals: green tests, commits, rendered docs, closed issues, proof cards, generated artifacts.
4. For each closure signal, ask what it proves and what it does not prove.
5. Try to break the completion claim with source reality, issue state, missing artifact surfaces, stale governance, and plausible user rejection.
6. If the proof does not cross the threshold, downgrade the claim to partial, blocked, or continue.
7. If editing the living doc, render it after the update.
8. If files changed, create a focused commit before finishing the run. The commit message must name the proof-threshold decision.

## Output

Return one of these states:

- `threshold-met`: proof survived contradiction and closure can proceed.
- `threshold-not-met`: evidence exists but does not satisfy the objective.
- `partial-proof`: useful proof exists for a slice only.
- `blocked-by-missing-proof`: a specific proof condition is absent.
- `ready-for-hostile-final-proof`: enough evidence exists for adversarial final review, but closure is not automatic.

## Closure Rule

Passing tests, rendered artifacts, and closed issues can support closure, but none of them replace the objective. If the proof did not try to fail, it is not final proof.

## Commit Rule

When this skill changes the living doc, rendered HTML, issues, or validation artifacts, commit those changes in the same run. Use a detailed commit body that records:

- the claimed closure threshold
- whether the threshold was met or missed
- what evidence was accepted or rejected
- validation or render commands run
