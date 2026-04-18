#!/usr/bin/env node
// One-shot: extend the registry with generalAiActions (top-level) and
// per-convergence-type aiActions arrays.
//
// Scope convention:
//   - generalAiActions is a flat array at the registry root.
//   - Each convergence type may carry an optional aiActions array.
//     If absent, only the general set appears in the palette for that type.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(__dirname, 'living-doc-registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

const generalAiActions = [
  {
    id: 'decompose',
    name: 'Decompose into sub-cards',
    description: 'Break an umbrella or thin card into scoped sub-cards. Creates new tickets via gh, wires coverage edges, updates the parent card to point at the children.',
  },
  {
    id: 'enrich-notes',
    name: 'Enrich notes',
    description: 'Propose richer prose, callouts, and references for the notes field, matching the style of neighbour cards in the same section.',
  },
  {
    id: 'verify-invariants',
    name: 'Verify against invariants',
    description: "Check the card against every invariant whose appliesTo includes this section. Flag violations with the specific invariant id and quote the rule.",
  },
  {
    id: 'propose-coverage',
    name: 'Propose coverage edges',
    description: 'Map the card to the objective facets it carries. Surface orphan facets honestly if none match — do not fabricate coverage.',
  },
  {
    id: 'summarise',
    name: 'Summarise',
    description: "Concise one-paragraph summary of the card's current state. Read-only — never writes changes back to the doc.",
  },
];

const typeActions = {
  'attempt-log': [
    { id: 'propose-supersession', name: 'Propose supersession', description: 'If a newer attempt productionised the same insight, suggest marking this card superseded and linking the newer shipping site.' },
    { id: 'find-shipping-commit', name: 'Find shipping commit', description: 'Search the referenced repos for the commit that productionised this attempt; fill shipped_in if missing.' },
  ],
  'code-anchor': [
    { id: 'check-revision-drift', name: 'Check revision drift', description: 'Diff the pinned revision against current main. Propose updating the revision, flagging as changed-since-issue, or replacing the anchor.' },
    { id: 'propose-replacement-anchor', name: 'Propose replacement anchor', description: 'If the code moved, suggest a replacement path + range with the same purpose.' },
  ],
  'symptom-observation': [
    { id: 'suggest-environment-variants', name: 'Suggest environment variants', description: 'Propose reproduction attempts on adjacent environments (other OS, terminal, framework version) to narrow or widen the symptom.' },
    { id: 'check-contradictions', name: 'Check for contradictions', description: 'Scan the thread + orbit cards for observers who reported different behaviour; flag contradicted_by.' },
  ],
  'issue-orbit': [
    { id: 'refresh-github-state', name: 'Refresh GitHub state', description: 'Re-fetch the linked issue/PR and update status + closed_by_pr if changed since the doc was last touched.' },
    { id: 'reclassify-relationship', name: 'Reclassify relationship', description: 'Re-read the sibling issue and challenge the current relationship classification (same-root-cause / symmetric / adjacent / superseded / prior-art).' },
  ],
  'maintainer-stance': [
    { id: 'check-evolution', name: 'Check evolution', description: 'Re-read the thread since stated_at; propose updating position, rebuttal, or evolution if the stance has shifted.' },
  ],
  'proof-ladder': [
    { id: 'check-monotonic', name: 'Check monotonic invariant', description: 'Confirm every rung below this one is ready. If not, flag the inversion — this rung cannot legitimately claim ready state.' },
  ],
  'decision-record': [
    { id: 'check-if-still-current', name: 'Check if still current', description: 'Read recent commits, tickets, and sessions for signals that a ground-truth decision has been implicitly overridden. Propose softening to reference or opening a challenge card.' },
  ],
  'capability-surface': [
    { id: 'propose-status-from-commits', name: 'Propose status from commits', description: 'Look at recent commits touching the card\u2019s codePaths and propose a status change (built / partial / not-built / gap / blocked) based on what landed.' },
  ],
  'investigation-findings': [
    { id: 'check-still-holding', name: 'Check still holding', description: 'Re-verify the finding against current evidence. Propose status transitions (ground-truth / reference / deprecated) or flag as stale.' },
  ],
};

const force = process.argv.includes('--force');

if (registry.generalAiActions && !force) {
  throw new Error('generalAiActions already set; pass --force to overwrite');
}
registry.generalAiActions = generalAiActions;

for (const [typeId, actions] of Object.entries(typeActions)) {
  const typeDef = registry.convergenceTypes?.[typeId];
  if (!typeDef) throw new Error(`convergence type "${typeId}" not found in registry`);
  if (typeDef.aiActions && !force) {
    throw new Error(`convergenceTypes.${typeId}.aiActions already set; pass --force to overwrite`);
  }
  typeDef.aiActions = actions;
}

fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
console.log(`generalAiActions: ${generalAiActions.length}`);
console.log(`type-specific aiActions: ${Object.keys(typeActions).length} convergence types`);
