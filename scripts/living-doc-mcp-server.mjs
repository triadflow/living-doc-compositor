#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyAiPatch } from './apply-ai-patch.mjs';
import { validatePatch } from './validate-ai-patch.mjs';
import { convergenceTypeDefinitions } from './living-doc-definitions/index.mjs';
import {
  inferTemplateGraphForDoc,
  loadSemanticDiagrams,
  loadSemanticGraph,
  semanticContextForPath,
  semanticGraphSummaryForDoc,
} from './living-doc-semantic-context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const harnessCli = path.join(repoRoot, '.agents/skills/inference-living-doc-run-codex/scripts/ldoc-run-tools.mjs');

const protocolVersion = '2024-11-05';
const convergenceTypeDefinitionsById = new Map(convergenceTypeDefinitions.map((definition) => [definition.id, definition]));

const objectSchema = (properties = {}, required = []) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const stringProp = (description = '') => ({ type: 'string', minLength: 1, ...(description ? { description } : {}) });
const optionalString = (description = '') => ({ type: 'string', ...(description ? { description } : {}) });

const tools = [
  tool('living_doc_registry_summary', 'List registry convergence types, entity type count, status set count, source keys, and status fields.', objectSchema({
    registry: optionalString('Optional registry JSON path. Defaults to scripts/living-doc-registry.json.'),
  })),
  tool('living_doc_registry_explain_type', 'Explain a convergence type as an inference type: sources, projection, status sets, prompt guidance, and structural contract.', objectSchema({
    convergenceType: stringProp('Convergence type id.'),
    registry: optionalString('Optional registry JSON path.'),
  }, ['convergenceType'])),
  tool('living_doc_convergence_type_contract', 'Return the code-defined convergence-type contract with status logic, generated relationship participation, prompt guidance, structural constraints, and repair operation ids.', objectSchema({
    convergenceType: stringProp('Convergence type id.'),
    registry: optionalString('Optional generated registry JSON path used only for status set values and generated semanticUses.'),
  }, ['convergenceType'])),
  tool('living_doc_registry_match_objective', 'Match an objective/success condition to strategy, starter template, and convergence types.', objectSchema({
    objective: stringProp(),
    success: optionalString(),
    registry: optionalString(),
  }, ['objective'])),
  tool('living_doc_registry_propose_type_gap', 'Return a registry-entry skeleton when observed source pressure does not fit existing convergence types.', objectSchema({
    reason: stringProp(),
    observedSources: { type: 'array', items: { type: 'string' }, default: [] },
    neededProjection: { type: 'string', enum: ['card-grid', 'edge-table'], default: 'card-grid' },
    suggestedId: optionalString(),
  }, ['reason'])),

  tool('living_doc_objective_decompose', 'Decompose an objective and success condition into initial objective facets for an inference run.', objectSchema({
    objective: stringProp(),
    success: optionalString(),
  }, ['objective'])),
  tool('living_doc_structure_select', 'Select the initial living-doc structure for an objective using registry semantics.', objectSchema({
    objective: stringProp(),
    success: optionalString(),
    registry: optionalString(),
  }, ['objective'])),
  tool('living_doc_structure_reflect', 'Evaluate whether a living doc structure still fits the objective, coverage, and governance state.', objectSchema({
    doc: stringProp('Living doc JSON path.'),
    registry: optionalString(),
  }, ['doc'])),
  tool('living_doc_template_graph', 'Return generated semantic relationship graph metadata for a template or matching living doc.', objectSchema({
    templateId: optionalString('Template id such as surface-delivery. If omitted with doc, inferred from the doc shape where possible.'),
    doc: optionalString('Optional living doc JSON path used to infer the matching template graph.'),
  })),
  tool('living_doc_template_diagrams', 'Return generated Mermaid relationship diagram source for a template or matching living doc.', objectSchema({
    templateId: optionalString('Template id such as surface-delivery. If omitted with doc, inferred from the doc shape where possible.'),
    doc: optionalString('Optional living doc JSON path used to infer the matching template graph.'),
  })),
  tool('living_doc_semantic_context', 'Return full semantic graph and diagram context for a living doc JSON path or rendered HTML snapshot.', objectSchema({
    doc: optionalString('Living doc JSON path used to compute semantic context from generated artifacts.'),
    html: optionalString('Rendered HTML snapshot path used to read embedded doc-semantic-context.'),
  })),
  tool('living_doc_relationship_gaps', 'Compare a living doc against its generated template graph and return missing or weak expected relationships.', objectSchema({
    doc: stringProp('Living doc JSON path.'),
    templateId: optionalString('Optional template graph id. If omitted, inferred from the doc shape where possible.'),
    registry: optionalString('Optional registry JSON path.'),
  }, ['doc'])),
  tool('living_doc_stage_diagnostics', 'Infer stage candidates from generated template graph relationships and current section/card population.', objectSchema({
    doc: stringProp('Living doc JSON path.'),
    templateId: optionalString('Optional template graph id. If omitted, inferred from the doc shape where possible.'),
    registry: optionalString('Optional registry JSON path.'),
  }, ['doc'])),
  tool('living_doc_valid_stage_operations', 'Return generated valid operations for a template graph, optionally filtered by stage.', objectSchema({
    templateId: optionalString('Template graph id. If omitted with doc, inferred from the doc shape where possible.'),
    doc: optionalString('Optional living doc JSON path used to infer the matching template graph.'),
    stage: optionalString('Optional stage name such as Seeding, Coherence, Operation, Refresh, or Judgment.'),
  })),
  tool('living_doc_structure_refine', 'Apply conservative structural edits: add section, update section type/rationale/title, or remove empty section.', objectSchema({
    doc: stringProp(),
    changes: { type: 'array', items: { type: 'object' }, default: [] },
    registry: optionalString(),
  }, ['doc', 'changes'])),
  tool('living_doc_scaffold', 'Create an objective-scoped living doc JSON scaffold with selected sections, initial facets, and starter invariants.', objectSchema({
    objective: stringProp(),
    out: stringProp('Output JSON path for the new or overwritten living doc.'),
    success: optionalString(),
    title: optionalString(),
    template: optionalString('Optional living-doc template JSON path.'),
    registry: optionalString(),
  }, ['objective', 'out'])),

  tool('living_doc_sources_add', 'Add a typed source/card object to a section data array.', objectSchema({
    doc: stringProp(),
    sectionId: stringProp(),
    card: { type: 'object', additionalProperties: true },
  }, ['doc', 'sectionId', 'card'])),
  tool('living_doc_sources_create', 'Create or plan new source material, such as a local markdown note or GitHub issue, then return a linkable entity.', objectSchema({
    kind: { type: 'string', enum: ['plan', 'local-markdown', 'local-json', 'github-issue'] },
    payload: { type: 'object', additionalProperties: true },
    policy: { type: 'object', additionalProperties: true, description: 'Use {allowWrite:true} to create external/local source material.' },
  }, ['kind', 'payload'])),
  tool('living_doc_sources_link', 'Link a source entity to an existing card field; defaults to a refs array with edgeType metadata.', objectSchema({
    doc: stringProp(),
    sectionId: stringProp(),
    cardId: stringProp(),
    entityRef: { type: 'object', additionalProperties: true },
    edgeType: optionalString(),
    field: optionalString('Target field. Defaults to refs.'),
  }, ['doc', 'sectionId', 'cardId', 'entityRef'])),

  tool('living_doc_coverage_map', 'Add a coverage edge from an objective facet to a section card.', objectSchema({
    doc: stringProp(),
    facetId: stringProp(),
    sectionId: stringProp(),
    cardId: stringProp(),
    rationale: optionalString(),
  }, ['doc', 'facetId', 'sectionId', 'cardId'])),
  tool('living_doc_coverage_find_gaps', 'Find uncovered objective facets and invalid coverage edges.', objectSchema({
    doc: stringProp(),
  }, ['doc'])),
  tool('living_doc_coverage_evaluate_success_condition', 'Evaluate success readiness from objective facets, coverage, invalid edges, and governance checks.', objectSchema({
    doc: stringProp(),
    registry: optionalString(),
  }, ['doc'])),

  tool('living_doc_governance_list_invariants', 'List invariants that apply to the whole doc, a section, card, or facet.', objectSchema({
    doc: stringProp(),
    scope: optionalString('Use *, wholeDoc, section:<id>, card:<section>/<card>, facet:<id>, or a section id.'),
  }, ['doc'])),
  tool('living_doc_governance_evaluate', 'Evaluate the governance layer for a scope and return applicable invariants, warnings, and likely violations.', objectSchema({
    doc: stringProp(),
    scope: optionalString(),
    registry: optionalString(),
  }, ['doc'])),
  tool('living_doc_governance_classify_trap', 'Classify a reasoning/execution trap so it can become an invariant candidate.', objectSchema({
    event: stringProp(),
    context: { type: 'object', additionalProperties: true },
  }, ['event'])),
  tool('living_doc_governance_suggest_invariant', 'Suggest or apply a governance invariant derived from a durable trap.', objectSchema({
    doc: stringProp(),
    trap: optionalString(),
    invariant: { type: 'object', additionalProperties: true },
    appliesTo: { type: 'array', items: { type: 'string' } },
    apply: { type: 'boolean', default: false },
  }, ['doc', 'invariant'])),
  tool('living_doc_governance_refine_invariant', 'Update an existing invariant statement/name/appliesTo.', objectSchema({
    doc: stringProp(),
    invariantId: stringProp(),
    change: { type: 'object', additionalProperties: true },
  }, ['doc', 'invariantId', 'change'])),
  tool('living_doc_governance_check_patch', 'Validate whether a living-doc-ai-patch/v1 respects schema, registry contracts, and doc consistency.', objectSchema({
    doc: stringProp(),
    patch: { type: 'object', additionalProperties: true },
    registry: optionalString(),
  }, ['doc', 'patch'])),

  tool('living_doc_patch_validate', 'Validate a living-doc-ai-patch/v1 against optional doc and registry context.', objectSchema({
    patch: { type: 'object', additionalProperties: true },
    doc: optionalString(),
    registry: optionalString(),
  }, ['patch'])),
  tool('living_doc_patch_apply', 'Apply a validated living-doc-ai-patch/v1 to a living doc JSON without executing external side effects.', objectSchema({
    doc: stringProp(),
    patch: { type: 'object', additionalProperties: true },
    acceptedChangeIds: { type: 'array', items: { type: 'string' } },
    registry: optionalString(),
  }, ['doc', 'patch'])),
  tool('living_doc_render', 'Render a living doc JSON to standalone HTML; optionally commit JSON and HTML.', objectSchema({
    doc: stringProp(),
    commit: { type: 'boolean' },
    message: optionalString(),
  }, ['doc'])),
];

