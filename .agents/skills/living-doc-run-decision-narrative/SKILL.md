---
name: living-doc-run-decision-narrative
description: Create a static HTML decision narrative for a completed or in-progress living-doc harness lifecycle run. Use when the user asks to explain, narrate, inspect, summarize, or make a post-run report of why inference units chose repair, balance scan, ordered skills, continuation, closure review, blockers, or terminal closure from `.living-doc-runs` artifacts.
---

# Living Doc Run Decision Narrative

Use this skill after a living-doc harness run to create a readable HTML page that explains the run as a chain of inference decisions.

The point is not to redraw the lifecycle graph. The point is to preserve **why** each important transition happened:

- reviewer verdict and reason code
- post-review selected unit
- balance-scan imbalance diagnosis and ordered skills
- repair-skill judgments, changed files, and commit intent
- readiness or blocker judgment
- closure-review approval or rejection
- deterministic lifecycle action that followed each inference signal

## Workflow

1. Locate the lifecycle result.
   - Accept either a lifecycle id such as `ldhl-...` or a path to `lifecycle-result.json`.
   - Default run directory is `.living-doc-runs`.

2. Render the narrative:

   ```bash
   node .agents/skills/living-doc-run-decision-narrative/scripts/render-run-decision-narrative.mjs <lifecycle-id-or-result-path>
   ```

   Useful options:

   ```bash
   --runs-dir .living-doc-runs
   --out docs/<name>.html
   --title "Readable title"
   ```

3. Open the generated page when the user asks to view it:

   ```bash
   open docs/<generated-file>.html
   ```

4. When reporting back, name the output HTML path and the run id.

## What To Inspect

The renderer reads these artifacts when present:

- lifecycle result: `lifecycle-result.json`
- iteration output-input: `output-input/iteration-N.json`
- reviewer verdict: `reviewer-inference/iteration-N-verdict.json`
- worker unit result and final message
- repair chain result: `repair-skills/iteration-N/repair-chain-result.json`
- balance scan result: `repair-skills/iteration-N/00-living-doc-balance-scan/result.json`
- ordered repair-skill unit results, validations, input contracts, and codex-events logs
- closure review result: `inference-units/iteration-N/03-closure-review/result.json`

## Narrative Rules

- Lead with decisions, not artifact inventory.
- Distinguish inference judgment from deterministic enforcement.
- Say when the reviewer decided `repairable`, `closed`, `true-blocked`, or another lifecycle signal.
- Say when the controller merely mapped an inference signal to a next unit.
- For balance scan, preserve the imbalance labels and ordered skills.
- For repair skills, preserve `status`, `basis`, `changedFiles`, `commitIntent`, and `nextRecommendedAction`.
- For closure, say whether closure-review approved terminal closure and why.
- Include required-inspection-path coverage when input contracts and codex-events logs are available.

## Output

The HTML must be standalone and local. It may reference local artifact paths as text, but must not embed raw private JSONL payloads or full prompts.
