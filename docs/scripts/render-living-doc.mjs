#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync, execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncCompositorEmbeds } from './sync-compositor-embeds.mjs';
import { checkFingerprint } from './meta-fingerprint.mjs';
import { semanticContextForDoc } from './living-doc-semantic-context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(__dirname, 'living-doc-registry.json');
const i18nPath = path.join(__dirname, 'living-doc-i18n.json');
const compositorPath = path.join(__dirname, '..', 'docs', 'living-doc-compositor.html');
const aiRenderGraphRuntimePath = process.env.AI_RENDER_GRAPH_RUNTIME_PATH
  ? path.resolve(process.env.AI_RENDER_GRAPH_RUNTIME_PATH)
  : path.join(__dirname, 'vendor', 'ai-render-graph.file.js');

/* ── Load registry + doc ── */

function printUsageAndExit(code = 1) {
  console.error('Usage: render-living-doc.mjs <doc.json> [--ai-enhanced] [--ai-endpoint URL] [--ai-model NAME] [--ai-timeout-ms N] [--commit] [--message "Commit message"]');
  process.exit(code);
}

const argv = process.argv.slice(2);
let docPath = '';
let shouldCommit = false;
let commitMessageOverride = '';
let aiEnhancedFlag = false;
let aiEndpointOverride = '';
let aiModelOverride = '';
let aiTimeoutMsOverride = '';

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg) continue;
  if (arg === '--help' || arg === '-h') {
    printUsageAndExit(0);
  }
  if (arg === '--commit') {
    shouldCommit = true;
    continue;
  }
  if (arg === '--ai-enhanced') {
    aiEnhancedFlag = true;
    continue;
  }
  if (arg === '--message' || arg === '--commit-message') {
    const next = argv[i + 1];
    if (!next) {
      console.error(`Missing value for ${arg}`);
      printUsageAndExit(1);
    }
    commitMessageOverride = next;
    i += 1;
    continue;
  }
  if (arg === '--ai-endpoint') {
    const next = argv[i + 1];
    if (!next) {
      console.error(`Missing value for ${arg}`);
      printUsageAndExit(1);
    }
    aiEndpointOverride = next;
    i += 1;
    continue;
  }
  if (arg === '--ai-model') {
    const next = argv[i + 1];
    if (!next) {
      console.error(`Missing value for ${arg}`);
      printUsageAndExit(1);
    }
    aiModelOverride = next;
    i += 1;
    continue;
  }
  if (arg === '--ai-timeout-ms') {
    const next = argv[i + 1];
    if (!next) {
      console.error(`Missing value for ${arg}`);
      printUsageAndExit(1);
    }
    aiTimeoutMsOverride = next;
    i += 1;
    continue;
  }
  if (arg.startsWith('--')) {
    console.error(`Unknown option: ${arg}`);
    printUsageAndExit(1);
  }
  if (!docPath) {
    docPath = arg;
    continue;
  }
  console.error(`Unexpected extra argument: ${arg}`);
  printUsageAndExit(1);
}

if (!docPath) {
  printUsageAndExit(1);
}

const resolvedDocPath = path.resolve(docPath);
await syncCompositorEmbeds();
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const i18n = JSON.parse(await readFile(i18nPath, 'utf8'));
const compositorHtml = await readFile(compositorPath, 'utf8');
const data = JSON.parse(await readFile(resolvedDocPath, 'utf8'));
const snapshotGeneratedAt = new Date().toISOString();
const defaultCanonicalOrigin = path.relative(process.cwd(), resolvedDocPath) || resolvedDocPath;
const docAiEnhancement = data.aiEnhancement && typeof data.aiEnhancement === 'object' ? data.aiEnhancement : {};
const aiEnhancement = {
  enabled: aiEnhancedFlag || docAiEnhancement.enabled === true,
  endpoint: String(aiEndpointOverride || docAiEnhancement.endpoint || '').trim(),
  model: String(aiModelOverride || docAiEnhancement.model || '').trim(),
  timeoutMs: (() => {
    const raw = aiTimeoutMsOverride || docAiEnhancement.timeoutMs;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 45000;
  })(),
  autoRun: docAiEnhancement.autoRun !== false,
  useJsonResponseFormat: docAiEnhancement.useJsonResponseFormat === true,
};

// Version from git
let buildVersion = 'dev';
try {
  const hash = execSync('git rev-parse --short HEAD', { cwd: __dirname, encoding: 'utf8' }).trim();
  const date = new Date().toISOString().slice(0, 10);
  buildVersion = `v0.1.0-${hash} (${date})`;
} catch {};
const htmlPath = resolvedDocPath.replace(/\.json$/, '.html');

function runGit(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    ...options,
  }).trim();
}

function resolveRepoRootForPath(filePath) {
  try {
    return runGit(['-C', path.dirname(filePath), 'rev-parse', '--show-toplevel']);
  } catch {
    return '';
  }
}