function tool(name, description, inputSchema) {
  const readOnlyTools = new Set([
    'living_doc_registry_summary',
    'living_doc_registry_explain_type',
    'living_doc_convergence_type_contract',
    'living_doc_registry_match_objective',
    'living_doc_registry_propose_type_gap',
    'living_doc_objective_decompose',
    'living_doc_structure_select',
    'living_doc_structure_reflect',
    'living_doc_template_graph',
    'living_doc_template_diagrams',
    'living_doc_semantic_context',
    'living_doc_relationship_gaps',
    'living_doc_stage_diagnostics',
    'living_doc_valid_stage_operations',
    'living_doc_coverage_find_gaps',
    'living_doc_coverage_evaluate_success_condition',
    'living_doc_governance_list_invariants',
    'living_doc_governance_evaluate',
    'living_doc_governance_classify_trap',
    'living_doc_governance_check_patch',
    'living_doc_patch_validate',
  ]);
  const readOnly = readOnlyTools.has(name);
  return {
    name,
    description,
    inputSchema,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint: readOnly,
      openWorldHint: false,
    },
  };
}

function toArgs(args, fields) {
  const out = [];
  for (const field of fields) {
    const value = args?.[field];
    if (value === undefined || value === null || value === '') continue;
    out.push(`--${field}`, String(value));
  }
  return out;
}

function parseJsonOutput(stdout, fallback = {}) {
  const text = String(stdout || '').trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return { ...fallback, output: text };
  }
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    throw new Error(stderr || stdout || `node ${args.join(' ')} exited ${result.status}`);
  }
  return result.stdout;
}

function resolvePath(value) {
  return path.resolve(repoRoot, String(value || ''));
}

function registryPath(args = {}) {
  return resolvePath(args.registry || 'scripts/living-doc-registry.json');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(resolvePath(filePath), 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(resolvePath(filePath), JSON.stringify(value, null, 2) + '\n');
}

async function loadRegistry(args = {}) {
  return JSON.parse(await readFile(registryPath(args), 'utf8'));
}

function slugify(value, fallback = 'item') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function getCards(section) {
  if (Array.isArray(section.data)) return section.data;
  if (Array.isArray(section.cards)) return section.cards;
  section.data = [];
  return section.data;
}

function findSection(doc, sectionId) {
  return (doc.sections || []).find((section) => section?.id === sectionId);
}

function findCard(doc, sectionId, cardId) {
  const section = findSection(doc, sectionId);
  if (!section) return { section: null, card: null };
  const card = getCards(section).find((item) => item?.id === cardId);
  return { section, card };
}

function normalizeCardForDoc(card) {
  const next = { ...card };
  for (const key of ['notes', 'evidence', 'refs', 'tests', 'verification', 'citations']) {
    if (typeof next[key] === 'string' && next[key].trim()) next[key] = [next[key].trim()];
  }
  return next;
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

async function registryExplainType(args) {
  const registry = await loadRegistry(args);
  const type = registry.convergenceTypes?.[args.convergenceType];
  if (!type) throw new McpError(-32602, `Unknown convergenceType: ${args.convergenceType}`);
  const statusFields = (type.statusFields || []).map((field) => ({
    ...field,
    values: registry.statusSets?.[field.statusSet]?.values || [],
    labels: registry.statusSets?.[field.statusSet]?.labels || {},
    tones: registry.statusSets?.[field.statusSet]?.tones || {},
  }));
  return {
    id: args.convergenceType,
    ...type,
    statusFields,
    inferenceUse: {
      sourcesConstrainGrouping: type.sources || [],
      statusFieldsConstrainState: statusFields,
      promptGuidance: type.promptGuidance || null,
      structuralContract: type.structuralContract || type.description || '',
    },
  };
}

async function convergenceTypeContractTool(args) {
  const definition = convergenceTypeDefinitionsById.get(args.convergenceType);
  if (!definition) throw new McpError(-32602, `Unknown convergenceType: ${args.convergenceType}`);

  const registry = await loadRegistry(args);
  const generatedType = registry.convergenceTypes?.[args.convergenceType] || {};
  const authoredContract = JSON.parse(JSON.stringify(definition.registryEntry));
  const semanticUses = generatedType.semanticUses || null;
  const statusLogic = statusLogicForContract(authoredContract, registry);
  const relationshipParticipation = relationshipParticipationForSemanticUses(semanticUses);

  return {
    id: definition.id,
    source: {
      kind: 'code-defined-convergence-type',
      modulePath: `scripts/living-doc-definitions/convergence-types/${definition.id}.mjs`,
      exportName: 'default',
    },
    authoredContract,
    generatedFields: [...(definition.generatedFields || [])],
    fieldContract: {
      projection: authoredContract.projection,
      columns: authoredContract.columns || null,
      sources: authoredContract.sources || [],
      sourceA: authoredContract.sourceA || null,
      sourceB: authoredContract.sourceB || null,
      statusFields: authoredContract.statusFields || [],
      edgeStatus: authoredContract.edgeStatus || null,
      textFields: authoredContract.textFields || [],
      detailsFields: authoredContract.detailsFields || [],
      columnHeaders: authoredContract.columnHeaders || [],
      edgeNotes: authoredContract.edgeNotes || null,
    },
    statusLogic,
    structuralContract: authoredContract.structuralContract || '',
    promptGuidance: authoredContract.promptGuidance || null,
    relationshipParticipation,
    repairOperationIds: relationshipParticipation.repairOperationIds,
    generatedSemanticUses: semanticUses,
    inferenceUse: {
      sourceOfTruth: 'scripts/living-doc-definitions/convergence-types',
      useFor: [
        'field and source expectations',
        'status value validation',
        'structural fit checks',
        'prompt guidance',
        'template relationship participation',
        'repair operation selection',
      ],
      doNotInferFrom: [
        'rendered prose',
        'template-local duplication',
        'hand-edited registry JSON',
      ],
    },
  };
}

function statusLogicForContract(contract, registry) {
  const fields = [...(contract.statusFields || [])];
  if (contract.edgeStatus) fields.push(contract.edgeStatus);
  return fields.map((field) => ({
    ...field,
    values: registry.statusSets?.[field.statusSet]?.values || [],
    labels: registry.statusSets?.[field.statusSet]?.labels || {},
    tones: registry.statusSets?.[field.statusSet]?.tones || {},
  }));
}

function relationshipParticipationForSemanticUses(semanticUses) {
  const incoming = [];
  const outgoing = [];
  const repairOperationIds = new Set();

  for (const template of semanticUses?.templates || []) {
    for (const relationship of template.relationships?.incoming || []) {
      incoming.push({
        templateId: template.templateId,
        templateName: template.templateName,
        ...relationship,
      });
      for (const id of relationship.repairOperationIds || []) repairOperationIds.add(id);
    }
    for (const relationship of template.relationships?.outgoing || []) {
      outgoing.push({
        templateId: template.templateId,
        templateName: template.templateName,
        ...relationship,
      });
      for (const id of relationship.repairOperationIds || []) repairOperationIds.add(id);
    }
  }

  return {
    incoming,
    outgoing,
    repairOperationIds: [...repairOperationIds].sort(),
  };
}

function proposeTypeGap(args) {
  const id = slugify(args.suggestedId || args.reason, 'new-convergence-type');
  const sources = (args.observedSources || []).map((source) => ({
    key: slugify(source, 'source'),
    entityType: slugify(source, 'entity'),
    label: String(source),
  }));
  return {
    proposedId: id,
    rationale: args.reason,
    registryEntrySkeleton: {
      name: id.split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' '),
      category: 'inference-run',
      description: args.reason,
      projection: args.neededProjection || 'card-grid',
      sources,
      statusFields: [{ key: 'status', statusSet: 'delivery-status' }],
      promptGuidance: {
        operatingThesis: 'Describe the convergence this type should preserve.',
        keepDistinct: sources.map((source) => source.label),
        inspect: ['Verify that existing registry types cannot represent this source convergence before adding a new type.'],
        update: ['Add only fields that preserve the source relationship and objective state.'],
        avoid: ['Do not add a type for one-off prose grouping.'],
      },
    },
  };
}

function typeSourceKeys(typeDef) {
  return (typeDef?.sources || [])
    .filter((source) => source?.key && source.entityType)
    .map((source) => source.key);
}

function hasMeaningfulValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function observedCardKeys(card) {
  return Object.entries(card || {})
    .filter(([, value]) => hasMeaningfulValue(value))
    .map(([key]) => key);
}

function cardSourceCoverage(card, typeDef) {
  const expected = typeSourceKeys(typeDef);
  const present = expected.filter((key) => hasMeaningfulValue(card?.[key]));
  return {
    expected,
    present,
    missing: expected.filter((key) => !present.includes(key)),
    hasAnyExpectedSource: expected.length === 0 || present.length > 0,
  };
}

function scoreTypeForSection(section, typeId, typeDef) {
  const cards = getCards(section);
  const sourceKeys = typeSourceKeys(typeDef);
  const statusKeys = (typeDef.statusFields || []).map((field) => field.key);
  const observed = new Set(cards.flatMap(observedCardKeys));
  let score = 0;
  const reasons = [];
  for (const key of sourceKeys) {
    if (observed.has(key)) {
      score += 3;
      reasons.push(`source key ${key}`);
    }
  }
  for (const key of statusKeys) {
    if (observed.has(key)) {
      score += 2;
      reasons.push(`status key ${key}`);
    }
  }
  const text = `${section.title || ''} ${section.rationale || ''}`.toLowerCase();
  for (const word of String(typeDef.name || typeId).toLowerCase().split(/\W+/).filter(Boolean)) {
    if (word.length > 3 && text.includes(word)) score += 1;
  }
  return { typeId, name: typeDef.name || typeId, score, reasons };
}

function bestTypeCandidates(section, registry, currentTypeId) {
  return Object.entries(registry.convergenceTypes || {})
    .map(([typeId, typeDef]) => scoreTypeForSection(section, typeId, typeDef))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry) => ({ ...entry, current: entry.typeId === currentTypeId }));
}

