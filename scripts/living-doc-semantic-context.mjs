import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

export const semanticGraphPath = path.join(repoRoot, 'scripts/generated/living-doc-template-graphs.json');
export const semanticDiagramPath = path.join(repoRoot, 'scripts/generated/living-doc-template-diagrams.json');

export async function loadSemanticGraph(filePath = semanticGraphPath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function loadSemanticDiagrams(filePath = semanticDiagramPath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export function inferTemplateGraphForDoc(doc, templates) {
  const docId = String(doc?.docId || '');
  if (docId.startsWith('template:')) {
    const templateId = docId.slice('template:'.length);
    if (templates[templateId]) return { templateId, method: 'docId' };
  }

  const canonicalOrigin = String(doc?.canonicalOrigin || '');
  const filenameMatch = canonicalOrigin.match(/living-doc-template-([a-z0-9-]+)\.json$/);
  if (filenameMatch?.[1] && templates[filenameMatch[1]]) {
    return { templateId: filenameMatch[1], method: 'canonicalOrigin' };
  }

  const docTypes = (doc?.sections || []).map((section) => section.convergenceType).filter(Boolean);
  for (const [templateId, template] of Object.entries(templates)) {
    const templateTypes = (template.sections || []).map((section) => section.convergenceType).filter(Boolean);
    if (sameStringArray(docTypes, templateTypes)) {
      return { templateId, method: 'sectionTypeSequence' };
    }
  }

  return null;
}

export async function semanticGraphSummaryForDoc(doc) {
  const graph = await loadSemanticGraph().catch(() => null);
  const templates = graph?.templates || {};
  const inferred = inferTemplateGraphForDoc(doc, templates);
  if (!inferred) return null;
  const template = templates[inferred.templateId];
  if (!template) return null;
  return {
    schema: graph.schema,
    templateId: inferred.templateId,
    inferredFromDoc: inferred,
    relationships: template.relationships || [],
    stageSignals: template.stageSignals || [],
    validOperations: template.validOperations || [],
  };
}

export async function semanticContextForDoc(doc) {
  const graph = await loadSemanticGraph().catch(() => null);
  const templates = graph?.templates || {};
  const inferred = inferTemplateGraphForDoc(doc, templates);
  if (!graph || !inferred) return null;

  const templateGraph = templates[inferred.templateId];
  if (!templateGraph) return null;

  const diagrams = await loadSemanticDiagrams().catch(() => null);
  const templateDiagram = diagrams?.templates?.[inferred.templateId] || null;
  return {
    schema: 'living-doc-semantic-context/v1',
    templateId: inferred.templateId,
    inferredFromDoc: inferred,
    graph: {
      schema: graph.schema,
      generatedFrom: graph.generatedFrom,
      template: templateGraph,
    },
    diagram: templateDiagram ? {
      schema: diagrams.schema,
      generatedFrom: diagrams.generatedFrom,
      template: templateDiagram,
    } : null,
  };
}

export function semanticContextFromRenderedHtml(html) {
  const source = String(html || '');
  const match = source.match(/<script\b(?=[^>]*\bid=["']doc-semantic-context["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i)
    || source.match(/<script\b(?=[^>]*\btype=["']application\/json["'])(?=[^>]*\bid=["']doc-semantic-context["'])[^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  return JSON.parse(unescapeScriptJson(match[1]));
}

export async function semanticContextForPath(filePath) {
  const source = await readFile(filePath, 'utf8');
  if (String(filePath).toLowerCase().endsWith('.html')) {
    return semanticContextFromRenderedHtml(source);
  }
  return semanticContextForDoc(JSON.parse(source));
}

function unescapeScriptJson(value) {
  return String(value || '').replace(/<\\\/script/gi, '</script');
}

function sameStringArray(a, b) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}
