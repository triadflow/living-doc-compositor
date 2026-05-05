#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultGraphPath = path.join(repoRoot, 'scripts/generated/living-doc-template-graphs.json');
const defaultOut = path.join(repoRoot, 'scripts/generated/living-doc-template-diagrams.json');

export async function buildSemanticDiagrams(graphPath = defaultGraphPath) {
  const graph = JSON.parse(await readFile(graphPath, 'utf8'));
  const templates = {};

  for (const [templateId, template] of Object.entries(graph.templates || {}).sort(([a], [b]) => a.localeCompare(b))) {
    templates[templateId] = {
      id: templateId,
      name: template.name,
      mermaid: templateToMermaid(template),
    };
  }

  return {
    schema: 'living-doc-semantic-diagrams/v1',
    generatedFrom: path.relative(repoRoot, graphPath),
    templates,
  };
}

function templateToMermaid(template) {
  const lines = ['flowchart LR'];
  const nodeIds = new Map();

  for (const section of template.sections || []) {
    const nodeId = safeNodeId(section.convergenceType);
    nodeIds.set(section.convergenceType, nodeId);
    lines.push(`  ${nodeId}["${escapeLabel(section.convergenceType)}<br/>${escapeLabel(section.role || '')}"]`);
  }

  if ((template.relationships || []).length) lines.push('');
  for (const relationship of template.relationships || []) {
    const from = nodeIds.get(relationship.from) || safeNodeId(relationship.from);
    const to = nodeIds.get(relationship.to) || safeNodeId(relationship.to);
    lines.push(`  ${from} -- "${escapeLabel(relationship.relation)}" --> ${to}`);
  }

  return `${lines.join('\n')}\n`;
}

function safeNodeId(value) {
  return String(value || 'node').replace(/[^A-Za-z0-9_]/g, '_');
}

function escapeLabel(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function writeSemanticDiagrams(outPath = defaultOut) {
  const diagrams = await buildSemanticDiagrams();
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(diagrams, null, 2)}\n`);
  return { outPath, diagrams };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const checkOnly = process.argv.includes('--check');
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex >= 0 ? path.resolve(repoRoot, process.argv[outIndex + 1]) : defaultOut;
  const diagrams = await buildSemanticDiagrams();
  const next = `${JSON.stringify(diagrams, null, 2)}\n`;
  if (checkOnly) {
    const existing = await readFile(outPath, 'utf8').catch(() => null);
    if (existing !== next) {
      console.error(`${path.relative(repoRoot, outPath)} is out of date. Run node scripts/generate-living-doc-semantic-diagrams.mjs`);
      process.exit(1);
    }
    console.log(`${path.relative(repoRoot, outPath)} is up to date`);
  } else {
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, next);
    console.log(`Wrote ${path.relative(repoRoot, outPath)}`);
  }
}