function textSize(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + textSize(item), 0);
  if (typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + textSize(item), 0);
  return 0;
}

function sourceMaterialPressure(card) {
  const pressure = [];
  for (const [key, value] of Object.entries(card || {})) {
    if (['id', 'name', 'title', 'status'].includes(key)) continue;
    const size = textSize(value);
    if (size > 1800) {
      pressure.push({
        field: key,
        size,
        recommendation: 'Move large/canonical detail into source material and link it back to this card.',
      });
    }
  }
  return pressure;
}

function hasEvidence(card) {
  const evidenceKeys = [
    'evidence', 'verification', 'verifications', 'tests', 'testResults', 'currentCoverage',
    'proof', 'probe', 'probes', 'citations', 'citationIds', 'sourceRefs', 'refs', 'codePaths',
    'ticketIds', 'issueUrl', 'url', 'revision',
  ];
  return evidenceKeys.some((key) => hasMeaningfulValue(card?.[key]));
}

function statusTone(registry, typeDef, field, value) {
  const statusSet = registry.statusSets?.[field.statusSet];
  return statusSet?.tones?.[value] || '';
}

function isCompletionStatus(registry, typeDef, card) {
  const doneWords = new Set(['complete', 'completed', 'done', 'built', 'verified', 'closed-fixed', 'ground-truth', 'current', 'ready', 'workaround-shipped', 'covered']);
  for (const field of typeDef?.statusFields || [{ key: 'status' }]) {
    const value = card?.[field.key];
    if (!value) continue;
    if (doneWords.has(String(value))) return true;
    if (statusTone(registry, typeDef, field, value) === 'positive') return true;
  }
  return false;
}

async function structureReflect(args) {
  const doc = await readJson(args.doc);
  const registry = await loadRegistry(args);
  const coverage = await callTool('living_doc_coverage_find_gaps', { doc: args.doc });
  const governance = await callTool('living_doc_governance_evaluate', { doc: args.doc, registry: args.registry });
  const recommendations = [];
  const sectionDiagnostics = [];

  for (const section of doc.sections || []) {
    const typeDef = registry.convergenceTypes?.[section.convergenceType];
    const cards = getCards(section);
    const cardDiagnostics = cards.map((card) => ({
      cardId: card.id || '',
      observedKeys: observedCardKeys(card),
      sourceCoverage: cardSourceCoverage(card, typeDef),
      sourceMaterialPressure: sourceMaterialPressure(card),
      hasEvidence: hasEvidence(card),
    }));
    const typeCandidates = bestTypeCandidates(section, registry, section.convergenceType);
    const sourcePressure = cardDiagnostics.flatMap((diag) => diag.sourceMaterialPressure.map((pressure) => ({ cardId: diag.cardId, ...pressure })));
    const missingSourceCards = cardDiagnostics.filter((diag) => !diag.sourceCoverage.hasAnyExpectedSource).map((diag) => diag.cardId);
    sectionDiagnostics.push({
      sectionId: section.id,
      title: section.title || '',
      convergenceType: section.convergenceType,
      typeKnown: Boolean(typeDef),
      cardCount: cards.length,
      expectedSourceKeys: typeSourceKeys(typeDef),
      typeCandidates,
      missingSourceCards,
      sourceMaterialPressure: sourcePressure,
      hasRationale: Boolean(section.rationale),
    });

    if (!typeDef) {
      recommendations.push({ severity: 'high', kind: 'fix-section-type', sectionId: section.id, reason: `Unknown convergence type ${section.convergenceType}` });
    }
    if (cards.length === 0) {
      recommendations.push({ severity: 'medium', kind: 'hydrate-section', sectionId: section.id, reason: 'Section has no cards yet.' });
    }
    if (!section.rationale) {
      recommendations.push({ severity: 'low', kind: 'add-rationale', sectionId: section.id, reason: 'Section lacks rationale for why this convergence type fits.' });
    }
    if (missingSourceCards.length > 0) {
      recommendations.push({ severity: 'medium', kind: 'add-source-links', sectionId: section.id, cardIds: missingSourceCards, reason: 'Cards do not carry any expected source keys for the selected convergence type.' });
    }
    if (sourcePressure.length > 0) {
      recommendations.push({ severity: 'medium', kind: 'create-source-material', sectionId: section.id, items: sourcePressure, reason: 'Cards contain large inline detail that likely belongs in source material.' });
    }
    const bestCandidate = typeCandidates[0];
    if (bestCandidate && bestCandidate.typeId !== section.convergenceType && bestCandidate.score >= 4) {
      recommendations.push({
        severity: 'medium',
        kind: 'review-convergence-type',
        sectionId: section.id,
        currentType: section.convergenceType,
        candidateType: bestCandidate.typeId,
        reason: `Observed fields fit ${bestCandidate.typeId} (${bestCandidate.reasons.join(', ')}) better than the current type.`,
      });
    }
  }
  for (const facet of coverage.uncoveredFacets || []) {
    recommendations.push({ severity: 'high', kind: 'cover-facet', facetId: facet.id, reason: 'Objective facet has no coverage edge.' });
  }
  if (!Array.isArray(doc.invariants) || doc.invariants.length === 0) {
    recommendations.push({ severity: 'high', kind: 'add-governance', reason: 'Doc has no invariants.' });
  }

  return {
    doc: resolvePath(args.doc),
    objective: doc.objective || '',
    structureStillFits: recommendations.filter((rec) => rec.severity === 'high' && ['fix-section-type', 'cover-facet', 'add-governance'].includes(rec.kind)).length === 0,
    semanticGraph: await semanticGraphSummaryForDoc(doc),
    sectionDiagnostics,
    coverage,
    governance,
    recommendations,
  };
}

