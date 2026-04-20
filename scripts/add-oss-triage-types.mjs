#!/usr/bin/env node
// One-shot: extend the registry with the 5 OSS-triage convergence types and their status sets.
// See ticket #78 and docs/oss-triage-convergence-types-proposal.html for the contracts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(__dirname, 'living-doc-registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

const newStatusSets = {
  'attempt-log-status': {
    values: ['probe', 'workaround-shipped', 'rejected', 'superseded'],
    tones: {
      'probe': 'neutral',
      'workaround-shipped': 'positive',
      'rejected': 'negative',
      'superseded': 'warning',
    },
  },
  'issue-orbit-status': {
    values: ['closed-fixed', 'closed-wontfix', 'open-active', 'open-stale'],
    tones: {
      'closed-fixed': 'positive',
      'closed-wontfix': 'neutral',
      'open-active': 'warning',
      'open-stale': 'negative',
    },
  },
  'code-anchor-status': {
    values: ['current', 'changed-since-issue', 'deprecated'],
    tones: {
      'current': 'positive',
      'changed-since-issue': 'warning',
      'deprecated': 'negative',
    },
  },
  'symptom-status': {
    values: ['reproduced', 'unconfirmed', 'contradicted'],
    tones: {
      'reproduced': 'positive',
      'unconfirmed': 'warning',
      'contradicted': 'negative',
    },
  },
  'stance-status': {
    values: ['current', 'softened', 'retracted', 'unchallenged'],
    tones: {
      'current': 'warning',
      'softened': 'neutral',
      'retracted': 'negative',
      'unchallenged': 'positive',
    },
  },
};

