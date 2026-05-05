#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { templateDefinitions } from './living-doc-definitions/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultOut = path.join(repoRoot, 'scripts/generated/living-doc-template-graphs.json');

export async function buildSemanticGraph() {
  const registry = JSON.parse(await readFile(path.join(repoRoot, 'scripts/living-doc-registry.json'), 'utf8'));
  const templates = {};

  for (const definition of [...templateDefinitions].sort((a, b) => a.id.localeCompare(b.id))) {
    templates[definition.id] = await buildTemplateGraph(definition, registry);
  }

  return {
    schema: 'living-doc-semantic-graph/v1',
    generatedFrom: 'scripts/living-doc-definitions',
    templates,
  };
}

async function buildTemplateGraph(definition, registry) {
  const templatePath = path.join(repoRoot, definition.templatePath);
  const template = JSON.parse(await readFile(templatePath, 'utf8'));
  const templateSections = new Map((template.sections || []).map((section) => [section.id, section]));
  const templateTypes = new Set((template.sections || []).map((section) => section.convergenceType));

  for (const section of definition.sections) {
    if (!registry.convergenceTypes?.[section.convergenceType]) {
      throw new Error(`${definition.id}.${section.id} references unknown convergence type ${section.convergenceType}`);
    }
    const templateSection = templateSections.get(section.id);
    if (!templateSection) {
      throw new Error(`${definition.id}.${section.id} missing from ${definition.templatePath}`);
    }
    if (templateSection.convergenceType !== section.convergenceType) {
      throw new Error(`${definition.id}.${section.id} expected ${section.convergenceType}, template has ${templateSection.convergenceType}`);
    }
  }

  for (const relationship of definition.relationships) {
    if (!templateTypes.has(relationship.from)) {
      throw new Error(`${definition.id}.${relationship.id} from type ${relationship.from} is not present in template`);
    }
    if (!templateTypes.has(relationship.to)) {
      throw new Error(`${definition.id}.${relationship.id} to type ${relationship.to} is not present in template`);
    }
  }

  const relationshipIds = new Set(definition.relationships.map((relationship) => relationship.id));
  for (const signal of definition.stageSignals) {
    for (const relationshipId of signal.relatedRelationships || []) {
      if (!relationshipIds.has(relationshipId)) {
        throw new Error(`${definition.id}.${signal.id} references unknown relationship ${relationshipId}`);
      }
    }
  }

  return {
    id: definition.id,
    name: definition.name,
    templatePath: definition.templatePath,
    objectiveRole: definition.objectiveRole,
    templateObjective: template.objective || '',
    templateSuccessCondition: template.successCondition || '',
    sections: definition.sections,
    relationships: definition.relationships,
    stageSignals: definition.stageSignals,
    validOperations: definition.validOperations,
  };
}

export async function writeSemanticGraph(outPath = defaultOut) {
  const graph = await buildSemanticGraph();
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(graph, null, 2)}\n`);
  return { outPath, graph };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const checkOnly = process.argv.includes('--check');
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex >= 0 ? path.resolve(repoRoot, process.argv[outIndex + 1]) : defaultOut;
  const graph = await buildSemanticGraph();
  const next = `${JSON.stringify(graph, null, 2)}\n`;
  if (checkOnly) {
    const existing = await readFile(outPath, 'utf8').catch(() => null);
    if (existing !== next) {
      console.error(`${path.relative(repoRoot, outPath)} is out of date. Run node scripts/generate-living-doc-semantic-graph.mjs`);
      process.exit(1);
    }
    console.log(`${path.relative(repoRoot, outPath)} is up to date`);
  } else {
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, next);
    console.log(`Wrote ${path.relative(repoRoot, outPath)}`);
  }
}