async function templateGraphTool(args = {}) {
  const graph = await loadSemanticGraph();
  const templates = graph.templates || {};
  const inferred = args.doc ? inferTemplateGraphForDoc(await readJson(args.doc), templates) : null;
  const templateId = args.templateId || inferred?.templateId || '';

  if (templateId) {
    const template = templates[templateId];
    if (!template) throw new McpError(-32602, `Unknown template graph: ${templateId}`);
    return {
      schema: graph.schema,
      generatedFrom: graph.generatedFrom,
      templateId,
      inferredFromDoc: inferred || null,
      template,
    };
  }

  return {
    schema: graph.schema,
    generatedFrom: graph.generatedFrom,
    templateIds: Object.keys(templates).sort(),
    templates,
  };
}

async function templateDiagramsTool(args = {}) {
  const [graph, diagrams] = await Promise.all([loadSemanticGraph(), loadSemanticDiagrams()]);
  const graphTemplates = graph.templates || {};
  const diagramTemplates = diagrams.templates || {};
  const inferred = args.doc ? inferTemplateGraphForDoc(await readJson(args.doc), graphTemplates) : null;
  const templateId = args.templateId || inferred?.templateId || '';

  if (templateId) {
    const template = diagramTemplates[templateId];
    if (!template) throw new McpError(-32602, `Unknown template diagram: ${templateId}`);
    return {
      schema: diagrams.schema,
      generatedFrom: diagrams.generatedFrom,
      templateId,
      inferredFromDoc: inferred || null,
      template,
    };
  }

  return {
    schema: diagrams.schema,
    generatedFrom: diagrams.generatedFrom,
    templateIds: Object.keys(diagramTemplates).sort(),
    templates: diagramTemplates,
  };
}

async function semanticContextTool(args = {}) {
  const target = args.html || args.doc || '';
  if (!target) throw new McpError(-32602, 'Pass doc or html.');
  const context = await semanticContextForPath(resolvePath(target));
  return {
    source: {
      kind: args.html ? 'rendered-html' : 'living-doc-json',
      path: resolvePath(target),
    },
    context,
  };
}

async function relationshipGapsTool(args = {}) {
  const { graph, template, inferred } = await resolveTemplateGraphContext(args);
  const doc = await readJson(args.doc);
  const registry = await loadRegistry(args);
  const sectionStats = sectionStatsByType(doc);
  const sectionCards = sectionCardsByType(doc);
  const operationsById = new Map((template.validOperations || []).map((operation) => [operation.id, operation]));
  const gaps = [];

  for (const relationship of template.relationships || []) {
    const fromStats = sectionStats.get(relationship.from);
    const toStats = sectionStats.get(relationship.to);
    let status = classifyRelationshipStatus(fromStats, toStats);
    if (status.kind === 'present' && relationship.evidence) {
      status = evaluateRelationshipEvidence(
        relationship,
        sectionCards.get(relationship.from) || [],
        sectionCards.get(relationship.to) || [],
      );
    }
    if (status.kind !== 'present') {
      const repairOperations = (relationship.repairOperationIds || [])
        .map((operationId) => operationsById.get(operationId))
        .filter(Boolean);
      const patchDraft = buildRelationshipGapPatchDraft({
        doc,
        relationship,
        status,
        repairOperations,
        sourceEntries: sectionCards.get(relationship.from) || [],
      });
      if (patchDraft) {
        patchDraft.validation = validatePatch(patchDraft.patch, { registry, doc });
      }
      gaps.push({
        relationshipId: relationship.id,
        relation: relationship.relation,
        from: relationship.from,
        to: relationship.to,
        severity: status.severity,
        kind: status.kind,
        reason: status.reason,
        ...(status.evidence ? { evidence: status.evidence } : {}),
        ...(status.unmatchedSourceCards ? { unmatchedSourceCards: status.unmatchedSourceCards } : {}),
        ...(status.matchedSourceCount !== undefined ? { matchedSourceCount: status.matchedSourceCount } : {}),
        ...(status.totalSourceCount !== undefined ? { totalSourceCount: status.totalSourceCount } : {}),
        repairOperations,
        ...(patchDraft ? { patchDraft } : {}),
        question: relationshipGapQuestion(relationship, status),
      });
    }
  }

  return {
    schema: graph.schema,
    doc: resolvePath(args.doc),
    templateId: template.id,
    inferredFromDoc: inferred,
    sectionStats: Object.fromEntries([...sectionStats.entries()].map(([type, stats]) => [type, stats])),
    gaps,
  };
}

async function stageDiagnosticsTool(args = {}) {
  const context = await resolveTemplateGraphContext(args);
  const relationships = await relationshipGapsTool(args);
  const doc = await readJson(args.doc);
  const sectionStats = sectionStatsByType(doc);
  const candidates = [];

  for (const signal of context.template.stageSignals || []) {
    const evaluation = evaluateStageSignal(signal, sectionStats, relationships.gaps);
    if (evaluation.triggered) {
      candidates.push({
        stage: signal.stage,
        signalId: signal.id,
        severity: signal.severity,
        question: signal.question,
        reason: evaluation.reason,
        relatedRelationships: signal.relatedRelationships || [],
      });
    }
  }

  candidates.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  return {
    schema: context.graph.schema,
    doc: resolvePath(args.doc),
    templateId: context.template.id,
    inferredFromDoc: context.inferred,
    likelyStage: candidates[0]?.stage || null,
    candidates,
    relationshipGaps: relationships.gaps,
  };
}

async function validStageOperationsTool(args = {}) {
  const { graph, template, inferred } = await resolveTemplateGraphContext(args);
  const stage = String(args.stage || '').trim();
  const operations = (template.validOperations || []).filter((operation) => (
    !stage || (operation.stages || []).includes(stage)
  ));
  return {
    schema: graph.schema,
    templateId: template.id,
    inferredFromDoc: inferred,
    stage: stage || null,
    operations,
  };
}

async function resolveTemplateGraphContext(args = {}) {
  const graph = await loadSemanticGraph();
  const templates = graph.templates || {};
  const doc = args.doc ? await readJson(args.doc) : null;
  const inferred = doc ? inferTemplateGraphForDoc(doc, templates) : null;
  const templateId = args.templateId || inferred?.templateId || '';
  if (!templateId) throw new McpError(-32602, 'Unable to infer template graph; pass templateId or a matching doc.');
  const template = templates[templateId];
  if (!template) throw new McpError(-32602, `Unknown template graph: ${templateId}`);
  return { graph, template, inferred };
}

function sectionStatsByType(doc) {
  const stats = new Map();
  for (const section of doc.sections || []) {
    const type = section.convergenceType;
    if (!type) continue;
    const cards = getCards(section);
    const existing = stats.get(type) || { sectionIds: [], cardCount: 0 };
    existing.sectionIds.push(section.id);
    existing.cardCount += cards.length;
    stats.set(type, existing);
  }
  return stats;
}