const newConvergenceTypes = {
  'attempt-log': {
    name: 'Attempt Log',
    category: 'verification',
    description: 'A record of actions taken against a problem and what each one proved. Distinct from findings (observations) and decisions (chosen directions).',
    structuralContract: 'Two-column card grid. Each card is one attempt with an outcome. Status is attempt-log-status. Use when capturing tried fixes, probes, and shipped workarounds — not to record decisions or generic findings.',
    notFor: [
      'observed behaviors (use symptom-observation)',
      'settled team decisions (use decision-record)',
      'positions in an ongoing debate (use maintainer-stance)',
    ],
    promptGuidance: {
      operatingThesis: 'Treat each card as an action with a result. Every attempt must name what was tried and what it proved; shipped attempts must link their shipping site.',
      keepDistinct: [
        'what was tried',
        'what it proved',
        'shipped-in location',
        'cost to apply',
        'attempt status',
      ],
      inspect: [
        'Verify each attempt has a concrete outcome — probes that revealed nothing are noise.',
        'Check the shipped_in URL resolves and the referenced code or patch still exists.',
      ],
      update: [
        'When an attempt is superseded by a newer one, mark it superseded rather than deleting.',
        'Preserve rejected attempts — they tell the next reader what not to try.',
      ],
      avoid: [
        'Do not collapse attempts into observations or decisions.',
        'Do not mix generic notes into attempt cards — supporting context goes in notes[].',
      ],
    },
    icon: "<path opacity='.28' d='M4 4h12v12H4z'/><path d='M6 7h8v1.5H6zm0 3h6v1.5H6zm0 3h4v1.5H6z'/><path d='M15 13l3 3-1 1-3-3z'/>",
    iconColor: '#ea580c',
    projection: 'card-grid',
    columns: 2,
    sources: [
      { key: 'ticketIds', entityType: 'ticket', label: 'Tickets' },
      { key: 'notes', entityType: null, label: null },
    ],
    statusFields: [
      { key: 'status', statusSet: 'attempt-log-status' },
    ],
    textFields: [
      { key: 'shipped_in', label: 'Shipped in' },
      { key: 'cost_to_apply', label: 'Cost to apply' },
    ],
    detailsFields: [
      { key: 'what_tried', label: 'What was tried' },
      { key: 'what_proved', label: 'What it proved' },
    ],
  },
  'issue-orbit': {
    name: 'Issue Orbit',
    category: 'verification',
    description: 'A graph of sibling issues and PRs that share root cause, symmetry, or adjacency with the focal issue. Not a list of findings — each card is metadata about another issue.',
    structuralContract: 'Two-column card grid. Each card names another issue/PR, its state, its relationship to the focal issue, and why it matters. Use when a doc needs to preserve the shape of nearby bugs in the same problem space.',
    notFor: [
      'observations about the focal issue (use symptom-observation)',
      'attempts at a fix (use attempt-log)',
      'general references or citations',
    ],
    promptGuidance: {
      operatingThesis: 'Each card describes a different issue and its relationship to the focal one. The relationship is required — a card without a clear relationship does not belong here.',
      keepDistinct: [
        'sibling issue identity',
        'github state',
        'relationship to focal (same-root-cause, adjacent, symmetric, superseded, prior-art)',
        'relevance to focal',
      ],
      inspect: [
        'Verify the github_state is current — closed issues may have reopened, open issues may have gone stale.',
        'Challenge the relationship classification — a weak relationship is usually no relationship.',
      ],
      update: [
        'When a sibling issue is closed by a PR, link it via ticketIds or notes and update status.',
      ],
      avoid: [
        'Do not include issues with only topical overlap — the relationship must be structural.',
      ],
    },
    icon: "<circle cx='10' cy='10' r='2'/><circle cx='10' cy='10' r='6' fill='none' stroke='currentColor' stroke-width='1' opacity='.4'/><circle cx='16' cy='10' r='1.5'/><circle cx='6' cy='14' r='1.5'/><circle cx='6' cy='6' r='1.5'/>",
    iconColor: '#0891b2',
    projection: 'card-grid',
    columns: 2,
    sources: [
      { key: 'ticketIds', entityType: 'ticket', label: 'Tickets' },
      { key: 'notes', entityType: null, label: null },
    ],
    statusFields: [
      { key: 'status', statusSet: 'issue-orbit-status' },
    ],
    textFields: [
      { key: 'url', label: 'URL' },
      { key: 'github_state', label: 'GitHub state' },
      { key: 'relationship', label: 'Relationship' },
      { key: 'relevance', label: 'Relevance' },
    ],
  },
  'code-anchor': {
    name: 'Code Anchor',
    category: 'verification',
    description: 'Revision-pinned pointers into source code. Each card is one file-and-range with a short description of what the code does and why it matters for the focal issue. Diagnostic, not product-framing.',
    structuralContract: 'Two-column card grid. Each card pins a file path, line range, and revision (commit SHA or tag). Use when a doc needs to point a reader into exact code locations, not describe product capabilities.',
    notFor: [
      'user-facing product capabilities (use capability-surface)',
      'general architectural overviews',
      'tried fixes (use attempt-log)',
    ],
    promptGuidance: {
      operatingThesis: 'Each anchor pins source code at a revision. Without a revision, a code anchor is not trustworthy — if the file moves, the pointer stales silently.',
      keepDistinct: [
        'file path',
        'line range',
        'pinned revision',
        'what the code does',
        'why it matters for the focal issue',
      ],
      inspect: [
        'Verify the revision is resolvable (tag or SHA).',
        'When the doc is re-crystallized, check whether the pinned file/range still matches current main.',
      ],
      update: [
        'If the code has moved since the pin, update the revision or mark the anchor changed-since-issue.',
      ],
      avoid: [
        'Do not use code-anchor for product capabilities or feature-level descriptions.',
      ],
    },
    icon: "<path opacity='.28' d='M4 4h12v12H4z'/><path d='M7 8l-2 2 2 2M13 8l2 2-2 2' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/><path d='M11 7l-2 6'/>",
    iconColor: '#7c3aed',
    projection: 'card-grid',
    columns: 2,
    sources: [
      { key: 'ticketIds', entityType: 'ticket', label: 'Tickets' },
      { key: 'notes', entityType: null, label: null },
    ],
    statusFields: [
      { key: 'status', statusSet: 'code-anchor-status' },
    ],
    textFields: [
      { key: 'path', label: 'Path' },
      { key: 'range', label: 'Line' },
      { key: 'revision', label: 'Revision' },
      { key: 'what_it_does', label: 'What it does' },
    ],
    detailsFields: [
      { key: 'why_it_matters', label: 'Why it matters' },
    ],
  },
  'symptom-observation': {
    name: 'Symptom Observation',
    category: 'verification',
    description: 'Observed behaviors with reproduction paths and witness attribution. Distinct from generic findings — the presence of repro steps and a named witness is the semantic contract.',
    structuralContract: 'Two-column card grid. Each card is one observed behavior with environment, reproduction steps, and a witness. Use when the section captures reproducible behaviors of a bug or feature — not generalized findings.',
    notFor: [
      'conclusions or synthesized findings (use investigation-findings)',
      'tried fixes (use attempt-log)',
      'decisions or positions (use maintainer-stance or decision-record)',
    ],
    promptGuidance: {
      operatingThesis: 'A symptom is a reproducible behavior. Without repro steps and a witness, it is not a symptom — it is a generic finding and belongs elsewhere.',
      keepDistinct: [
        'environment',
        'reproduction steps',
        'witness attribution',
        'contradicting observers (when present)',
      ],
      inspect: [
        'Verify the repro steps actually reproduce — if the environment shifted, mark unconfirmed.',
        'Check whether any other observer contradicted the symptom.',
      ],
      update: [
        'When a symptom is independently reproduced, keep the original witness and add the corroboration to notes.',
      ],
      avoid: [
        'Do not promote a generic finding to a symptom without a real repro path.',
      ],
    },
    icon: "<circle cx='10' cy='10' r='6' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M10 6v4M10 12v.5' stroke='currentColor' stroke-width='1.5' stroke-linecap='round'/>",
    iconColor: '#d97706',
    projection: 'card-grid',
    columns: 2,
    sources: [
      { key: 'ticketIds', entityType: 'ticket', label: 'Tickets' },
      { key: 'notes', entityType: null, label: null },
    ],
    statusFields: [
      { key: 'status', statusSet: 'symptom-status' },
    ],
    textFields: [
      { key: 'environment', label: 'Environment' },
      { key: 'witness', label: 'Witness' },
      { key: 'contradicted_by', label: 'Contradicted by' },
    ],
    detailsFields: [
      { key: 'repro_steps', label: 'Reproduction' },
    ],
  },
  'maintainer-stance': {
    name: 'Maintainer Stance',
    category: 'verification',
    description: 'Named, evolving positions held by stakeholders. Distinct from settled decision records — a stance has an owner, a timestamp, and may be rebutted or shift over time.',
    structuralContract: 'One-column card grid. Each card is one stakeholder\'s position with rationale and any rebuttal. Use when the section preserves an evolving debate — not a settled team decision.',
    notFor: [
      'settled, authoritative decisions (use decision-record)',
      'observations (use symptom-observation or investigation-findings)',
      'attempted fixes (use attempt-log)',
    ],
    promptGuidance: {
      operatingThesis: 'A stance is a named position in a live conversation. It has an owner, a timestamp, and may still move. Do not collapse stances into decisions.',
      keepDistinct: [
        'stakeholder identity and role',
        'stated_at timestamp and link',
        'the position itself',
        'the rationale given',
        'any rebuttal',
        'evolution over time',
      ],
      inspect: [
        'Verify the stated_at timestamp links to the original comment or statement.',
        'Check whether the stance has shifted since — update evolution accordingly.',
      ],
      update: [
        'When a stance is rebutted or softens, add to rebuttal/evolution rather than overwriting position.',
      ],
      avoid: [
        'Do not promote a stance to a decision before the team actually decides.',
        'Do not erase a stance that was retracted — mark it retracted and preserve the history.',
      ],
    },
    icon: "<path opacity='.28' d='M4 6h12v10H4z'/><circle cx='8' cy='10' r='1.5'/><circle cx='14' cy='10' r='1.5'/><path d='M6 14h3M11 14h3' stroke='currentColor' stroke-width='1' stroke-linecap='round'/>",
    iconColor: '#0369a1',
    projection: 'card-grid',
    columns: 1,
    sources: [
      { key: 'ticketIds', entityType: 'ticket', label: 'Tickets' },
      { key: 'notes', entityType: null, label: null },
    ],
    statusFields: [
      { key: 'status', statusSet: 'stance-status' },
    ],
    textFields: [
      { key: 'stakeholder', label: 'Stakeholder' },
      { key: 'stated_at', label: 'Stated at' },
      { key: 'position', label: 'Position' },
      { key: 'rationale', label: 'Rationale' },
      { key: 'rebuttal', label: 'Rebuttal' },
      { key: 'evolution', label: 'Evolution' },
    ],
  },
};

// Merge — refuse to overwrite existing keys unless --force
const force = process.argv.includes('--force');

function mergeOrRefuse(target, source, label) {
  for (const key of Object.keys(source)) {
    if (target[key] && !force) {
      throw new Error(`${label}.${key} already exists — pass --force to overwrite`);
    }
    target[key] = source[key];
  }
}

mergeOrRefuse(registry.statusSets, newStatusSets, 'statusSets');
mergeOrRefuse(registry.convergenceTypes, newConvergenceTypes, 'convergenceTypes');

fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
console.log(`Added ${Object.keys(newStatusSets).length} status sets and ${Object.keys(newConvergenceTypes).length} convergence types to ${registryPath}`);
