---
name: living-doc-harness-supervisor
description: "Use when supervising, testing, calibrating, or production-running the standalone living-doc harness. Enforces the observer/governor boundary: start or watch the standalone harness run, inspect wrapper and native inference evidence, create a GitHub issue for any blocker or process defect, and stop without implementing fixes unless explicitly approved."
---

# Living Doc Harness Supervisor

## Core Rule

Use the standalone harness process. Do not turn a blocker, misclassification, trace problem, dashboard gap, or worker failure directly into implementation work.

The supervising inference is not the worker and not a second implementer. Its job is to:

1. start or watch the standalone harness run;
2. inspect durable run artifacts and direct native inference evidence;
3. classify the outcome;
4. create a GitHub issue for every blocker or process defect;
5. stop and wait for explicit approval before implementing any fix.

## Triggered Scope

Use this skill when the user asks to:

- test a living doc through the headless harness;
- run a calibration fixture;
- supervise a standalone living-doc harness run;
- inspect why a harness run stopped;
- review dashboard, trace, evidence, or proof output from a run;
- handle a harness blocker, proof gap, trace mismatch, dashboard gap, or premature closure signal.

Do not use this skill for ordinary living-doc editing or for directly implementing the objective inside a living doc.

## Standalone Run Procedure

1. Check repo state first:

```bash
git status --short --branch
```

2. Identify the living doc JSON to run. Use the doc the user named, the open dashboard selection, or the current issue/run context. If no doc is identifiable, ask for the doc path and stop.

3. Prefer the dashboard/backend as the supervising surface when available:

```bash
npm run ldoc:harness:dashboard
```

Then start the run through the dashboard UI or API. The desired API shape is:

```bash
curl -s -X POST http://127.0.0.1:4334/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"docPath":"<doc.json>","execute":true}'
```

4. If the dashboard/backend is not available yet, run the standalone runner directly, but keep the same observer boundary:

```bash
node scripts/living-doc-harness-runner.mjs start <doc.json> \
  --runs-dir .living-doc-runs \
  --execute
```

5. Watch until the run reaches a terminal process result. Do not edit code, the living doc, fixture files, tests, or dashboard implementation while the worker is running.

## Evidence Inspection

Inspect the run directory, not chat memory:

```bash
cat .living-doc-runs/<run-id>/contract.json
cat .living-doc-runs/<run-id>/state.json
tail -n 120 .living-doc-runs/<run-id>/events.jsonl
tail -n 120 .living-doc-runs/<run-id>/codex-turns/codex-events.jsonl
tail -n 120 .living-doc-runs/<run-id>/codex-turns/codex-stderr.log
```

If the dashboard tail endpoint exists, prefer it for live observation:

```bash
curl -s http://127.0.0.1:4334/api/runs/<run-id>/tail?lines=120
```

Inspect direct native trace evidence through sanitized summaries attached to the run:

```bash
node -e "const c=require('./.living-doc-runs/<run-id>/contract.json'); console.log(c.artifacts.nativeTraceRefs)"
cat .living-doc-runs/<run-id>/traces/*.summary.json
```

Do not infer the run outcome from the worker final message alone. The authoritative evidence is the combination of:

- run contract and state;
- wrapper events;
- native trace refs and summaries;
- proof artifacts;
- terminal state;
- evidence bundle;
- dashboard gates;
- living-doc source and rendered artifact state.

Raw native trace payloads are local operator evidence only. Do not paste raw prompts, raw reasoning, raw messages, or private payload content into issues, commits, summaries, or dashboards.

## Outcome Classification

Use the harness evidence to classify the result:

- `closed`: objective terms and acceptance criteria are proven by artifacts, native trace refs, proof state, and dashboard gates.
- `repairable`: objective/proof state is unsatisfied and a repair skill or next implementation run can act.
- `resumable`: worker stopped before completion while the next action is clear.
- `closure-candidate`: worker claims done, but proof is incomplete or acceptance criteria are not conserved.
- `true-block`: source, permission, proof authority, privacy boundary, platform capability, or objective decision is missing.
- `pivot`: the original objective no longer matches valid work.
- `deferred`: completion depends on a later trigger.
- `budget-exhausted`: allowed time or iteration budget ended without proof.
- `process-defect`: the harness, dashboard, trace reader, proof gate, or supervising process violated its contract.

If classification reveals a blocker or process defect, create a GitHub issue and stop.

## Issue Procedure

For every blocker or process defect:

1. Stop implementation work.
2. Create a GitHub issue.
3. Include:
   - run id;
   - living doc path;
   - command or dashboard/API action that started the run;
   - process result and exit code;
   - stage/gate;
   - reason code or classification;
   - direct inference evidence used, preferably sanitized trace summary refs and hashes;
   - wrapper/native mismatch if present;
   - governance or proof verdict when present;
   - sanitized evidence path or dashboard path;
   - owning-layer hypothesis;
   - acceptance criteria for fixing the blocker.
4. Reference related issues, but still create a new issue for the new blocker.
5. Stop and wait for explicit approval.

Use `gh issue create` from the repo root:

```bash
gh issue create --repo triadflow/living-doc-compositor \
  --title "<specific blocker title>" \
  --body-file <issue-body.md>
```

## Clean Completion

If the run completes cleanly:

1. Verify the target objective from source artifacts, not worker self-report.
2. Verify the living doc source and rendered HTML if the objective requires them.
3. Verify proof artifacts and dashboard gates agree with closure.
4. If evidence is complete, report the run id, verdict, evidence paths, and verification commands.
5. Do not strengthen living-doc status beyond what the proof gates show.

Only commit evidence or living-doc updates when the user explicitly asked for that or the governing issue/run process requires it.

## Approval Boundary

Only implement a fix after the user explicitly approves the new issue or explicitly asks to implement that issue.

When approved:

1. Implement only the owning-layer correction described by the approved issue.
2. Add or update focused tests for that correction.
3. Rerun the same standalone harness path.
4. If the run blocks again, create a new issue and stop again.

## Forbidden Moves

- Do not edit source files while the standalone worker is still running.
- Do not repair the living doc manually to make the worker look successful.
- Do not patch harness code in the same supervision pass that discovered the blocker.
- Do not infer closure from the final worker message or wrapper summary alone.
- Do not hide process defects inside local implementation work.
- Do not reuse an existing issue as permission to implement a newly discovered blocker.
- Do not mark a living doc complete unless objective terms, acceptance criteria, proof artifacts, trace evidence, and dashboard gates agree.

## Layer Framing

When creating issues or implementing approved fixes, name the owning layer:

- dashboard/backend supervising surface;
- standalone runner/process isolation;
- direct native trace discovery;
- wrapper/native mismatch classification;
- stop-negotiation inference;
- skill routing and repair handover;
- terminal state and blocker policy;
- evidence bundle and dashboard reporting;
- living-doc objective/proof/governance state;
- source-system implementation objective.
