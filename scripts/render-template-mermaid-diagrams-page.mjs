#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const graphPath = path.join(repoRoot, 'scripts/generated/living-doc-template-graphs.json');
const diagramPath = path.join(repoRoot, 'scripts/generated/living-doc-template-diagrams.json');
const outPath = path.join(repoRoot, 'docs/living-doc-template-mermaid-diagrams.html');

const graph = JSON.parse(await readFile(graphPath, 'utf8'));
const diagrams = JSON.parse(await readFile(diagramPath, 'utf8'));

const templates = Object.entries(diagrams.templates || {})
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([templateId, diagram]) => ({
    templateId,
    diagram,
    graph: graph.templates?.[templateId] || {},
  }));

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Living Doc Template Mermaid Diagrams</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #171b22;
      --muted: #5d6675;
      --line: #d9dee7;
      --accent: #1f6feb;
      --accent-2: #0d9488;
      --node: #fbfcff;
      --node-stroke: #bdc7d6;
      --code: #101828;
      --code-bg: #f1f4f8;
      --shadow: 0 14px 38px rgba(20, 31, 48, 0.08);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      padding: 28px clamp(20px, 5vw, 64px) 18px;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
    }
    h1 {
      margin: 0;
      font-size: clamp(28px, 4vw, 44px);
      line-height: 1.05;
      letter-spacing: 0;
    }
    .lead {
      max-width: 980px;
      margin: 12px 0 0;
      color: var(--muted);
      font-size: 16px;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 18px;
    }
    .pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 5px 10px;
      background: #fff;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    main {
      display: grid;
      grid-template-columns: minmax(180px, 260px) minmax(0, 1fr);
      gap: 22px;
      padding: 22px clamp(20px, 5vw, 64px) 56px;
    }
    nav {
      position: sticky;
      top: 18px;
      align-self: start;
      max-height: calc(100vh - 36px);
      overflow: auto;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 12px;
    }
    nav h2 {
      margin: 0 0 8px;
      font-size: 13px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    nav a {
      display: block;
      padding: 7px 8px;
      color: var(--ink);
      text-decoration: none;
      border-radius: 6px;
      overflow-wrap: anywhere;
    }
    nav a:hover { background: #eef4ff; color: var(--accent); }
    .stack { display: grid; gap: 22px; }
    article {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .card-head {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      justify-content: space-between;
      padding: 18px 20px 12px;
      border-bottom: 1px solid var(--line);
    }
    h2 {
      margin: 0;
      font-size: 22px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .template-id {
      margin-top: 3px;
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
    }
    .counts {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
      min-width: 160px;
    }
    .count {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 4px 8px;
      color: var(--muted);
      background: #fafbfc;
      font-size: 12px;
    }
    .diagram-wrap {
      padding: 18px 20px 20px;
      overflow-x: auto;
      background:
        linear-gradient(#fff, #fff) padding-box,
        repeating-linear-gradient(90deg, rgba(31,111,235,.05) 0, rgba(31,111,235,.05) 1px, transparent 1px, transparent 32px),
        repeating-linear-gradient(0deg, rgba(31,111,235,.05) 0, rgba(31,111,235,.05) 1px, transparent 1px, transparent 32px);
    }
    svg.template-diagram {
      display: block;
      min-width: 760px;
      width: 100%;
      height: auto;
    }
    details {
      border-top: 1px solid var(--line);
      background: #fbfcfe;
    }
    summary {
      cursor: pointer;
      padding: 12px 20px;
      color: var(--accent);
      font-weight: 650;
    }
    pre {
      margin: 0;
      padding: 0 20px 18px;
      overflow-x: auto;
    }
    code {
      display: block;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--code-bg);
      color: var(--code);
      padding: 14px;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      white-space: pre;
    }
    .node-title {
      font-weight: 700;
      fill: #172033;
      font-size: 13px;
    }
    .node-role {
      fill: #536071;
      font-size: 11px;
    }
    .edge-label {
      fill: #324055;
      font-size: 11px;
      paint-order: stroke;
      stroke: white;
      stroke-width: 5px;
      stroke-linejoin: round;
    }
    @media (max-width: 900px) {
      main { grid-template-columns: 1fr; }
      nav { position: static; max-height: none; }
      .card-head { display: block; }
      .counts { justify-content: flex-start; margin-top: 12px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Living Doc Template Mermaid Diagrams</h1>
    <p class="lead">Generated from <code style="display:inline;padding:2px 5px">scripts/generated/living-doc-template-diagrams.json</code>. Each visual is rendered from the same section and relationship graph that emits the Mermaid source shown below it.</p>
    <div class="meta">
      <span class="pill">${templates.length} templates</span>
      <span class="pill">${escapeHtml(diagrams.schema)}</span>
      <span class="pill">Generated from ${escapeHtml(diagrams.generatedFrom)}</span>
    </div>
  </header>
  <main>
    <nav aria-label="Template diagrams">
      <h2>Templates</h2>
      ${templates.map(({ templateId, diagram }) => `<a href="#${escapeAttribute(templateId)}">${escapeHtml(diagram.name || templateId)}</a>`).join('\n      ')}
    </nav>
    <div class="stack">
      ${templates.map(renderTemplate).join('\n')}
    </div>
  </main>
</body>
</html>
`;

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, html);
console.log(`Wrote ${path.relative(repoRoot, outPath)}`);

function renderTemplate({ templateId, diagram, graph: templateGraph }) {
  const sections = templateGraph.sections || [];
  const relationships = templateGraph.relationships || [];
  return `<article id="${escapeAttribute(templateId)}">
    <div class="card-head">
      <div>
        <h2>${escapeHtml(diagram.name || templateId)}</h2>
        <div class="template-id">${escapeHtml(templateId)}</div>
      </div>
      <div class="counts">
        <span class="count">${sections.length} sections</span>
        <span class="count">${relationships.length} relationships</span>
      </div>
    </div>
    <div class="diagram-wrap">
      ${renderSvg(templateGraph)}
    </div>
    <details>
      <summary>Mermaid source</summary>
      <pre><code>${escapeHtml(diagram.mermaid || '')}</code></pre>
    </details>
  </article>`;
}

function renderSvg(templateGraph) {
  const sections = templateGraph.sections || [];
  const relationships = templateGraph.relationships || [];
  const nodeWidth = 250;
  const nodeHeight = 86;
  const columnGap = 118;
  const rowGap = 30;
  const margin = 38;
  const depths = computeDepths(sections, relationships);
  const groups = new Map();

  for (const section of sections) {
    const depth = depths.get(section.convergenceType) || 0;
    groups.set(depth, [...(groups.get(depth) || []), section]);
  }

  const sortedDepths = [...groups.keys()].sort((a, b) => a - b);
  const positions = new Map();
  let maxRows = 1;
  for (const depth of sortedDepths) {
    const group = groups.get(depth);
    maxRows = Math.max(maxRows, group.length);
    group.forEach((section, index) => {
      const x = margin + depth * (nodeWidth + columnGap);
      const y = margin + index * (nodeHeight + rowGap);
      positions.set(section.convergenceType, { x, y, section });
    });
  }

  const width = margin * 2 + sortedDepths.length * nodeWidth + Math.max(0, sortedDepths.length - 1) * columnGap;
  const height = margin * 2 + maxRows * nodeHeight + Math.max(0, maxRows - 1) * rowGap;
  const markerId = `arrow-${stableId(templateGraph.id || templateGraph.name || 'template')}`;

  const edges = relationships.map((relationship) => {
    const from = positions.get(relationship.from);
    const to = positions.get(relationship.to);
    if (!from || !to) return '';
    const startX = from.x + nodeWidth;
    const startY = from.y + nodeHeight / 2;
    const endX = to.x;
    const endY = to.y + nodeHeight / 2;
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const controlOffset = Math.max(48, Math.abs(endX - startX) * 0.42);
    return `<path d="M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX - 9} ${endY}" fill="none" stroke="#7890ad" stroke-width="1.8" marker-end="url(#${markerId})"/>
      <text class="edge-label" x="${midX}" y="${midY - 8}" text-anchor="middle">${escapeHtml(relationship.relation || '')}</text>`;
  }).join('\n');

  const nodes = sections.map((section) => {
    const pos = positions.get(section.convergenceType);
    const titleLines = wrapText(section.convergenceType, 24, 2);
    const roleLines = wrapText(section.role || '', 48, 3);
    return `<g>
      <rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}" rx="8" fill="var(--node)" stroke="var(--node-stroke)" stroke-width="1.4"/>
      ${titleLines.map((line, index) => `<text class="node-title" x="${pos.x + 14}" y="${pos.y + 22 + index * 15}">${escapeHtml(line)}</text>`).join('\n')}
      ${roleLines.map((line, index) => `<text class="node-role" x="${pos.x + 14}" y="${pos.y + 52 + index * 13}">${escapeHtml(line)}</text>`).join('\n')}
    </g>`;
  }).join('\n');

  return `<svg class="template-diagram" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttribute(templateGraph.name || 'Template relationship diagram')}">
    <defs>
      <marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#7890ad"></path>
      </marker>
    </defs>
    ${edges}
    ${nodes}
  </svg>`;
}

function computeDepths(sections, relationships) {
  const typeIds = sections.map((section) => section.convergenceType);
  const depths = new Map(typeIds.map((id) => [id, 0]));
  for (let i = 0; i < typeIds.length; i += 1) {
    let changed = false;
    for (const relationship of relationships) {
      if (!depths.has(relationship.from) || !depths.has(relationship.to)) continue;
      const nextDepth = Math.max(depths.get(relationship.to), depths.get(relationship.from) + 1);
      if (nextDepth !== depths.get(relationship.to)) {
        depths.set(relationship.to, nextDepth);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depths;
}

function wrapText(value, width, maxLines) {
  const words = String(value || '').split(/[\s-]+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function stableId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
