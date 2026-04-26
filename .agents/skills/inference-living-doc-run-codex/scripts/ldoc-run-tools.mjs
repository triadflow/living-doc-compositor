#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, '..', '..', '..', '..');

function usage(code = 0) {
  const msg = `Usage:
  ldoc-run-tools.mjs registry-summary [--registry scripts/living-doc-registry.json]
  ldoc-run-tools.mjs match-structure --objective TEXT [--success TEXT] [--registry PATH]
  ldoc-run-tools.mjs scaffold --objective TEXT --out PATH [--success TEXT] [--title TEXT] [--template PATH]
  ldoc-run-tools.mjs coverage-check --doc PATH
  ldoc-run-tools.mjs governance-check --doc PATH [--registry PATH]
`;
  (code ? console.error : console.log)(msg.trim());
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(path.resolve(filePath), 'utf8'));
}

function resolveRegistryPath(args) {
  return path.resolve(args.registry || path.join(defaultRepoRoot, 'scripts/living-doc-registry.json'));
}

function slugify(value, fallback = 'objective') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || fallback;
}

function sectionTitle(typeId, typeDef) {
  return typeDef?.name || typeId.split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function textScore(haystack, needles) {
  const text = haystack.toLowerCase();
  return needles.reduce((score, needle) => score + (text.includes(needle) ? 1 : 0), 0);
}

function inferStrategy(input) {
  const text = input.toLowerCase();
  const candidates = [
    {
      id: 'ship-feature',
      label: 'feature shipping',
      template: 'docs/living-doc-template-starter-ship-feature.json',
      keywords: ['ship', 'feature', 'implement', 'build', 'add ', 'release', 'delivery'],
      types: ['capability-surface', 'code-anchor', 'verification-surface', 'decision-record'],
    },
    {
      id: 'bug-investigation',
      label: 'bug investigation and fix',
      template: 'docs/living-doc-template-oss-issue-deep-dive.json',
      keywords: ['bug', 'fix', 'error', 'failure', 'broken', 'regression', 'repro', 'issue'],
      types: ['symptom-observation', 'investigation-findings', 'code-anchor', 'attempt-log', 'verification-surface', 'issue-orbit'],
    },
    {
      id: 'prove-claim',
      label: 'claim proof and evidence',
      template: 'docs/living-doc-template-starter-prove-claim.json',
      keywords: ['prove', 'claim', 'evidence', 'verify', 'validate', 'support', 'argument'],
      types: ['proof-ladder', 'experiment-evidence-surface', 'citation-feed', 'decision-record'],
    },
    {
      id: 'support-ops',
      label: 'support or operations run',
      template: 'docs/living-doc-template-starter-run-support-ops.json',
      keywords: ['support', 'ops', 'operation', 'ticket', 'incident', 'customer', 'reset', 'cleanup'],
      types: ['operation', 'status-snapshot', 'issue-orbit', 'verification-checkpoints'],
    },
    {
      id: 'monitoring',
      label: 'monitoring tracker',
      template: 'docs/living-doc-template-monitoring-tracker.json',
      keywords: ['monitor', 'watch', 'track', 'period', 'indicator', 'trend'],
      types: ['indicator-trace', 'citation-feed', 'position-cluster-map', 'change-log'],
    },
    {
      id: 'competitor-watch',
      label: 'competitor watcher',
      template: 'docs/living-doc-template-competitor-watcher.json',
      keywords: ['competitor', 'market', 'rival', 'lab', 'company', 'strategy'],
      types: ['competitor-stance-track', 'strategic-move-log', 'indicator-trace', 'citation-feed'],
    },
  ];
  return candidates
    .map((candidate) => ({ ...candidate, score: textScore(text, candidate.keywords) }))
    .sort((a, b) => b.score - a.score)[0];
}

async function registrySummary(args) {
  const registry = await readJson(resolveRegistryPath(args));
  const convergenceTypes = Object.entries(registry.convergenceTypes || {}).map(([id, def]) => ({
    id,
    name: def.name,
    category: def.category,
    projection: def.projection,
    sources: (def.sources || []).map((s) => ({ key: s.key, entityType: s.entityType, label: s.label })),
    statusFields: def.statusFields || [],
  }));
  output({
    convergenceTypeCount: convergenceTypes.length,
    entityTypeCount: Object.keys(registry.entityTypes || {}).length,
    statusSetCount: Object.keys(registry.statusSets || {}).length,
    convergenceTypes,
  });
}

async function matchStructure(args) {
  if (!args.objective) usage(1);
  const registry = await readJson(resolveRegistryPath(args));
  const input = `${args.objective} ${args.success || ''}`;
  const strategy = inferStrategy(input);
  const availableTypes = strategy.types.filter((id) => registry.convergenceTypes?.[id]);
  const deferred = ['coherence-map', 'change-log'].filter((id) => registry.convergenceTypes?.[id]);
  output({
    objective: args.objective,
    successCondition: args.success || '',
    strategy: strategy.label,
    recommendedTemplate: existsSync(path.resolve(defaultRepoRoot, strategy.template)) ? strategy.template : null,
    convergenceTypes: availableTypes.map((id) => ({
      id,
      name: registry.convergenceTypes[id].name,
      rationale: registry.convergenceTypes[id].structuralContract || registry.convergenceTypes[id].description || '',
    })),
    deferredConvergenceTypes: deferred,
    rationale: 'Initial structure match is heuristic. Treat it as the first Codex reasoning frame and refine after source hydration.',
  });
}

async function scaffold(args) {
  if (!args.objective || !args.out) usage(1);
  const now = new Date().toISOString();
  let doc;
  if (args.template) {
    doc = await readJson(path.resolve(args.template));
  } else {
    const registry = await readJson(resolveRegistryPath(args));
    const strategy = inferStrategy(`${args.objective} ${args.success || ''}`);
    const types = strategy.types.filter((id) => registry.convergenceTypes?.[id]).slice(0, 4);
    const sections = types.map((typeId) => ({
      id: slugify(typeId),
      title: sectionTitle(typeId, registry.convergenceTypes[typeId]),
      convergenceType: typeId,
      rationale: `Initial ${strategy.label} frame selected for the objective; refine after source hydration.`,
      updated: now,
      data: [],
    }));
    doc = {
      docId: `doc:${slugify(args.title || args.objective)}`,
      title: args.title || titleFromObjective(args.objective),
      subtitle: 'Inference-time Codex living doc run',
      brand: 'LD',
      scope: args.objective,
      owner: 'Codex',
      version: 'draft',
      canonicalOrigin: args.out,
      sourceCoverage: 'Initial objective scaffold; source hydration pending',
      updated: now,
      objective: args.objective,
      successCondition: args.success || '',
      objectiveFacets: initialFacets(args.objective, args.success),
      coverage: [],
      invariants: initialInvariants(sections),
      metaFingerprint: '',
      sections,
    };
  }
  doc.title = args.title || doc.title || titleFromObjective(args.objective);
  doc.objective = args.objective;
  if (args.success) doc.successCondition = args.success;
  doc.updated = now;
  doc.canonicalOrigin = args.out;
  doc.sourceCoverage = doc.sourceCoverage || 'Initial objective scaffold; source hydration pending';
  if (!Array.isArray(doc.objectiveFacets)) doc.objectiveFacets = initialFacets(args.objective, args.success);
  if (!Array.isArray(doc.coverage)) doc.coverage = [];
  if (!Array.isArray(doc.invariants)) doc.invariants = initialInvariants(doc.sections || []);
  await writeFile(path.resolve(args.out), JSON.stringify(doc, null, 2) + '\n');
  output({ ok: true, wrote: path.resolve(args.out), sections: (doc.sections || []).map((s) => ({ id: s.id, convergenceType: s.convergenceType })) });
}

function titleFromObjective(objective) {
  const words = String(objective || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 8);
  return words.join(' ') || 'Inference Living Doc Run';
}

function initialFacets(objective, success) {
  const base = [
    ['frame-objective', 'Frame objective', 'The objective and success condition are explicit enough to guide work.'],
    ['hydrate-sources', 'Hydrate sources', 'Relevant source material is discovered and linked into the document.'],
    ['implement-or-resolve', 'Implement or resolve', 'The core work is completed or a blocked conclusion is justified.'],
    ['verify-outcome', 'Verify outcome', 'Evidence supports the final status of the objective.'],
    ['finalize-handoff', 'Finalize handoff', 'The final document records source links, residual risks, and completion state.'],
  ];
  if (success) base.splice(1, 0, ['meet-success-condition', 'Meet success condition', String(success)]);
  return base.map(([id, name, description]) => ({ id, name, description }));
}

function initialInvariants(sections) {
  const appliesTo = (sections || []).map((s) => s.id).filter(Boolean);
  return [
    {
      id: 'status-needs-evidence',
      name: 'Status needs evidence',
      statement: 'Do not mark the objective complete unless verification evidence is linked to the relevant section or card.',
      appliesTo: appliesTo.length ? appliesTo : ['*'],
    },
    {
      id: 'source-detail-owned-by-source',
      name: 'Source detail owned by source',
      statement: 'Large, operational, canonical, or executable detail should live in a source artifact and be linked from the doc.',
      appliesTo: ['*'],
    },
  ];
}

async function coverageCheck(args) {
  if (!args.doc) usage(1);
  const doc = await readJson(args.doc);
  const sections = new Map((doc.sections || []).map((s) => [s.id, s]));
  const cards = new Set();
  for (const section of doc.sections || []) {
    for (const card of section.data || section.cards || []) {
      if (card?.id) cards.add(`${section.id}/${card.id}`);
    }
  }
  const facets = doc.objectiveFacets || [];
  const coverage = doc.coverage || [];
  const coveredFacetIds = new Set(coverage.map((edge) => edge.facetId));
  const invalidEdges = coverage.filter((edge) => (
    !facets.some((facet) => facet.id === edge.facetId) ||
    !sections.has(edge.sectionId) ||
    (edge.cardId && !cards.has(`${edge.sectionId}/${edge.cardId}`))
  ));
  output({
    doc: args.doc,
    facetCount: facets.length,
    coverageEdgeCount: coverage.length,
    uncoveredFacets: facets.filter((facet) => !coveredFacetIds.has(facet.id)).map((facet) => ({ id: facet.id, name: facet.name })),
    invalidEdges,
  });
}

async function governanceCheck(args) {
  if (!args.doc) usage(1);
  const doc = await readJson(args.doc);
  const registry = await readJson(resolveRegistryPath(args));
  const warnings = [];
  const sectionIds = new Set();
  const duplicateSections = [];
  for (const section of doc.sections || []) {
    if (sectionIds.has(section.id)) duplicateSections.push(section.id);
    sectionIds.add(section.id);
    if (!registry.convergenceTypes?.[section.convergenceType]) {
      warnings.push(`unknown convergenceType on section ${section.id}: ${section.convergenceType}`);
    }
    validateStatuses(section, registry, warnings);
  }
  const invalidInvariants = [];
  for (const invariant of doc.invariants || []) {
    if (!invariant?.id || !invariant?.statement || !Array.isArray(invariant.appliesTo)) {
      invalidInvariants.push(invariant?.id || '(missing id)');
      continue;
    }
    for (const target of invariant.appliesTo) {
      if (target !== '*' && !sectionIds.has(target)) warnings.push(`invariant ${invariant.id} applies to missing section ${target}`);
    }
  }
  const coverage = await collectCoverage(args.doc);
  output({
    doc: args.doc,
    ok: warnings.length === 0 && duplicateSections.length === 0 && invalidInvariants.length === 0 && coverage.invalidEdges.length === 0,
    duplicateSections,
    invalidInvariants,
    invalidCoverageEdges: coverage.invalidEdges,
    warnings,
    invariants: (doc.invariants || []).map((inv) => ({ id: inv.id, appliesTo: inv.appliesTo })),
  });
}

function validateStatuses(section, registry, warnings) {
  const typeDef = registry.convergenceTypes?.[section.convergenceType];
  const statusFields = typeDef?.statusFields || [];
  const cards = section.data || section.cards || [];
  for (const field of statusFields) {
    const values = registry.statusSets?.[field.statusSet]?.values || [];
    if (!values.length) continue;
    for (const card of cards) {
      const value = card?.[field.key];
      if (value && !values.includes(value)) {
        warnings.push(`invalid status ${section.id}/${card.id || '(card)'}.${field.key}: ${value}`);
      }
    }
  }
}

async function collectCoverage(docPath) {
  const doc = await readJson(docPath);
  const sections = new Map((doc.sections || []).map((s) => [s.id, s]));
  const cards = new Set();
  for (const section of doc.sections || []) {
    for (const card of section.data || section.cards || []) {
      if (card?.id) cards.add(`${section.id}/${card.id}`);
    }
  }
  const facets = doc.objectiveFacets || [];
  const invalidEdges = (doc.coverage || []).filter((edge) => (
    !facets.some((facet) => facet.id === edge.facetId) ||
    !sections.has(edge.sectionId) ||
    (edge.cardId && !cards.has(`${edge.sectionId}/${edge.cardId}`))
  ));
  return { invalidEdges };
}

function output(value) {
  console.log(JSON.stringify(value, null, 2));
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (!cmd || args.help) usage(0);

if (cmd === 'registry-summary') await registrySummary(args);
else if (cmd === 'match-structure') await matchStructure(args);
else if (cmd === 'scaffold') await scaffold(args);
else if (cmd === 'coverage-check') await coverageCheck(args);
else if (cmd === 'governance-check') await governanceCheck(args);
else usage(1);