function sectionCardsByType(doc) {
  const cardsByType = new Map();
  for (const section of doc.sections || []) {
    const type = section.convergenceType;
    if (!type) continue;
    const cards = getCards(section).map((card) => ({ sectionId: section.id, card }));
    cardsByType.set(type, [...(cardsByType.get(type) || []), ...cards]);
  }
  return cardsByType;
}

function classifyRelationshipStatus(fromStats, toStats) {
  if (!fromStats) {
    return { kind: 'missing-source-section', severity: 'high', reason: 'The source convergence type is not present in the document.' };
  }
  if (!toStats) {
    return { kind: 'missing-target-section', severity: 'high', reason: 'The target convergence type is not present in the document.' };
  }
  if (fromStats.cardCount > 0 && toStats.cardCount === 0) {
    return { kind: 'missing-target-cards', severity: 'high', reason: 'The source section has cards, but the target section has no cards to carry the expected relationship.' };
  }
  if (fromStats.cardCount === 0 && toStats.cardCount > 0) {
    return { kind: 'missing-source-cards', severity: 'medium', reason: 'The target section has cards, but the source section has no cards to ground the relationship.' };
  }
  if (fromStats.cardCount === 0 && toStats.cardCount === 0) {
    return { kind: 'unpopulated', severity: 'low', reason: 'Both sides of the expected relationship are still unpopulated.' };
  }
  return { kind: 'present', severity: 'none', reason: 'Both sides are populated. Card-level relationship quality is not checked yet.' };
}

function evaluateRelationshipEvidence(relationship, sourceEntries, targetEntries) {
  const evidence = relationship.evidence || {};
  if (evidence.kind !== 'shared-field-value') {
    return { kind: 'present', severity: 'none', reason: 'No supported card-level evidence rule is defined.' };
  }

  const sourceFields = Array.isArray(evidence.sourceFields) ? evidence.sourceFields : [];
  const targetFields = Array.isArray(evidence.targetFields) ? evidence.targetFields : [];
  if (sourceFields.length === 0 || targetFields.length === 0) {
    return { kind: 'present', severity: 'none', reason: 'Card-level evidence rule is incomplete.' };
  }

  const targetValueSets = targetEntries.map(({ card }) => valuesForFields(card, targetFields));
  let matchedSourceCount = 0;
  const unmatchedSourceCards = [];

  for (const { sectionId, card } of sourceEntries) {
    const sourceValues = valuesForFields(card, sourceFields);
    const matched = targetValueSets.some((targetValues) => intersects(sourceValues, targetValues));
    if (matched) {
      matchedSourceCount += 1;
    } else {
      unmatchedSourceCards.push({
        sectionId,
        cardId: String(card?.id || card?.name || card?.title || '').trim(),
        name: String(card?.name || card?.title || card?.id || '').trim(),
        sourceValues: valuesByField(card, sourceFields),
        expectedEvidence: {
          sourceFields,
          targetFields,
        },
      });
    }
  }

  if (unmatchedSourceCards.length === 0) {
    return {
      kind: 'present',
      severity: 'none',
      reason: 'Both sides are populated and card-level evidence links were found.',
      evidence,
      matchedSourceCount,
      totalSourceCount: sourceEntries.length,
    };
  }

  return {
    kind: matchedSourceCount > 0 ? 'partial-card-evidence' : 'missing-card-evidence',
    severity: matchedSourceCount > 0 ? 'medium' : 'high',
    reason: matchedSourceCount > 0
      ? 'Some source cards have card-level evidence in the target section, but at least one source card is not evidenced.'
      : 'Both sides are populated, but no source cards have card-level evidence in the target section.',
    evidence,
    unmatchedSourceCards,
    matchedSourceCount,
    totalSourceCount: sourceEntries.length,
  };
}

function buildRelationshipGapPatchDraft({ doc, relationship, status, repairOperations, sourceEntries }) {
  const operation = repairOperations.find((item) => item?.patchKind === 'card-create') || repairOperations[0];
  if (!operation || operation.patchKind !== 'card-create') return null;

  const targetSection = (doc.sections || []).find((section) => section?.convergenceType === relationship.to);
  if (!targetSection?.id) return null;

  const sourceRef = firstPatchableSourceRef(status, sourceEntries);
  if (!sourceRef?.cardId) return null;

  const targetCards = getCards(targetSection);
  const cardId = uniqueCardId(
    targetCards,
    slugify(`${sourceRef.cardId}-${relationship.relation}`, `${relationship.to}-repair`),
  );
  const link = relationshipEvidenceLink(relationship, sourceRef);
  if (!link) return null;

  return {
    kind: 'living-doc-ai-patch/v1-draft',
    repairOperationId: operation.id,
    repairOperation: operation,
    note: 'Draft only; review and edit the card name and fields before applying.',
    patch: {
      schema: 'living-doc-ai-patch/v1',
      requestId: `relationship-gap:${relationship.id}:${sourceRef.cardId}`,
      summary: `Draft repair for ${relationship.id}`,
      proposedBy: {
        engine: 'codex',
        action: 'relationship-gap-draft',
      },
      changes: [
        {
          changeId: `repair-${slugify(relationship.id)}-${slugify(sourceRef.cardId)}`,
          kind: 'card-create',
          sectionId: targetSection.id,
          card: {
            id: cardId,
            name: `Evidence for ${sourceRef.name || sourceRef.cardId}`,
            [link.field]: link.value,
          },
        },
      ],
    },
  };
}

function firstPatchableSourceRef(status, sourceEntries) {
  const unmatched = (status.unmatchedSourceCards || []).find((entry) => entry?.cardId);
  if (unmatched) return unmatched;
  const firstSource = (sourceEntries || []).find(({ card }) => card?.id || card?.name || card?.title);
  if (!firstSource) return null;
  const sourceFields = Array.isArray(status.evidence?.sourceFields) ? status.evidence.sourceFields : ['id'];
  return {
    sectionId: firstSource.sectionId,
    cardId: String(firstSource.card?.id || firstSource.card?.name || firstSource.card?.title || '').trim(),
    name: String(firstSource.card?.name || firstSource.card?.title || firstSource.card?.id || '').trim(),
    sourceValues: valuesByField(firstSource.card, sourceFields),
  };
}

function relationshipEvidenceLink(relationship, sourceRef) {
  const targetFields = Array.isArray(relationship.evidence?.targetFields) ? relationship.evidence.targetFields : [];
  if (targetFields.length === 0) return null;

  const preferred = ['sourceCardIds', 'assertionIds', 'operationIds'].find((field) => targetFields.includes(field));
  if (preferred) {
    return { field: preferred, value: [sourceRef.cardId] };
  }

  const field = targetFields[0];
  const values = Object.values(sourceRef.sourceValues || {}).flat().filter(Boolean);
  const value = values[0] || sourceRef.cardId;
  return { field, value: arrayishField(field) ? [value] : value };
}

