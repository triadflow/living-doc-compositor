---
name: "oss-issue-deep-dive"
description: "Compose a living doc for a stuck open-source issue by reading the issue thread, related PRs and issues, relevant code, and prior attempts."
---

# /oss-issue-deep-dive

Pick one stuck issue in an open-source repo you have no prior context in, read everything orbiting it (thread, linked PRs, related issues, source code, workaround commits), and compose a living doc that any fresh agent or human can load to start engineering work without redoing archaeology.

## Usage

```
/oss-issue-deep-dive <owner/repo>                   # Scan and suggest a candidate issue
/oss-issue-deep-dive <owner/repo> <issue-number>    # Deep-dive a specific issue
/oss-issue-deep-dive <owner/repo>#<issue-number>    # Alternate shorthand
/oss-issue-deep-dive --dry-run <owner/repo> <num>   # Show sections without writing the file
```

## Background

- Template: `docs/living-doc-template-oss-issue-deep-dive.json`
- Convergence types used: `symptom-observation`, `investigation-findings`, `code-anchor`, `attempt-log`, `issue-orbit`, `maintainer-stance`
- Sister skill: `/crystallize` — run it after composition to stamp the `metaFingerprint` and surface orphan facets
- Prior art: the Textual #5380 trial (`docs/oss-trial-textual-5380.v2.json`) — the shape this skill produces

## What this skill does

Moves the ~30 minutes of archaeology a contributor would otherwise do by hand — reading the thread, following PR links, chasing referenced commits, inspecting code, comparing against closed siblings — into a composed living doc. The output is a **working surface**, not a summary: it is meant to be loaded into a Claude Code or Codex session and updated live as work progresses.

## Execution

### 1. Resolve the target

- Parse the argument. Accepted forms: `owner/repo`, `owner/repo <num>`, `owner/repo#<num>`, GitHub URL.
- Validate the repo exists (`gh api repos/<owner>/<repo>` returns success).
- If an issue number is given, skip to step 3.

### 2. Pick a candidate issue (when no number given)

Pull the open-issue list and rank by signal of *stuck-but-solvable*:

```bash
gh issue list --repo <owner/repo> --state open --limit 100 \
  --json number,title,comments,labels,updatedAt,createdAt > /tmp/oss-candidates.json
```

Signal heuristics (rough, not absolute):

- **High comment count** with `COLLABORATOR`/`MEMBER` participation — thread has weight
- **Has linked closed PRs** or commits in comments — prior attempts exist
- **Labels contain `bug` / `help wanted` / `good first issue`** — work is welcomed
- **Age > 30 days, last activity < 90 days** — stuck but not dead
- **Deprioritize**: auto-FAQ-bot threads, issues asking questions answered in the FAQ, docs typos, single-comment issues

Show the user the top 3–5 candidates with a one-line rationale each. Ask the user to pick, or proceed with the top candidate if non-interactive. Never silently pick a low-signal issue.

### 3. Deep-dive

Run the following reads. Parallelize where possible.

**Issue body and full comment thread:**

```bash
gh issue view <num> --repo <owner/repo> --comments
gh issue view <num> --repo <owner/repo> --json number,title,state,body,labels,author,createdAt,closedByPullRequestsReferences,url
```

**Linked and referenced PRs:**

- Follow `closedByPullRequestsReferences` if any
- Scan comment text for `#<num>` references and commit SHAs; fetch each
- For each linked PR: title, state, body, `gh pr view --comments` if discussion is substantive

**Related issues (issue-orbit candidates):**

```bash
gh issue list --repo <owner/repo> --state all --search "<2-3 keywords from focal issue>" --limit 20 \
  --json number,title,state,closedByPullRequestsReferences
```

Filter to ones with a structural relationship (same root cause, symmetric, adjacent, superseded, prior art). Drop weak topical overlaps.

**Source code:**

- Identify file paths mentioned in the thread or in linked PR diffs
- Fetch them at the repo's HEAD via `gh api repos/<owner>/<repo>/contents/<path>` (base64 decode)
- Note the revision SHA you read (for pinning in code anchors)
- If the thread references magic constants, function names, or specific line numbers — anchor them

