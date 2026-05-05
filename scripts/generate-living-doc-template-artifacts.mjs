#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultGraphPath = path.join(repoRoot, 'scripts/generated/living-doc-template-graphs.json');
const defaultDiagramPath = path.join(repoRoot, 'scripts/generated/living-doc-template-diagrams.json');

export async function buildTemplateArtifactUpdates({
  graphPath = defaultGraphPath,
  diagramPath = defaultDiagramPath,
} = {}) {
  const graph = JSON.parse(await readFile(graphPath, 'utf8'));
  const diagrams = JSON.parse(await readFile(diagramPath, 'utf8'));
  const updates = [];

  for (const [templateId, templateGraph] of Object.entries(graph.templates || {}).sort(([a], [b]) => a.localeCompare(b))) {
    const templatePath = path.join(repoRoot, templateGraph.templatePath);
    const template = JSON.parse(await readFile(templatePath, 'utf8'));
    const semanticDefinition = buildTemplateSemanticDefinition({
      templateId,
      templateGraph,
      diagram: diagrams.templates?.[templateId] || null,
      graph,
      diagrams,
    });

    const nextTemplate = {
      ...template,
      templateMeta: {
        ...(template.templateMeta || {}),
        semanticDefinition,
      },
    };

    updates.push({
      templateId,
      templatePath,
      relativePath: path.relative(repoRoot, templatePath),
      current: `${JSON.stringify(template, null, 2)}\n`,
      next: `${JSON.stringify(nextTemplate, null, 2)}\n`,
      semanticDefinition,
    });
  }

  return updates;
}

export function buildTemplateSemanticDefinition({ templateId, templateGraph, diagram, graph, diagrams }) {
  return {
    schema: 'living-doc-template-semantic-definition/v1',
    definitionId: templateId,
    generatedFrom: graph.generatedFrom,
    graph: {
      schema: graph.schema,
      artifactPath: 'scripts/generated/living-doc-template-graphs.json',
    },
    diagram: diagram ? {
      schema: diagrams.schema,
      artifactPath: 'scripts/generated/living-doc-template-diagrams.json',
      mermaid: diagram.mermaid,
    } : null,
    objectiveRole: templateGraph.objectiveRole || '',
    templateObjective: templateGraph.templateObjective || '',
    templateSuccessCondition: templateGraph.templateSuccessCondition || '',
    sections: templateGraph.sections || [],
    relationships: templateGraph.relationships || [],
    stageSignals: templateGraph.stageSignals || [],
    validOperations: templateGraph.validOperations || [],
    counts: {
      sections: (templateGraph.sections || []).length,
      relationships: (templateGraph.relationships || []).length,
      stageSignals: (templateGraph.stageSignals || []).length,
      validOperations: (templateGraph.validOperations || []).length,
    },
  };
}

export async function syncTemplateArtifacts({ check = false } = {}) {
  const updates = await buildTemplateArtifactUpdates();
  const changed = updates.filter((update) => update.current !== update.next);
  if (check) return { ok: changed.length === 0, changed, updates };

  for (const update of changed) {
    await writeFile(update.templatePath, update.next);
  }
  return { ok: true, changed, updates };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const check = process.argv.includes('--check');
  const result = await syncTemplateArtifacts({ check });
  if (check) {
    if (!result.ok) {
      for (const update of result.changed) {
        console.error(`${update.relativePath} is out of date. Run node scripts/generate-living-doc-template-artifacts.mjs`);
      }
      process.exit(1);
    }
    console.log(`template artifacts are up to date: ${result.updates.length} templates`);
  } else {
    for (const update of result.changed) {
      console.log(`Wrote ${update.relativePath}`);
    }
    if (result.changed.length === 0) {
      console.log(`template artifacts already up to date: ${result.updates.length} templates`);
    }
  }
}