function uniqueCardId(cards, baseId) {
  const used = new Set((cards || []).map((card) => card?.id).filter(Boolean));
  if (!used.has(baseId)) return baseId;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${baseId}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${baseId}-${Date.now()}`;
}

function arrayishField(field) {
  return /(?:Ids|Refs|Paths)$/.test(field);
}

function valuesByField(card, fields) {
  const out = {};
  for (const field of fields || []) {
    out[field] = [...valuesForFields(card, [field])];
  }
  return out;
}

function valuesForFields(card, fields) {
  const values = new Set();
  for (const field of fields) {
    collectPrimitiveValues(card?.[field], values);
  }
  return values;
}

function collectPrimitiveValues(value, out) {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    if (text) out.add(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPrimitiveValues(item, out);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectPrimitiveValues(item, out);
  }
}

function intersects(a, b) {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function relationshipGapQuestion(relationship, status) {
  if (status.kind === 'missing-card-evidence' || status.kind === 'partial-card-evidence') {
    return `Which ${relationship.to} card explicitly carries evidence for each ${relationship.from} card?`;
  }
  if (status.kind === 'missing-target-cards') {
    return `What ${relationship.to} card should carry the ${relationship.relation} relationship from ${relationship.from}?`;
  }
  if (status.kind === 'missing-source-cards') {
    return `What ${relationship.from} card grounds the existing ${relationship.to} cards?`;
  }
  if (status.kind === 'unpopulated') {
    return `What first real entities should populate ${relationship.from} and ${relationship.to}?`;
  }
  return `What structure is needed for ${relationship.from} to ${relationship.relation} ${relationship.to}?`;
}

function evaluateStageSignal(signal, sectionStats, gaps) {
  const condition = signal.condition || {};
  if (!condition.kind || condition.kind === 'manual-review') return { triggered: false, reason: '' };

  if (condition.kind === 'section-empty') {
    const stats = sectionStats.get(condition.type);
    if (!stats || stats.cardCount === 0) {
      return { triggered: true, reason: `${condition.type} has no cards.` };
    }
  }

  if (condition.kind === 'related-relationship-gap') {
    const hasRelatedGap = (signal.relatedRelationships || []).some((id) => gaps.some((gap) => gap.relationshipId === id));
    if (hasRelatedGap) {
      return { triggered: true, reason: 'An expected relationship referenced by this stage signal is missing or weak.' };
    }
  }

  if (condition.kind === 'source-populated-target-empty') {
    const source = sectionStats.get(condition.sourceType);
    const target = sectionStats.get(condition.targetType);
    if ((source?.cardCount || 0) > 0 && (!target || target.cardCount === 0)) {
      return { triggered: true, reason: `${condition.sourceType} has cards, but ${condition.targetType} has no cards.` };
    }
  }

  if (condition.kind === 'all-populated-no-high-gaps') {
    const types = Array.isArray(condition.types) ? condition.types : [];
    const populated = types.every((type) => (sectionStats.get(type)?.cardCount || 0) > 0);
    const highGaps = gaps.some((gap) => gap.severity === 'high');
    if (populated && !highGaps) {
      return { triggered: true, reason: 'All required condition types are populated and no high-severity relationship gaps were found.' };
    }
  }

  return { triggered: false, reason: '' };
}

function severityRank(severity) {
  return { high: 0, medium: 1, low: 2, none: 3 }[severity] ?? 4;
}

async function structureRefine(args) {
  const doc = await readJson(args.doc);
  const registry = await loadRegistry(args);
  const log = [];
  const now = nowIso();
  doc.sections ||= [];

  for (const change of args.changes || []) {
    if (change.kind === 'add-section') {
      if (!registry.convergenceTypes?.[change.convergenceType]) throw new McpError(-32602, `Unknown convergence type: ${change.convergenceType}`);
      const id = change.sectionId || slugify(change.title || change.convergenceType, change.convergenceType);
      if (findSection(doc, id)) throw new McpError(-32602, `Section already exists: ${id}`);
      doc.sections.push({
        id,
        title: change.title || registry.convergenceTypes[change.convergenceType].name || id,
        convergenceType: change.convergenceType,
        rationale: change.rationale || 'Added during inference-time structure reflection.',
        updated: now,
        data: [],
      });
      log.push(`added section ${id}`);
    } else if (change.kind === 'update-section-type') {
      const section = findSection(doc, change.sectionId);
      if (!section) throw new McpError(-32602, `Missing section: ${change.sectionId}`);
      if (!registry.convergenceTypes?.[change.convergenceType]) throw new McpError(-32602, `Unknown convergence type: ${change.convergenceType}`);
      section.convergenceType = change.convergenceType;
      section.updated = now;
      log.push(`updated ${change.sectionId} convergenceType`);
    } else if (change.kind === 'update-section') {
      const section = findSection(doc, change.sectionId);
      if (!section) throw new McpError(-32602, `Missing section: ${change.sectionId}`);
      if (change.title) section.title = change.title;
      if (change.rationale) section.rationale = change.rationale;
      section.updated = now;
      log.push(`updated section ${change.sectionId}`);
    } else if (change.kind === 'remove-section') {
      const section = findSection(doc, change.sectionId);
      if (!section) throw new McpError(-32602, `Missing section: ${change.sectionId}`);
      if (getCards(section).length > 0 && change.force !== true) throw new McpError(-32602, `Refusing to remove non-empty section without force: ${change.sectionId}`);
      doc.sections = doc.sections.filter((s) => s.id !== change.sectionId);
      log.push(`removed section ${change.sectionId}`);
    } else {
      throw new McpError(-32602, `Unsupported structure change kind: ${change.kind}`);
    }
  }

  doc.updated = now;
  await writeJson(args.doc, doc);
  return { ok: true, doc: resolvePath(args.doc), log, sections: doc.sections.map((s) => ({ id: s.id, convergenceType: s.convergenceType })) };
}

async function sourcesAdd(args) {
  const doc = await readJson(args.doc);
  const section = findSection(doc, args.sectionId);
  if (!section) throw new McpError(-32602, `Missing section: ${args.sectionId}`);
  const cards = getCards(section);
  const card = normalizeCardForDoc(args.card);
  if (!card.id) card.id = slugify(card.name || card.title || `card-${cards.length + 1}`);
  if (!card.name) card.name = card.title || card.id;
  if (cards.some((item) => item?.id === card.id)) throw new McpError(-32602, `Card already exists: ${args.sectionId}/${card.id}`);
  cards.push(card);
  section.updated = nowIso();
  doc.updated = section.updated;
  await writeJson(args.doc, doc);
  return { ok: true, doc: resolvePath(args.doc), sectionId: args.sectionId, card };
}

async function sourcesCreate(args) {
  const policy = args.policy || {};
  const kind = args.kind || 'plan';
  const sourceId = slugify(args.payload?.id || args.payload?.title || args.payload?.name || kind, 'source');
  const title = args.payload?.title || args.payload?.name || 'Source material';
  const baseEntity = {
    id: sourceId,
    kind,
    title,
    createdBy: 'living-doc-mcp',
    createdAt: nowIso(),
  };
  if (!policy.allowWrite || kind === 'plan') {
    return {
      ok: true,
      mode: 'plan',
      kind,
      entityRef: {
        ...baseEntity,
        planned: true,
        payload: args.payload,
      },
      docLinkGuidance: {
        edgeType: args.payload?.edgeType || 'references',
        recommendedField: args.payload?.field || 'refs',
        summary: args.payload?.summary || title,
      },
      note: 'No source material was written because policy.allowWrite is not true or kind is plan.',
    };
  }

  if (kind === 'local-markdown') {
    const out = resolvePath(args.payload?.path || `docs/source-material/${sourceId}.md`);
    await mkdir(path.dirname(out), { recursive: true });
    const body = args.payload?.body || '';
    const frontmatter = [
      '---',
      `sourceId: ${JSON.stringify(sourceId)}`,
      `createdAt: ${JSON.stringify(baseEntity.createdAt)}`,
      `createdBy: ${JSON.stringify(baseEntity.createdBy)}`,
      '---',
      '',
    ].join('\n');
    await writeFile(out, `${frontmatter}# ${title}\n\n${body}\n`);
    return { ok: true, kind, entityRef: { ...baseEntity, path: out, url: out } };
  }

  if (kind === 'local-json') {
    const out = resolvePath(args.payload?.path || `docs/source-material/${sourceId}.json`);
    await mkdir(path.dirname(out), { recursive: true });
    const value = {
      ...baseEntity,
      data: args.payload?.data ?? args.payload,
    };
    await writeJson(out, value);
    return { ok: true, kind, entityRef: { ...baseEntity, path: out, url: out } };
  }

  if (kind === 'github-issue') {
    const repo = args.payload?.repo;
    if (!repo || !title) throw new McpError(-32602, 'github-issue requires payload.repo and payload.title');
    const ghArgs = ['issue', 'create', '--repo', repo, '--title', title];
    if (args.payload?.body) ghArgs.push('--body', args.payload.body);
    for (const label of args.payload?.labels || []) ghArgs.push('--label', label);
    const result = spawnSync('gh', ghArgs, { cwd: repoRoot, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'gh issue create failed');
    const url = result.stdout.trim();
    const issueNumber = url.match(/\/issues\/(\d+)/)?.[1] ? `#${url.match(/\/issues\/(\d+)/)[1]}` : undefined;
    return { ok: true, kind, entityRef: { ...baseEntity, repo, url, issueUrl: url, ...(issueNumber ? { issueNumber } : {}) } };
  }

  throw new McpError(-32602, `Unsupported source material kind: ${kind}`);
}