function toRepoPath(repoRoot, absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

async function commitRenderedDoc({
  repoRoot,
  resolvedDocPath,
  htmlPath,
  title,
  commitMessageOverride,
}) {
  const relDoc = toRepoPath(repoRoot, resolvedDocPath);
  const relHtml = toRepoPath(repoRoot, htmlPath);
  const targetPaths = [relDoc, relHtml];
  const status = runGit(['-C', repoRoot, 'status', '--porcelain', '--', ...targetPaths]);
  if (!status) {
    console.log(`No commit needed for ${relDoc} and ${relHtml}`);
    return null;
  }

  let headRef = '';
  try {
    headRef = runGit(['-C', repoRoot, 'symbolic-ref', '-q', 'HEAD']);
  } catch {
    throw new Error(`Cannot --commit in detached HEAD for repo ${repoRoot}`);
  }

  let parent = '';
  try {
    parent = runGit(['-C', repoRoot, 'rev-parse', '--verify', 'HEAD']);
  } catch {
    parent = '';
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-commit-'));
  const tempIndex = path.join(tempDir, 'index');
  const gitEnv = { ...process.env, GIT_INDEX_FILE: tempIndex };

  try {
    if (parent) {
      runGit(['-C', repoRoot, 'read-tree', 'HEAD'], { env: gitEnv });
    }
    try {
      runGit(['-C', repoRoot, 'add', '--', ...targetPaths], { env: gitEnv });
    } catch (error) {
      const stderr = String(error?.stderr ?? error?.message ?? '').trim();
      throw new Error(`Failed to stage rendered doc paths for commit: ${stderr || targetPaths.join(', ')}`);
    }

    let hasDiff = true;
    if (parent) {
      hasDiff = false;
      try {
        runGit(['-C', repoRoot, 'diff', '--cached', '--quiet', 'HEAD', '--', ...targetPaths], { env: gitEnv });
      } catch (error) {
        if (error?.status === 1) {
          hasDiff = true;
        } else {
          throw error;
        }
      }
    }
    if (!hasDiff) {
      console.log(`No commit needed for ${relDoc} and ${relHtml}`);
      return null;
    }

    const tree = runGit(['-C', repoRoot, 'write-tree'], { env: gitEnv });
    const message = commitMessageOverride || `Update living doc: ${title || path.basename(relDoc, '.json')}`;
    const commitTreeArgs = ['-C', repoRoot, 'commit-tree', tree];
    if (parent) commitTreeArgs.push('-p', parent);
    const commitSha = runGit(commitTreeArgs, {
      env: gitEnv,
      input: `${message}\n`,
    });
    const updateRefArgs = ['-C', repoRoot, 'update-ref', headRef, commitSha];
    if (parent) updateRefArgs.push(parent);
    runGit(updateRefArgs);
    console.log(`Committed ${relDoc} and ${relHtml} in ${path.basename(repoRoot)} as ${commitSha.slice(0, 7)}`);
    return commitSha;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/* ── Helpers ── */

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatExactTimestamp(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return String(value ?? '');
  return date.toISOString().replace('.000Z', 'Z');
}

function timestampHtml(value, options = {}) {
  if (!value) return '';
  const { relativeToSnapshot = true, snapshotAnchor = false } = options;
  const exact = formatExactTimestamp(value);
  const attrs = [
    `datetime="${escapeHtml(exact)}"`,
    `title="${escapeHtml(exact)}"`,
  ];
  if (relativeToSnapshot) attrs.push('data-relative-to-snapshot="true"');
  if (snapshotAnchor) {
    attrs.push('data-snapshot-anchor="generated-at"');
    attrs.push('id="snapshot-generated-at"');
  }
  return `<time ${attrs.join(' ')}>${escapeHtml(exact)}</time>`;
}

function toTitleCase(value) {
  return String(value ?? '')
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function tone(statusSet, value) {
  const set = registry.statusSets[statusSet];
  return set?.tones?.[value] ?? 'neutral';
}

function statusLabel(statusSet, value) {
  const set = registry.statusSets[statusSet];
  return set?.labels?.[value] ?? toTitleCase(value);
}

function badge(label, toneName) {
  return `<span class="badge badge-${toneName}">${escapeHtml(label)}</span>`;
}

function renderInlineText(value) {
  return escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function splitTextLines(value) {
  return String(value ?? '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

function renderLineStack(value, className) {
  const lines = splitTextLines(value);
  if (lines.length === 0) return '';
  return lines.map((line) => `<span class="${className}">${renderInlineText(line)}</span>`).join('');
}

function shouldRenderReferenceChips(lines) {
  return lines.length > 1 && lines.every((line) => line.length <= 40 && !/[:`/.]/.test(line));
}

function isRenderableMermaid(value) {
  return /^\s*flowchart\s+(TD|TB|BT|RL|LR)\b/i.test(String(value ?? ''));
}

function mermaidNodeShape(token) {
  if (/\{\s*"/.test(token)) return 'diamond';
  if (/\(\s*"/.test(token)) return 'round';
  return 'rect';
}

function decodeMermaidLabel(value) {
  return String(value ?? '')
    .replace(/\\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\"/g, '"')
    .trim();
}

function parseMermaidEndpoint(token, nodes) {
  const normalized = String(token ?? '').trim().replace(/;$/, '');
  const match = normalized.match(/^([A-Za-z0-9_:-]+)(?:\s*(\[\s*"([\s\S]*?)"\s*\]|\{\s*"([\s\S]*?)"\s*\}|\(\s*"([\s\S]*?)"\s*\)))?$/);
  if (!match) return normalized;
  const id = match[1];
  const label = decodeMermaidLabel(match[3] ?? match[4] ?? match[5] ?? '');
  const existing = nodes.get(id) || { id, label: id, shape: 'rect' };
  nodes.set(id, {
    ...existing,
    label: label || existing.label || id,
    shape: mermaidNodeShape(normalized),
  });
  return id;
}

function parseMermaidFlowchart(source) {
  const lines = String(source ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] || '';
  const direction = firstLine.match(/^flowchart\s+([A-Z]+)/i)?.[1]?.toUpperCase() || 'TD';
  const nodes = new Map();
  const edges = [];

  for (const line of lines.slice(1)) {
    if (line.startsWith('%%')) continue;
    let match = line.match(/^(.+?)\s*--\s*"([^"]+)"\s*-->\s*(.+)$/);
    if (match) {
      edges.push({
        from: parseMermaidEndpoint(match[1], nodes),
        to: parseMermaidEndpoint(match[3], nodes),
        label: decodeMermaidLabel(match[2]),
      });
      continue;
    }
    match = line.match(/^(.+?)\s*-->\|([^|]+)\|\s*(.+)$/);
    if (match) {
      edges.push({
        from: parseMermaidEndpoint(match[1], nodes),
        to: parseMermaidEndpoint(match[3], nodes),
        label: decodeMermaidLabel(match[2]),
      });
      continue;
    }
    match = line.match(/^(.+?)\s*-->\s*(.+)$/);
    if (match) {
      edges.push({
        from: parseMermaidEndpoint(match[1], nodes),
        to: parseMermaidEndpoint(match[2], nodes),
        label: '',
      });
      continue;
    }
    parseMermaidEndpoint(line, nodes);
  }

  return { direction, nodes: [...nodes.values()], edges };
}

function wrapSvgLines(label, maxChars = 24) {
  const sourceLines = String(label ?? '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const lines = [];
  for (const sourceLine of sourceLines.length ? sourceLines : ['']) {
    const words = sourceLine.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines.slice(0, 4);
}

function renderSvgText(lines, x, y, options = {}) {
  const anchor = options.anchor || 'middle';
  const className = options.className || 'mermaid-node-label';
  const escapedLines = lines.length ? lines : [''];
  const startY = y - ((escapedLines.length - 1) * 8);
  return `<text class="${className}" x="${x}" y="${startY}" text-anchor="${anchor}">${escapedLines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : 16}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
}

function renderMermaidFlowchartSvg(source) {
  const graph = parseMermaidFlowchart(source);
  if (graph.nodes.length === 0) return '';

  const outgoing = new Map();
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  const layersById = new Map();
  const roots = graph.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  const queue = (roots.length ? roots : graph.nodes).map((node) => {
    layersById.set(node.id, 0);
    return node.id;
  });
  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index];
    const nextLayer = (layersById.get(nodeId) ?? 0) + 1;
    for (const targetId of outgoing.get(nodeId) ?? []) {
      if (!layersById.has(targetId)) {
        layersById.set(targetId, nextLayer);
        queue.push(targetId);
      }
    }
  }
  for (const node of graph.nodes) {
    if (!layersById.has(node.id)) layersById.set(node.id, 0);
  }

  const layers = new Map();
  for (const node of graph.nodes) {
    const layer = layersById.get(node.id) ?? 0;
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer).push(node);
  }

  const horizontal = ['LR', 'RL'].includes(graph.direction);
  const nodeWidth = 188;
  const gapX = 68;
  const gapY = 30;
  const margin = 24;
  const coords = new Map();
  const sortedLayers = [...layers.keys()].sort((a, b) => a - b);
  const maxLayerSize = Math.max(...[...layers.values()].map((items) => items.length), 1);

  for (const layer of sortedLayers) {
    const items = layers.get(layer);
    items.sort((a, b) => a.id.localeCompare(b.id));
    items.forEach((node, index) => {
      const labelLines = wrapSvgLines(node.label);
      const height = Math.max(52, 28 + labelLines.length * 16);
      const width = node.shape === 'diamond' ? 156 : nodeWidth;
      const x = horizontal
        ? margin + layer * (nodeWidth + gapX)
        : margin + index * (nodeWidth + gapX);
      const y = horizontal
        ? margin + index * (80 + gapY)
        : margin + layer * (80 + gapY);
      coords.set(node.id, { x, y, width, height, labelLines, shape: node.shape });
    });
  }

  const maxLayer = Math.max(...sortedLayers, 0);
  const svgWidth = horizontal
    ? margin * 2 + (maxLayer + 1) * nodeWidth + maxLayer * gapX
    : margin * 2 + maxLayerSize * nodeWidth + Math.max(0, maxLayerSize - 1) * gapX;
  const svgHeight = horizontal
    ? margin * 2 + maxLayerSize * 80 + Math.max(0, maxLayerSize - 1) * gapY
    : margin * 2 + (maxLayer + 1) * 80 + maxLayer * gapY;

  const edgeHtml = graph.edges.map((edge, index) => {
    const from = coords.get(edge.from);
    const to = coords.get(edge.to);
    if (!from || !to) return '';
    const fromX = horizontal ? from.x + from.width : from.x + from.width / 2;
    const fromY = horizontal ? from.y + from.height / 2 : from.y + from.height;
    const toX = horizontal ? to.x : to.x + to.width / 2;
    const toY = horizontal ? to.y + to.height / 2 : to.y;
    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2;
    const bend = horizontal
      ? `C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
      : `C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
    const label = edge.label
      ? `<text class="mermaid-edge-label" x="${midX}" y="${midY - 6}" text-anchor="middle">${escapeHtml(edge.label)}</text>`
      : '';
    return `<g class="mermaid-edge" data-edge-index="${index}"><path d="M ${fromX} ${fromY} ${bend}" marker-end="url(#arrowhead)"/>${label}</g>`;
  }).join('');

  const nodeHtml = graph.nodes.map((node) => {
    const c = coords.get(node.id);
    if (!c) return '';
    const cx = c.x + c.width / 2;
    const cy = c.y + c.height / 2;
    if (c.shape === 'diamond') {
      const points = `${cx},${c.y} ${c.x + c.width},${cy} ${cx},${c.y + c.height} ${c.x},${cy}`;
      return `<g class="mermaid-node mermaid-node-diamond"><polygon points="${points}"/>${renderSvgText(c.labelLines, cx, cy + 4)}</g>`;
    }
    const radius = c.shape === 'round' ? 18 : 10;
    return `<g class="mermaid-node"><rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="${radius}"/>${renderSvgText(c.labelLines, cx, cy + 4)}</g>`;
  }).join('');

  return `<svg class="mermaid-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" role="img" aria-label="Rendered Mermaid flowchart">
    <defs>
      <marker id="arrowhead" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
        <path d="M 0 0 L 10 4 L 0 8 z" class="mermaid-arrowhead"/>
      </marker>
    </defs>
    ${edgeHtml}
    ${nodeHtml}
  </svg>`;
}

function renderMermaidSource(source) {
  return `<details class="mermaid-source"><summary>Mermaid source</summary><pre><code>${escapeHtml(source)}</code></pre></details>`;
}

function renderMermaidDiagram(note) {
  const normalized = normalizeNote(note);
  if (!normalized) return '';
  if (!isRenderableMermaid(normalized.text)) return renderNotes([normalized]);
  const titleHtml = normalized.title ? `<h4 class="mermaid-title">${escapeHtml(normalized.title)}</h4>` : '';
  const svg = renderMermaidFlowchartSvg(normalized.text);
  return `<article class="mermaid-card">${titleHtml}<div class="mermaid-rendered">${svg || `<pre><code>${escapeHtml(normalized.text)}</code></pre>`}</div>${renderMermaidSource(normalized.text)}</article>`;
}

function renderDiagramDetails(items, label) {
  if (!items || items.length === 0) return '';
  return `
    <details class="details-block mermaid-details" open>
      <summary>${escapeHtml(label)} (${items.length})</summary>
      <div class="mermaid-stack">${items.map(renderMermaidDiagram).join('')}</div>
    </details>`;
}

function normalizeNote(note) {
  if (typeof note === 'string') {
    return { text: note, role: 'description', tone: null, title: '' };
  }
  if (!note || typeof note !== 'object') return null;
  const text = String(note.text ?? note.value ?? '').trim();
  if (!text) return null;
  return {
    text,
    role: note.role ?? (note.tone ? 'callout' : 'description'),
    tone: note.tone ?? null,
    title: String(note.title ?? '').trim(),
  };
}

function normalizeCallout(callout) {
  if (Array.isArray(callout)) {
    return { tone: 'neutral', title: '', items: callout, columnHeaders: [], rows: [] };
  }
  if (!callout || typeof callout !== 'object') return null;
  return {
    tone: callout.tone ?? 'neutral',
    title: String(callout.title ?? '').trim(),
    items: Array.isArray(callout.items) ? callout.items : [],
    columnHeaders: Array.isArray(callout.columnHeaders) ? callout.columnHeaders : [],
    rows: Array.isArray(callout.rows) ? callout.rows : [],
  };
}

function renderRawTable(columnHeaders, rows) {
  if (!columnHeaders?.length || !rows?.length) return '';
  const headerHtml = columnHeaders.map((header) => `<th>${renderInlineText(header)}</th>`).join('');
  const rowHtml = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineText(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="callout-table-wrap"><table class="full-table callout-table"><thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}</tbody></table></div>`;
}

function renderCallout(callout) {
  const normalized = normalizeCallout(callout);
  if (!normalized) return '';
  const { tone: toneName, title, items, columnHeaders, rows } = normalized;
  const itemHtml = items.map((item) => `<p>${renderLineStack(item, 'callout-line')}</p>`).join('');
  const tableHtml = renderRawTable(columnHeaders, rows);
  return `
    <section class="callout callout-${escapeHtml(toneName)}">
      ${title ? `<h3 class="callout-title">${escapeHtml(title)}</h3>` : ''}
      ${itemHtml}
      ${tableHtml}
    </section>`;
}

/* ── AI-enhanced export helpers ── */

function safeJsonForScript(value) {
  return JSON.stringify(value, null, 2).replace(/<\/script/gi, '<\\/script');
}

function safeInlineScriptSource(value) {
  return String(value ?? '').replace(/<\/script/gi, '<\\/script');
}

function normalizeAiNotes(notes) {
  if (!Array.isArray(notes)) return [];
  return notes
    .map((note) => {
      const normalized = normalizeNote(note);
      if (!normalized) return '';
      return normalized.title ? `${normalized.title}: ${normalized.text}` : normalized.text;
    })
    .filter(Boolean);
}

function normalizeAiTickets(tickets) {
  if (!Array.isArray(tickets)) return [];
  return tickets
    .map((ticket) => {
      if (!ticket || typeof ticket !== 'object') return String(ticket ?? '').trim();
      return {
        issueNumber: String(ticket.issueNumber ?? '').trim(),
        issueUrl: String(ticket.issueUrl ?? '').trim(),
        title: String(ticket.title ?? '').trim(),
      };
    })
    .filter((ticket) => (typeof ticket === 'string' ? ticket : (ticket.issueNumber || ticket.issueUrl || ticket.title)));
}

function normalizeInvariantTexts(doc) {
  if (!Array.isArray(doc?.invariants)) return [];
  return doc.invariants
    .map((inv) => {
      if (typeof inv === 'string') return inv.trim();
      if (!inv || typeof inv !== 'object') return '';
      const name = String(inv.name ?? inv.id ?? '').trim();
      const statement = String(inv.statement ?? inv.description ?? '').trim();
      if (name && statement) return `${name}: ${statement}`;
      return statement || name;
    })
    .filter(Boolean);
}

function buildDocRootAiContext(doc) {
  return {
    title: String(doc?.title ?? '').trim(),
    scope: String(doc?.scope ?? '').trim(),
    objective: String(doc?.objective ?? '').trim(),
    successCondition: String(doc?.successCondition ?? '').trim(),
    invariants: normalizeInvariantTexts(doc),
    updated: String(doc?.updated ?? '').trim(),
  };
}

function buildSectionAiContext(section) {
  const callout = normalizeCallout(section?.callout);
  return {
    id: String(section?.id ?? '').trim(),
    title: String(section?.title ?? '').trim(),
    convergenceType: String(section?.convergenceType ?? '').trim(),
    updated: String(section?.updated ?? '').trim(),
    callout: callout ? {
      tone: callout.tone,
      title: callout.title,
      items: callout.items,
    } : null,
  };
}

function buildTypeAiContext(ct) {
  return {
    promptGuidance: ct?.promptGuidance ?? null,
    sources: ct?.sources ?? [],
    statusFields: ct?.statusFields ?? [],
    textFields: ct?.textFields ?? [],
    detailsFields: ct?.detailsFields ?? [],
    aiProfiles: ct?.aiProfiles ?? [],
  };
}

function buildAiObjectSchema(properties, required = Object.keys(properties)) {
  return {
    type: 'object',
    required,
    properties,
  };
}

function buildAiOutputExample(schema) {
  if (!schema || typeof schema !== 'object') return '<value>';
  if (schema.type === 'object') {
    return Object.fromEntries(
      Object.entries(schema.properties || {}).map(([key, value]) => [key, buildAiOutputExample(value)]),
    );
  }
  if (schema.type === 'array') {
    return [buildAiOutputExample(schema.items)];
  }
  if (schema.type === 'string' && Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  if (schema.type === 'string') return '<string>';
  return '<value>';
}

function buildAiPrompt({
  convergenceLabel,
  payload,
  tasks,
  rules,
  outputSchema,
}) {
  return [
    'You are producing a read-only advisory summary for one living-doc section.',
    '',
    `Convergence type: ${convergenceLabel}`,
    `Operating thesis: ${payload.typeContext.promptGuidance?.operatingThesis ?? ''}`,
    `Keep distinct: ${JSON.stringify(payload.typeContext.promptGuidance?.keepDistinct ?? [])}`,
    `Avoid: ${JSON.stringify(payload.typeContext.promptGuidance?.avoid ?? [])}`,
    '',
    'Use the provided task input JSON as the grounded document context.',
    'Do not assume access to any source beyond that input.',
    '',
    'Task:',
    ...tasks.map((task, index) => `${index + 1}. ${task}`),
    '',
    'Return exactly this JSON shape:',
    JSON.stringify(buildAiOutputExample(outputSchema), null, 2),
    '',
    'Rules:',
    ...rules.map((rule) => `- ${rule}`),
    '- Write concise reader-facing copy that can sit inside the living doc without assistant preamble.',
    '- When evidence is missing, say what is missing from the provided section data instead of guessing.',
    '- Return JSON only.',
    '- Include every required key shown in the JSON shape.',
    '- Do not wrap the result under extra keys like result, output, data, or response.',
    '- For list fields, return arrays of plain strings only.',
  ].join('\n');
}

function normalizeDesignCodeSpecFlowItems(items) {
  return items.map((item) => ({
    name: String(item?.name ?? '').trim(),
    feature: String(item?.feature ?? '').trim(),
    kind: String(item?.kind ?? '').trim(),
    status: String(item?.status ?? '').trim(),
    codeStatus: String(item?.codeStatus ?? '').trim(),
    updated: String(item?.updated ?? '').trim(),
    designRefs: Array.isArray(item?.pageIds) ? item.pageIds : [],
    defaultNodeRefs: Array.isArray(item?.defaultNodeIds) ? item.defaultNodeIds : [],
    codeRefs: Array.isArray(item?.codeRefs) ? item.codeRefs : [],
    specRefs: Array.isArray(item?.specRefIds) ? item.specRefIds : [],
    interactionRefs: Array.isArray(item?.interactionSurfaceIds) ? item.interactionSurfaceIds : [],
    tickets: normalizeAiTickets(item?.ticketIds),
    notes: normalizeAiNotes(item?.notes),
  }));
}

function normalizeVerificationSurfaceItems(items) {
  return items.map((item) => ({
    name: String(item?.name ?? '').trim(),
    status: String(item?.status ?? '').trim(),
    priority: String(item?.priority ?? '').trim(),
    updated: String(item?.updated ?? '').trim(),
    currentCoverage: String(item?.currentCoverage ?? '').trim(),
    nextStep: String(item?.nextStep ?? '').trim(),
    gaps: Array.isArray(item?.gaps) ? item.gaps.map((gap) => String(gap ?? '').trim()).filter(Boolean) : [],
    flowRefs: Array.isArray(item?.flowIds) ? item.flowIds : [],
    pageRefs: Array.isArray(item?.pageIds) ? item.pageIds : [],
    interactionRefs: Array.isArray(item?.interactionSurfaceIds) ? item.interactionSurfaceIds : [],
    automationRefs: Array.isArray(item?.automationPaths) ? item.automationPaths : [],
    apiRefs: Array.isArray(item?.apiRefs) ? item.apiRefs : [],
    tickets: normalizeAiTickets(item?.ticketIds),
    notes: normalizeAiNotes(item?.notes),
  }));
}

function normalizeProofLadderItems(items) {
  return items.map((item, index) => ({
    order: index + 1,
    name: String(item?.name ?? '').trim(),
    status: String(item?.status ?? '').trim(),
    updated: String(item?.updated ?? '').trim(),
    tickets: normalizeAiTickets(item?.ticketIds),
    notes: normalizeAiNotes(item?.notes),
  }));
}

const AI_TYPE_SPECS = {
  'design-code-spec-flow': {
    normalizeItems: normalizeDesignCodeSpecFlowItems,
    profiles: {
      'surface-brief': {
        resultAliases: {
          headline: ['title', 'brief', 'overviewTitle', 'surfaceBrief', 'surfaceTitle'],
          summary: ['overview', 'briefSummary', 'surfaceSummary', 'summaryText'],
          currentFocus: ['focus', 'focusPoints', 'priorities', 'items', 'checklist'],
        },
        fields: [
          { field: 'headline', render: 'text', tag: 'h3', className: 'section-ai-title', fallback: 'Surface brief will appear here when local AI runs.' },
          { field: 'summary', render: 'text', tag: 'p', className: 'section-ai-copy', fallback: 'This advisory stays grounded in the current section data and convergence-type semantics.' },
          { field: 'currentFocus', render: 'list', tag: 'ul', className: 'section-ai-list', fallback: ['Current focus items will appear here.'] },
        ],
        outputSchema: buildAiObjectSchema({
          headline: { type: 'string' },
          summary: { type: 'string' },
          currentFocus: { type: 'array', items: { type: 'string' } },
        }),
        buildPrompt(payload, profile) {
          return buildAiPrompt({
            convergenceLabel: 'Design-Code-Spec Flow',
            payload,
            tasks: [
              'Summarize the current surface in plain language.',
              'Identify the single strongest current alignment risk.',
              'List the two or three most important current focus points.',
            ],
            rules: [
              'Ground every claim in the provided section data only.',
              'Do not invent missing design, code, or spec facts.',
              'Do not reduce the section to implementation status only.',
            ],
            outputSchema: profile.outputSchema,
          });
        },
      },
      'alignment-risk-note': {
        resultAliases: {
          surface: ['riskSurface', 'highestRiskSurface', 'surfaceName', 'focus', 'targetSurface'],
          reason: ['why', 'rationale', 'risk', 'riskReason', 'explanation'],
        },
        fields: [
          { field: 'surface', render: 'text', tag: 'h3', className: 'section-ai-title', fallback: 'The highest-risk surface will appear here.' },
          { field: 'reason', render: 'text', tag: 'p', className: 'section-ai-copy', fallback: 'The reason this alignment risk matters will appear here.' },
        ],
        outputSchema: buildAiObjectSchema({
          surface: { type: 'string' },
          reason: { type: 'string' },
        }),
        buildPrompt(payload, profile) {
          return buildAiPrompt({
            convergenceLabel: 'Design-Code-Spec Flow',
            payload,
            tasks: [
              'Identify the single strongest current alignment risk in this section.',
              'Name the surface card where it appears.',
              'Explain why that risk matters to the shipped surface.',
            ],
            rules: [
              'Ground every claim in the provided section data only.',
              'Prefer the most concrete design-code-spec drift rather than generic delivery risk.',
            ],
            outputSchema: profile.outputSchema,
          });
        },
      },
      'review-checklist': {
        resultAliases: {
          items: ['checklist', 'reviewChecklist', 'steps', 'checks', 'focusPoints', 'list'],
        },
        fields: [
          { field: 'items', render: 'list', tag: 'ul', className: 'section-ai-list', fallback: ['A local review checklist will appear here.'] },
        ],
        outputSchema: buildAiObjectSchema({
          items: { type: 'array', items: { type: 'string' } },
        }),
        buildPrompt(payload, profile) {
          return buildAiPrompt({
            convergenceLabel: 'Design-Code-Spec Flow',
            payload,
            tasks: [
              'Generate a short local review checklist for a human walking this surface before share or handoff.',
              'Keep the checklist concrete and tied to the current section data.',
            ],
            rules: [
              'Ground every checklist item in the provided section data only.',
              'Return three to five checklist items.',
            ],
            outputSchema: profile.outputSchema,
          });
        },
      },
    },
  },
  'verification-surface': {
    normalizeItems: normalizeVerificationSurfaceItems,
    profiles: {
      'verification-brief': {
        resultAliases: {
          headline: ['title', 'brief', 'readinessHeadline', 'summaryTitle'],
          readinessSummary: ['summary', 'briefSummary', 'readiness', 'overview'],
        },
        fields: [
          { field: 'headline', render: 'text', tag: 'h3', className: 'section-ai-title', fallback: 'Verification brief will appear here when local AI runs.' },
          { field: 'readinessSummary', render: 'text', tag: 'p', className: 'section-ai-copy', fallback: 'The summary should describe current readiness from explicit evidence only.' },
        ],
        outputSchema: buildAiObjectSchema({
          headline: { type: 'string' },
          readinessSummary: { type: 'string' },
        }),
        buildPrompt(payload, profile) {
          return buildAiPrompt({
            convergenceLabel: 'Verification Surface',
            payload,
            tasks: [
              'Summarize the current readiness posture from actual evidence.',
              'Make the difference between current coverage and missing evidence explicit.',
            ],
            rules: [
              'Ground every statement in the provided section data only.',
              'Do not treat planned work as completed evidence.',
            ],
            outputSchema: profile.outputSchema,
          });
        },
      },
      'weakest-signal-note': {
        resultAliases: {
          probe: ['signal', 'weakestSignal', 'surface', 'targetProbe', 'focus'],
          reason: ['why', 'rationale', 'weaknessReason', 'explanation'],
          missingEvidenceType: ['evidenceType', 'gapType', 'missingType'],
        },
        fields: [
          { field: 'probe', render: 'text', tag: 'h3', className: 'section-ai-title', fallback: 'The weakest current signal will appear here.' },
          { field: 'reason', render: 'text', tag: 'p', className: 'section-ai-copy', fallback: 'The reason this weakens the readiness claim will appear here.' },
          { field: 'missingEvidenceType', render: 'text', tag: 'p', className: 'section-ai-meta', fallback: 'The missing evidence type will appear here.' },
        ],
        outputSchema: buildAiObjectSchema({
          probe: { type: 'string' },
          reason: { type: 'string' },
          missingEvidenceType: {
            type: 'string',
            enum: ['automation', 'api', 'interaction', 'gap'],
          },
        }),
        buildPrompt(payload, profile) {
          return buildAiPrompt({
            convergenceLabel: 'Verification Surface',
            payload,
            tasks: [
              'Identify the single weakest current evidence signal.',
              'Name the probe where the weakness appears.',
              'Classify the missing evidence type as automation, api, interaction, or gap.',
            ],
            rules: [
              'Ground every statement in the provided section data only.',
              'Focus on evidence weakness, not generic implementation incompleteness.',
            ],
            outputSchema: profile.outputSchema,
          });
        },
      },
      'next-verification-loop': {
        resultAliases: {
          focus: ['title', 'loopFocus', 'nextLoop', 'headline'],
          evidenceToCollect: ['evidence', 'nextEvidence', 'requiredEvidence', 'items'],
          gapsToRetireFirst: ['gaps', 'priorityGaps', 'retireFirst', 'firstGaps'],
        },
        fields: [
          { field: 'focus', render: 'text', tag: 'h3', className: 'section-ai-title', fallback: 'The next verification focus will appear here.' },
          { field: 'evidenceToCollect', render: 'list', tag: 'ul', className: 'section-ai-list', fallback: ['Evidence to collect will appear here.'] },
          { field: 'gapsToRetireFirst', render: 'list', tag: 'ul', className: 'section-ai-list', fallback: ['Priority gaps will appear here.'] },
        ],
        outputSchema: buildAiObjectSchema({
          focus: { type: 'string' },
          evidenceToCollect: { type: 'array', items: { type: 'string' } },
          gapsToRetireFirst: { type: 'array', items: { type: 'string' } },
        }),
        buildPrompt(payload, profile) {
          return buildAiPrompt({
            convergenceLabel: 'Verification Surface',
            payload,
            tasks: [
              'Describe the next tight verification loop.',
              'List the evidence to collect next.',
              'List the gaps that should be retired first.',
            ],
            rules: [
              'Ground every statement in the provided section data only.',
              'Keep the next loop action-oriented and evidence-bearing.',
            ],
            outputSchema: profile.outputSchema,
          });
        },
      },
    },
  },
  'proof-ladder': {
    normalizeItems: normalizeProofLadderItems,
    profiles: {
      'proof-state-brief': {
        resultAliases: {
          closedThroughRung: ['proofBoundary', 'currentBoundary', 'boundary', 'closedThrough'],
          summary: ['brief', 'overview', 'proofSummary'],
          notYetProven: ['openBoundary', 'remainingProofGap', 'notProven', 'remainingGap'],
        },
        fields: [
          { field: 'closedThroughRung', render: 'text', tag: 'h3', className: 'section-ai-title', fallback: 'The current proof boundary will appear here.' },
          { field: 'summary', render: 'text', tag: 'p', className: 'section-ai-copy', fallback: 'The current proof summary will appear here.' },
          { field: 'notYetProven', render: 'text', tag: 'p', className: 'section-ai-copy', fallback: 'What is not yet proven will appear here.' },
        ],
        outputSchema: buildAiObjectSchema({
          closedThroughRung: { type: 'string' },
          summary: { type: 'string' },
          notYetProven: { type: 'string' },
        }),
        buildPrompt(payload, profile) {
          return buildAiPrompt({
            convergenceLabel: 'Proof Ladder',
            payload,
            tasks: [
              'State what the ladder currently proves.',
              'Name the current proof boundary.',
              'State clearly what is not yet proven.',
            ],
            rules: [
              'Respect rung ordering.',
              'Do not flatten the ladder into unordered progress.',
              'Distinguish what is already proven from what is only planned.',
            ],
            outputSchema: profile.outputSchema,
          });
        },
      },
      'weakest-open-rung': {
        resultAliases: {
          rung: ['targetRung', 'openRung', 'weakestRung', 'firstOpenRung'],
          missingEvidence: ['requiredEvidence', 'evidenceGap', 'whyOpen', 'missingProof'],
        },
        fields: [
          { field: 'rung', render: 'text', tag: 'h3', className: 'section-ai-title', fallback: 'The first unsatisfied rung will appear here.' },
          { field: 'missingEvidence', render: 'text', tag: 'p', className: 'section-ai-copy', fallback: 'The missing evidence for closure will appear here.' },
        ],
        outputSchema: buildAiObjectSchema({
          rung: { type: 'string' },
          missingEvidence: { type: 'string' },
        }),
        buildPrompt(payload, profile) {
          return buildAiPrompt({
            convergenceLabel: 'Proof Ladder',
            payload,
            tasks: [
              'Identify the first unsatisfied rung in the ladder.',
              'Describe the missing evidence for closure.',
            ],
            rules: [
              'Respect rung ordering.',
              'Do not skip over weaker open rungs.',
            ],
            outputSchema: profile.outputSchema,
          });
        },
      },
      'next-stronger-proof': {
        resultAliases: {
          targetRung: ['rung', 'nextRung', 'proofTarget', 'focus'],
          requiredEvidence: ['evidence', 'items', 'checklist', 'nextEvidence'],
        },
        fields: [
          { field: 'targetRung', render: 'text', tag: 'h3', className: 'section-ai-title', fallback: 'The next stronger proof target will appear here.' },
          { field: 'requiredEvidence', render: 'list', tag: 'ul', className: 'section-ai-list', fallback: ['Required evidence will appear here.'] },
        ],
        outputSchema: buildAiObjectSchema({
          targetRung: { type: 'string' },
          requiredEvidence: { type: 'array', items: { type: 'string' } },
        }),
        buildPrompt(payload, profile) {
          return buildAiPrompt({
            convergenceLabel: 'Proof Ladder',
            payload,
            tasks: [
              'Describe the next evidence shape that would strengthen the ladder.',
              'Name the target rung and the required evidence.',
            ],
            rules: [
              'Respect rung ordering.',
              'Do not redesign the ladder.',
            ],
            outputSchema: profile.outputSchema,
          });
        },
      },
    },
  },
};

function enabledAiProfilesForSection(section, ct) {
  if (!aiEnhancement.enabled) return [];
  const typeSpec = AI_TYPE_SPECS[section?.convergenceType];
  if (!typeSpec) return [];
  const validIds = new Set((ct?.aiProfiles ?? []).map((profile) => profile.id));
  const defaultIds = (ct?.aiProfiles ?? [])
    .filter((profile) => profile.defaultVisible === true)
    .map((profile) => String(profile.id ?? '').trim())
    .filter(Boolean);
  const enabledIds = Array.isArray(section?.ai?.enabledProfiles)
    ? section.ai.enabledProfiles.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  const disabledIds = new Set(Array.isArray(section?.ai?.disabledProfiles)
    ? section.ai.disabledProfiles.map((value) => String(value ?? '').trim()).filter(Boolean)
    : []);
  return [...new Set([...defaultIds, ...enabledIds])]
    .filter((id) => !disabledIds.has(id) && validIds.has(id) && typeSpec.profiles[id]);
}

function buildSectionAiPayload(section, ct, doc, typeSpec) {
  return {
    docRootContext: buildDocRootAiContext(doc),
    sectionContext: buildSectionAiContext(section),
    typeContext: buildTypeAiContext(ct),
    normalizedItems: typeSpec.normalizeItems(deriveSectionItems(section, ct, doc)),
  };
}

function buildSectionAiTaskInput(section, payload) {
  return {
    docRootContext: { const: payload.docRootContext },
    sectionContext: { const: payload.sectionContext },
    typeContext: { const: payload.typeContext },
    normalizedItems: { const: payload.normalizedItems },
    sourceText: { from: `props.sources.${section.id}.text` },
  };
}

const AI_SLOT_COPY = {
  'section-brief': {
    label: 'Section brief',
    description: 'Reader orientation from this section only.',
  },
  'section-weakness-note': {
    label: 'Evidence weakness',
    description: 'A focused risk note from the current evidence.',
  },
  'section-next-loop': {
    label: 'Next evidence loop',
    description: 'Concrete follow-up work grounded in this section.',
  },
};

function aiSlotCopy(slot) {
  return AI_SLOT_COPY[slot] || {
    label: slot || 'Advisory',
    description: 'Document-grounded local advisory.',
  };
}

function renderAiField(taskId, fieldSpec) {
  const attrs = [
    `data-ai-task="${escapeHtml(taskId)}"`,
    `data-ai-field="${escapeHtml(fieldSpec.field)}"`,
    `data-ai-path="${escapeHtml(fieldSpec.field)}"`,
  ];
  if (fieldSpec.render === 'list') attrs.push('data-ai-render="list"');
  const className = fieldSpec.className ? ` class="${escapeHtml(fieldSpec.className)}"` : '';
  if (fieldSpec.render === 'list') {
    const fallbackItems = Array.isArray(fieldSpec.fallback) ? fieldSpec.fallback : [String(fieldSpec.fallback ?? '').trim()].filter(Boolean);
    attrs.push(`data-ai-fallback='${escapeHtml(JSON.stringify(fallbackItems))}'`);
    return `<${fieldSpec.tag || 'ul'}${className} ${attrs.join(' ')}>${fallbackItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${fieldSpec.tag || 'ul'}>`;
  }
  const fallbackText = String(fieldSpec.fallback ?? '').trim();
  attrs.push(`data-ai-fallback="${escapeHtml(fallbackText)}"`);
  return `<${fieldSpec.tag || 'p'}${className} ${attrs.join(' ')}>${escapeHtml(fallbackText)}</${fieldSpec.tag || 'p'}>`;
}

function renderAiTaskCard(task) {
  const slotCopy = aiSlotCopy(task.slot);
  return `
    <article class="section-ai-card" data-ai-task-block="${escapeHtml(task.id)}" data-ai-slot="${escapeHtml(task.slot)}">
      <header class="section-ai-card-header">
        <div>
          <strong>${escapeHtml(task.name)}</strong>
          <span class="section-ai-slot">${escapeHtml(slotCopy.label)}</span>
        </div>
        <div class="section-ai-card-actions">
          <span class="section-ai-status" data-ai-status="${escapeHtml(task.id)}">Ready</span>
          <button class="section-ai-run section-ai-run-card" type="button" data-ai-run-task="${escapeHtml(task.id)}" aria-label="Run ${escapeHtml(task.name)}">Run</button>
        </div>
      </header>
      <p class="section-ai-profile-copy">${escapeHtml(task.description || slotCopy.description)}</p>
      ${task.fields.map((fieldSpec) => renderAiField(task.id, fieldSpec)).join('')}
      <p class="section-ai-message" data-ai-message="${escapeHtml(task.id)}">Ready for a document-grounded section pass.</p>
    </article>`;
}

function renderSectionAi(sectionAi) {
  if (!sectionAi || sectionAi.tasks.length === 0) return '';
  const endpointReady = aiEnhancement.endpoint && aiEnhancement.model;
  const summary = endpointReady
    ? `Configured for ${aiEnhancement.model}. This pass reads the current section only and writes no source data.`
    : 'Local model settings are not configured; default section guidance remains visible.';
  return `
    <section class="section-ai" data-ai-source="${escapeHtml(sectionAi.sectionId)}">
      <div class="section-ai-toolbar">
        <div>
          <h3>Section advisory</h3>
          <p>${escapeHtml(summary)}</p>
        </div>
        <button class="section-ai-run" type="button" data-ai-run="${escapeHtml(sectionAi.sectionId)}"${endpointReady ? '' : ' disabled'}>${endpointReady ? 'Run section pass' : 'Needs model config'}</button>
      </div>
      <div class="section-ai-grid">
        ${sectionAi.tasks.map((task) => renderAiTaskCard(task)).join('')}
      </div>
    </section>`;
}

function buildDocumentAiArtifacts(doc, sections) {
  const sectionsBySectionId = new Map();
  const tasks = [];

  for (const section of sections) {
    const ct = registry.convergenceTypes[section.convergenceType];
    if (!ct) continue;
    const typeSpec = AI_TYPE_SPECS[section.convergenceType];
    if (!typeSpec) continue;
    const enabledProfiles = enabledAiProfilesForSection(section, ct);
    if (enabledProfiles.length === 0) continue;

    const payload = buildSectionAiPayload(section, ct, doc, typeSpec);
    const taskInput = buildSectionAiTaskInput(section, payload);
    const profileMetaById = new Map((ct.aiProfiles ?? []).map((profile) => [profile.id, profile]));
    const sectionTasks = enabledProfiles.map((profileId) => {
      const impl = typeSpec.profiles[profileId];
      const profileMeta = profileMetaById.get(profileId);
      return {
        id: `${section.id}:${profileId}`,
        sectionId: section.id,
        profileId,
        name: profileMeta?.name ?? profileId,
        description: profileMeta?.description ?? '',
        slot: profileMeta?.slot ?? 'section-brief',
        prompt: impl.buildPrompt(payload, impl),
        input: taskInput,
        outputSchema: impl.outputSchema,
        resultAliases: impl.resultAliases ?? {},
        fields: impl.fields,
      };
    });

    sectionsBySectionId.set(section.id, {
      sectionId: section.id,
      tasks: sectionTasks,
    });
    tasks.push(...sectionTasks);
  }

  return {
    enabled: aiEnhancement.enabled,
    sectionsBySectionId,
    tasks,
    serializableSpec: tasks.length > 0 ? {
      tasks: Object.fromEntries(tasks.map((task) => [task.id, {
        type: 'inference',
        prompt: task.prompt,
        input: task.input,
        outputSchema: task.outputSchema,
        cache: false,
      }])),
      layout: {
        type: 'static-html',
      },
    } : null,
    serializableMeta: tasks.length > 0 ? {
      runtime: {
        endpoint: aiEnhancement.endpoint,
        model: aiEnhancement.model,
        timeoutMs: aiEnhancement.timeoutMs,
        autoRun: aiEnhancement.autoRun,
        useJsonResponseFormat: aiEnhancement.useJsonResponseFormat,
      },
      sections: [...sectionsBySectionId.values()].map((section) => ({
        sectionId: section.sectionId,
        taskIds: section.tasks.map((task) => task.id),
      })),
      taskMeta: Object.fromEntries(tasks.map((task) => [task.id, {
        sectionId: task.sectionId,
        profileId: task.profileId,
        name: task.name,
        slot: task.slot,
        resultAliases: task.resultAliases,
      }])),
    } : null,
  };
}

let documentAiArtifacts = {
  enabled: false,
  sectionsBySectionId: new Map(),
  tasks: [],
  serializableSpec: null,
  serializableMeta: null,
};

function slugifyValue(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function readDocField(doc, key, aliases = []) {
  for (const candidate of [key, ...aliases]) {
    const value = doc?.[candidate];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function describeSourceCoverage(syncHints) {
  if (!syncHints || typeof syncHints !== 'object') return '';
  const pairs = Object.entries(syncHints)
    .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()])
    .filter(([key, value]) => key && value);
  if (pairs.length === 0) return '';
  return pairs.map(([key, value]) => `${key}: ${value}`).join(' · ');
}

function renderSnapshotTeam(team) {
  if (!Array.isArray(team) || team.length === 0) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:8px">${team
    .map((member) => `<span style="display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;background:#eef2ff;border:1px solid #c7d2fe;color:#312e81;font-size:12px;font-weight:600">${escapeHtml(String(member?.login ?? '').trim())}</span>`)
    .filter(Boolean)
    .join('')}</div>`;
}

function buildSnapshotMeta(doc) {
  const team = Array.isArray(doc?.repoState?.collaborators)
    ? doc.repoState.collaborators
        .map((entry) => ({
          login: String(entry?.login ?? '').trim(),
        }))
        .filter((entry) => entry.login)
    : [];
  return {
    docId: readDocField(doc, 'docId', ['id']) || `doc:${slugifyValue(path.basename(resolvedDocPath, path.extname(resolvedDocPath))) || 'living-doc'}`,
    title: String(doc?.title ?? '').trim() || 'Untitled Living Doc',
    scope: readDocField(doc, 'scope', ['docScope']),
    owner: readDocField(doc, 'owner', ['owningTeam']),
    generatedAt: snapshotGeneratedAt,
    version: readDocField(doc, 'version', ['revision']),
    owningRepoUrl: readDocField(doc, 'owningRepoUrl', ['repoUrl', 'locationUrl']),
    canonicalOrigin: readDocField(doc, 'canonicalOrigin', ['canonicalUrl']) || defaultCanonicalOrigin,
    derivedFrom: readDocField(doc, 'derivedFrom', ['derivedFromSnapshot', 'derivedFromVersion']),
    sourceCoverage: readDocField(doc, 'sourceCoverage') || describeSourceCoverage(doc?.syncHints),
    team,
  };
}

function normalizeUpdateSource(doc) {
  const raw = doc?.updateSource;
  if (!raw || typeof raw !== 'object') return null;
  const manifestUrl = String(raw.manifestUrl ?? '').trim();
  if (!manifestUrl) return null;
  return { manifestUrl };
}

function renderPeriodStrip(periods) {
  if (!Array.isArray(periods) || periods.length === 0) return '';
  // Current = last non-future period. Future = explicitly flagged or id sorts after last known.
  const lastIdx = periods.length - 1;
  return `
    <div class="period-strip" role="list" aria-label="Monitoring periods">
      ${periods
        .map((p, idx) => {
          const isCurrent = !p.future && idx === lastIdx;
          const isFuture = !!p.future;
          const cls = isCurrent ? 'period-chip current' : isFuture ? 'period-chip future' : 'period-chip';
          return `
            <div class="${cls}" role="listitem">
              <span class="period-label">${escapeHtml(p.id ?? '')}${isCurrent ? ' · current' : ''}</span>
              ${p.window ? `<span class="period-window">${escapeHtml(p.window)}</span>` : ''}
              ${p.summary ? `<span class="period-summary">${escapeHtml(p.summary)}</span>` : ''}
            </div>`;
        })
        .join('')}
    </div>`;
}

function renderPeriodBadge(period) {
  if (!period) return '';
  return `<span class="period-badge" title="Updated in ${escapeHtml(period)}">${escapeHtml(period)}</span>`;
}

function renderSnapshotPanel(meta) {
  const renderValue = (value, options = {}) => {
    if (!value) return '<span class="snapshot-missing">Unknown</span>';
    if (options.html) return value;
    if (options.time) {
      return timestampHtml(value, {
        relativeToSnapshot: options.relativeToSnapshot ?? !options.snapshotAnchor,
        snapshotAnchor: options.snapshotAnchor ?? false,
      });
    }
    if (options.code) return `<code>${escapeHtml(value)}</code>`;
    return escapeHtml(value);
  };
  const item = (label, value, options = {}) => `
    <div class="snapshot-item${options.wide ? ' snapshot-item-wide' : ''}">
      <span class="snapshot-label">${escapeHtml(label)}</span>
      <span class="snapshot-value">${renderValue(value, options)}</span>
    </div>`;

  return `
    <section class="snapshot-panel" aria-label="Snapshot identity and lineage">
      <div class="snapshot-head">
        <div>
          <div class="snapshot-eyebrow">Portable Snapshot</div>
          <h2 class="snapshot-title">Identity and lineage</h2>
        </div>
        <div class="snapshot-actions">
          <span class="snapshot-pill">HTML Snapshot</span>
          <button type="button" class="doc-diff-btn" id="doc-diff-toggle">Show local diff</button>
        </div>
      </div>
      <p class="snapshot-note">This standalone HTML is a shareable snapshot and may drift from its canonical origin.</p>
      <div class="doc-diff-status" id="doc-diff-status" hidden></div>
      <div class="snapshot-grid">
        ${item('Doc ID', meta.docId, { code: true })}
        ${item('Title', meta.title)}
        ${item('Scope', meta.scope)}
        ${item('Owner / Team', meta.owner)}
        ${item('Generated', meta.generatedAt, { time: true, relativeToSnapshot: false, snapshotAnchor: true })}
        ${item('Version / Revision', meta.version, { code: true })}
        ${item('Location URL', meta.owningRepoUrl)}
        ${item('Team', renderSnapshotTeam(meta.team), { wide: true, html: true })}
        ${item('Canonical Origin', meta.canonicalOrigin, { code: true })}
        ${item('Derived From', meta.derivedFrom, { code: true })}
        ${item('Source Coverage', meta.sourceCoverage, { wide: true })}
      </div>
    </section>`;
}

/* ── Entity reference rendering ── */

function entityTypeDef(entityType) {
  return registry.entityTypes?.[entityType] ?? {};
}

function interpolateTemplate(template, context) {
  if (!template) return null;
  let missing = false;
  const rendered = String(template).replace(/\{([^}]+)\}/g, (_, key) => {
    const value = context?.[key];
    if (value === undefined || value === null || value === '') {
      missing = true;
      return '';
    }
    return String(value);
  });
  return missing ? null : rendered;
}

const lookupMaps = {};
function buildLookup(entityType, items) {
  if (!lookupMaps[entityType] && Array.isArray(items)) {
    lookupMaps[entityType] = new Map(items.map((item) => [String(item.id), item]));
  }
  return lookupMaps[entityType] ?? new Map();
}

for (const [entityType, def] of Object.entries(registry.entityTypes ?? {})) {
  if (def.collectionKey && Array.isArray(data[def.collectionKey])) {
    buildLookup(entityType, data[def.collectionKey]);
  }
}

function buildEntityContext(entityType, value) {
  const def = entityTypeDef(entityType);
  const context = typeof value === 'object' && value ? { ...value } : {};
  const rawValue = typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  if (rawValue && def.collectionKey) {
    const resolved = lookupMaps[entityType]?.get(rawValue);
    if (resolved) Object.assign(context, resolved);
  }
  if (def.valueKey && context[def.valueKey] == null && rawValue != null) {
    context[def.valueKey] = rawValue;
  }
  if (context.id == null && def.valueKey && context[def.valueKey] != null) {
    context.id = context[def.valueKey];
  }
  if ((entityType === 'figma-page' || entityType === 'figma-node')) {
    context.figmaCanonicalUrl ??= data.figma?.canonicalUrl ?? '';
    if (context.nodeId != null && context.nodeIdParam == null) {
      context.nodeIdParam = encodeURIComponent(String(context.nodeId).replace(':', '-'));
    }
    if (context.id == null && context.nodeId != null) context.id = context.nodeId;
  }
  return context;
}

function entityDisplayValue(entityType, value, options = {}) {
  const def = entityTypeDef(entityType);
  const context = buildEntityContext(entityType, value);
  const override = typeof options.displayOverride === 'string' ? options.displayOverride.trim() : '';
  if (override) return override;
  if (def.displayKey && context?.[def.displayKey] != null && context[def.displayKey] !== '') return String(context[def.displayKey]);
  if (def.valueKey && context?.[def.valueKey] != null && context[def.valueKey] !== '') return String(context[def.valueKey]);
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object') return String(value.id ?? value.name ?? value.ref ?? JSON.stringify(value));
  return '';
}

function renderEntityRef(entityType, value, options = {}) {
  const def = entityTypeDef(entityType);
  const context = buildEntityContext(entityType, value);
  const display = `${def.displayPrefix ?? ''}${entityDisplayValue(entityType, value, options)}`;
  const fallback = `<code>${escapeHtml(display || String(value ?? ''))}</code>`;

  switch (def.refRender) {
    case 'issue-link': {
      const href = interpolateTemplate(def.hrefTemplate, context);
      const primary = href ? `<a href="${escapeHtml(href)}"><code>${escapeHtml(display)}</code></a>` : fallback;
      const secondaryHref = interpolateTemplate(def.secondaryHref, context);
      const secondary = secondaryHref && def.secondaryLabel
        ? ` <a href="${escapeHtml(secondaryHref)}"><code>${escapeHtml(def.secondaryLabel)}</code></a>`
        : '';
      return `${primary}${secondary}`;
    }
    case 'code-link':
    case 'link':
    case 'anchor-link': {
      const href = interpolateTemplate(def.hrefTemplate, context);
      return href ? `<a href="${escapeHtml(href)}"><code>${escapeHtml(display)}</code></a>` : fallback;
    }
    case 'code-badge':
    default:
      return fallback;
  }
}

function renderRefList(values, entityType, label) {
  if (!values || values.length === 0) return '';
  if (entityType === 'ticket') {
    const refs = values.map((value) => {
      const issueUrl = value?.issueUrl;
      const issueNumber = String(value?.issueNumber ?? value ?? '').trim();
      const labelText = issueNumber.startsWith('#') ? issueNumber : `#${issueNumber}`;
      const inner = `<span class="ticket-badge badge badge-neutral">${escapeHtml(labelText)}</span>`;
      return issueUrl ? `<a href="${escapeHtml(issueUrl)}" class="ticket-link">${inner}</a>` : inner;
    }).join('');
    return `<div class="ticket-row">${label ? `<strong>${escapeHtml(label)}</strong>` : ''}<div class="ticket-badges">${refs}</div></div>`;
  }
  const refs = values.map((v) => renderEntityRef(entityType, v)).join(' ');
  return `<div class="flow-meta"><strong>${escapeHtml(label)}</strong> ${refs}</div>`;
}

function renderPathLinks(paths) {
  if (!paths || paths.length === 0) return '<span>None yet</span>';
  return paths.map((p) => renderEntityRef('code-file', p)).join(' ');
}

function renderNotes(items) {
  if (!items || items.length === 0) return '';
  const normalized = items.map(normalizeNote).filter(Boolean);
  if (normalized.length === 0) return '';
  return `
    <div class="note-stack">
      ${normalized.map((note) => {
        const titleHtml = note.title ? `<strong class="note-title">${escapeHtml(note.title)}</strong>` : '';
        if (note.role === 'reference') {
          const lines = splitTextLines(note.text);
          if (shouldRenderReferenceChips(lines)) {
            const chipHtml = lines.map((line) => `<span class="note-chip">${renderInlineText(line)}</span>`).join('');
            return `<div class="note-reference">${titleHtml}<div class="note-chip-row">${chipHtml}</div></div>`;
          }
          const lineHtml = lines.map((line) => `<span class="note-reference-line">${renderInlineText(line)}</span>`).join('');
          return `<div class="note-reference">${titleHtml}<div class="note-reference-lines">${lineHtml}</div></div>`;
        }
        if (note.role === 'callout' || note.tone) {
          return `<div class="note-callout note-callout-${escapeHtml(note.tone ?? 'neutral')}">${titleHtml}${renderLineStack(note.text, 'note-line')}</div>`;
        }
        return `<p class="note-description">${titleHtml}${renderLineStack(note.text, 'note-line')}</p>`;
      }).join('')}
    </div>`;
}

function renderDetails(items, label, fieldKey = '') {
  if (!items || items.length === 0) return '';
  if (fieldKey === 'diagrams' || items.some((item) => isRenderableMermaid(typeof item === 'string' ? item : item?.text ?? item?.value))) {
    return renderDiagramDetails(items, label);
  }
  return `
    <details class="details-block">
      <summary>${escapeHtml(label)} (${items.length})</summary>
      ${renderNotes(items)}
    </details>`;
}

/* ── Convergence type renderers ── */

function renderCardDomKey(item) {
  return String(item?.id || item?.figmaName || item?.name || '').trim();
}

function renderCardItem(item, convergenceType, sectionId) {
  const ct = registry.convergenceTypes[convergenceType];
  if (!ct) return '';

  // Status badges
  const badges = (ct.statusFields ?? [])
    .filter((sf) => item[sf.key])
    .map((sf) => badge(statusLabel(sf.statusSet, item[sf.key]), tone(sf.statusSet, item[sf.key])))
    .join(' ');

  // Meta row
  const metaParts = [];
  if (item.feature) metaParts.push(escapeHtml(item.feature));
  if (item.kind) metaParts.push(escapeHtml(toTitleCase(item.kind)));
  const updatedHtml = item.updated ? timestampHtml(item.updated) : null;
  const metaRow = metaParts.length > 0 || updatedHtml
    ? `<div class="meta-row">${metaParts.map((p) => `<span>${p}</span>`).join('')}${updatedHtml ? `<span>${updatedHtml}</span>` : ''}</div>`
    : '';

  // Source references
  const sourceHtml = (ct.sources ?? [])
    .filter((src) => src.entityType && item[src.key] && item[src.key].length > 0)
    .map((src) => renderRefList(item[src.key], src.entityType, src.label))
    .join('');

  // Notes (sources with null entityType)
  const notesSrc = (ct.sources ?? []).find((src) => src.key === 'notes' && !src.entityType);
  const notesHtml = notesSrc && item.notes ? renderNotes(item.notes) : '';

  // Text fields
  const textHtml = (ct.textFields ?? [])
    .filter((tf) => item[tf.key])
    .map((tf) => `<p class="code-refs"><strong>${escapeHtml(tf.label)}</strong> ${renderInlineText(item[tf.key])}</p>`)
    .join('');

  // Details fields
  const detailsHtml = (ct.detailsFields ?? [])
    .filter((df) => item[df.key] && item[df.key].length > 0)
    .map((df) => renderDetails(item[df.key], df.label, df.key))
    .join('');

  // Item-level ID for anchoring
  const anchorId = item.id ? ` id="${escapeHtml(item.id)}"` : '';
  const dataAttrs = [
    sectionId ? ` data-section-id="${escapeHtml(sectionId)}"` : '',
    renderCardDomKey(item) ? ` data-card-key="${escapeHtml(renderCardDomKey(item))}"` : '',
  ].join('');

  const periodBadge = item.lastUpdatedInPeriod ? renderPeriodBadge(item.lastUpdatedInPeriod) : '';

  return `
    <article class="flow-card"${anchorId}${dataAttrs}>
      <header class="flow-card-header">
        <div>
          <h3>${escapeHtml(item.name)}${periodBadge}</h3>
          ${metaRow}
        </div>
        <div class="badge-row">${badges}</div>
      </header>
      ${sourceHtml}
      ${notesHtml}
      ${textHtml}
      ${detailsHtml}
    </article>`;
}

function renderEdgeTable(items, convergenceType) {
  const ct = registry.convergenceTypes[convergenceType];
  if (!ct) return '';

  const headers = (ct.columnHeaders ?? [])
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join('');

  const rows = items
    .map((item) => {
      const a = ct.sourceA;
      const b = ct.sourceB;
      const renderEdgeEntity = (sourceDef) => {
        if (!sourceDef) return '<span>None yet</span>';
        const sourceValue = item[sourceDef.key];
        if (!sourceValue) {
          return item.name
            ? `${escapeHtml(item.name)}${item.id ? `<br /><code>${escapeHtml(item.id)}</code>` : ''}`
            : '<span>None yet</span>';
        }
        const displayOverride = sourceDef.displayKey ? item[sourceDef.displayKey] : '';
        const refHtml = renderEntityRef(sourceDef.entityType, sourceValue, { displayOverride });
        const rawValueHtml = displayOverride && String(displayOverride) !== String(sourceValue)
          ? `<br /><code>${escapeHtml(sourceValue)}</code>`
          : '';
        return `${refHtml}${rawValueHtml}`;
      };
      const aHtml = renderEdgeEntity(a);
      const bHtml = renderEdgeEntity(b);
      const statusHtml = ct.edgeStatus
        ? badge(toTitleCase(item[ct.edgeStatus.key]), tone(ct.edgeStatus.statusSet, item[ct.edgeStatus.key]))
        : '';
      const notesHtml = ct.edgeNotes && item[ct.edgeNotes.key] ? renderNotes(item[ct.edgeNotes.key]) : '';
      const cells = [aHtml];
      if (ct.sourceB && (ct.columnHeaders?.length ?? 0) >= 4) cells.push(bHtml);
      if (ct.edgeStatus) cells.push(statusHtml);
      if (ct.edgeNotes) cells.push(notesHtml);
      return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
    })
    .join('');

  return `
    <table class="full-table">
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ── Registry-derived board view ── */

function statusSetTitle(statusSet) {
  return toTitleCase(String(statusSet ?? '').replace(/-status$/, ''));
}

function boardFieldLabel(field) {
  return field?.label ?? toTitleCase(field?.key ?? 'status');
}

function buildSectionBoardEntries(section) {
  const ct = registry.convergenceTypes[section.convergenceType];
  if (!ct) return [];

  if (ct.projection === 'edge-table' && ct.edgeStatus?.key && ct.edgeStatus?.statusSet) {
    return [{
      section,
      ct,
      fieldKey: ct.edgeStatus.key,
      fieldLabel: boardFieldLabel(ct.edgeStatus),
      statusSet: ct.edgeStatus.statusSet,
      source: 'edgeStatus',
    }];
  }

  return (ct.statusFields ?? [])
    .filter((field) => field?.key && field?.statusSet)
    .map((field) => ({
      section,
      ct,
      fieldKey: field.key,
      fieldLabel: boardFieldLabel(field),
      statusSet: field.statusSet,
      source: 'statusField',
    }));
}

function buildBoardDimensions(sectionsToRender) {
  const entries = sectionsToRender.flatMap(buildSectionBoardEntries);
  const byStatusSet = new Map();
  for (const entry of entries) {
    if (!byStatusSet.has(entry.statusSet)) byStatusSet.set(entry.statusSet, []);
    byStatusSet.get(entry.statusSet).push(entry);
  }

  const documentDimensions = [...byStatusSet.entries()]
    .filter(([, groupEntries]) => groupEntries.length > 1)
    .map(([statusSet, groupEntries]) => ({
      id: `doc-${slugifyValue(statusSet) || 'status'}`,
      scope: 'document',
      statusSet,
      label: `${statusSetTitle(statusSet)} board`,
      entries: groupEntries,
    }));

  const sectionDimensions = entries.map((entry) => ({
    id: `section-${slugifyValue(entry.section.id) || 'section'}-${slugifyValue(entry.fieldKey) || 'status'}`,
    scope: 'section',
    statusSet: entry.statusSet,
    label: `${entry.section.title} · ${entry.fieldLabel}`,
    entries: [entry],
  }));

  return [...documentDimensions, ...sectionDimensions];
}

function boardItemTitle(item, entry) {
  if (entry.source === 'edgeStatus') {
    const edgeLabel = (sourceDef) => {
      if (!sourceDef) return '';
      const value = item[sourceDef.key];
      if (!value) return '';
      const displayOverride = sourceDef.displayKey ? item[sourceDef.displayKey] : '';
      return entityDisplayValue(sourceDef.entityType, value, { displayOverride });
    };
    const left = edgeLabel(entry.ct.sourceA);
    const right = edgeLabel(entry.ct.sourceB);
    const edgeTitle = [left, right].filter(Boolean).join(' -> ');
    if (edgeTitle) return edgeTitle;
  }
  return String(item.name ?? item.figmaName ?? item.title ?? item.id ?? 'Untitled item');
}

function boardCardNote(item, entry) {
  const textField = (entry.ct.textFields ?? []).find((field) => item[field.key]);
  if (textField) {
    return `<p class="board-card-note"><strong>${escapeHtml(textField.label)}</strong> ${renderInlineText(item[textField.key])}</p>`;
  }
  if (entry.ct.edgeNotes?.key && item[entry.ct.edgeNotes.key]) {
    return renderNotes(item[entry.ct.edgeNotes.key]);
  }
  return '';
}

function boardCardRefs(item, entry) {
  if (entry.source === 'edgeStatus') return '';
  return (entry.ct.sources ?? [])
    .filter((src) => src.entityType && item[src.key]?.length > 0)
    .slice(0, 2)
    .map((src) => renderRefList(item[src.key], src.entityType, src.label))
    .join('');
}

function buildBoardModel(dimension) {
  const statusSet = registry.statusSets[dimension.statusSet];
  const values = Array.isArray(statusSet?.values) ? statusSet.values : [];
  const lanes = values.map((value) => ({
    value,
    label: statusLabel(dimension.statusSet, value),
    tone: tone(dimension.statusSet, value),
    cards: [],
  }));
  const laneByValue = new Map(lanes.map((lane) => [lane.value, lane]));
  const fallbackLane = {
    value: '__other__',
    label: 'Other / missing',
    tone: 'neutral',
    cards: [],
  };

  for (const entry of dimension.entries) {
    for (const item of entry.section.data ?? []) {
      const rawValue = item?.[entry.fieldKey];
      const value = rawValue == null ? '' : String(rawValue).trim();
      const lane = laneByValue.get(value) ?? fallbackLane;
      const knownValue = lane !== fallbackLane;
      lane.cards.push({
        sectionId: entry.section.id,
        sectionTitle: entry.section.title,
        typeName: entry.ct.name ?? entry.section.convergenceType,
        title: boardItemTitle(item, entry),
        fieldLabel: entry.fieldLabel,
        rawValue: value,
        knownValue,
        noteHtml: boardCardNote(item, entry),
        refsHtml: boardCardRefs(item, entry),
      });
    }
  }

  return {
    dimension,
    lanes: fallbackLane.cards.length > 0 ? [...lanes, fallbackLane] : lanes,
  };
}

function renderBoardCard(card, statusSet) {
  const statusText = card.knownValue && card.rawValue
    ? statusLabel(statusSet, card.rawValue)
    : (card.rawValue ? toTitleCase(card.rawValue) : 'Missing');
  const statusTone = card.knownValue ? tone(statusSet, card.rawValue) : 'neutral';
  return `
    <article class="board-card" data-section-id="${escapeHtml(card.sectionId)}">
      <div class="board-card-kicker">${escapeHtml(card.sectionTitle)} · ${escapeHtml(card.typeName)}</div>
      <h3>${escapeHtml(card.title)}</h3>
      <div class="badge-row">${badge(statusText, statusTone)}</div>
      ${card.noteHtml}
      ${card.refsHtml}
    </article>`;
}

function renderBoardLane(lane, statusSet) {
  return `
    <section class="board-lane">
      <header class="board-lane-header">
        <span>${escapeHtml(lane.label)}</span>
        <span class="board-count">${escapeHtml(String(lane.cards.length))}</span>
      </header>
      <div class="board-lane-cards">
        ${lane.cards.length
          ? lane.cards.map((card) => renderBoardCard(card, statusSet)).join('')
          : '<div class="board-empty">No items</div>'}
      </div>
    </section>`;
}

function renderBoardView(dimensions) {
  if (dimensions.length === 0) return '';
  const panels = dimensions.map((dimension, index) => {
    const model = buildBoardModel(dimension);
    return `
      <div class="board-panel" data-board-panel="${escapeHtml(dimension.id)}"${index === 0 ? '' : ' hidden'}>
        <div class="board-context">
          <span>${escapeHtml(dimension.scope === 'document' ? 'Document view' : 'Section view')}</span>
          <strong>${escapeHtml(statusSetTitle(dimension.statusSet))}</strong>
        </div>
        <div class="board-track">
          <div class="board-grid">
            ${model.lanes.map((lane) => renderBoardLane(lane, dimension.statusSet)).join('')}
          </div>
        </div>
      </div>`;
  }).join('');

  const dimensionControl = dimensions.length > 1
    ? `
      <label class="board-select-wrap">
        <span>Board</span>
        <select class="board-select" data-board-select>
          ${dimensions.map((dimension, index) => `<option value="${escapeHtml(dimension.id)}"${index === 0 ? ' selected' : ''}>${escapeHtml(dimension.label)}</option>`).join('')}
        </select>
      </label>`
    : `<div class="board-static-label">${escapeHtml(dimensions[0].label)}</div>`;

  return `
    <section id="board-view" class="view-panel board-view" data-view-panel="board" hidden>
      <div class="board-toolbar">
        <div>
          <h2>Board</h2>
          <p>Columns are generated from registry status sets; cards are grouped from convergence-type status fields.</p>
        </div>
        ${dimensionControl}
      </div>
      ${panels}
    </section>`;
}

/* ── JSON structure graph view ── */

function graphNodeLabel(value, fallback = 'Untitled') {
  return String(value ?? '').trim() || fallback;
}

function graphStableHash(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function graphNodeId(kind, value) {
  return `graph-${kind}-${slugifyValue(value) || graphStableHash(value || kind)}`;
}

function graphTruncate(value, limit = 42) {
  const text = graphNodeLabel(value, '');
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function graphTextLines(value, maxLineLength = 22, maxLines = 3) {
  const words = graphNodeLabel(value, '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLineLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === 0) lines.push('Untitled');
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = graphTruncate(lines[maxLines - 1], maxLineLength);
  }
  return lines;
}

function graphDetailAttr(details) {
  return escapeHtml(JSON.stringify(details ?? {}));
}

function graphValueList(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function graphSourceLabel(entityType, value) {
  if (entityType) return entityDisplayValue(entityType, value) || graphNodeLabel(value, 'Reference');
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    return String(value.issueNumber ?? value.title ?? value.name ?? value.id ?? value.path ?? value.url ?? 'Reference');
  }
  return 'Reference';
}

function graphSourceKey(entityType, value, sourceKey) {
  if (value && typeof value === 'object') {
    const stable = value.issueUrl ?? value.url ?? value.path ?? value.id ?? value.issueNumber ?? value.name ?? JSON.stringify(value);
    return `${entityType || sourceKey || 'ref'}:${stable}`;
  }
  return `${entityType || sourceKey || 'ref'}:${String(value)}`;
}

function buildLivingDocGraphModel(doc, sectionsToRender) {
  const nodes = [];
  const edges = [];
  const sourceNodeIds = new Map();
  const addNode = (node) => {
    nodes.push({
      size: 12,
      ...node,
    });
    return node.id;
  };
  const addEdge = (from, to, label = '') => {
    if (!from || !to) return;
    edges.push({ from, to, label });
  };

  const sectionItems = new Map();
  let cardCount = 0;
  let sourceRefCount = 0;
  for (const section of sectionsToRender) {
    const ct = registry.convergenceTypes[section.convergenceType];
    const items = ct ? deriveSectionItems(section, ct, doc) : (section.data ?? []);
    sectionItems.set(section.id, items);
    cardCount += items.length;
  }

  const governance = [
    { key: 'objective', label: 'Objective', count: doc.objective ? 1 : 0 },
    { key: 'successCondition', label: 'Success condition', count: doc.successCondition ? 1 : 0 },
    { key: 'objectiveFacets', label: 'Objective facets', count: Array.isArray(doc.objectiveFacets) ? doc.objectiveFacets.length : 0 },
    { key: 'coverage', label: 'Coverage edges', count: Array.isArray(doc.coverage) ? doc.coverage.length : 0 },
    { key: 'invariants', label: 'Invariants', count: Array.isArray(doc.invariants) ? doc.invariants.length : 0 },
  ].filter((entry) => entry.count > 0);

  const centerX = 960;
  const centerY = 960;
  const radialPoint = (angleDeg, radius) => {
    const angle = (angleDeg * Math.PI) / 180;
    return {
      x: centerX + (Math.cos(angle) * radius),
      y: centerY + (Math.sin(angle) * radius),
    };
  };

  const rootId = addNode({
    id: 'graph-doc-root',
    type: 'document',
    label: graphNodeLabel(doc.title, 'Living doc'),
    meta: `${sectionsToRender.length} sections · ${cardCount} cards`,
    path: '$',
    cx: centerX,
    cy: centerY,
    size: 24,
    details: {
      type: 'document',
      path: '$',
      title: graphNodeLabel(doc.title, 'Living doc'),
      sections: sectionsToRender.length,
      cards: cardCount,
      objective: String(doc.objective ?? ''),
      successCondition: String(doc.successCondition ?? ''),
    },
  });

  governance.forEach((entry, index) => {
    const angle = governance.length === 1 ? 180 : 145 + ((70 / Math.max(1, governance.length - 1)) * index);
    const point = radialPoint(angle, 310);
    const id = addNode({
      id: graphNodeId('governance', entry.key),
      type: 'governance',
      label: entry.label,
      meta: `${entry.count} ${entry.count === 1 ? 'entry' : 'entries'}`,
      path: `$.${entry.key}`,
      cx: point.x,
      cy: point.y,
      size: 15,
      details: {
        type: 'governance',
        path: `$.${entry.key}`,
        count: entry.count,
      },
    });
    addEdge(rootId, id, entry.key);
  });

  sectionsToRender.forEach((section, sectionIndex) => {
    const ct = registry.convergenceTypes[section.convergenceType];
    const items = sectionItems.get(section.id) ?? [];
    const sectionId = graphNodeId('section', section.id || sectionIndex);
    const sectionAngle = sectionsToRender.length === 1 ? -90 : -90 + ((360 / sectionsToRender.length) * sectionIndex);
    const sectionPoint = radialPoint(sectionAngle, 430);
    addNode({
      id: sectionId,
      type: 'section',
      label: graphNodeLabel(section.title, section.id || 'Section'),
      meta: `${ct?.name ?? section.convergenceType ?? 'Unknown type'} · ${items.length} cards`,
      path: `$.sections[${sectionIndex}]`,
      cx: sectionPoint.x,
      cy: sectionPoint.y,
      size: 18,
      details: {
        type: 'section',
        path: `$.sections[${sectionIndex}]`,
        id: section.id,
        title: section.title,
        convergenceType: section.convergenceType,
        cards: items.length,
      },
    });
    addEdge(rootId, sectionId, 'section');

    items.forEach((item, itemIndex) => {
      const cardId = graphNodeId('card', `${section.id || sectionIndex}-${item.id ?? itemIndex}`);
      const statusParts = (ct?.statusFields ?? [])
        .map((field) => item?.[field.key] ? `${boardFieldLabel(field)}: ${statusLabel(field.statusSet, item[field.key])}` : '')
        .filter(Boolean);
      const itemSpan = Math.min(150, Math.max(34, items.length * 9));
      const cardAngle = items.length === 1
        ? sectionAngle
        : sectionAngle - (itemSpan / 2) + ((itemSpan / Math.max(1, items.length - 1)) * itemIndex);
      const cardPoint = radialPoint(cardAngle, 650 + ((itemIndex % 3) * 58));
      addNode({
        id: cardId,
        type: 'card',
        label: boardItemTitle(item, { section, ct: ct ?? {}, source: 'statusField' }),
        meta: statusParts[0] ?? graphNodeLabel(item.id, 'Card'),
        path: `$.sections[${sectionIndex}].data[${itemIndex}]`,
        cx: cardPoint.x,
        cy: cardPoint.y,
        size: 12,
        details: {
          type: 'card',
          path: `$.sections[${sectionIndex}].data[${itemIndex}]`,
          id: item?.id,
          title: graphNodeLabel(item?.name ?? item?.title ?? item?.id, 'Card'),
          section: section.title,
          statuses: statusParts,
        },
      });
      addEdge(sectionId, cardId, 'card');

      const sources = (ct?.sources ?? [])
        .filter((source) => source?.key && source?.entityType && item?.[source.key] !== undefined)
        .flatMap((source) => graphValueList(item[source.key]).map((value) => ({ source, value })))
        .filter(({ value }) => typeof value === 'string' || typeof value === 'number' || (value && typeof value === 'object'));

      sources.slice(0, 6).forEach(({ source, value }, refIndex) => {
        const key = graphSourceKey(source.entityType, value, source.key);
        let refId = sourceNodeIds.get(key);
        if (!refId) {
          refId = graphNodeId('source', key);
          sourceNodeIds.set(key, refId);
          sourceRefCount += 1;
          const sourceOffset = sources.length === 1 ? 0 : (refIndex - ((Math.min(6, sources.length) - 1) / 2)) * 7;
          const sourcePoint = radialPoint(cardAngle + sourceOffset, 850 + ((refIndex % 3) * 72));
          addNode({
            id: refId,
            type: 'source',
            label: graphSourceLabel(source.entityType, value),
            meta: source.label ?? entityTypeDef(source.entityType)?.label ?? source.key,
            path: `$.sections[${sectionIndex}].data[${itemIndex}].${source.key}`,
            cx: sourcePoint.x,
            cy: sourcePoint.y,
            size: 10,
            details: {
              type: 'source',
              path: `$.sections[${sectionIndex}].data[${itemIndex}].${source.key}`,
              field: source.key,
              entityType: source.entityType,
              label: graphSourceLabel(source.entityType, value),
            },
          });
        }
        addEdge(cardId, refId, source.key);
      });
    });
  });

  const bounds = nodes.reduce((acc, node) => {
    const size = node.size ?? 12;
    return {
      minX: Math.min(acc.minX, node.cx - size),
      minY: Math.min(acc.minY, node.cy - size),
      maxX: Math.max(acc.maxX, node.cx + size),
      maxY: Math.max(acc.maxY, node.cy + size),
    };
  }, { minX: centerX, minY: centerY, maxX: centerX, maxY: centerY });
  const pad = 130;
  const viewBox = [
    Math.floor(bounds.minX - pad),
    Math.floor(bounds.minY - pad),
    Math.ceil(bounds.maxX - bounds.minX + (pad * 2)),
    Math.ceil(bounds.maxY - bounds.minY + (pad * 2)),
  ];
  const typeCounts = nodes.reduce((acc, node) => {
    acc[node.type] = (acc[node.type] ?? 0) + 1;
    return acc;
  }, {});
  return {
    width: Math.max(1040, viewBox[2]),
    height: Math.max(620, viewBox[3]),
    viewBox: viewBox.join(' '),
    types: [
      { key: 'document', label: 'Document', color: '#2563eb', count: typeCounts.document ?? 0 },
      { key: 'governance', label: 'Governance', color: '#0f766e', count: typeCounts.governance ?? 0 },
      { key: 'section', label: 'Sections', color: '#7c3aed', count: typeCounts.section ?? 0 },
      { key: 'card', label: 'Cards', color: '#64748b', count: typeCounts.card ?? 0 },
      { key: 'source', label: 'Refs', color: '#f59e0b', count: typeCounts.source ?? 0 },
    ].filter((type) => type.count > 0),
    nodes,
    edges,
    stats: {
      sections: sectionsToRender.length,
      cards: cardCount,
      sources: sourceRefCount,
      governance: governance.length,
    },
  };
}

function renderGraphNode(node) {
  const labelLines = graphTextLines(node.label, node.type === 'document' ? 26 : 20, 2);
  const meta = graphTruncate(node.meta, node.type === 'document' ? 34 : 26);
  const lineHeight = 12;
  const labelOffset = (node.size ?? 12) + 16;
  const labelAnchor = node.type === 'source' ? 'start' : 'middle';
  const labelX = node.type === 'source' ? (node.size ?? 12) + 8 : 0;
  return `
    <g class="json-graph-node json-graph-node-${escapeHtml(node.type)}" tabindex="0" role="button"
      data-graph-node="${escapeHtml(node.id)}"
      data-graph-type="${escapeHtml(node.type)}"
      data-graph-x="${escapeHtml(node.cx)}"
      data-graph-y="${escapeHtml(node.cy)}"
      data-graph-home-x="${escapeHtml(node.homeX ?? node.cx)}"
      data-graph-home-y="${escapeHtml(node.homeY ?? node.cy)}"
      data-graph-size="${escapeHtml(node.size ?? 12)}"
      data-graph-label="${escapeHtml(`${node.label ?? ''} ${node.meta ?? ''} ${node.path ?? ''}`.toLowerCase())}"
      data-graph-details="${graphDetailAttr(node.details)}"
      transform="translate(${escapeHtml(node.cx)}, ${escapeHtml(node.cy)})">
      <title>${escapeHtml(node.label)}${node.path ? ` · ${escapeHtml(node.path)}` : ''}</title>
      <circle class="json-graph-node-hit" r="${escapeHtml((node.size ?? 12) + 18)}"></circle>
      <circle class="json-graph-node-dot" r="${escapeHtml(node.size ?? 12)}"></circle>
      <text class="json-graph-node-label" x="${escapeHtml(labelX)}" y="${escapeHtml(labelOffset)}" text-anchor="${escapeHtml(labelAnchor)}">
        ${labelLines.map((line, index) => `<tspan x="${escapeHtml(labelX)}" dy="${index === 0 ? 0 : lineHeight}">${escapeHtml(line)}</tspan>`).join('')}
      </text>
      ${meta ? `<text class="json-graph-node-meta" x="${escapeHtml(labelX)}" y="${escapeHtml(labelOffset + 18 + ((labelLines.length - 1) * lineHeight))}" text-anchor="${escapeHtml(labelAnchor)}">${escapeHtml(meta)}</text>` : ''}
    </g>`;
}

function renderGraphEdge(edge, nodeById) {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  if (!from || !to) return '';
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const fromPad = (from.size ?? 12) + 4;
  const toPad = (to.size ?? 12) + 7;
  const x1 = from.cx + ((dx / distance) * fromPad);
  const y1 = from.cy + ((dy / distance) * fromPad);
  const x2 = to.cx - ((dx / distance) * toPad);
  const y2 = to.cy - ((dy / distance) * toPad);
  const labelX = x1 + ((x2 - x1) * 0.52);
  const labelY = y1 + ((y2 - y1) * 0.52);
  const showLabel = edge.label && edge.label !== 'card' && edge.label !== 'section';
  return `<g class="json-graph-edge-group" data-graph-edge-from="${escapeHtml(edge.from)}" data-graph-edge-to="${escapeHtml(edge.to)}" data-graph-edge-label="${escapeHtml(edge.label || 'contains')}">
    <path class="json-graph-edge" marker-end="url(#json-graph-arrow)" d="M ${escapeHtml(x1)} ${escapeHtml(y1)} L ${escapeHtml(x2)} ${escapeHtml(y2)}"><title>${escapeHtml(edge.label || 'contains')}</title></path>
    ${showLabel ? `<text class="json-graph-edge-label" x="${escapeHtml(labelX)}" y="${escapeHtml(labelY)}">${escapeHtml(graphTruncate(edge.label, 18))}</text>` : ''}
  </g>`;
}

function renderGraphView(graph) {
  if (!graph?.nodes?.length) return '';
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  return `
    <section id="graph-view" class="view-panel json-graph-view" data-view-panel="graph" hidden>
      <h2 class="json-graph-title">JSON Structure Graph</h2>
      <div class="graph-toolbar json-graph-toolbar">
        <div class="toolbar-section toolbar-type-toggles" aria-label="Graph node type filters">
          ${graph.types.map((type) => `<button class="type-toggle active" type="button" data-graph-type-toggle="${escapeHtml(type.key)}" style="--toggle-color: ${escapeHtml(type.color)}; border-color: ${escapeHtml(type.color)}; background: ${escapeHtml(type.color)};">
            <span class="shape-icon" aria-hidden="true"></span>${escapeHtml(type.label)} (${escapeHtml(String(type.count))})
          </button>`).join('')}
        </div>
        <div class="toolbar-section toolbar-controls">
          <span class="live-badge"><span class="pulse-dot"></span>Standalone</span>
          <input class="toolbar-search" type="search" data-graph-search placeholder="Search nodes...">
        </div>
      </div>
      <div class="json-graph-shell">
        <div class="json-graph-canvas graph-container" tabindex="0" aria-label="Living doc JSON structure graph">
          <svg class="json-graph-svg graph-canvas" viewBox="${escapeHtml(graph.viewBox)}" data-graph-svg data-graph-initial-view-box="${escapeHtml(graph.viewBox)}" role="img" aria-labelledby="json-graph-title">
            <title id="json-graph-title">Living doc JSON structure graph</title>
            <defs>
              <marker id="json-graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z"></path>
              </marker>
            </defs>
            <g class="json-graph-edges">
              ${graph.edges.map((edge) => renderGraphEdge(edge, nodeById)).join('')}
            </g>
            <g class="json-graph-nodes">
              ${graph.nodes.map(renderGraphNode).join('')}
            </g>
          </svg>
          <div class="graph-zoom-controls" aria-label="Graph zoom controls">
            <button class="graph-zoom-btn" type="button" data-graph-zoom="in" onclick="window.__livingDocGraphControl?.('in', event)" title="Zoom in">+</button>
            <button class="graph-zoom-btn" type="button" data-graph-zoom="out" onclick="window.__livingDocGraphControl?.('out', event)" title="Zoom out">&minus;</button>
            <button class="graph-zoom-btn graph-zoom-fit" type="button" data-graph-zoom="fit" onclick="window.__livingDocGraphControl?.('fit', event)" title="Fit to graph">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="graph-zoom-btn graph-zoom-fullscreen" type="button" data-graph-fullscreen onclick="window.__livingDocGraphControl?.('fullscreen', event)" title="Fullscreen graph">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          <div class="graph-info" data-graph-info>${escapeHtml(String(graph.nodes.length))} nodes · ${escapeHtml(String(graph.edges.length))} edges · 100%</div>
        </div>
        <aside class="json-graph-inspector" aria-live="polite">
          <span class="json-graph-inspector-kicker">Selected node</span>
          <h3 data-graph-detail-title>${escapeHtml(graph.nodes[0].label)}</h3>
          <dl data-graph-detail-list>
            <div><dt>Type</dt><dd>${escapeHtml(graph.nodes[0].details?.type ?? graph.nodes[0].type)}</dd></div>
            <div><dt>Path</dt><dd><code>${escapeHtml(graph.nodes[0].path ?? '$')}</code></dd></div>
          </dl>
        </aside>
      </div>
    </section>`;
}

function deriveCoherenceMapItems(doc) {
  const facets = Array.isArray(doc.objectiveFacets) ? doc.objectiveFacets : [];
  const coverage = Array.isArray(doc.coverage) ? doc.coverage : [];
  const invariants = Array.isArray(doc.invariants) ? doc.invariants : [];
  const sectionIds = new Set((doc.sections ?? []).map((s) => s.id));

  return facets.map((facet) => {
    const edges = coverage.filter((c) => c.facetId === facet.id);
    const carryingSectionIds = [...new Set(edges.map((e) => e.sectionId))];
    const anyDrift = edges.some((e) => !sectionIds.has(e.sectionId));
    const governingInvariants = invariants
      .filter((inv) => {
        const applies = Array.isArray(inv.appliesTo) ? inv.appliesTo : [];
        return applies.includes('*') || applies.some((s) => carryingSectionIds.includes(s));
      })
      .map((inv) => inv.id);

    let status;
    if (anyDrift) status = 'drift';
    else if (edges.length === 0) status = 'orphaned';
    else status = 'covered';

    return {
      id: facet.id,
      name: facet.name,
      facetDescription: facet.description ?? '',
      status,
      sectionIds: carryingSectionIds,
      invariantIds: governingInvariants,
      notes: [],
    };
  });
}

function deriveSectionItems(section, ct, doc) {
  const authored = Array.isArray(section.data) ? section.data : [];
  if (!ct.derived) return authored;
  if (authored.length > 0) return authored;
  if (section.convergenceType === 'coherence-map') return deriveCoherenceMapItems(doc);
  return authored;
}

function renderMetaFreshnessBanner(section, ct, doc) {
  if (!ct.derived) return '';
  const derivedFrom = Array.isArray(ct.derivedFrom) ? ct.derivedFrom : [];
  const reliesOnCoverage = derivedFrom.includes('objectiveFacets') || derivedFrom.includes('coverage');
  if (!reliesOnCoverage) return '';
  const hasMeta = Array.isArray(doc.objectiveFacets) && doc.objectiveFacets.length > 0;
  if (!hasMeta) return '';

  const freshness = checkFingerprint(doc.metaFingerprint, doc.sections);
  if (freshness.fresh) return '';

  const reasonText = freshness.reason === 'missing'
    ? 'No fingerprint stamped yet. Run /crystallize to seed the governance layer.'
    : 'Sections have changed since the meta was derived. Coverage edges may point at the wrong cards. Run /crystallize --refresh to update.';

  return `
    <div class="callout callout-warning" role="alert" data-meta-stale="true">
      <p class="callout-title">Meta layer may be stale</p>
      <p>${escapeHtml(reasonText)}</p>
      ${freshness.stored ? `<p style="font-size:12px;color:var(--muted);margin-top:8px"><strong>Stored:</strong> <code>${escapeHtml(freshness.stored)}</code><br/><strong>Current:</strong> <code>${escapeHtml(freshness.current)}</code></p>` : ''}
    </div>`;
}

function renderSection(section) {
  const ct = registry.convergenceTypes[section.convergenceType];
  if (!ct) return `<!-- unknown convergence type: ${escapeHtml(section.convergenceType)} -->`;
  const projection = ct.projection;
  const iconColorStyle = ct.iconColor ? ` style="color:${escapeHtml(ct.iconColor)}"` : '';

  const icon = ct.icon
    ? `<svg class="section-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"${iconColorStyle}>${ct.icon}</svg>`
    : '';

  const items = deriveSectionItems(section, ct, data);
  const freshnessBannerHtml = renderMetaFreshnessBanner(section, ct, data);

  // Callout
  const calloutHtml = section.callout ? renderCallout(section.callout) : '';
  const sectionAiHtml = renderSectionAi(documentAiArtifacts.sectionsBySectionId.get(section.id));

  // Stat cards
  const statsHtml = section.stats
    ? `<div class="summary-grid">${section.stats.map((s) => `
        <article class="stat-card">
          <h3>${escapeHtml(s.label)}</h3>
          <div class="value">${escapeHtml(String(s.value))}</div>
        </article>`).join('')}</div>`
    : '';

  // Pills
  const pillsHtml = section.pills
    ? `<div class="pill-row">${section.pills.map((p) => `<span class="pill">${escapeHtml(p)}</span>`).join('')}</div>`
    : '';

  // Main content
  let contentHtml = '';
  if (projection === 'card-grid') {
    const cols = Math.max(1, Number(ct.columns ?? 2));
    contentHtml = `<div class="card-grid" style="--grid-cols:${escapeHtml(String(cols))}">${items.map((item) => renderCardItem(item, section.convergenceType, section.id)).join('')}</div>`;
  } else if (projection === 'edge-table') {
    contentHtml = renderEdgeTable(items, section.convergenceType);
  }

  const sectionUpdated = section.updated
    ? `<span style="font-size:12px;font-weight:500;color:var(--muted);margin-left:auto">${timestampHtml(section.updated)}</span>`
    : '';

  const kindBadge = ct.kind
    ? `<span class="kind-badge kind-${escapeHtml(ct.kind)}" title="${ct.kind === 'act' ? 'Act type — a kind of thinking-action recorded here' : 'Surface type — a projection of state from elsewhere'}">${escapeHtml(ct.kind)}</span>`
    : '';

  return `
    <section class="section${projection === 'edge-table' ? ' table-card' : ''}" id="${escapeHtml(section.id)}" data-section-id="${escapeHtml(section.id)}">
      <h2>${icon} ${escapeHtml(section.title)} ${kindBadge}${sectionUpdated}</h2>
      ${freshnessBannerHtml}
      ${calloutHtml}
      ${sectionAiHtml}
      <div data-ai-source="${escapeHtml(section.id)}">
        ${statsHtml}
        ${pillsHtml}
        ${contentHtml}
      </div>
    </section>`;
}

/* ── Sidebar ── */

function buildSidebar(sections) {
  const counts = new Map();
  const seen = new Map();
  for (const section of sections) {
    counts.set(section.convergenceType, (counts.get(section.convergenceType) ?? 0) + 1);
  }
  return sections.map((section) => {
    const ct = registry.convergenceTypes[section.convergenceType];
    const icon = ct?.icon ?? '';
    const iconStyle = ct?.iconColor ? ` style="--icon-color:${escapeHtml(ct.iconColor)}"` : '';
    const nextIndex = (seen.get(section.convergenceType) ?? 0) + 1;
    seen.set(section.convergenceType, nextIndex);
    const showIndex = (counts.get(section.convergenceType) ?? 0) > 1;
    return `
      <a href="#${escapeHtml(section.id)}" class="nav-icon" data-target="${escapeHtml(section.id)}" aria-label="${escapeHtml(section.title)}"${iconStyle}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">${icon}</svg>
        ${showIndex ? `<span class="nav-index">${escapeHtml(String(nextIndex))}</span>` : ''}
        <span class="nav-tooltip">${escapeHtml(section.title)}</span>
      </a>`;
  }).join('');
}

/* ── Assemble HTML ── */

const sections = data.sections ?? [];
documentAiArtifacts = buildDocumentAiArtifacts(data, sections);
const boardDimensions = buildBoardDimensions(sections);
const boardViewHtml = renderBoardView(boardDimensions);
const graphModel = buildLivingDocGraphModel(data, sections);
const graphViewHtml = renderGraphView(graphModel);
const viewSwitchHtml = boardDimensions.length > 0 || graphViewHtml
  ? `
          <div class="view-switch" role="tablist" aria-label="Living doc views">
            <button class="view-switch-btn active" type="button" data-view-target="document" aria-selected="true">Document</button>
            ${boardDimensions.length > 0 ? '<button class="view-switch-btn" type="button" data-view-target="board" aria-selected="false">Board</button>' : ''}
            ${graphViewHtml ? '<button class="view-switch-btn" type="button" data-view-target="graph" aria-selected="false">Graph</button>' : ''}
          </div>`
  : '';
const snapshotMeta = buildSnapshotMeta(data);
const updateSource = normalizeUpdateSource(data);
const metaJson = JSON.stringify(data, null, 2).replace(/<\/script/gi, '<\\/script');
const registryJson = JSON.stringify(registry, null, 2).replace(/<\/script/gi, '<\\/script');
const i18nJson = JSON.stringify(i18n, null, 2).replace(/<\/script/gi, '<\\/script');
const semanticContext = await semanticContextForDoc(data);
const semanticContextJson = semanticContext ? safeJsonForScript(semanticContext) : '';
const aiSpecJson = documentAiArtifacts.serializableSpec ? safeJsonForScript(documentAiArtifacts.serializableSpec) : '';
const aiMetaJson = documentAiArtifacts.serializableMeta ? safeJsonForScript(documentAiArtifacts.serializableMeta) : '';
const aiRenderGraphRuntimeSource = documentAiArtifacts.serializableSpec
  ? safeInlineScriptSource(await readAiRenderGraphRuntime())
  : '';

async function readAiRenderGraphRuntime() {
  try {
    return await readFile(aiRenderGraphRuntimePath, 'utf8');
  } catch (error) {
    const hint = process.env.AI_RENDER_GRAPH_RUNTIME_PATH
      ? `AI_RENDER_GRAPH_RUNTIME_PATH is set to ${aiRenderGraphRuntimePath}, but that file could not be read.`
      : `Expected the vendored browser runtime at ${aiRenderGraphRuntimePath}.`;
    throw new Error(`${hint} Rebuild or restore scripts/vendor/ai-render-graph.file.js before rendering AI-enhanced exports.`, {
      cause: error,
    });
  }
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(data.title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7fa; --card: #ffffff; --ink: #1a2332; --muted: #64748b;
        --line: #e2e8f0;
        --positive-bg: #ecfdf5; --positive-ink: #166534;
        --warning-bg: #fffbeb; --warning-ink: #92400e;
        --negative-bg: #fef2f2; --negative-ink: #991b1b;
        --neutral-bg: #f1f5f9; --neutral-ink: #475569;
        --accent: #2563eb; --sidebar: 56px; --max: 1120px; --radius: 12px;
        --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; scroll-padding-top: 24px; }
      body {
        margin: 0; padding: 0; background: var(--bg); color: var(--ink);
        font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      a { color: var(--accent); text-decoration: none; }
      a:hover { text-decoration: underline; }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.88em; background: var(--neutral-bg);
        border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px;
      }
      .sidebar {
        position: fixed; top: 0; left: 0; width: var(--sidebar); height: 100vh;
        background: var(--card); border-right: 1px solid var(--line);
        display: flex; flex-direction: column; align-items: center;
        padding: 16px 0; gap: 2px; z-index: 100;
        overflow-y: auto; overflow-x: hidden;
      }
      .sidebar .brand {
        width: 32px; height: 32px; border-radius: 8px;
        background: var(--accent); color: #fff;
        display: flex; align-items: center; justify-content: center;
        font-weight: 800; font-size: 14px; margin-bottom: 12px; flex-shrink: 0;
      }
      .nav-icon {
        position: relative; width: 40px; height: 40px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        color: var(--icon-color, var(--muted)); transition: background 0.15s, color 0.15s;
        text-decoration: none; flex-shrink: 0;
      }
      .nav-index {
        position: absolute; right: 2px; bottom: 2px;
        min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px;
        background: var(--card); border: 1px solid color-mix(in srgb, var(--icon-color, var(--line)) 18%, var(--line)); color: var(--icon-color, var(--muted));
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 10px; font-weight: 700; line-height: 1;
      }
      .nav-icon:hover { background: color-mix(in srgb, var(--icon-color, var(--neutral-bg)) 10%, transparent); color: var(--icon-color, var(--ink)); text-decoration: none; }
      .nav-icon.active { background: color-mix(in srgb, var(--icon-color, var(--accent)) 15%, transparent); color: var(--icon-color, var(--accent)); }
      .nav-tooltip {
        position: absolute; left: calc(100% + 10px); top: 50%; transform: translateY(-50%);
        background: var(--ink); color: #fff; font-size: 12px; font-weight: 600;
        padding: 5px 10px; border-radius: 6px; white-space: nowrap;
        pointer-events: none; opacity: 0; transition: opacity 0.15s;
      }
      .nav-icon:hover .nav-tooltip { opacity: 1; }
      .content { margin-left: var(--sidebar); }
      .wrap { max-width: var(--max); margin: 0 auto; padding: 36px 32px 64px; }
      header.page-header { padding: 0 0 28px; }
      h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.25; letter-spacing: -0.025em; font-weight: 700; }
      .subtitle { margin: 0 0 20px; color: var(--muted); max-width: 880px; font-size: 15px; line-height: 1.6; }
      .snapshot-panel {
        margin: 0 0 22px; padding: 20px 22px; border: 1px solid var(--line);
        border-radius: 14px; background: linear-gradient(135deg, rgba(37,99,235,.06), rgba(255,255,255,.95));
        box-shadow: var(--shadow-sm);
      }
      .snapshot-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
      .snapshot-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
      .snapshot-eyebrow {
        display: inline-flex; padding: 4px 10px; border-radius: 999px;
        background: rgba(37,99,235,.12); color: var(--accent); font-size: 11px;
        font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
      }
      .snapshot-title { margin: 10px 0 0; font-size: 18px; line-height: 1.2; letter-spacing: -0.02em; }
      .snapshot-pill {
        display: inline-flex; align-items: center; padding: 6px 10px; border-radius: 999px;
        background: var(--card); border: 1px solid var(--line); color: var(--muted);
        font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap;
      }
      .snapshot-note { margin: 12px 0 0; color: var(--muted); font-size: 13.5px; line-height: 1.55; max-width: 70ch; }
      .doc-diff-btn {
        appearance: none; border: 1px solid var(--line); border-radius: 999px;
        background: var(--card); color: var(--ink); font: inherit; font-size: 12px;
        font-weight: 700; padding: 7px 12px; cursor: pointer;
      }
      .doc-diff-btn:hover { border-color: var(--accent); color: var(--accent); }
      .doc-diff-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
      .doc-diff-status {
        margin-top: 14px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line);
        background: rgba(255,255,255,.82); color: var(--muted); font-size: 12.5px; line-height: 1.5;
      }
      .doc-diff-status strong { color: var(--ink); }
      .doc-diff-status code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
      .doc-diff-status-error { color: var(--negative-ink); border-color: color-mix(in srgb, var(--negative-ink) 24%, var(--line)); background: color-mix(in srgb, var(--negative-bg) 78%, var(--card)); }
      .snapshot-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; margin-top: 18px; }
      .snapshot-item {
        padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line);
        background: rgba(255,255,255,.82); min-width: 0;
      }
      .snapshot-item-wide { grid-column: 1 / -1; }
      .snapshot-label {
        display: block; margin-bottom: 6px; color: var(--muted);
        font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
      }
      .snapshot-value {
        display: block; color: var(--ink); font-size: 13.5px; line-height: 1.6;
        overflow-wrap: anywhere;
      }
      .snapshot-value time { font-variant-numeric: tabular-nums; }
      .snapshot-missing { color: var(--muted); font-style: italic; }
      .pill-row, .badge-row, .meta-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .meta-row { color: var(--muted); font-size: 13px; gap: 12px; }
      .pill {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 5px 12px; border-radius: 999px;
        background: var(--card); border: 1px solid var(--line);
        box-shadow: var(--shadow-sm); color: var(--muted); font-size: 12.5px; font-weight: 500;
      }
      .kind-badge {
        display: inline-flex; align-items: center;
        margin-left: 10px; padding: 2px 9px; border-radius: 999px;
        font-size: 10.5px; font-weight: 700;
        letter-spacing: 0.08em; text-transform: uppercase;
        font-family: var(--font-mono, ui-monospace, monospace);
        vertical-align: middle;
      }
      .kind-badge.kind-act {
        color: #92400e; background: #fef3c7; border: 1px solid #fde68a;
      }
      .kind-badge.kind-surface {
        color: #1e40af; background: #dbeafe; border: 1px solid #bfdbfe;
      }
      .view-switch {
        display: inline-flex; gap: 4px; margin-top: 18px; padding: 4px;
        border: 1px solid var(--line); border-radius: 10px; background: var(--card);
        box-shadow: var(--shadow-sm);
      }
      .view-switch-btn {
        appearance: none; border: none; border-radius: 7px; padding: 7px 13px;
        background: transparent; color: var(--muted); font: inherit; font-size: 12.5px;
        font-weight: 700; cursor: pointer;
      }
      .view-switch-btn.active { background: var(--accent); color: #fff; }
      .view-panel[hidden], .board-panel[hidden] { display: none !important; }
      .board-view { margin-top: 28px; }
      .board-toolbar {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 18px;
        margin-bottom: 16px; padding: 18px 20px; border: 1px solid var(--line);
        border-radius: var(--radius); background: var(--card); box-shadow: var(--shadow-sm);
      }
      .board-toolbar h2 { margin: 0; font-size: 19px; line-height: 1.25; }
      .board-toolbar p { margin: 6px 0 0; color: var(--muted); font-size: 13.5px; line-height: 1.55; max-width: 62ch; }
      .board-select-wrap { display: flex; flex-direction: column; gap: 5px; min-width: min(320px, 100%); }
      .board-select-wrap span {
        color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
      }
      .board-select, .board-static-label {
        border: 1px solid var(--line); border-radius: 8px; background: var(--bg);
        color: var(--ink); font: inherit; font-size: 13px; padding: 8px 10px;
      }
      .board-context {
        display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px;
        margin: 0 0 10px; color: var(--muted); font-size: 12.5px;
      }
      .board-context strong { color: var(--ink); }
      .board-track {
        overflow-x: auto; overflow-y: hidden; padding-bottom: 4px;
        overscroll-behavior-x: contain;
      }
      .board-grid {
        display: grid; grid-auto-flow: column; grid-auto-columns: minmax(240px, 280px);
        gap: 12px; align-items: start; justify-content: start;
        width: max-content; min-width: 100%;
      }
      .board-lane {
        min-width: 0; border: 1px solid var(--line); border-radius: var(--radius);
        background: color-mix(in srgb, var(--neutral-bg) 55%, var(--card));
        padding: 10px; box-shadow: var(--shadow-sm);
      }
      .board-lane-header {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        min-height: 28px; color: var(--ink); font-size: 12.5px; font-weight: 800;
      }
      .board-count {
        min-width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
        border-radius: 999px; background: var(--card); border: 1px solid var(--line);
        color: var(--muted); font-size: 11px; font-weight: 800;
      }
      .board-lane-cards { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
      .board-card {
        border: 1px solid var(--line); border-radius: 10px; background: var(--card);
        padding: 12px; box-shadow: var(--shadow-sm);
      }
      .board-card-kicker {
        margin-bottom: 5px; color: var(--muted); font-size: 11px; font-weight: 700;
        line-height: 1.35; text-transform: uppercase; letter-spacing: 0.04em;
      }
      .board-card h3 { margin-bottom: 8px; line-height: 1.35; overflow-wrap: anywhere; }
      .board-card-note {
        margin: 9px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.55;
      }
      .board-card .flow-meta, .board-card .ticket-row { margin-top: 9px; }
      .board-empty {
        min-height: 64px; display: flex; align-items: center; justify-content: center;
        border: 1px dashed var(--line); border-radius: 8px; color: var(--muted);
        font-size: 12.5px; background: color-mix(in srgb, var(--card) 70%, transparent);
      }
      .json-graph-view {
        position: relative; left: 50%; width: calc(100vw - var(--sidebar) - 24px);
        max-width: none; margin-top: 28px; transform: translateX(-50%);
      }
      .json-graph-title { margin: 0 0 10px; font-size: 16px; line-height: 1.25; }
      .graph-toolbar {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        margin-bottom: 12px; padding: 10px 12px; border: 1px solid var(--line);
        border-radius: 8px; background: var(--card); box-shadow: var(--shadow-sm); flex-wrap: wrap;
      }
      .toolbar-section { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .toolbar-type-toggles { display: flex; flex-wrap: wrap; gap: 6px; }
      .type-toggle {
        display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 5px 9px;
        border: 2px solid var(--line); border-radius: 6px; background: transparent; color: var(--muted);
        font-size: 11px; font-weight: 800; cursor: pointer; transition: background .15s, border-color .15s, color .15s, opacity .15s;
      }
      .type-toggle .shape-icon {
        width: 8px; height: 8px; border-radius: 999px; background: var(--toggle-color, var(--muted));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--toggle-color, var(--muted)) 18%, transparent);
      }
      .type-toggle.active { color: #fff; }
      .type-toggle:not(.active) { opacity: .72; }
      .toolbar-controls { margin-left: auto; }
      .live-badge {
        display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px; border: 1px solid var(--line);
        border-radius: 999px; color: var(--muted); font-size: 11px; font-weight: 800; white-space: nowrap;
      }
      .pulse-dot { width: 7px; height: 7px; border-radius: 999px; background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.14); }
      .toolbar-search {
        width: min(220px, 42vw); min-height: 32px; border: 1px solid var(--line); border-radius: 7px;
        background: var(--bg); color: var(--ink); padding: 6px 9px; font-size: 12px;
      }
      .json-graph-shell {
        display: grid; grid-template-columns: minmax(760px, 1fr) minmax(280px, 340px);
        gap: 16px; align-items: start;
      }
      .json-graph-canvas {
        position: relative; min-height: 860px; height: min(90vh, 1120px); max-height: none; overflow: hidden; border: 1px solid var(--line);
        border-radius: 12px; background: var(--card); box-shadow: var(--shadow-sm); touch-action: none;
      }
      .json-graph-canvas.graph-fullscreen {
        position: fixed; inset: 12px; z-index: 2000; min-height: 0; max-height: none; height: calc(100vh - 24px);
        border-radius: 12px; background: var(--card); box-shadow: 0 24px 80px rgba(15,23,42,.32);
      }
      .json-graph-canvas:fullscreen {
        width: 100vw; height: 100vh; max-height: none; border-radius: 0; border: none;
      }
      .json-graph-svg { display: block; width: 100%; height: 100%; min-height: 860px; cursor: grab; user-select: none; }
      .json-graph-canvas.graph-fullscreen .json-graph-svg,
      .json-graph-canvas:fullscreen .json-graph-svg { min-height: 100%; height: 100%; }
      .json-graph-svg.dragging { cursor: grabbing; }
      .json-graph-svg defs path { fill: #94a3b8; }
      .json-graph-edge-group.filtered-out, .json-graph-node.filtered-out { display: none; }
      .json-graph-edge {
        fill: none; stroke: #94a3b8; stroke-width: 1.2; stroke-linecap: round; opacity: .72;
      }
      .json-graph-edge-group.neighbor .json-graph-edge {
        stroke: #475569; stroke-width: 2; opacity: .96;
      }
      .json-graph-edge-label {
        fill: #64748b; font: 700 9px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
        paint-order: stroke; stroke: var(--card); stroke-width: 4px; stroke-linejoin: round; pointer-events: none;
      }
      .json-graph-node { cursor: pointer; outline: none; }
      .json-graph-node-hit {
        fill: transparent; stroke: none; pointer-events: all;
      }
      .json-graph-node-dot {
        stroke-width: 2.4; filter: drop-shadow(0 2px 4px rgba(15,23,42,.13));
        transition: r .12s, stroke-width .12s, filter .12s;
      }
      .json-graph-node.dragging .json-graph-node-dot {
        stroke: #0f172a; stroke-width: 4; filter: drop-shadow(0 8px 16px rgba(15,23,42,.28));
      }
      .json-graph-node.neighbor .json-graph-node-dot { stroke: #334155; stroke-width: 3.2; }
      .json-graph-node:hover .json-graph-node-dot, .json-graph-node.active .json-graph-node-dot, .json-graph-node:focus .json-graph-node-dot {
        stroke: #0f172a; stroke-width: 4; filter: drop-shadow(0 4px 9px rgba(15,23,42,.2));
      }
      .json-graph-node-document .json-graph-node-dot { fill: #2563eb; stroke: color-mix(in srgb, #2563eb 35%, #fff); }
      .json-graph-node-governance .json-graph-node-dot { fill: #0f766e; stroke: color-mix(in srgb, #0f766e 35%, #fff); }
      .json-graph-node-section .json-graph-node-dot { fill: #7c3aed; stroke: color-mix(in srgb, #7c3aed 35%, #fff); }
      .json-graph-node-card .json-graph-node-dot { fill: #64748b; stroke: color-mix(in srgb, #64748b 35%, #fff); }
      .json-graph-node-source .json-graph-node-dot { fill: #f59e0b; stroke: color-mix(in srgb, #f59e0b 35%, #fff); }
      .json-graph-node-label {
        fill: #1e293b; font: 800 11px/1.25 ui-sans-serif, system-ui, -apple-system, sans-serif;
        paint-order: stroke; stroke: var(--card); stroke-width: 5px; stroke-linejoin: round; pointer-events: none;
      }
      .json-graph-node-meta {
        fill: #64748b; font: 700 9px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
        paint-order: stroke; stroke: var(--card); stroke-width: 4px; stroke-linejoin: round; pointer-events: none;
      }
      .graph-zoom-controls {
        position: absolute; right: 12px; bottom: 12px; z-index: 4; display: flex; flex-direction: column; gap: 1px;
        border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(15,23,42,.12);
      }
      .graph-zoom-btn {
        display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: none;
        background: rgba(255,255,255,.92); color: #475569; font-size: 17px; font-weight: 800; line-height: 1;
        cursor: pointer; transition: background .15s, color .15s;
      }
      .graph-zoom-btn:hover { background: #f1f5f9; color: #0f172a; }
      .graph-zoom-fit { border-top: 1px solid #e2e8f0; }
      .graph-zoom-fullscreen { border-top: 1px solid #e2e8f0; }
      .json-graph-canvas.graph-fullscreen .graph-zoom-fullscreen,
      .json-graph-canvas:fullscreen .graph-zoom-fullscreen { background: #6366f1; color: #fff; }
      .graph-info {
        position: absolute; left: 12px; bottom: 12px; z-index: 3; padding: 5px 8px; border-radius: 999px;
        background: rgba(255,255,255,.88); color: #64748b; font-size: 11px; font-weight: 800;
      }
      .json-graph-inspector {
        position: sticky; top: 16px; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius);
        background: var(--card); box-shadow: var(--shadow-sm);
      }
      .json-graph-inspector-kicker {
        display: block; margin-bottom: 8px; color: var(--muted); font-size: 11px; font-weight: 800;
        text-transform: uppercase; letter-spacing: 0.06em;
      }
      .json-graph-inspector h3 { margin: 0 0 12px; font-size: 16px; line-height: 1.35; }
      .json-graph-inspector dl { display: grid; gap: 9px; margin: 0; }
      .json-graph-inspector dl div { min-width: 0; }
      .json-graph-inspector dt {
        color: var(--muted); font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;
      }
      .json-graph-inspector dd { margin: 2px 0 0; color: var(--ink); font-size: 12.5px; line-height: 1.5; overflow-wrap: anywhere; }
      .section { margin-top: 48px; padding-top: 36px; border-top: 1px solid var(--line); }
      .section:first-of-type { border-top: none; padding-top: 0; }
      .section.ld-diff-added, .flow-card.ld-diff-added {
        border-color: color-mix(in srgb, #16a34a 40%, var(--line));
        background: color-mix(in srgb, #16a34a 6%, var(--card));
      }
      .section.ld-diff-changed, .flow-card.ld-diff-changed {
        border-color: color-mix(in srgb, #2563eb 40%, var(--line));
        background: color-mix(in srgb, #2563eb 4%, var(--card));
      }
      .section.ld-diff-removed, .flow-card.ld-diff-removed {
        border-color: color-mix(in srgb, #dc2626 40%, var(--line));
        background: color-mix(in srgb, #dc2626 5%, var(--card));
      }
      .ld-diff-pill {
        display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
        border-radius: 999px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
      }
      .doc-diff-pill-inline { display: inline-flex; margin-left: 10px; vertical-align: middle; }
      .ld-diff-pill-added { background: color-mix(in srgb, #16a34a 12%, #fff); color: #166534; }
      .ld-diff-pill-changed { background: color-mix(in srgb, #2563eb 12%, #fff); color: #1d4ed8; }
      .ld-diff-pill-removed { background: color-mix(in srgb, #dc2626 12%, #fff); color: #b91c1c; }
      .doc-diff-removed-list {
        margin-top: 12px; padding: 12px 14px; border-radius: 10px;
        border: 1px solid color-mix(in srgb, #dc2626 24%, var(--line));
        background: color-mix(in srgb, #dc2626 4%, var(--card));
      }
      .doc-diff-inline-added {
        background: color-mix(in srgb, #16a34a 12%, transparent);
        color: #166534; border-radius: 4px; padding: 0 2px; font-weight: 600;
      }
      .doc-diff-inline-removed {
        background: color-mix(in srgb, #dc2626 10%, transparent);
        color: #991b1b; border-radius: 4px; padding: 0 2px; text-decoration: line-through;
      }
      .doc-diff-removed-list strong { display: block; margin-bottom: 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #b91c1c; }
      .doc-diff-removed-list ul { margin: 0; padding-left: 18px; color: var(--ink); }
      .doc-diff-removed-list li + li { margin-top: 4px; }
      .section h2 {
        margin: 0 0 20px; font-size: 19px; font-weight: 700; letter-spacing: -0.01em;
        display: flex; align-items: center; gap: 10px;
      }
      .section-icon { color: var(--muted); flex-shrink: 0; }
      .callout {
        margin-top: 20px; padding: 16px 20px; border-radius: var(--radius);
        border: 1px solid var(--line); background: var(--card); box-shadow: var(--shadow-sm);
      }
      .callout-title {
        margin: 0 0 10px; font-size: 14px; font-weight: 700; letter-spacing: -0.01em;
      }
      .callout-neutral { background: var(--card); }
      .callout-info {
        border-color: color-mix(in srgb, var(--accent) 24%, var(--line));
        background: color-mix(in srgb, var(--accent) 5%, var(--card));
      }
      .callout-warning {
        border-color: color-mix(in srgb, var(--warning-ink) 24%, var(--line));
        background: color-mix(in srgb, var(--warning-bg) 72%, var(--card));
      }
      .callout-negative {
        border-color: color-mix(in srgb, var(--negative-ink) 26%, var(--line));
        background: color-mix(in srgb, var(--negative-bg) 78%, var(--card));
      }
      .callout p { margin: 0 0 8px; line-height: 1.55; }
      .callout p:last-child { margin-bottom: 0; }
      .callout-line, .note-line, .note-reference-line {
        display: block;
      }
      .callout-line + .callout-line,
      .note-line + .note-line,
      .note-reference-line + .note-reference-line {
        margin-top: 4px;
      }
      .callout-table-wrap { margin-top: 14px; overflow-x: auto; }
      .section-ai {
        margin-top: 20px; padding: 18px 20px; border-radius: var(--radius);
        border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--line));
        background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 4%, var(--card)), var(--card));
        box-shadow: var(--shadow-sm);
      }
      .section-ai-toolbar {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 14px;
      }
      .section-ai-toolbar h3 {
        margin: 0 0 4px; font-size: 14px; font-weight: 700; letter-spacing: -0.01em;
      }
      .section-ai-toolbar p {
        margin: 0; color: var(--muted); font-size: 13px; line-height: 1.55; max-width: 70ch;
      }
      .section-ai-run {
        appearance: none; border: 1px solid var(--line); border-radius: 999px;
        background: var(--card); color: var(--ink); font: inherit; font-size: 12px;
        font-weight: 700; padding: 7px 12px; cursor: pointer; white-space: nowrap;
      }
      .section-ai-run:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
      .section-ai-run:disabled { opacity: 0.6; cursor: not-allowed; }
      .section-ai-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .section-ai-card {
        border: 1px solid var(--line); border-radius: 8px; background: var(--card);
        padding: 14px; box-shadow: var(--shadow-sm);
      }
      .section-ai-card[data-ai-slot="section-brief"] {
        grid-column: 1 / -1;
        border-color: color-mix(in srgb, var(--accent) 22%, var(--line));
      }
      .section-ai-card-header {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px;
      }
      .section-ai-card-actions {
        display: flex; align-items: center; gap: 8px;
      }
      .section-ai-slot {
        display: inline-flex; margin-top: 6px; padding: 4px 8px; border-radius: 999px;
        background: var(--neutral-bg); color: var(--neutral-ink); font-size: 10px; font-weight: 800;
        letter-spacing: 0.05em; text-transform: uppercase;
      }
      .section-ai-status {
        display: inline-flex; align-items: center; padding: 4px 8px; border-radius: 999px;
        background: var(--neutral-bg); color: var(--neutral-ink); font-size: 10px; font-weight: 800;
        letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap;
      }
      .section-ai-status[data-state="running"] { background: color-mix(in srgb, var(--accent) 12%, var(--card)); color: var(--accent); }
      .section-ai-status[data-state="done"] { background: var(--positive-bg); color: var(--positive-ink); }
      .section-ai-status[data-state="error"] { background: var(--negative-bg); color: var(--negative-ink); }
      .section-ai-run-card { padding: 5px 9px; font-size: 11px; }
      .section-ai-profile-copy { margin: -2px 0 12px; color: var(--muted); font-size: 12px; line-height: 1.5; }
      .section-ai-title { margin: 0 0 8px; font-size: 14px; line-height: 1.4; letter-spacing: -0.01em; }
      .section-ai-copy, .section-ai-meta { margin: 0 0 8px; color: var(--muted); font-size: 13px; line-height: 1.6; }
      .section-ai-meta {
        display: inline-flex; padding: 4px 8px; border-radius: 999px; background: var(--neutral-bg);
        color: var(--neutral-ink); font-size: 11px; font-weight: 700; margin-bottom: 0;
      }
      .section-ai-list { margin: 0; padding-left: 18px; color: var(--muted); font-size: 13px; line-height: 1.55; }
      .section-ai-list li + li { margin-top: 6px; }
      .section-ai-message {
        margin: 12px 0 0; color: var(--muted); font-size: 12px; line-height: 1.55;
      }
      .section-ai-message[data-tone="error"] { color: var(--negative-ink); }
      .section-ai-message[data-tone="done"] { color: var(--positive-ink); }
      .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin-top: 20px; }
      .stat-card, .flow-card, .page-card, .table-card {
        background: var(--card); border: 1px solid var(--line);
        border-radius: var(--radius); padding: 18px 20px; box-shadow: var(--shadow-sm);
      }
      .stat-card { padding: 20px; }
      .stat-card h3 { margin: 0; font-size: 12.5px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
      .stat-card .value { margin-top: 6px; font-size: 32px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
      .card-grid { display: grid; grid-template-columns: repeat(var(--grid-cols, 2), minmax(0,1fr)); gap: 12px; }
      .flow-card-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
      h3 { margin: 0; font-size: 15px; font-weight: 650; }
      .note-stack { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
      .note-description {
        margin: 0; color: var(--ink); font-size: 14px; line-height: 1.65;
      }
      .note-title {
        display: block; margin-bottom: 6px;
      }
      .note-callout, .note-reference {
        border-radius: 10px; padding: 12px 14px; font-size: 13.5px; line-height: 1.6;
      }
      .note-callout-neutral, .note-reference {
        background: var(--neutral-bg); color: var(--neutral-ink); border: 1px solid var(--line);
      }
      .note-callout-info {
        background: color-mix(in srgb, var(--accent) 6%, var(--card));
        color: var(--ink); border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--line));
      }
      .note-callout-positive {
        background: var(--positive-bg); color: var(--positive-ink);
        border: 1px solid color-mix(in srgb, var(--positive-ink) 24%, var(--line));
      }
      .note-callout-warning {
        background: var(--warning-bg); color: var(--warning-ink);
        border: 1px solid color-mix(in srgb, var(--warning-ink) 24%, var(--line));
      }
      .note-callout-negative {
        background: var(--negative-bg); color: var(--negative-ink);
        border: 1px solid color-mix(in srgb, var(--negative-ink) 24%, var(--line));
      }
      .note-reference-lines {
        display: flex; flex-direction: column;
      }
      .note-chip-row {
        display: flex; flex-wrap: wrap; gap: 6px;
      }
      .note-chip {
        display: inline-flex; align-items: center; padding: 3px 10px;
        border-radius: 999px; background: var(--card); border: 1px solid var(--line);
        color: var(--muted); font-size: 12px; font-weight: 600;
      }
      .mermaid-details[open] { padding-bottom: 10px; }
      .mermaid-stack { margin-top: 12px; display: grid; gap: 14px; }
      .mermaid-card {
        border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--line));
        background: color-mix(in srgb, var(--accent) 3%, var(--card));
        border-radius: 10px; padding: 12px;
      }
      .mermaid-title { margin: 0 0 10px; font-size: 13px; font-weight: 700; color: var(--ink); }
      .mermaid-rendered {
        overflow-x: auto; border-radius: 8px; border: 1px solid var(--line);
        background: var(--card); padding: 10px;
      }
      .mermaid-svg { display: block; min-width: 640px; max-width: 100%; height: auto; }
      .mermaid-edge path { fill: none; stroke: color-mix(in srgb, var(--muted) 70%, var(--line)); stroke-width: 1.8; }
      .mermaid-arrowhead { fill: color-mix(in srgb, var(--muted) 70%, var(--line)); }
      .mermaid-node rect, .mermaid-node polygon {
        fill: color-mix(in srgb, var(--accent) 7%, var(--card));
        stroke: color-mix(in srgb, var(--accent) 35%, var(--line));
        stroke-width: 1.4;
      }
      .mermaid-node-label {
        fill: var(--ink); font-size: 12px; font-weight: 650;
        dominant-baseline: middle; pointer-events: none;
      }
      .mermaid-edge-label {
        fill: var(--muted); font-size: 11px; font-weight: 700;
        paint-order: stroke; stroke: var(--card); stroke-width: 5px; stroke-linejoin: round;
      }
      .mermaid-source { margin-top: 10px; }
      .mermaid-source summary { color: var(--muted); font-size: 12px; font-weight: 700; cursor: pointer; }
      .mermaid-source pre {
        overflow-x: auto; margin: 8px 0 0; padding: 10px; border-radius: 8px;
        background: var(--neutral-bg); color: var(--neutral-ink); font-size: 12px; line-height: 1.5;
      }
      .badge {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 3px 10px; border-radius: 999px; font-size: 11.5px;
        font-weight: 600; letter-spacing: 0.02em; white-space: nowrap;
      }
      .badge-positive { background: var(--positive-bg); color: var(--positive-ink); }
      .badge-warning { background: var(--warning-bg); color: var(--warning-ink); }
      .badge-negative { background: var(--negative-bg); color: var(--negative-ink); }
      .badge-neutral { background: var(--neutral-bg); color: var(--neutral-ink); }
      .full-table { width: 100%; border-collapse: collapse; margin-top: 14px; }
      .full-table th, .full-table td {
        padding: 10px 12px; border-bottom: 1px solid var(--line);
        text-align: left; vertical-align: top; font-size: 13.5px;
      }
      .full-table th { color: var(--muted); font-weight: 600; font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.03em; }
      .full-table thead th { border-bottom: 2px solid var(--line); padding-bottom: 10px; }
      .flow-meta { margin-top: 14px; color: var(--muted); font-size: 13.5px; line-height: 1.65; }
      .flow-meta div { margin-bottom: 2px; }
      .flow-meta div:last-child { margin-bottom: 0; }
      .ticket-row {
        margin-top: 14px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
      }
      .ticket-row strong { font-size: 13px; color: var(--muted); }
      .ticket-badges { display: flex; flex-wrap: wrap; gap: 6px; }
      .ticket-link { text-decoration: none; }
      .ticket-link:hover { text-decoration: none; }
      .ticket-badge { cursor: pointer; }
      .code-refs { margin-top: 10px; color: var(--muted); font-size: 13.5px; line-height: 1.55; }
      .details-block {
        margin-top: 14px; padding: 12px 14px;
        border: 1px dashed color-mix(in srgb, var(--line) 70%, transparent);
        border-radius: 10px; background: var(--bg);
      }
      .details-block summary { cursor: pointer; font-weight: 600; font-size: 13.5px; color: var(--muted); }
      .table-card { padding: 24px; }
      .table-card h2 { margin: 0 0 4px; }
      .footnote { margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12.5px; }
      @media (max-width: 980px) {
        .summary-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
        .card-grid { grid-template-columns: 1fr; }
        .snapshot-grid { grid-template-columns: 1fr; }
        .section-ai-grid { grid-template-columns: 1fr; }
      }
      /* ── Compositor overlay ── */
      .comp-toggle {
        margin-top: auto; width: 40px; height: 40px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        color: var(--muted); cursor: pointer; transition: all 0.15s; flex-shrink: 0;
      }
      .comp-toggle:hover { background: var(--neutral-bg); color: var(--ink); }
      .build-link {
        width: 40px; height: 40px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        color: var(--muted); transition: all 0.15s; flex-shrink: 0; position: relative; cursor: pointer;
      }
      .build-link:hover { background: var(--neutral-bg); color: var(--ink); text-decoration: none; }
      .build-link:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
      .build-link .nav-tooltip {
        position: absolute; left: calc(100% + 8px); top: 50%; transform: translateY(-50%);
        background: var(--ink); color: #fff; font-size: 12px; font-weight: 600;
        padding: 4px 8px; border-radius: 6px; white-space: nowrap; opacity: 0; pointer-events: none;
        transition: opacity 0.15s;
      }
      .build-link:hover .nav-tooltip { opacity: 1; }
      @keyframes comp-glow {
        0%, 100% { box-shadow: 0 0 0 0 rgba(37,99,235,0); }
        50% { box-shadow: 0 0 12px 4px rgba(37,99,235,0.35); }
      }
      .comp-toggle.glow {
        animation: comp-glow 1.5s ease-in-out 3;
        color: var(--accent);
      }
      .comp-cta {
        position: fixed; left: calc(var(--sidebar) + 12px); bottom: 20px; z-index: 150;
        background: var(--card); border: 1px solid var(--line); border-radius: 14px;
        padding: 16px 20px; max-width: 280px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.12);
        opacity: 0; transform: translateY(10px);
        transition: opacity 0.3s, transform 0.3s;
        pointer-events: none;
      }
      .comp-cta.show { opacity: 1; transform: translateY(0); pointer-events: all; }
      .comp-cta-title { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
      .comp-cta-body { font-size: 13px; color: var(--muted); line-height: 1.5; margin-bottom: 12px; }
      .comp-cta-actions { display: flex; gap: 8px; }
      .comp-cta-btn {
        padding: 7px 14px; border-radius: 8px; border: none;
        font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
      }
      .comp-cta-primary { background: var(--accent); color: #fff; }
      .comp-cta-primary:hover { opacity: 0.9; }
      .comp-cta-dismiss { background: transparent; color: var(--muted); }
      .comp-cta-dismiss:hover { color: var(--ink); }
      .comp-overlay {
        position: fixed; inset: 0; z-index: 200;
        background: #fff;
        display: none;
      }
      .comp-overlay.open { display: block; }
      .comp-overlay iframe {
        width: 100%; height: 100%; border: none;
      }
      .comp-close {
        position: fixed; top: 12px; right: 16px; z-index: 300;
        width: 40px; height: 40px; border-radius: 10px; border: 1px solid var(--line);
        background: var(--card); color: var(--muted); font-size: 20px;
        display: none; align-items: center; justify-content: center; cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }
      .comp-close.open { display: flex; }
      .comp-close:hover { background: var(--negative-bg); color: var(--negative-ink); border-color: var(--negative-ink); }
      .period-strip {
        display: flex; gap: 0; margin: 16px 0 8px; border: 1px solid var(--line);
        border-radius: 10px; overflow: hidden; font-size: 13px;
      }
      .period-chip {
        flex: 1; padding: 10px 14px; border-right: 1px solid var(--line); background: var(--card);
      }
      .period-chip:last-child { border-right: none; }
      .period-chip.current { background: color-mix(in srgb, var(--accent) 10%, var(--card)); color: var(--accent); font-weight: 600; }
      .period-chip.future { background: repeating-linear-gradient(45deg, var(--card), var(--card) 5px, var(--neutral-bg) 5px, var(--neutral-bg) 10px); color: var(--muted); }
      .period-chip .period-label { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; display: block; margin-bottom: 3px; letter-spacing: 0.02em; }
      .period-chip .period-summary { font-size: 12.5px; color: var(--muted); line-height: 1.45; }
      .period-chip.current .period-summary { color: var(--accent); }
      .period-chip .period-window {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--muted); display: block; margin-top: 2px;
      }
      .period-badge {
        display: inline-flex; align-items: center; gap: 3px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px; padding: 1px 7px; border-radius: 999px;
        background: color-mix(in srgb, var(--accent) 10%, var(--card));
        color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--line));
        margin-left: 6px;
      }
      .period-badge::before { content: "·"; margin-right: 2px; color: color-mix(in srgb, var(--accent) 40%, var(--muted)); }
      @media (max-width: 720px) {
        .period-strip { flex-direction: column; }
        .period-chip { border-right: none; border-bottom: 1px solid var(--line); }
        .period-chip:last-child { border-bottom: none; }
        .sidebar { display: none; }
        .comp-panel { display: none; }
        .content { margin-left: 0; }
        .wrap { padding: 20px 16px 48px; }
        .json-graph-view { left: auto; width: 100%; transform: none; }
        .summary-grid { grid-template-columns: 1fr; }
        .board-toolbar { flex-direction: column; }
        .graph-toolbar { flex-direction: column; }
        .json-graph-shell { grid-template-columns: 1fr; }
        .json-graph-canvas { min-height: 560px; height: 72vh; }
        .json-graph-svg { min-height: 560px; }
        .json-graph-inspector { position: static; }
        h1 { font-size: 24px; }
      }
    </style>
  </head>
  <body>
    <script type="application/json" id="doc-meta">${metaJson}</script>
    ${semanticContextJson ? `<script type="application/json" id="doc-semantic-context">${semanticContextJson}</script>` : ''}
    ${documentAiArtifacts.serializableSpec ? `<script type="application/ai-render-graph+json" id="doc-ai-spec">${aiSpecJson}</script>` : ''}
    ${documentAiArtifacts.serializableMeta ? `<script type="application/json" id="doc-ai-meta">${aiMetaJson}</script>` : ''}

    <nav class="sidebar" aria-label="Section navigation">
      <div class="brand">${escapeHtml(data.brand ?? 'LD')}</div>
      ${buildSidebar(sections)}
      <div class="comp-toggle" id="comp-toggle" title="Open compositor">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
      </div>
      <div class="build-link" id="build-link" role="button" tabindex="0" aria-label="Build your tool">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM12 4.15 18.04 7.6 12 11.05 5.96 7.6 12 4.15zM5 9.34l6 3.43v6.89l-6-3.43V9.34zm8 10.32v-6.89l6-3.43v6.89l-6 3.43z"/></svg>
        <span class="nav-tooltip">Build your tool</span>
      </div>
    </nav>

    <div class="comp-overlay" id="comp-overlay">
      <iframe id="comp-iframe" srcdoc="${escapeHtml(compositorHtml)}"></iframe>
    </div>
    <div class="comp-cta" id="comp-cta">
      <div class="comp-cta-title" id="cta-title"></div>
      <div class="comp-cta-body" id="cta-body"></div>
      <div class="comp-cta-actions">
        <button class="comp-cta-btn comp-cta-primary" id="cta-explore"></button>
        <button class="comp-cta-btn comp-cta-dismiss" id="cta-dismiss"></button>
      </div>
    </div>

    <div class="content">
      <div class="wrap">
        <header class="page-header">
          <h1>${escapeHtml(data.title)}</h1>
          ${data.subtitle ? `<p class="subtitle">${escapeHtml(data.subtitle)}</p>` : ''}
          ${data.pills ? `<div class="pill-row">${data.pills.map((p) => `<span class="pill">${escapeHtml(p)}</span>`).join('')}</div>` : ''}
          ${renderPeriodStrip(data.periods)}
          ${viewSwitchHtml}
        </header>

        <div id="document-view" class="view-panel" data-view-panel="document">
          ${renderSnapshotPanel(snapshotMeta)}

          ${data.objective ? `
          <section class="callout" style="border-left:3px solid var(--accent)">
            <p><strong>Objective</strong> ${escapeHtml(data.objective)}</p>
            ${data.successCondition ? `<p style="color:var(--muted)"><strong>Success condition</strong> ${escapeHtml(data.successCondition)}</p>` : ''}
            ${data.syncHints ? `<p style="color:var(--muted);font-size:13px"><strong>Scope</strong> ${Object.entries(data.syncHints).map(([k, v]) => `<code>${escapeHtml(k)}: ${escapeHtml(v)}</code>`).join(' ')}</p>` : ''}
          </section>` : ''}

          ${(data.callouts ?? []).map(renderCallout).join('')}

          ${sections.map(renderSection).join('')}

          ${data.source ? `<p class="footnote">Source: ${escapeHtml(data.source)}</p>` : ''}
          <p class="footnote" style="margin-top:${data.source ? '8px' : '40px'}">Living Doc Compositor ${escapeHtml(buildVersion)}</p>
        </div>
        ${boardViewHtml}
        ${graphViewHtml}
      </div>
    </div>

    <script>
      (() => {
        const icons = document.querySelectorAll('.nav-icon[data-target]');
        const sections = [...icons].map(icon => ({
          icon, el: document.getElementById(icon.dataset.target),
        })).filter(s => s.el);
        let active = null;
        const activate = (icon) => {
          if (active === icon) return;
          if (active) active.classList.remove('active');
          icon.classList.add('active');
          active = icon;
        };
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                const match = sections.find(s => s.el === entry.target);
                if (match) activate(match.icon);
              }
            }
          },
          { rootMargin: '-20% 0px -60% 0px' }
        );
        for (const { el } of sections) observer.observe(el);
        if (sections.length > 0) activate(sections[0].icon);
      })();
    </script>

    <script>
      (() => {
        const viewButtons = Array.from(document.querySelectorAll('[data-view-target]'));
        const panels = Array.from(document.querySelectorAll('[data-view-panel]'));
        if (viewButtons.length === 0) return;

        const showView = (view) => {
          for (const panel of panels) {
            panel.hidden = panel.dataset.viewPanel !== view;
          }
          for (const button of viewButtons) {
            const active = button.dataset.viewTarget === view;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
          }
        };

        for (const button of viewButtons) {
          button.addEventListener('click', () => showView(button.dataset.viewTarget));
        }

        document.querySelectorAll('[data-board-select]').forEach((select) => {
          const root = select.closest('.board-view');
          const panelsForBoard = Array.from(root?.querySelectorAll('[data-board-panel]') ?? []);
          const showBoard = (id) => {
            for (const panel of panelsForBoard) {
              panel.hidden = panel.dataset.boardPanel !== id;
            }
          };
          select.addEventListener('change', () => showBoard(select.value));
          showBoard(select.value);
        });

        const graphNodes = Array.from(document.querySelectorAll('[data-graph-node]'));
        const graphTitle = document.querySelector('[data-graph-detail-title]');
        const graphList = document.querySelector('[data-graph-detail-list]');
        let focusGraphNeighborhood = () => {};
        const escapeDetailHtml = (value) => String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
        const renderDetail = (node) => {
          if (!node || !graphTitle || !graphList) return;
          let details = {};
          try {
            details = JSON.parse(node.dataset.graphDetails || '{}');
          } catch {}
          graphNodes.forEach((candidate) => candidate.classList.toggle('active', candidate === node));
          focusGraphNeighborhood(node);
          graphTitle.textContent = details.title || details.label || node.querySelector('title')?.textContent || 'Graph node';
          const rows = Object.entries(details)
            .filter(([key, value]) => key !== 'title' && value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0))
            .map(([key, value]) => {
              const display = Array.isArray(value) ? value.join(', ') : String(value);
              const safeKey = escapeDetailHtml(key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase()));
              const safeDisplay = escapeDetailHtml(display);
              const isPath = key === 'path';
              return '<div><dt>' + safeKey + '</dt><dd>' + (isPath ? '<code>' + safeDisplay + '</code>' : safeDisplay) + '</dd></div>';
            })
            .join('');
          graphList.innerHTML = rows || '<div><dt>Details</dt><dd>No additional metadata.</dd></div>';
        };
        graphNodes.forEach((node) => {
          node.addEventListener('click', (event) => {
            if (node.dataset.graphSuppressClick === 'true') {
              event.preventDefault();
              return;
            }
            renderDetail(node);
          });
          node.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              renderDetail(node);
            }
          });
        });
        if (graphNodes[0]) renderDetail(graphNodes[0]);

        let graphSvg = document.querySelector('[data-graph-svg]');
        const graphEdges = Array.from(document.querySelectorAll('[data-graph-edge-from]'));
        const graphInfo = document.querySelector('[data-graph-info]');
        const graphSearch = document.querySelector('[data-graph-search]');
        const graphTypeToggles = Array.from(document.querySelectorAll('[data-graph-type-toggle]'));
        let graphCanvas = graphSvg?.closest('.json-graph-canvas');
        const graphNodeById = new Map(graphNodes.map((node) => [node.dataset.graphNode, node]));
        const parseViewBox = (value) => String(value || '')
          .trim()
          .split(/\\s+/)
          .map(Number)
          .filter((part) => Number.isFinite(part));
        let graphViewBox = graphSvg ? parseViewBox(graphSvg.dataset.graphInitialViewBox || graphSvg.getAttribute('viewBox')) : [];
        let initialGraphViewBox = graphViewBox.slice();
        const activeGraphTypes = new Set(graphTypeToggles
          .filter((button) => button.classList.contains('active'))
          .map((button) => button.dataset.graphTypeToggle)
          .filter(Boolean));
        const ensureGraphSvg = () => {
          if (!graphSvg) graphSvg = window.document.querySelector('[data-graph-svg]');
          if (!graphCanvas) graphCanvas = graphSvg?.closest('.json-graph-canvas');
          if (graphSvg && graphViewBox.length !== 4) {
            graphViewBox = parseViewBox(graphSvg.getAttribute('viewBox'));
          }
          if (graphViewBox.length === 4 && initialGraphViewBox.length !== 4) {
            initialGraphViewBox = graphViewBox.slice();
          }
          return graphSvg;
        };
        let visibleGraphNodes = graphNodes.length;
        const graphZoomPercent = () => {
          if (graphViewBox.length !== 4 || initialGraphViewBox.length !== 4) return 100;
          return Math.round((initialGraphViewBox[2] / graphViewBox[2]) * 100);
        };
        const updateGraphInfo = () => {
          if (!graphInfo) return;
          graphInfo.textContent = visibleGraphNodes + ' of ' + graphNodes.length + ' nodes visible · ' + graphEdges.length + ' edges · ' + graphZoomPercent() + '%';
        };
        const graphNodePosition = (node) => ({
          x: Number(node?.dataset.graphX || 0),
          y: Number(node?.dataset.graphY || 0),
          size: Number(node?.dataset.graphSize || 12),
        });
        const graphNodeHome = (node) => ({
          x: Number(node?.dataset.graphHomeX || node?.dataset.graphX || 0),
          y: Number(node?.dataset.graphHomeY || node?.dataset.graphY || 0),
        });
        const graphPointFromEvent = (event) => {
          const svg = ensureGraphSvg();
          if (!svg) return { x: 0, y: 0 };
          const point = svg.createSVGPoint();
          point.x = event.clientX;
          point.y = event.clientY;
          const matrix = svg.getScreenCTM();
          if (!matrix) return { x: 0, y: 0 };
          return point.matrixTransform(matrix.inverse());
        };
        const updateGraphEdge = (edge) => {
          const from = graphNodeById.get(edge.dataset.graphEdgeFrom);
          const to = graphNodeById.get(edge.dataset.graphEdgeTo);
          const path = edge.querySelector('.json-graph-edge');
          if (!from || !to || !path) return;
          const a = graphNodePosition(from);
          const b = graphNodePosition(to);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const x1 = a.x + ((dx / distance) * (a.size + 4));
          const y1 = a.y + ((dy / distance) * (a.size + 4));
          const x2 = b.x - ((dx / distance) * (b.size + 7));
          const y2 = b.y - ((dy / distance) * (b.size + 7));
          path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2);
          const label = edge.querySelector('.json-graph-edge-label');
          if (label) {
            label.setAttribute('x', String(x1 + ((x2 - x1) * 0.52)));
            label.setAttribute('y', String(y1 + ((y2 - y1) * 0.52)));
          }
        };
        const updateConnectedGraphEdges = (nodeId) => {
          graphEdges.forEach((edge) => {
            if (edge.dataset.graphEdgeFrom === nodeId || edge.dataset.graphEdgeTo === nodeId) updateGraphEdge(edge);
          });
        };
        const setGraphNodePosition = (node, x, y, updateEdges = true) => {
          node.dataset.graphX = String(x);
          node.dataset.graphY = String(y);
          node.setAttribute('transform', 'translate(' + x + ', ' + y + ')');
          if (updateEdges) updateConnectedGraphEdges(node.dataset.graphNode);
        };
        const updateAllGraphEdges = () => {
          graphEdges.forEach(updateGraphEdge);
        };
        const runGraphGravity = () => {
          if (!graphNodes.length || !graphEdges.length) return;
          const nodes = graphNodes.map((node) => ({
            node,
            id: node.dataset.graphNode,
            type: node.dataset.graphType,
            vx: 0,
            vy: 0,
          }));
          const nodeById = new Map(nodes.map((entry) => [entry.id, entry]));
          const links = graphEdges
            .map((edge) => ({
              edge,
              from: nodeById.get(edge.dataset.graphEdgeFrom),
              to: nodeById.get(edge.dataset.graphEdgeTo),
            }))
            .filter((link) => link.from && link.to);
          const linkLength = (link) => {
            const from = link.from.type;
            const to = link.to.type;
            if (from === 'document' || to === 'document') return 330;
            if (from === 'section' || to === 'section') return 320;
            if (from === 'card' || to === 'card') return 300;
            return 240;
          };
          const homeStrength = (type) => {
            if (type === 'document') return 0.045;
            if (type === 'governance' || type === 'section') return 0.03;
            if (type === 'card') return 0.018;
            return 0.014;
          };
          let tick = 0;
          const step = () => {
            for (let inner = 0; inner < 3 && tick < 180; inner += 1, tick += 1) {
              nodes.forEach((entry) => {
                const pos = graphNodePosition(entry.node);
                const home = graphNodeHome(entry.node);
                const gravity = homeStrength(entry.type);
                entry.vx += (home.x - pos.x) * gravity;
                entry.vy += (home.y - pos.y) * gravity;
              });
              for (let i = 0; i < nodes.length; i += 1) {
                const a = nodes[i];
                const pa = graphNodePosition(a.node);
                for (let j = i + 1; j < nodes.length; j += 1) {
                  const b = nodes[j];
                  const pb = graphNodePosition(b.node);
                  let dx = pb.x - pa.x;
                  let dy = pb.y - pa.y;
                  let distSq = (dx * dx) + (dy * dy);
                  if (distSq < 1) {
                    dx = 1;
                    dy = 0;
                    distSq = 1;
                  }
                  const dist = Math.sqrt(distSq);
                  const minDistance = pa.size + pb.size + 42;
                  const charge = Math.min(4.2, 7600 / distSq);
                  const push = charge + (dist < minDistance ? (minDistance - dist) * 0.035 : 0);
                  const fx = (dx / dist) * push;
                  const fy = (dy / dist) * push;
                  a.vx -= fx;
                  a.vy -= fy;
                  b.vx += fx;
                  b.vy += fy;
                }
              }
              links.forEach((link) => {
                const a = graphNodePosition(link.from.node);
                const b = graphNodePosition(link.to.node);
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.max(1, Math.hypot(dx, dy));
                const delta = dist - linkLength(link);
                const spring = delta * 0.018;
                const fx = (dx / dist) * spring;
                const fy = (dy / dist) * spring;
                link.from.vx += fx;
                link.from.vy += fy;
                link.to.vx -= fx;
                link.to.vy -= fy;
              });
              nodes.forEach((entry) => {
                if (entry.node.classList.contains('dragging')) {
                  entry.vx = 0;
                  entry.vy = 0;
                  return;
                }
                const pos = graphNodePosition(entry.node);
                entry.vx *= 0.72;
                entry.vy *= 0.72;
                setGraphNodePosition(entry.node, pos.x + entry.vx, pos.y + entry.vy, false);
              });
              updateAllGraphEdges();
            }
            if (tick < 180) {
              window.requestAnimationFrame(step);
            } else if (graphCanvas) {
              graphCanvas.dataset.graphGravity = 'settled';
            }
          };
          window.requestAnimationFrame(step);
        };
        focusGraphNeighborhood = (node) => {
          const selectedId = node?.dataset.graphNode;
          if (!selectedId) {
            graphNodes.forEach((candidate) => candidate.classList.remove('neighbor'));
            graphEdges.forEach((edge) => edge.classList.remove('neighbor'));
            return;
          }
          const visibleIds = new Set([selectedId]);
          graphEdges.forEach((edge) => {
            const isConnected = edge.dataset.graphEdgeFrom === selectedId || edge.dataset.graphEdgeTo === selectedId;
            edge.classList.toggle('neighbor', isConnected);
            if (isConnected) {
              visibleIds.add(edge.dataset.graphEdgeFrom);
              visibleIds.add(edge.dataset.graphEdgeTo);
            }
          });
          graphNodes.forEach((candidate) => {
            const isSelected = candidate.dataset.graphNode === selectedId;
            const isNeighbor = visibleIds.has(candidate.dataset.graphNode) && !isSelected;
            candidate.classList.toggle('neighbor', isNeighbor);
          });
        };
        const setGraphViewBox = () => {
          const svg = ensureGraphSvg();
          if (!svg || graphViewBox.length !== 4) return;
          svg.setAttribute('viewBox', graphViewBox.map((part) => Number(part.toFixed(3))).join(' '));
          updateGraphInfo();
        };
        const zoomGraph = (factor, centerPoint = null) => {
          if (!ensureGraphSvg() || graphViewBox.length !== 4) return;
          const [x, y, w, h] = graphViewBox;
          const nextW = Math.max(160, w * factor);
          const nextH = Math.max(120, h * factor);
          const centerX = centerPoint?.x ?? (x + (w / 2));
          const centerY = centerPoint?.y ?? (y + (h / 2));
          const relativeX = (centerX - x) / w;
          const relativeY = (centerY - y) / h;
          graphViewBox = [
            centerX - (nextW * relativeX),
            centerY - (nextH * relativeY),
            nextW,
            nextH,
          ];
          setGraphViewBox();
        };
        const setGraphFullscreen = (active) => {
          ensureGraphSvg();
          if (!graphCanvas) return;
          graphCanvas.classList.toggle('graph-fullscreen', active);
          const button = document.querySelector('[data-graph-fullscreen]');
          if (button) button.setAttribute('title', active ? 'Exit fullscreen graph' : 'Fullscreen graph');
          window.setTimeout(() => setGraphViewBox(), 0);
        };
        window.__livingDocGraphControl = async (action, event) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          const svg = ensureGraphSvg();
          if (action === 'in') {
            graphViewBox = parseViewBox(svg?.getAttribute('viewBox'));
            zoomGraph(0.72);
            return;
          }
          if (action === 'out') {
            graphViewBox = parseViewBox(svg?.getAttribute('viewBox'));
            zoomGraph(1.38);
            return;
          }
          if (action === 'fit') {
            const initialBox = parseViewBox(svg?.dataset.graphInitialViewBox);
            if (initialBox.length === 4) {
              initialGraphViewBox = initialBox.slice();
              graphViewBox = initialBox;
              setGraphViewBox();
            }
            return;
          }
          if (action !== 'fullscreen' || !graphCanvas) return;
          const nativeFullscreen = document.fullscreenElement === graphCanvas;
          if (nativeFullscreen || graphCanvas.classList.contains('graph-fullscreen')) {
            setGraphFullscreen(false);
            if (nativeFullscreen && document.exitFullscreen) {
              try { await document.exitFullscreen(); } catch {}
            }
            return;
          }
          setGraphFullscreen(true);
          if (graphCanvas.requestFullscreen) {
            try { await graphCanvas.requestFullscreen(); } catch {}
          }
        };
        document.addEventListener('click', async (event) => {
          const zoomButton = event.target.closest?.('[data-graph-zoom]');
          const fullscreenButton = event.target.closest?.('[data-graph-fullscreen]');
          if (!zoomButton && !fullscreenButton) return;
          if (zoomButton) {
            await window.__livingDocGraphControl(zoomButton.dataset.graphZoom, event);
            return;
          }
          if (fullscreenButton) await window.__livingDocGraphControl('fullscreen', event);
        });
        document.addEventListener('fullscreenchange', () => {
          if (!graphCanvas) return;
          if (document.fullscreenElement !== graphCanvas && graphCanvas.classList.contains('graph-fullscreen')) {
            setGraphFullscreen(false);
          } else if (document.fullscreenElement === graphCanvas) {
            setGraphFullscreen(true);
          }
        });
        let hoveredGraphNode = null;
        const graphPointWithinNodeHit = (event, candidate, padding = 0) => {
          const hit = candidate.querySelector('.json-graph-node-hit') || candidate;
          const rect = hit.getBoundingClientRect();
          return event.clientX >= rect.left - padding && event.clientX <= rect.right + padding
            && event.clientY >= rect.top - padding && event.clientY <= rect.bottom + padding;
        };
        const graphNodeAtPoint = (event) => graphNodes.find((candidate) => graphPointWithinNodeHit(event, candidate)) || null;
        const hoveredGraphNodeAtPoint = (event) => (
          hoveredGraphNode && graphPointWithinNodeHit(event, hoveredGraphNode, 8) ? hoveredGraphNode : null
        );
        const beginGraphNodeDrag = (node, event) => {
          if (event.button !== 0 || !graphSvg || !node) return false;
          event.preventDefault();
          event.stopPropagation();
          if (node.setPointerCapture && event.pointerId !== undefined) {
            try { node.setPointerCapture(event.pointerId); } catch {}
          }
          node.classList.add('dragging');
          renderDetail(node);
          const startPoint = graphPointFromEvent(event);
          const startPosition = graphNodePosition(node);
          let moved = false;
          const onMove = (moveEvent) => {
            const nextPoint = graphPointFromEvent(moveEvent);
            const nextX = startPosition.x + (nextPoint.x - startPoint.x);
            const nextY = startPosition.y + (nextPoint.y - startPoint.y);
            if (Math.hypot(nextX - startPosition.x, nextY - startPosition.y) > 1) moved = true;
            setGraphNodePosition(node, nextX, nextY);
            focusGraphNeighborhood(node);
          };
          const onUp = (upEvent) => {
            if (node.hasPointerCapture && upEvent.pointerId !== undefined && node.hasPointerCapture(upEvent.pointerId)) {
              try { node.releasePointerCapture(upEvent.pointerId); } catch {}
            }
            node.classList.remove('dragging');
            node.removeEventListener('pointermove', onMove);
            node.removeEventListener('pointerup', onUp);
            node.removeEventListener('pointercancel', onUp);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            if (moved) {
              node.dataset.graphSuppressClick = 'true';
              window.setTimeout(() => {
                delete node.dataset.graphSuppressClick;
              }, 0);
            }
          };
          node.addEventListener('pointermove', onMove);
          node.addEventListener('pointerup', onUp);
          node.addEventListener('pointercancel', onUp);
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
          document.addEventListener('pointercancel', onUp);
          return true;
        };
        const beginGraphNodeMouseDrag = (node, event) => {
          if (event.button !== 0 || !graphSvg || !node || node.classList.contains('dragging')) return false;
          event.preventDefault();
          event.stopPropagation();
          node.classList.add('dragging');
          renderDetail(node);
          const startPoint = graphPointFromEvent(event);
          const startPosition = graphNodePosition(node);
          let moved = false;
          const onMove = (moveEvent) => {
            const nextPoint = graphPointFromEvent(moveEvent);
            const nextX = startPosition.x + (nextPoint.x - startPoint.x);
            const nextY = startPosition.y + (nextPoint.y - startPoint.y);
            if (Math.hypot(nextX - startPosition.x, nextY - startPosition.y) > 1) moved = true;
            setGraphNodePosition(node, nextX, nextY);
            focusGraphNeighborhood(node);
          };
          const onUp = () => {
            node.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (moved) {
              node.dataset.graphSuppressClick = 'true';
              window.setTimeout(() => {
                delete node.dataset.graphSuppressClick;
              }, 0);
            }
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          return true;
        };
        if (graphSvg) {
          let dragStart = null;
          graphSvg.addEventListener('wheel', (event) => {
            event.preventDefault();
            zoomGraph(event.deltaY < 0 ? 0.88 : 1.14, graphPointFromEvent(event));
          }, { passive: false });
          graphSvg.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || graphViewBox.length !== 4) return;
            const nodeTarget = event.target.closest?.('[data-graph-node]') || graphNodeAtPoint(event) || hoveredGraphNodeAtPoint(event);
            if (nodeTarget && beginGraphNodeDrag(nodeTarget, event)) return;
            graphSvg.setPointerCapture(event.pointerId);
            graphSvg.classList.add('dragging');
            dragStart = {
              x: event.clientX,
              y: event.clientY,
              viewBox: graphViewBox.slice(),
            };
          });
          graphSvg.addEventListener('mousedown', (event) => {
            const nodeTarget = event.target.closest?.('[data-graph-node]') || graphNodeAtPoint(event) || hoveredGraphNodeAtPoint(event);
            if (nodeTarget) beginGraphNodeMouseDrag(nodeTarget, event);
          });
          graphSvg.addEventListener('pointermove', (event) => {
            if (!dragStart || graphViewBox.length !== 4) return;
            const rect = graphSvg.getBoundingClientRect();
            const scaleX = dragStart.viewBox[2] / Math.max(1, rect.width);
            const scaleY = dragStart.viewBox[3] / Math.max(1, rect.height);
            graphViewBox = [
              dragStart.viewBox[0] - ((event.clientX - dragStart.x) * scaleX),
              dragStart.viewBox[1] - ((event.clientY - dragStart.y) * scaleY),
              dragStart.viewBox[2],
              dragStart.viewBox[3],
            ];
            setGraphViewBox();
          });
          const endDrag = (event) => {
            if (event?.pointerId !== undefined && graphSvg.hasPointerCapture(event.pointerId)) {
              graphSvg.releasePointerCapture(event.pointerId);
            }
            graphSvg.classList.remove('dragging');
            dragStart = null;
          };
          graphSvg.addEventListener('pointerup', endDrag);
          graphSvg.addEventListener('pointercancel', endDrag);
          graphSvg.addEventListener('click', (event) => {
            if (event.target === graphSvg) focusGraphNeighborhood(document.querySelector('.json-graph-node.active'));
          });
        }
        graphNodes.forEach((node) => {
          node.addEventListener('mouseenter', () => {
            hoveredGraphNode = node;
            focusGraphNeighborhood(node);
          });
          node.addEventListener('pointermove', () => {
            hoveredGraphNode = node;
          });
          node.addEventListener('mouseleave', () => {
            const activeNode = document.querySelector('.json-graph-node.active');
            focusGraphNeighborhood(activeNode);
          });
          node.addEventListener('pointerdown', (event) => {
            beginGraphNodeDrag(node, event);
          });
          node.addEventListener('mousedown', (event) => {
            beginGraphNodeMouseDrag(node, event);
          });
        });
        const updateGraphVisibility = () => {
          const query = (graphSearch?.value || '').trim().toLowerCase();
          let visible = 0;
          const hiddenByNodeId = new Map();
          graphNodes.forEach((node) => {
            const type = node.dataset.graphType;
            const label = node.dataset.graphLabel || '';
            const hidden = (type && !activeGraphTypes.has(type)) || (query && !label.includes(query));
            node.classList.toggle('filtered-out', Boolean(hidden));
            hiddenByNodeId.set(node.dataset.graphNode, Boolean(hidden));
            if (!hidden) visible += 1;
          });
          graphEdges.forEach((edge) => {
            const hidden = hiddenByNodeId.get(edge.dataset.graphEdgeFrom) || hiddenByNodeId.get(edge.dataset.graphEdgeTo);
            edge.classList.toggle('filtered-out', Boolean(hidden));
          });
          visibleGraphNodes = visible;
          updateGraphInfo();
        };
        graphTypeToggles.forEach((button) => {
          button.addEventListener('click', () => {
            const type = button.dataset.graphTypeToggle;
            if (!type) return;
            if (activeGraphTypes.has(type) && activeGraphTypes.size > 1) activeGraphTypes.delete(type);
            else activeGraphTypes.add(type);
            button.classList.toggle('active', activeGraphTypes.has(type));
            if (activeGraphTypes.has(type)) {
              button.style.background = button.style.getPropertyValue('--toggle-color');
              button.style.borderColor = button.style.getPropertyValue('--toggle-color');
            } else {
              button.style.background = 'transparent';
              button.style.borderColor = 'var(--line)';
            }
            updateGraphVisibility();
          });
        });
        graphSearch?.addEventListener('input', updateGraphVisibility);
        updateGraphVisibility();
        runGraphGravity();

        showView('document');
      })();
    </script>

    <script>
      (() => {
        const snapshotAnchor = document.getElementById('snapshot-generated-at');
        if (!snapshotAnchor) return;
        const snapshotTime = Date.parse(snapshotAnchor.getAttribute('datetime') || snapshotAnchor.textContent || '');
        if (Number.isNaN(snapshotTime)) return;

        const formatSnapshotRelative = (value) => {
          const targetTime = Date.parse(value);
          if (Number.isNaN(targetTime)) return null;

          const diffMs = snapshotTime - targetTime;
          const absoluteMs = Math.abs(diffMs);
          const diffMin = Math.floor(absoluteMs / 60000);
          const diffHr = Math.floor(absoluteMs / 3600000);
          const diffDay = Math.floor(absoluteMs / 86400000);
          const direction = diffMs < 0 ? 'after snapshot' : 'before snapshot';

          if (diffMin < 1) return 'at snapshot';
          if (diffMin < 60) return diffMin + 'm ' + direction;
          if (diffHr < 24) return diffHr + 'h ' + direction;
          if (diffDay < 7) return diffDay + 'd ' + direction;
          return new Date(targetTime).toISOString().slice(0, 10);
        };

        document.querySelectorAll('time[data-relative-to-snapshot="true"]').forEach((timeEl) => {
          const datetime = timeEl.getAttribute('datetime') || '';
          const label = formatSnapshotRelative(datetime);
          if (!label) return;
          timeEl.textContent = label;
          timeEl.title = datetime + ' · ' + label;
          timeEl.setAttribute('aria-label', label + ' (' + datetime + ')');
        });
      })();
    </script>

    <script>
    (() => {
      // Compositor toggle — opens the full tool as an overlay
      const compOverlay = document.getElementById('comp-overlay');
      const compToggle = document.getElementById('comp-toggle');
      const compIframe = document.getElementById('comp-iframe');
      const diffToggle = document.getElementById('doc-diff-toggle');
      const diffStatus = document.getElementById('doc-diff-status');
      const LOCAL_DIFF_SERVER = localStorage.getItem('ap-server') || 'http://localhost:4322';

      function resolveDocPath() {
        if (typeof window.LD_DOC_ABS_PATH === 'string' && window.LD_DOC_ABS_PATH) return window.LD_DOC_ABS_PATH;
        try {
          if (window.parent && window.parent !== window && typeof window.parent.LD_DOC_ABS_PATH === 'string' && window.parent.LD_DOC_ABS_PATH) {
            return window.parent.LD_DOC_ABS_PATH;
          }
        } catch {}
        const override = localStorage.getItem('ap-doc-path');
        if (override) return override;
        const meta = JSON.parse(document.getElementById('doc-meta').textContent);
        if (typeof meta?.canonicalOrigin === 'string' && meta.canonicalOrigin.startsWith('/')) return meta.canonicalOrigin;
        return null;
      }

      function cardKey(card, index) {
        return String(card?.id || card?.figmaName || card?.name || ('index-' + index));
      }

      function changedFields(baseObj, nextObj, excluded = []) {
        const ignore = new Set(excluded);
        const keys = new Set([...(baseObj ? Object.keys(baseObj) : []), ...(nextObj ? Object.keys(nextObj) : [])]);
        return [...keys].filter((key) => !ignore.has(key) && JSON.stringify(baseObj?.[key] ?? null) !== JSON.stringify(nextObj?.[key] ?? null));
      }

      function escapeDiffHtml(value) {
        return String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function flattenDiffText(value) {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) {
          return value.map((entry) => {
            if (typeof entry === 'string') return entry;
            if (entry && typeof entry === 'object') {
              if (typeof entry.text === 'string' && entry.text.trim()) return entry.text;
              if (typeof entry.statement === 'string' && entry.statement.trim()) return entry.statement;
              if (typeof entry.name === 'string' && entry.name.trim()) return entry.name;
            }
            return JSON.stringify(entry);
          }).filter(Boolean).join('\\n');
        }
        if (typeof value === 'object') {
          if (typeof value.text === 'string' && value.text.trim()) return value.text;
          if (typeof value.statement === 'string' && value.statement.trim()) return value.statement;
          if (typeof value.name === 'string' && value.name.trim()) return value.name;
        }
        return JSON.stringify(value, null, 2);
      }

      function textPieces(value) {
        if (value == null) return [];
        if (typeof value === 'string') return [value];
        if (Array.isArray(value)) {
          return value.map((entry) => flattenDiffText(entry)).filter((entry) => entry && entry.trim());
        }
        return [flattenDiffText(value)].filter((entry) => entry && entry.trim());
      }

      function changedFragments(baseCard, currentCard, fields) {
        function changedFragment(beforeText, afterText) {
          const beforeTokens = String(beforeText || '').split(/(\s+)/);
          const afterTokens = String(afterText || '').split(/(\s+)/);
          let prefix = 0;
          while (prefix < beforeTokens.length && prefix < afterTokens.length && beforeTokens[prefix] === afterTokens[prefix]) {
            prefix += 1;
          }
          let beforeSuffix = beforeTokens.length - 1;
          let afterSuffix = afterTokens.length - 1;
          while (beforeSuffix >= prefix && afterSuffix >= prefix && beforeTokens[beforeSuffix] === afterTokens[afterSuffix]) {
            beforeSuffix -= 1;
            afterSuffix -= 1;
          }
          const beforeChanged = beforeTokens.slice(prefix, beforeSuffix + 1).join('').trim();
          const afterChanged = afterTokens.slice(prefix, afterSuffix + 1).join('').trim();
          return {
            before: beforeChanged || String(beforeText || '').trim(),
            after: afterChanged || String(afterText || '').trim(),
          };
        }

        const rows = [];
        fields.forEach((field) => {
          const beforePieces = textPieces(baseCard?.[field]);
          const afterPieces = textPieces(currentCard?.[field]);
          const pieceCount = Math.max(beforePieces.length, afterPieces.length);
          for (let index = 0; index < pieceCount; index += 1) {
            const beforeText = beforePieces[index] || '';
            const afterText = afterPieces[index] || '';
            if (!beforeText && !afterText) continue;
            if (beforeText === afterText) continue;
            const fragment = changedFragment(beforeText, afterText);
            if (fragment.before || fragment.after) rows.push(fragment);
          }
        });
        return rows;
      }

      function applyInlineFragmentDiff(root, beforeText, afterText) {
        if (!root || !afterText) return false;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.nodeValue || '';
          const index = text.indexOf(afterText);
          if (index === -1) continue;
          const fragment = document.createDocumentFragment();
          if (index > 0) fragment.appendChild(document.createTextNode(text.slice(0, index)));
          if (beforeText) {
            const removed = document.createElement('span');
            removed.className = 'doc-diff-inline-removed';
            removed.textContent = beforeText;
            fragment.appendChild(removed);
          }
          const added = document.createElement('span');
          added.className = 'doc-diff-inline-added';
          added.textContent = afterText;
          fragment.appendChild(added);
          if (index + afterText.length < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(index + afterText.length)));
          }
          const parent = node.parentNode;
          if (!parent) return false;
          parent.replaceChild(fragment, node);
          return true;
        }
        return false;
      }

      function computeDiff(baseDoc, currentDoc) {
        const diff = { summary: { sectionsAdded: 0, sectionsRemoved: 0, sectionsChanged: 0, cardsAdded: 0, cardsRemoved: 0, cardsChanged: 0 }, sections: {} };
        const currentSections = Array.isArray(currentDoc?.sections) ? currentDoc.sections : [];
        const baseSections = Array.isArray(baseDoc?.sections) ? baseDoc.sections : [];
        const currentById = new Map(currentSections.map((section, index) => [String(section?.id || ('section-' + index)), section]));
        const baseById = new Map(baseSections.map((section, index) => [String(section?.id || ('section-' + index)), section]));
        const sectionIds = [...new Set([...currentById.keys(), ...baseById.keys()])];

        sectionIds.forEach((sectionId) => {
          const currentSection = currentById.get(sectionId) || null;
          const baseSection = baseById.get(sectionId) || null;
          const currentCards = Array.isArray(currentSection?.data) ? currentSection.data : [];
          const baseCards = Array.isArray(baseSection?.data) ? baseSection.data : [];
          const currentCardMap = new Map(currentCards.map((card, index) => [cardKey(card, index), card]));
          const baseCardMap = new Map(baseCards.map((card, index) => [cardKey(card, index), card]));
          const cardKeys = [...new Set([...currentCardMap.keys(), ...baseCardMap.keys()])];
          const cards = {};
          const removedCards = [];
          cardKeys.forEach((key) => {
            const currentCard = currentCardMap.get(key);
            const baseCard = baseCardMap.get(key);
            if (currentCard && !baseCard) {
              cards[key] = { changeType: 'added' };
              diff.summary.cardsAdded += 1;
              return;
            }
            if (!currentCard && baseCard) {
              removedCards.push(baseCard);
              diff.summary.cardsRemoved += 1;
              return;
            }
            const fields = changedFields(baseCard, currentCard);
            cards[key] = { changeType: fields.length ? 'changed' : 'unchanged', changedFields: fields, baseCard, currentCard };
            if (fields.length) diff.summary.cardsChanged += 1;
          });
          const sectionFields = changedFields(baseSection, currentSection, ['data']);
          let changeType = 'unchanged';
          if (currentSection && !baseSection) changeType = 'added';
          else if (!currentSection && baseSection) changeType = 'removed';
          else if (sectionFields.length || removedCards.length || Object.values(cards).some((entry) => entry.changeType !== 'unchanged')) changeType = 'changed';
          if (changeType === 'added') diff.summary.sectionsAdded += 1;
          else if (changeType === 'removed') diff.summary.sectionsRemoved += 1;
          else if (changeType === 'changed') diff.summary.sectionsChanged += 1;
          diff.sections[sectionId] = { changeType, cards, removedCards };
        });
        return diff;
      }

      function diffClass(changeType) {
        if (changeType === 'added') return 'ld-diff-added';
        if (changeType === 'changed') return 'ld-diff-changed';
        if (changeType === 'removed') return 'ld-diff-removed';
        return '';
      }

      function diffPill(changeType) {
        if (changeType === 'added') return '<span class="ld-diff-pill ld-diff-pill-added">new</span>';
        if (changeType === 'changed') return '<span class="ld-diff-pill ld-diff-pill-changed">changed</span>';
        if (changeType === 'removed') return '<span class="ld-diff-pill ld-diff-pill-removed">removed</span>';
        return '';
      }

      function clearDocDiff() {
        document.querySelectorAll('.ld-diff-added, .ld-diff-changed, .ld-diff-removed').forEach((el) => {
          el.classList.remove('ld-diff-added', 'ld-diff-changed', 'ld-diff-removed');
        });
        document.querySelectorAll('.doc-diff-pill-inline, .doc-diff-removed-list').forEach((el) => el.remove());
      }

      function applyDocDiff(diff, baseRef) {
        clearDocDiff();
        Object.entries(diff.sections || {}).forEach(([sectionId, info]) => {
          const sectionEl = document.querySelector('.section[data-section-id="' + CSS.escape(sectionId) + '"]');
          if (!sectionEl) return;
          const sectionClass = diffClass(info.changeType);
          if (sectionClass) {
            sectionEl.classList.add(sectionClass);
            const heading = sectionEl.querySelector('h2');
            if (heading) {
              heading.insertAdjacentHTML('beforeend', '<span class="doc-diff-pill-inline">' + diffPill(info.changeType) + '</span>');
            }
          }
          Object.entries(info.cards || {}).forEach(([cardId, cardInfo]) => {
            if (!cardInfo || cardInfo.changeType === 'unchanged') return;
            const cardEl = sectionEl.querySelector('.flow-card[data-card-key="' + CSS.escape(cardId) + '"]');
            if (!cardEl) return;
            const cardClass = diffClass(cardInfo.changeType);
            if (cardClass) cardEl.classList.add(cardClass);
            const header = cardEl.querySelector('.flow-card-header');
            if (header) header.insertAdjacentHTML('beforeend', '<span class="doc-diff-pill-inline">' + diffPill(cardInfo.changeType) + '</span>');
            if (cardInfo.changeType === 'changed' && Array.isArray(cardInfo.changedFields) && cardInfo.changedFields.length) {
              changedFragments(cardInfo.baseCard, cardInfo.currentCard, cardInfo.changedFields).forEach((fragment) => {
                applyInlineFragmentDiff(cardEl, fragment.before, fragment.after);
              });
            }
          });
          if (Array.isArray(info.removedCards) && info.removedCards.length) {
            sectionEl.insertAdjacentHTML('beforeend',
              '<div class="doc-diff-removed-list">' +
                '<strong>Removed from local version</strong>' +
                '<ul>' + info.removedCards.map((card) => '<li>' + (card?.name || card?.figmaName || card?.id || 'Unnamed item') + '</li>').join('') + '</ul>' +
              '</div>');
          }
        });
        diffStatus.hidden = false;
        diffStatus.className = 'doc-diff-status';
        diffStatus.innerHTML = '<strong>Local diff</strong> vs <code>' + baseRef + '</code> · +' + diff.summary.cardsAdded + ' new · ~' + diff.summary.cardsChanged + ' changed · -' + diff.summary.cardsRemoved + ' removed';
      }

      // CTA i18n
      const ctaStrings = {
        en: { title: 'Want to build one of these?', body: 'This document was built with the Living Doc Compositor. Explore the tool, modify this structure, or create your own.', explore: 'Explore', dismiss: 'Later' },
        nl: { title: 'Wil je er zelf een maken?', body: 'Dit document is gemaakt met de Living Doc Compositor. Ontdek de tool, pas de structuur aan, of maak je eigen versie.', explore: 'Ontdekken', dismiss: 'Later' },
        id: { title: 'Ingin membuat sendiri?', body: 'Dokumen ini dibuat dengan Living Doc Compositor. Jelajahi alat ini, ubah struktur, atau buat versi Anda sendiri.', explore: 'Jelajahi', dismiss: 'Nanti' },
      };
      const lang = (navigator.language || 'en').toLowerCase();
      const ctaL = ctaStrings[lang.startsWith('nl') ? 'nl' : lang.startsWith('id') || lang.startsWith('ms') ? 'id' : 'en'];
      document.getElementById('cta-title').textContent = ctaL.title;
      document.getElementById('cta-body').textContent = ctaL.body;
      document.getElementById('cta-explore').textContent = ctaL.explore;
      document.getElementById('cta-dismiss').textContent = ctaL.dismiss;

      // CTA nudge after 8 seconds
      const cta = document.getElementById('comp-cta');
      let ctaDismissed = false;
      if (!ctaDismissed) {
        setTimeout(() => {
          compToggle.classList.add('glow');
          setTimeout(() => {
            cta.classList.add('show');
          }, 2000);
          setTimeout(() => { compToggle.classList.remove('glow'); }, 4500);
        }, 8000);
      }
      document.getElementById('cta-explore')?.addEventListener('click', () => {
        cta.classList.remove('show');
        ctaDismissed = true;
        compOverlay.classList.add('open');
        const docData = JSON.parse(document.getElementById('doc-meta').textContent);
        compIframe.contentWindow.postMessage({ type: 'load-document', doc: docData }, '*');
      });
      document.getElementById('cta-dismiss')?.addEventListener('click', () => {
        cta.classList.remove('show');
        ctaDismissed = true;
      });

      // Open compositor overlay
      compToggle.addEventListener('click', () => {
        cta.classList.remove('show');
        ctaDismissed = true;
        compOverlay.classList.add('open');
        // Pass the current document data to the compositor iframe via postMessage
        const docData = JSON.parse(document.getElementById('doc-meta').textContent);
        compIframe.contentWindow.postMessage({ type: 'load-document', doc: docData }, '*');
      });

      diffToggle?.addEventListener('click', async () => {
        if (diffToggle.classList.contains('active')) {
          diffToggle.classList.remove('active');
          diffToggle.textContent = 'Show local diff';
          clearDocDiff();
          diffStatus.hidden = true;
          diffStatus.textContent = '';
          return;
        }
        const docPath = resolveDocPath();
        if (!docPath) {
          diffStatus.hidden = false;
          diffStatus.className = 'doc-diff-status doc-diff-status-error';
          diffStatus.textContent = 'Cannot resolve local doc path for diff.';
          return;
        }
        diffToggle.disabled = true;
        diffToggle.textContent = 'Loading local diff…';
        diffStatus.hidden = false;
        diffStatus.className = 'doc-diff-status';
        diffStatus.textContent = 'Loading local diff…';
        try {
          const response = await fetch(LOCAL_DIFF_SERVER + '/api/local-diff/base', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docPath }),
          });
          if (!response.ok) {
            let message = 'server returned ' + response.status;
            try {
              const body = await response.json();
              if (body?.error) message = body.error;
            } catch {}
            throw new Error(message);
          }
          const payload = await response.json();
          const currentDoc = JSON.parse(document.getElementById('doc-meta').textContent);
          const diff = computeDiff(payload.baseDoc || {}, currentDoc);
          applyDocDiff(diff, payload.baseRef || 'base');
          diffToggle.classList.add('active');
          diffToggle.textContent = 'Hide local diff';
        } catch (error) {
          diffStatus.hidden = false;
          diffStatus.className = 'doc-diff-status doc-diff-status-error';
          diffStatus.textContent = String(error.message || error);
          diffToggle.classList.remove('active');
          diffToggle.textContent = 'Show local diff';
        } finally {
          diffToggle.disabled = false;
        }
      });

      // Open compositor overlay + build-your-tool modal
      const buildLink = document.getElementById('build-link');
      const openBuildFromOverlay = () => {
        cta.classList.remove('show');
        ctaDismissed = true;
        compOverlay.classList.add('open');
        const docData = JSON.parse(document.getElementById('doc-meta').textContent);
        // Give the iframe a beat to mount if it's the first open, then post both messages
        const post = () => {
          compIframe.contentWindow.postMessage({ type: 'load-document', doc: docData }, '*');
          compIframe.contentWindow.postMessage({ type: 'open-build-modal' }, '*');
        };
        if (compIframe.contentDocument?.readyState === 'complete') post();
        else compIframe.addEventListener('load', post, { once: true }), post();
      };
      buildLink?.addEventListener('click', openBuildFromOverlay);
      buildLink?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBuildFromOverlay(); }
      });

      // Auto-open compositor if document has no sections
      const docSections = JSON.parse(document.getElementById('doc-meta').textContent).sections || [];
      if (docSections.length === 0) {
        compOverlay.classList.add('open');
      }

      window.addEventListener('message', (event) => {
        if (event.source !== compIframe.contentWindow) return;
        const payload = event.data;
        if (!payload || payload.type !== 'living-doc-open-href') return;
        const href = String(payload.href || '').trim();
        if (!href) return;
        const target = payload.target === '_self' ? '_self' : '_blank';
        window.open(href, target, target === '_blank' ? 'noopener' : undefined);
      });
    })();
    </script>
${documentAiArtifacts.serializableSpec ? `
    <script>${aiRenderGraphRuntimeSource}</script>
    <script>
    (() => {
      const runtimeApi = window.AiRenderGraph;
      const specScript = document.getElementById('doc-ai-spec');
      const metaScript = document.getElementById('doc-ai-meta');
      if (!runtimeApi || !specScript || !metaScript) return;

      let spec;
      let meta;
      try {
        spec = JSON.parse(specScript.textContent);
        meta = JSON.parse(metaScript.textContent);
      } catch (error) {
        console.error('Failed to parse AI advisory scripts', error);
        return;
      }

      const hasModelConfig = Boolean(meta.runtime?.endpoint && meta.runtime?.model);
      const sections = Array.isArray(meta.sections) ? meta.sections : [];
      const sectionTaskIds = new Map(sections.map((section) => [section.sectionId, Array.isArray(section.taskIds) ? section.taskIds : []]));
      const sectionButtons = Array.from(document.querySelectorAll('[data-ai-run]'));
      const taskButtons = Array.from(document.querySelectorAll('[data-ai-run-task]'));
      let mounted = null;
      const persistedTaskResults = new Map();

      function taskIds() {
        return Object.keys(spec.tasks || {});
      }

      function statusElements(taskId) {
        return Array.from(document.querySelectorAll('[data-ai-status]')).filter((el) => el.dataset.aiStatus === taskId);
      }

      function messageElements(taskId) {
        return Array.from(document.querySelectorAll('[data-ai-message]')).filter((el) => el.dataset.aiMessage === taskId);
      }

      function fieldElements(taskId) {
        return Array.from(document.querySelectorAll('[data-ai-task]')).filter((el) => el.dataset.aiTask === taskId);
      }

      function taskRunButtons(taskId) {
        return taskButtons.filter((button) => button.dataset.aiRunTask === taskId);
      }

      function cloneTaskOutput(value) {
        if (value === undefined) return undefined;
        return JSON.parse(JSON.stringify(value));
      }

      function readTaskPath(value, path) {
        if (!path) return value;
        return String(path).split('.').reduce((current, part) => {
          if (current == null) return undefined;
          if (Array.isArray(current)) {
            const index = Number(part);
            return Number.isInteger(index) ? current[index] : undefined;
          }
          if (typeof current === 'object') return current[part];
          return undefined;
        }, value);
      }

      function renderTaskFieldValue(el, value) {
        if (el.dataset.aiRender === 'list') {
          const items = Array.isArray(value)
            ? value
            : value == null
              ? []
              : [value];
          el.innerHTML = items.map((item) => '<li>' + String(item)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;') + '</li>').join('');
          return;
        }
        if (el.tagName.toLowerCase() === 'pre') {
          el.textContent = JSON.stringify(value, null, 2);
          return;
        }
        el.textContent = value == null ? '' : String(value);
      }

      function persistTaskResult(taskId, output, message) {
        persistedTaskResults.set(taskId, {
          output: cloneTaskOutput(output),
          message: String(message || '').trim(),
        });
      }

      function applyPersistedTaskResult(taskId) {
        const persisted = persistedTaskResults.get(taskId);
        if (!persisted) return;
        fieldElements(taskId).forEach((el) => {
          renderTaskFieldValue(el, readTaskPath(persisted.output, el.dataset.aiPath || ''));
          delete el.dataset.aiStatus;
          el.removeAttribute('aria-busy');
        });
        setTaskStatus(taskId, 'Ready', 'done');
        setTaskMessage(taskId, persisted.message || 'Advisory updated from validated local output.', 'done');
        taskRunButtons(taskId).forEach((button) => { button.disabled = false; });
      }

      function restorePersistedTaskResults(excludedTaskIds = []) {
        const excluded = new Set(excludedTaskIds);
        taskIds().forEach((taskId) => {
          if (excluded.has(taskId)) return;
          applyPersistedTaskResult(taskId);
        });
      }

      function setTaskStatus(taskId, text, state = 'idle') {
        statusElements(taskId).forEach((el) => {
          el.textContent = text;
          el.dataset.state = state;
        });
      }

      function setTaskMessage(taskId, text, tone = 'muted') {
        messageElements(taskId).forEach((el) => {
          el.textContent = text;
          el.dataset.tone = tone;
        });
      }

      function restoreTaskFields(taskId) {
        fieldElements(taskId).forEach((el) => {
          const fallback = el.dataset.aiFallback || '';
          if (el.dataset.aiRender === 'list') {
            let items = [];
            try {
              items = JSON.parse(fallback);
            } catch {}
            el.innerHTML = items.map((item) => '<li>' + String(item)
              .replaceAll('&', '&amp;')
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;') + '</li>').join('');
          } else {
            el.textContent = fallback;
          }
          delete el.dataset.aiStatus;
          el.removeAttribute('aria-busy');
        });
      }

      function restoreAllTasks() {
        taskIds().forEach((taskId) => {
          restoreTaskFields(taskId);
          setTaskStatus(taskId, hasModelConfig ? 'Ready' : 'Config needed', 'idle');
          setTaskMessage(
            taskId,
            hasModelConfig ? 'Ready for a document-grounded section pass.' : 'Add a local AI endpoint and model before running this section pass.',
            hasModelConfig ? 'muted' : 'error',
          );
          taskRunButtons(taskId).forEach((button) => { button.disabled = !hasModelConfig; });
        });
        sectionButtons.forEach((button) => { button.disabled = !hasModelConfig; });
      }

      function currentTaskStatus(taskId) {
        if (!mounted) return 'idle';
        return mounted.runtime.getTask(taskId)?.status || 'idle';
      }

      function normalizeAiKey(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      }

      function unwrapTaskResult(value) {
        let current = value;
        for (let depth = 0; depth < 3; depth += 1) {
          if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
          const keys = Object.keys(current);
          if (keys.length !== 1) return current;
          const key = normalizeAiKey(keys[0]);
          if (!['result', 'output', 'data', 'response', 'answer', 'json'].includes(key)) return current;
          current = current[keys[0]];
        }
        return current;
      }

      function findAliasedValue(obj, aliases) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
        for (const alias of aliases) {
          if (alias in obj) return obj[alias];
        }
        const normalizedAliases = aliases.map(normalizeAiKey);
        for (const [key, value] of Object.entries(obj)) {
          if (normalizedAliases.includes(normalizeAiKey(key))) return value;
        }
        return undefined;
      }

      function stringFromValue(value) {
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (Array.isArray(value)) {
          return value.map((entry) => stringFromValue(entry)).filter(Boolean).join('; ').trim();
        }
        if (value && typeof value === 'object') {
          const nested = findAliasedValue(value, ['text', 'label', 'title', 'name', 'summary', 'headline', 'value', 'item', 'reason', 'description', 'content']);
          if (nested !== undefined && nested !== value) return stringFromValue(nested);
        }
        return '';
      }

      function listFromValue(value) {
        if (Array.isArray(value)) {
          return value.map((entry) => stringFromValue(entry)).filter(Boolean);
        }
        if (typeof value === 'string') {
          const pieces = value
            .split(/\\n|•|- |\\* |; /)
            .map((entry) => entry.trim())
            .filter(Boolean);
          return pieces.length > 0 ? pieces : [value.trim()].filter(Boolean);
        }
        if (value && typeof value === 'object') {
          const nested = findAliasedValue(value, ['items', 'list', 'checklist', 'steps', 'checks', 'focus', 'focusPoints', 'requiredEvidence', 'evidenceToCollect', 'gapsToRetireFirst']);
          if (nested !== undefined && nested !== value) return listFromValue(nested);
        }
        const single = stringFromValue(value);
        return single ? [single] : [];
      }

      function enumFromValue(value, allowed) {
        const raw = stringFromValue(value);
        if (!raw) return '';
        const normalized = normalizeAiKey(raw);
        for (const entry of allowed || []) {
          if (normalizeAiKey(entry) === normalized) return entry;
        }
        const aliases = {
          automated: 'automation',
          automationcoverage: 'automation',
          testautomation: 'automation',
          endpoint: 'api',
          apiedge: 'api',
          apievidence: 'api',
          ui: 'interaction',
          interactionsurface: 'interaction',
          ux: 'interaction',
          missinggap: 'gap',
          evidencegap: 'gap',
        };
        const match = aliases[normalized];
        return match && allowed.includes(match) ? match : raw;
      }

      function coerceToSchema(schema, value, aliasesByField = {}) {
        if (!schema || typeof schema !== 'object') return value;
        if (schema.type === 'object') {
          const source = unwrapTaskResult(value);
          const out = {};
          for (const [key, childSchema] of Object.entries(schema.properties || {})) {
            const aliases = [key, ...(aliasesByField[key] || [])];
            let childValue = source && typeof source === 'object' && !Array.isArray(source)
              ? findAliasedValue(source, aliases)
              : undefined;
            if (childValue && typeof childValue === 'object' && !Array.isArray(childValue)) {
              const nestedDirectValue = findAliasedValue(childValue, [key]);
              if (nestedDirectValue !== undefined) childValue = nestedDirectValue;
            }
            if (childValue === undefined && source && typeof source === 'object' && !Array.isArray(source)) {
              const nestedObjects = Object.values(source).filter((entry) => (
                entry && typeof entry === 'object' && !Array.isArray(entry)
              ));
              if (nestedObjects.length === 1) {
                childValue = findAliasedValue(nestedObjects[0], aliases);
              }
            }
            if (childValue === undefined && source && typeof source === 'object' && !Array.isArray(source) && Object.keys(schema.properties || {}).length === 1) {
              childValue = source;
            }
            out[key] = coerceToSchema(childSchema, childValue, aliasesByField);
          }
          return out;
        }
        if (schema.type === 'array') {
          return listFromValue(value).map((entry) => coerceToSchema(schema.items, entry, aliasesByField));
        }
        if (schema.type === 'string') {
          return Array.isArray(schema.enum) && schema.enum.length > 0
            ? enumFromValue(value, schema.enum)
            : stringFromValue(value);
        }
        return value;
      }

      function createModelAdapter() {
        const baseAdapter = runtimeApi.createOpenAICompatibleModelAdapter({
          model: meta.runtime.model,
          endpoint: meta.runtime.endpoint,
          timeoutMs: meta.runtime.timeoutMs,
          ...(meta.runtime.useJsonResponseFormat ? { responseFormat: 'json_object' } : {}),
        });
        function isRetryableModelParseError(error) {
          const message = String(error?.message || error || '').toLowerCase();
          return message.includes('did not contain json')
            || message.includes('contained incomplete json')
            || message.includes('was not valid json');
        }
        const tolerantAdapter = {
          async run(request) {
            let raw;
            let lastError;
            for (let attempt = 0; attempt < 3; attempt += 1) {
              try {
                raw = await baseAdapter.run(request);
                lastError = null;
                break;
              } catch (error) {
                lastError = error;
                if (!isRetryableModelParseError(error) || attempt === 2) throw error;
                setTaskMessage(request.taskId, 'Local output was not valid JSON; retrying with the same document payload...', 'muted');
              }
            }
            if (lastError) throw lastError;
            const aliasesByField = meta.taskMeta?.[request.taskId]?.resultAliases || {};
            return coerceToSchema(request.schema, raw, aliasesByField);
          },
        };
        return runtimeApi.createQueuedModelAdapter(tolerantAdapter, { concurrency: 1 });
      }

      function attachRuntimeEvents(current) {
        current.runtime.on('task:started', (event) => {
          setTaskStatus(event.taskId, 'Running', 'running');
          setTaskMessage(event.taskId, 'Reading this section with the local model...', 'muted');
          taskRunButtons(event.taskId).forEach((button) => { button.disabled = true; });
        });
        current.runtime.on('task:succeeded', (event) => {
          const latency = event.snapshot.latencyMs ? ' in ' + event.snapshot.latencyMs + 'ms' : '';
          const successMessage = 'Section advisory updated from validated local output' + latency + '.';
          persistTaskResult(event.taskId, event.snapshot.output, successMessage);
          setTaskStatus(event.taskId, 'Ready', 'done');
          setTaskMessage(event.taskId, successMessage, 'done');
          taskRunButtons(event.taskId).forEach((button) => { button.disabled = false; });
        });
        current.runtime.on('task:failed', (event) => {
          setTaskStatus(event.taskId, 'Error', 'error');
          setTaskMessage(event.taskId, 'Section advisory failed: ' + (event.error?.message || 'AI task failed.'), 'error');
          taskRunButtons(event.taskId).forEach((button) => { button.disabled = false; });
        });
      }

      function mountFreshRuntime(options = {}) {
        const excludedTaskIds = Array.isArray(options.excludedTaskIds) ? options.excludedTaskIds : [];
        if (mounted) mounted.unmount();
        restoreAllTasks();
        mounted = runtimeApi.mountAiRenderHtml({
          spec,
          autoRun: false,
          collectSources: true,
          models: { default: createModelAdapter() },
        });
        attachRuntimeEvents(mounted);
        restorePersistedTaskResults(excludedTaskIds);
        return mounted;
      }

      function ensureRuntime(taskIdsToRun = []) {
        if (!mounted) return mountFreshRuntime();
        const shouldRemount = taskIdsToRun.some((taskId) => currentTaskStatus(taskId) === 'success');
        if (!shouldRemount) return mounted;
        taskIdsToRun.forEach((taskId) => {
          persistedTaskResults.delete(taskId);
        });
        return mountFreshRuntime({ excludedTaskIds: taskIdsToRun });
      }

      async function runTask(taskId) {
        if (!hasModelConfig) return;
        const current = ensureRuntime([taskId]);
        await current.runtime.ensureTask(taskId).catch(() => {});
      }

      async function runSection(sectionId, button) {
        if (!hasModelConfig) return;
        const sectionTaskIdsToRun = sectionTaskIds.get(sectionId) || [];
        if (sectionTaskIdsToRun.length === 0) return;
        const current = ensureRuntime(sectionTaskIdsToRun);
        if (button) button.disabled = true;
        try {
          for (const taskId of sectionTaskIdsToRun) {
            await current.runtime.ensureTask(taskId).catch(() => {});
          }
        } finally {
          if (button) button.disabled = false;
        }
      }

      sectionButtons.forEach((button) => {
        button.addEventListener('click', () => runSection(button.dataset.aiRun, button));
      });

      taskButtons.forEach((button) => {
        button.addEventListener('click', () => runTask(button.dataset.aiRunTask));
      });

      restoreAllTasks();
      if (meta.runtime?.autoRun && hasModelConfig) {
        sections.forEach((section) => {
          void runSection(section.sectionId);
        });
      }
    })();
    </script>` : ''}
${data.liveReload ? `
    <!-- ── Live reload (opt-in via liveReload: true in doc JSON) ──
         Poller asks the serving host for the current fingerprint every 20s.
         Shows a click-to-reload banner when the fingerprint changes.
         Endpoint contract: GET <location.pathname>/fingerprint
         → { "fingerprint": "sha256:..." }
         Hosts can override the URL via body[data-fingerprint-url].
         If the endpoint is unavailable the poller fails silently. -->
    <div id="ld-reload-banner" role="status" aria-live="polite" hidden>
      <span class="ld-reload-dot" aria-hidden="true"></span>
      <span>Doc updated &mdash; reload</span>
    </div>
    <style>
      #ld-reload-banner {
        position: fixed; right: 20px; bottom: 20px; z-index: 9999;
        display: inline-flex; align-items: center; gap: 10px;
        padding: 10px 16px; border-radius: 999px;
        background: var(--accent, #2563eb); color: #fff;
        font: 600 13px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
        box-shadow: 0 6px 20px rgba(15, 23, 42, 0.20);
        cursor: pointer; border: none;
        transition: transform 0.15s, box-shadow 0.15s;
      }
      #ld-reload-banner:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(15, 23, 42, 0.24); }
      #ld-reload-banner[hidden] { display: none; }
      #ld-reload-banner .ld-reload-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #bbf7d0;
        animation: ld-reload-pulse 2s infinite;
      }
      @keyframes ld-reload-pulse {
        0%   { box-shadow: 0 0 0 0 rgba(187, 247, 208, 0.7); }
        70%  { box-shadow: 0 0 0 10px rgba(187, 247, 208, 0); }
        100% { box-shadow: 0 0 0 0 rgba(187, 247, 208, 0); }
      }
    </style>
    <script>
    (() => {
      const banner = document.getElementById('ld-reload-banner');
      if (!banner) return;
      banner.addEventListener('click', () => location.reload());

      // Skip on file:// — location.origin is "null" and any fetch under that
      // origin trips a browser console warning without ever succeeding.
      // Polling only makes sense when served over http(s).
      if (location.protocol === 'file:') return;

      let current;
      try {
        const meta = JSON.parse(document.getElementById('doc-meta').textContent);
        current = meta.metaFingerprint;
      } catch (e) { /* no doc-meta — bail */ }
      if (!current) return;

      const override = document.body && document.body.dataset.fingerprintUrl;
      const endpoint = override || (location.origin + location.pathname + '/fingerprint');
      let done = false;

      async function check() {
        if (done) return;
        try {
          const r = await fetch(endpoint, { cache: 'no-store' });
          if (!r.ok) return;
          const j = await r.json();
          if (j.fingerprint && j.fingerprint !== current) {
            banner.hidden = false;
            done = true;
          }
        } catch (e) { /* endpoint unavailable — silent */ }
      }

      const timer = setInterval(check, 20000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('beforeunload', () => clearInterval(timer));
    })();
    </script>` : ''}
${updateSource ? `
    <!-- ── Latest artifact refresh (opt-in via updateSource.manifestUrl) ──
         Checks a remote manifest for a newer committed version of this doc.
         On plain file:// docs, refresh means "open the latest artifact" rather
         than pretending the local file can be overwritten in place. -->
    <div id="ld-update-banner" role="status" aria-live="polite" hidden>
      <span class="ld-update-dot" aria-hidden="true"></span>
      <span>
        Update available
        <span class="ld-update-version" data-update-version></span>
      </span>
      <button type="button" class="ld-update-action" data-update-action>Refresh</button>
    </div>
    <style>
      #ld-update-banner {
        position: fixed; left: 20px; bottom: 20px; z-index: 9998;
        display: inline-flex; align-items: center; gap: 12px;
        padding: 10px 14px; border-radius: 999px;
        background: #0f172a; color: #fff;
        font: 600 13px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
        box-shadow: 0 6px 20px rgba(15, 23, 42, 0.20);
      }
      #ld-update-banner[hidden] { display: none; }
      #ld-update-banner .ld-update-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #fbbf24;
        animation: ld-update-pulse 2s infinite;
      }
      #ld-update-banner .ld-update-version {
        color: rgba(255, 255, 255, 0.82);
        margin-left: 4px;
      }
      #ld-update-banner .ld-update-action {
        appearance: none;
        border: none;
        border-radius: 999px;
        padding: 7px 12px;
        background: #f8fafc;
        color: #0f172a;
        font: inherit;
        cursor: pointer;
      }
      #ld-update-banner .ld-update-action:hover { background: #e2e8f0; }
      @keyframes ld-update-pulse {
        0%   { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.55); }
        70%  { box-shadow: 0 0 0 10px rgba(251, 191, 36, 0); }
        100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0); }
      }
    </style>
    <script>
    (() => {
      const banner = document.getElementById('ld-update-banner');
      const action = banner?.querySelector('[data-update-action]');
      const versionLabel = banner?.querySelector('[data-update-version]');
      if (!banner || !action || !versionLabel) return;

      let latest = null;

      function normalizeManifestEntry(payload, docId) {
        if (!payload || typeof payload !== 'object') return null;
        if (payload.docs && docId && typeof payload.docs === 'object') {
          const nested = payload.docs[docId];
          return nested && typeof nested === 'object' ? nested : null;
        }
        if (!payload.docId || !docId || payload.docId === docId) return payload;
        return null;
      }

      action.addEventListener('click', () => {
        if (!latest?.htmlUrl) return;
        location.href = latest.htmlUrl;
      });

      async function check() {
        let meta;
        try {
          meta = JSON.parse(document.getElementById('doc-meta').textContent);
        } catch (e) { return; }

        const manifestUrl = String(meta?.updateSource?.manifestUrl ?? '').trim();
        if (!manifestUrl) return;

        const currentDocId = String(meta.docId ?? '').trim();
        const currentVersion = String(meta.version ?? meta.metaFingerprint ?? '').trim();

        try {
          const response = await fetch(manifestUrl, { cache: 'no-store' });
          if (!response.ok) return;
          const payload = await response.json();
          const entry = normalizeManifestEntry(payload, currentDocId);
          if (!entry) return;

          const nextVersion = String(entry.version ?? '').trim();
          const htmlUrl = String(entry.htmlUrl ?? '').trim();
          if (!nextVersion || !htmlUrl || nextVersion === currentVersion) return;

          latest = { version: nextVersion, htmlUrl };
          versionLabel.textContent = '(' + (currentVersion || 'current') + ' → ' + nextVersion + ')';
          banner.hidden = false;
        } catch (e) { /* remote manifest unavailable — silent */ }
      }

      check();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    })();
    </script>` : ''}
  </body>
</html>
`;

await writeFile(htmlPath, html.replace(/[ \t]+$/gm, ''));
const relDoc = path.relative(process.cwd(), resolvedDocPath);
const relHtml = path.relative(process.cwd(), htmlPath);
console.log(`Wrote ${relHtml} from ${relDoc}`);

if (shouldCommit) {
  const repoRoot = resolveRepoRootForPath(resolvedDocPath);
  if (!repoRoot) {
    throw new Error(`Cannot --commit because ${resolvedDocPath} is not inside a git repository.`);
  }
  await commitRenderedDoc({
    repoRoot,
    resolvedDocPath,
    htmlPath,
    title: String(data?.title ?? '').trim(),
    commitMessageOverride: commitMessageOverride.trim(),
  });
}