**External references:**

- Workaround commits in *other* repos (e.g. downstream consumers) — fetch the commit diff
- FAQ entries, protocol specs, upstream issues — record URLs, do not transcribe

### 4. Compose the living doc

Copy the template:

```bash
cp docs/living-doc-template-oss-issue-deep-dive.json \
   docs/oss-issue-<owner>-<repo>-<num>.json
```

Populate the fields:

- **`objective`** — one sentence capturing what would be different after the fix
- **`successCondition`** — default is fine unless the issue has a specific acceptance criterion
- **`objectiveFacets`** — 4–7 facets decomposing the objective (root cause, proven workaround, shipping path, risks, etc.)
- **`invariants`** — observed regularities the archaeology revealed (e.g. "X is idempotent", "Y is called exactly once")

Populate the sections. **Type boundaries are strict:**

- `symptoms` → only cards with a real repro path and a named witness. No witness or repro → not a symptom.
- `findings` → synthesized claims without repro (drop the section if empty).
- `mechanics` → revision-pinned code anchors. Every card has a path, range, and SHA.
- `attempts` → actions with outcomes. Probes that revealed nothing are noise — drop them. Shipped workarounds must link the shipping site.
- `related` → sibling issues with an explicit relationship. Drop weak topical overlaps.
- `debate` → named stances with timestamps. If there is no debate, drop the section.

Author **`coverage`** edges mapping facets → cards. Flag orphan facets (no carrier) as open questions in the debate section — do not fabricate coverage.

### 5. Stamp and render

```bash
node -e "import('./scripts/meta-fingerprint.mjs').then(async m => {
  const fs = await import('node:fs');
  const path = '<doc-path>';
  const doc = JSON.parse(await fs.promises.readFile(path, 'utf8'));
  doc.metaFingerprint = m.computeSectionFingerprint(doc.sections);
  await fs.promises.writeFile(path, JSON.stringify(doc, null, 2) + '\n');
  console.log(doc.metaFingerprint);
})"

node scripts/render-living-doc.mjs <doc-path>
```

Alternatively, invoke `/crystallize <doc-path>` — it stamps the fingerprint and also refines facets/coverage/invariants.

### 6. Report

After composition, report:

```
Deep-dive of <owner/repo>#<num>: <issue title>

- symptoms: <N> (<M with repro confirmed>)
- findings: <N>
- code anchors: <N> (all pinned to <revision>)
- attempts: <N> probe, <M workaround-shipped>, <P rejected>
- issue orbit: <N> sibling issues (<M closed>)
- stances: <N>
- orphan facets: <list or "none">
- fingerprint: sha256:<prefix>...

Doc: docs/oss-issue-<owner>-<repo>-<num>.json
Rendered: docs/oss-issue-<owner>-<repo>-<num>.html
```

Also surface the **open questions** the deep-dive could not answer (e.g. unresolved maintainer stance, unverified cross-platform claim). These belong in the `debate` section as unchallenged cards.

## Key principles

1. **The doc is a working surface.** Do not write a summary-shaped report. Write a doc that the next session will edit, not just read.
2. **Pin every code anchor to a revision.** Without the SHA, the pointer stales silently.
3. **Repro or it didn't happen.** A card in `symptoms` without repro steps and a witness is not a symptom — move it to `findings` or delete it.
4. **Preserve rejected attempts.** A future contributor needs to know what not to try. Mark rejected or superseded, don't delete.
5. **Stances are not decisions.** Maintainer said "not ours to fix" — that is a stance, possibly stale. Do not collapse into `decision-record`.
6. **Orphan facets are signals, not errors.** If a facet has no carrier, that usually means the deep-dive surfaced a gap — record it, don't fabricate coverage.
7. **Skip low-signal issues.** A single-comment `needs-help` question with no archaeology does not earn a living doc. The skill should decline and say so.
8. **Never fabricate.** If the thread is thin, the doc is thin. Stretching is worse than producing less.