async function sourcesLink(args) {
  const doc = await readJson(args.doc);
  const { section, card } = findCard(doc, args.sectionId, args.cardId);
  if (!section || !card) throw new McpError(-32602, `Missing card: ${args.sectionId}/${args.cardId}`);
  const field = args.field || 'refs';
  const link = { edgeType: args.edgeType || 'references', ...args.entityRef };
  if (Array.isArray(card[field])) {
    card[field].push(link);
  } else if (card[field] === undefined) {
    card[field] = [link];
  } else {
    card[field] = [card[field], link];
  }
  section.updated = nowIso();
  doc.updated = section.updated;
  await writeJson(args.doc, doc);
  return { ok: true, doc: resolvePath(args.doc), sectionId: args.sectionId, cardId: args.cardId, field, link };
}

async function coverageMap(args) {
  const doc = await readJson(args.doc);
  doc.coverage ||= [];
  const exists = doc.coverage.some((edge) => edge.facetId === args.facetId && edge.sectionId === args.sectionId && edge.cardId === args.cardId);
  if (!exists) doc.coverage.push({ facetId: args.facetId, sectionId: args.sectionId, cardId: args.cardId, ...(args.rationale ? { rationale: args.rationale } : {}) });
  doc.updated = nowIso();
  await writeJson(args.doc, doc);
  return { ok: true, added: !exists, doc: resolvePath(args.doc), edge: { facetId: args.facetId, sectionId: args.sectionId, cardId: args.cardId } };
}

async function coverageEvaluateSuccess(args) {
  const coverage = await callTool('living_doc_coverage_find_gaps', { doc: args.doc });
  const governance = await callTool('living_doc_governance_evaluate', { doc: args.doc, registry: args.registry });
  return {
    doc: resolvePath(args.doc),
    successReady: coverage.uncoveredFacets.length === 0 && coverage.invalidEdges.length === 0 && governance.violations.length === 0,
    uncoveredFacets: coverage.uncoveredFacets,
    invalidEdges: coverage.invalidEdges,
    governanceViolations: governance.violations,
    governanceWarnings: governance.warnings,
  };
}

async function governanceListInvariants(args) {
  const doc = await readJson(args.doc);
  const scope = args.scope || '*';
  const invariants = (doc.invariants || []).filter((inv) => invariantApplies(inv, scope));
  return { doc: resolvePath(args.doc), scope, invariants };
}

function invariantApplies(inv, scope) {
  if (!scope || scope === '*' || scope === 'wholeDoc') return true;
  const appliesTo = inv?.appliesTo || [];
  if (appliesTo.includes('*') || appliesTo.includes(scope)) return true;
  if (scope.startsWith('section:')) return appliesTo.includes(scope.slice('section:'.length));
  if (scope.startsWith('card:')) return appliesTo.includes(scope.split('/')[0].slice('card:'.length));
  return false;
}

async function governanceEvaluate(args) {
  const base = parseJsonOutput(runNode([harnessCli, 'governance-check', ...toArgs(args, ['doc', 'registry'])]));
  const doc = await readJson(args.doc);
  const registry = await loadRegistry(args);
  const invariants = await governanceListInvariants(args);
  const violations = [];
  const warnings = [...(base.warnings || [])];
  const invariantEvaluations = [];
  const sourcePressure = [];
  const typeBoundaryWarnings = [];

  for (const section of doc.sections || []) {
    const typeDef = registry.convergenceTypes?.[section.convergenceType];
    const expectedSourceKeys = typeSourceKeys(typeDef);
    for (const card of getCards(section)) {
      const sourceCoverage = cardSourceCoverage(card, typeDef);
      const completionStatus = isCompletionStatus(registry, typeDef, card);
      const evidencePresent = hasEvidence(card);
      const pressure = sourceMaterialPressure(card);
      sourcePressure.push(...pressure.map((item) => ({ sectionId: section.id, cardId: card.id, ...item })));

      if (completionStatus && !evidencePresent) {
        violations.push({
          kind: 'status-needs-evidence',
          sectionId: section.id,
          cardId: card.id,
          invariantId: matchingInvariantId(invariants.invariants, 'evidence') || 'status-needs-evidence',
          message: `Card ${section.id}/${card.id} has a completion/current status without explicit evidence or source references.`,
        });
      }
      if (expectedSourceKeys.length > 0 && !sourceCoverage.hasAnyExpectedSource) {
        typeBoundaryWarnings.push({
          kind: 'missing-typed-source',
          sectionId: section.id,
          cardId: card.id,
          expectedSourceKeys,
          message: `Card ${section.id}/${card.id} does not carry any expected source key for ${section.convergenceType}.`,
        });
      }
      for (const item of pressure) {
        violations.push({
          kind: 'source-detail-owned-by-source',
          sectionId: section.id,
          cardId: card.id,
          invariantId: matchingInvariantId(invariants.invariants, 'source') || 'source-detail-owned-by-source',
          field: item.field,
          size: item.size,
          message: `Card ${section.id}/${card.id}.${item.field} is large inline detail and should likely be source material.`,
        });
      }
      if (card?.path && String(card.path).endsWith('.html')) {
        const siblingJson = resolvePath(String(card.path).replace(/\.html$/, '.json'));
        if (existsSync(siblingJson)) {
          warnings.push({
            kind: 'snapshot-vs-source',
            sectionId: section.id,
            cardId: card.id,
            message: `Card points at rendered HTML while sibling source JSON exists: ${siblingJson}`,
          });
        }
      }
    }
  }

  for (const inv of invariants.invariants || []) {
    const statement = String(inv.statement || '').toLowerCase();
    const relatedViolations = violations.filter((violation) => violation.invariantId === inv.id || statement.includes(violation.kind.split('-')[0]));
    invariantEvaluations.push({
      invariantId: inv.id,
      appliesTo: inv.appliesTo,
      status: relatedViolations.length > 0 ? 'violated' : 'not-triggered',
      relatedViolations: relatedViolations.map((violation) => ({ kind: violation.kind, sectionId: violation.sectionId, cardId: violation.cardId })),
    });
  }

  return {
    doc: resolvePath(args.doc),
    scope: args.scope || '*',
    ok: base.ok && violations.length === 0,
    applicableInvariants: invariants.invariants,
    invariantEvaluations,
    duplicateSections: base.duplicateSections || [],
    invalidInvariants: base.invalidInvariants || [],
    invalidCoverageEdges: base.invalidCoverageEdges || [],
    warnings: [...warnings, ...typeBoundaryWarnings],
    sourceMaterialPressure: sourcePressure,
    violations,
  };
}

function matchingInvariantId(invariants, needle) {
  const match = (invariants || []).find((inv) => `${inv.id} ${inv.name || ''} ${inv.statement || ''}`.toLowerCase().includes(needle));
  return match?.id || '';
}

function classifyTrap(args) {
  const text = `${args.event || ''} ${JSON.stringify(args.context || {})}`.toLowerCase();
  const patterns = [
    ['weak-domain-frame', ['wrong structure', 'wrong type', 'mixed section', 'unclear domain', 'frame']],
    ['missing-evidence', ['no evidence', 'without evidence', 'missing evidence', 'untested', 'verification', 'assumed', 'guess']],
    ['source-ownership', ['too much detail', 'inline', 'should be issue', 'source material', 'canonical']],
    ['stale-source', ['stale', 'outdated', 'old html', 'old json', 'drift']],
    ['looping', ['again', 'loop', 'repeated', 'keeps', 'retry']],
  ];
  const [kind, keywords] = patterns.find(([, words]) => words.some((word) => text.includes(word))) || ['general-trap', []];
  return {
    kind,
    confidence: keywords.length ? 'medium' : 'low',
    event: args.event,
    suggestedInvariant: invariantForTrap(kind),
  };
}

function invariantForTrap(kind) {
  const map = {
    'weak-domain-frame': 'When source relationships do not fit the selected convergence type, pause and refine the document structure before continuing.',
    'missing-evidence': 'Do not advance a status to complete/current without linked verification or evidence.',
    'source-ownership': 'Large, canonical, operational, or executable detail must live in a source artifact and be linked from the living doc.',
    'stale-source': 'Do not treat rendered snapshots as canonical when source JSON or source systems are available.',
    looping: 'When the same work step fails twice, classify the trap and check governance before retrying.',
    'general-trap': 'When a repeated trap appears, add a scoped invariant before continuing.',
  };
  return map[kind];
}

