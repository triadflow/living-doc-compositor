#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultRegistryPath = path.join(repoRoot, 'scripts/living-doc-registry.json');
const defaultGraphPath = path.join(repoRoot, 'scripts/generated/living-doc-template-graphs.json');

export async function buildRegistrySemanticUses({
  registryPath = defaultRegistryPath,
  graphPath = defaultGraphPath,
} = {}) {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const graph = JSON.parse(await readFile(graphPath, 'utf8'));
  const usesByType = new Map();

  for (const [templateId, template] of Object.entries(graph.templates || {}).sort(([a], [b]) => a.localeCompare(b))) {
    for (const section of template.sections || []) {
      const typeId = section.convergenceType;
      if (!typeId) continue;
      const use = templateUseForType({ templateId, template, typeId });
      usesByType.set(typeId, [...(usesByType.get(typeId) || []), use]);
    }
  }

  return {
    registry,
    graph,
    usesByType: Object.fromEntries([...usesByType.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function templateUseForType({ templateId, template, typeId }) {
  const sections = (template.sections || []).filter((section) => section.convergenceType === typeId);
  const relationships = template.relationships || [];
  const incoming = relationships
    .filter((relationship) => relationship.to === typeId)
    .map(relationshipSummary);
  const outgoing = relationships
    .filter((relationship) => relationship.from === typeId)
    .map(relationshipSummary);

  return {
    templateId,
    templateName: template.name || templateId,
    templatePath: template.templatePath,
    sectionIds: sections.map((section) => section.id),
    roles: sections.map((section) => section.role || '').filter(Boolean),
    relationships: { incoming, outgoing },
    stageSignals: (template.stageSignals || [])
      .filter((signal) => stageSignalTouchesType(signal, typeId, relationships))
      .map((signal) => ({
        id: signal.id,
        stage: signal.stage,
        severity: signal.severity,
        condition: signal.condition,
        relatedRelationships: signal.relatedRelationships || [],
      })),
  };
}

function relationshipSummary(relationship) {
  return {
    id: relationship.id,
    from: relationship.from,
    to: relationship.to,
    relation: relationship.relation,
    evidenceKind: relationship.evidence?.kind || null,
    repairOperationIds: relationship.repairOperationIds || [],
    required: relationship.required !== false,
  };
}

function stageSignalTouchesType(signal, typeId, relationships) {
  const condition = signal.condition || {};
  if (condition.type === typeId || condition.sourceType === typeId || condition.targetType === typeId) return true;
  if (Array.isArray(condition.types) && condition.types.includes(typeId)) return true;

  const related = new Set(signal.relatedRelationships || []);
  return relationships.some((relationship) => (
    related.has(relationship.id)
    && (relationship.from === typeId || relationship.to === typeId)
  ));
}

export async function buildRegistryWithSemanticUses(options = {}) {
  const { registry, graph, usesByType } = await buildRegistrySemanticUses(options);
  const next = JSON.parse(JSON.stringify(registry));

  for (const typeDef of Object.values(next.convergenceTypes || {})) {
    delete typeDef.semanticUses;
  }

  for (const [typeId, uses] of Object.entries(usesByType)) {
    const typeDef = next.convergenceTypes?.[typeId];
    if (!typeDef) {
      throw new Error(`Generated semantic use references unknown convergence type: ${typeId}`);
    }
    typeDef.semanticUses = {
      schema: 'living-doc-convergence-type-semantic-uses/v1',
      generatedFrom: graph.generatedFrom,
      graphArtifactPath: 'scripts/generated/living-doc-template-graphs.json',
      templates: uses,
    };
  }

  return { registry: next, usesByType };
}

export async function syncRegistrySemanticUses({ check = false } = {}) {
  const { registry, usesByType } = await buildRegistryWithSemanticUses();
  const next = `${JSON.stringify(registry, null, 2)}\n`;
  const current = await readFile(defaultRegistryPath, 'utf8');
  const changed = current !== next;
  if (check) return { ok: !changed, usesByType };
  if (changed) await writeFile(defaultRegistryPath, next);
  return { ok: true, changed, usesByType };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const check = process.argv.includes('--check');
  const result = await syncRegistrySemanticUses({ check });
  if (check) {
    if (!result.ok) {
      console.error('scripts/living-doc-registry.json is out of date. Run node scripts/generate-living-doc-registry-semantics.mjs');
      process.exit(1);
    }
    console.log(`registry semantic uses are up to date: ${Object.keys(result.usesByType).length} convergence types`);
  } else if (result.changed) {
    console.log('Wrote scripts/living-doc-registry.json');
  } else {
    console.log(`registry semantic uses already up to date: ${Object.keys(result.usesByType).length} convergence types`);
  }
}
