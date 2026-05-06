---
name: "equilibrium-rebalance"
description: "Repair a living doc when new evidence destabilizes its current state, such as a user rejection, reopened issue, stale governance fingerprint, source/proof contradiction, or fresh commit that changes objective pressure."
---

# equilibrium-rebalance

Use this after a user correction, reopened issue, stale or missing governance fingerprint, source/proof contradiction, or any new evidence that makes the current living doc state questionable.

## Law

Living docs can reach local equilibrium without being complete. New evidence shifts pressure; the doc must rebalance instead of defending the old state.

## Inputs

- Living doc JSON path.
- Current status snapshot, proof, decisions, attempts, findings, and issue references.
- Governance freshness: `metaFingerprint` check when governance exists.
- Recent commits and GitHub issue comments.
- Rendered artifact state.

## Workflow

1. Read the current doc state and name the claimed stage/status.
2. Check governance freshness when governance exists:
   ```bash
   node -e "import('./scripts/meta-fingerprint.mjs').then(async m => { const fs=await import('node:fs'); const doc=JSON.parse(await fs.promises.readFile('<doc>','utf8')); console.log(JSON.stringify(m.checkFingerprint(doc.metaFingerprint, doc.sections), null, 2)); })"
   ```
3. Read the destabilizing evidence: user rejection, issue change, commit, stale fingerprint, artifact/test mismatch.
4. Decide what state is now honest: stable, active, partial, blocked, pivoted, or complete.
5. Patch the living doc without erasing the prior state. Preserve corrections as history in attempts, proof, findings, or decisions.
6. Update GitHub issues when state changes require reopening, closing, creating, or commenting.
7. Render the doc after edits:
   ```bash
   node scripts/render-living-doc.mjs <doc>
   ```

## Output

Return one of these states:

- `stable`: new evidence does not change the doc state.
- `unstable-repaired`: doc/issue state was repaired.
- `unstable-blocked`: a blocker now controls the work.
- `stale-governance-refreshed`: governance freshness was repaired.
- `contradiction-escalated`: the evidence conflict needs user or source-system decision.

## Repair Rule

Do not delete the old claim just because it was wrong. Convert it into history: what was claimed, why it failed, and what state replaced it.