async function governanceSuggestInvariant(args) {
  const doc = await readJson(args.doc);
  const inv = {
    id: args.invariant.id || args.invariant.invariantId || slugify(args.invariant.name || args.trap || args.invariant.statement, 'invariant'),
    name: args.invariant.name || 'Suggested invariant',
    statement: args.invariant.statement || args.invariant.rule || invariantForTrap(args.trap || 'general-trap'),
    appliesTo: args.appliesTo || args.invariant.appliesTo || ['*'],
    suggestedBy: 'codex-mcp',
    ...(args.trap ? { trap: args.trap } : {}),
  };
  if (args.apply) {
    doc.invariants ||= [];
    const existing = doc.invariants.find((item) => item.id === inv.id);
    if (existing) Object.assign(existing, inv);
    else doc.invariants.push(inv);
    doc.updated = nowIso();
    await writeJson(args.doc, doc);
  }
  return { ok: true, applied: Boolean(args.apply), doc: resolvePath(args.doc), invariant: inv };
}

async function governanceRefineInvariant(args) {
  const doc = await readJson(args.doc);
  const invariant = (doc.invariants || []).find((item) => item.id === args.invariantId);
  if (!invariant) throw new McpError(-32602, `Missing invariant: ${args.invariantId}`);
  for (const key of ['name', 'statement', 'appliesTo', 'note']) {
    if (args.change[key] !== undefined) invariant[key] = args.change[key];
  }
  invariant.updated = nowIso();
  doc.updated = invariant.updated;
  await writeJson(args.doc, doc);
  return { ok: true, doc: resolvePath(args.doc), invariant };
}

async function validatePatchTool(args) {
  const registry = args.registry ? await loadRegistry(args) : existsSync(registryPath(args)) ? await loadRegistry(args) : null;
  const doc = args.doc ? await readJson(args.doc) : null;
  return validatePatch(args.patch, { registry, doc });
}

async function applyPatchTool(args) {
  const validation = await validatePatchTool(args);
  if (!validation.ok) return { ok: false, validation };
  const doc = await readJson(args.doc);
  const result = applyAiPatch(doc, args.patch, { acceptedChangeIds: args.acceptedChangeIds || null });
  result.doc.updated = nowIso();
  await writeJson(args.doc, result.doc);
  return {
    ok: true,
    doc: resolvePath(args.doc),
    validation,
    log: result.log,
    sideEffects: result.sideEffects,
    note: result.sideEffects.length ? 'External side effects were not executed by this MCP tool.' : '',
  };
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'living_doc_registry_summary':
      return parseJsonOutput(runNode([harnessCli, 'registry-summary', ...toArgs(args, ['registry'])]));
    case 'living_doc_registry_explain_type':
      return registryExplainType(args);
    case 'living_doc_convergence_type_contract':
      return convergenceTypeContractTool(args);
    case 'living_doc_registry_match_objective':
    case 'living_doc_match_structure':
    case 'living_doc_structure_select':
      return parseJsonOutput(runNode([harnessCli, 'match-structure', ...toArgs(args, ['objective', 'success', 'registry'])]));
    case 'living_doc_registry_propose_type_gap':
      return proposeTypeGap(args);
    case 'living_doc_objective_decompose':
      return { objective: args.objective, successCondition: args.success || '', facets: initialFacets(args.objective, args.success) };
    case 'living_doc_scaffold':
      return parseJsonOutput(runNode([harnessCli, 'scaffold', ...toArgs(args, ['objective', 'out', 'success', 'title', 'template', 'registry'])]));
    case 'living_doc_structure_reflect':
      return structureReflect(args);
    case 'living_doc_template_graph':
      return templateGraphTool(args);
    case 'living_doc_template_diagrams':
      return templateDiagramsTool(args);
    case 'living_doc_semantic_context':
      return semanticContextTool(args);
    case 'living_doc_relationship_gaps':
      return relationshipGapsTool(args);
    case 'living_doc_stage_diagnostics':
      return stageDiagnosticsTool(args);
    case 'living_doc_valid_stage_operations':
      return validStageOperationsTool(args);
    case 'living_doc_structure_refine':
      return structureRefine(args);
    case 'living_doc_sources_add':
      return sourcesAdd(args);
    case 'living_doc_sources_create':
      return sourcesCreate(args);
    case 'living_doc_sources_link':
      return sourcesLink(args);
    case 'living_doc_coverage_map':
      return coverageMap(args);
    case 'living_doc_coverage_find_gaps':
    case 'living_doc_coverage_check':
      return parseJsonOutput(runNode([harnessCli, 'coverage-check', ...toArgs(args, ['doc'])]));
    case 'living_doc_coverage_evaluate_success_condition':
      return coverageEvaluateSuccess(args);
    case 'living_doc_governance_list_invariants':
      return governanceListInvariants(args);
    case 'living_doc_governance_evaluate':
    case 'living_doc_governance_check':
      return governanceEvaluate(args);
    case 'living_doc_governance_classify_trap':
      return classifyTrap(args);
    case 'living_doc_governance_suggest_invariant':
      return governanceSuggestInvariant(args);
    case 'living_doc_governance_refine_invariant':
      return governanceRefineInvariant(args);
    case 'living_doc_governance_check_patch':
    case 'living_doc_patch_validate':
      return validatePatchTool(args);
    case 'living_doc_patch_apply':
      return applyPatchTool(args);
    case 'living_doc_render': {
      const renderArgs = [path.join(repoRoot, 'scripts/render-living-doc.mjs'), String(args.doc || '')];
      if (args.commit) renderArgs.push('--commit');
      if (args.message) renderArgs.push('--message', String(args.message));
      const output = runNode(renderArgs);
      const docPath = resolvePath(args.doc);
      return { ok: true, doc: docPath, html: docPath.replace(/\.json$/, '.html'), output: String(output || '').trim() };
    }
    default:
      throw new McpError(-32602, `Unknown tool: ${name}`);
  }
}

class McpError extends Error {
  constructor(code, message, data = undefined) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  try {
    if (method === 'initialize') {
      return response(id, {
        protocolVersion: params?.protocolVersion || protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'living-doc-compositor', version: '0.1.0' },
      });
    }
    if (method === 'notifications/initialized') return null;
    if (method === 'ping') return isNotification ? null : response(id, {});
    if (method === 'tools/list') return response(id, { tools });
    if (method === 'tools/call') {
      const result = await callTool(params?.name, params?.arguments || {});
      return response(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      });
    }
    if (isNotification) return null;
    return errorResponse(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    if (isNotification) return null;
    const code = Number.isInteger(error?.code) ? error.code : -32000;
    return errorResponse(id, code, error?.message || String(error), error?.data);
  }
}

function response(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message, data = undefined) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

function writeMessage(message) {
  if (!message) return;
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

let buffer = Buffer.alloc(0);

console.error('Living Doc Compositor MCP server running on stdio');

function extractHeaderMessage() {
  const sep = buffer.indexOf('\r\n\r\n');
  if (sep < 0) return null;
  const header = buffer.slice(0, sep).toString('utf8');
  const match = header.match(/content-length:\s*(\d+)/i);
  if (!match) throw new Error('missing Content-Length header');
  const length = Number(match[1]);
  const start = sep + 4;
  const end = start + length;
  if (buffer.length < end) return null;
  const body = buffer.slice(start, end).toString('utf8');
  buffer = buffer.slice(end);
  return JSON.parse(body);
}

function extractLineMessage() {
  const newline = buffer.indexOf('\n');
  if (newline < 0) return null;
  const line = buffer.slice(0, newline).toString('utf8').trim();
  buffer = buffer.slice(newline + 1);
  if (!line) return undefined;
  return JSON.parse(line);
}

async function drainMessages() {
  while (buffer.length > 0) {
    let message;
    const text = buffer.toString('utf8', 0, Math.min(buffer.length, 32));
    if (/^Content-Length:/i.test(text)) message = extractHeaderMessage();
    else message = extractLineMessage();
    if (message === null) return;
    if (message === undefined) continue;
    writeMessage(await handleMessage(message));
  }
}

process.stdin.on('data', async (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  try {
    await drainMessages();
  } catch (error) {
    writeMessage(errorResponse(null, -32700, error?.message || String(error)));
    buffer = Buffer.alloc(0);
  }
});

process.stdin.resume();
