#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(__dirname, 'living-doc-registry.json');
const i18nPath = path.join(__dirname, 'living-doc-i18n.json');
const compositorPath = path.join(__dirname, '..', 'docs', 'living-doc-compositor.html');

/* ── Load registry + doc ── */

const docPath = process.argv[2];
if (!docPath) {
  console.error('Usage: render-living-doc.mjs <doc.json>');
  process.exit(1);
}

const resolvedDocPath = path.resolve(docPath);
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const i18n = JSON.parse(await readFile(i18nPath, 'utf8'));
const compositorHtml = await readFile(compositorPath, 'utf8');
const data = JSON.parse(await readFile(resolvedDocPath, 'utf8'));

// Version from git
let buildVersion = 'dev';
try {
  const hash = execSync('git rev-parse --short HEAD', { cwd: __dirname, encoding: 'utf8' }).trim();
  const date = new Date().toISOString().slice(0, 10);
  buildVersion = `v0.1.0-${hash} (${date})`;
} catch {};
const htmlPath = resolvedDocPath.replace(/\.json$/, '.html');

/* ── Helpers ── */

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  let relative;
  if (diffMin < 1) relative = 'just now';
  else if (diffMin < 60) relative = `${diffMin}m ago`;
  else if (diffHr < 24) relative = `${diffHr}h ago`;
  else if (diffDay < 7) relative = `${diffDay}d ago`;
  else relative = date.toISOString().slice(0, 10);
  return relative;
}

function timestampHtml(value) {
  if (!value) return '';
  const display = formatTimestamp(value);
  const iso = new Date(value).toISOString?.() ?? value;
  return `<time datetime="${escapeHtml(iso)}" title="${escapeHtml(iso)}">${escapeHtml(display)}</time>`;
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

/* ── Entity reference rendering ── */

function figmaNodeHref(nodeId) {
  const url = data.figma?.canonicalUrl ?? '';
  return `${url}?node-id=${encodeURIComponent(String(nodeId).replace(':', '-'))}&m=dev`;
}

function repoHref(relativePath) {
  return relativePath ? `../${relativePath}` : null;
}

// Lookup maps for resolvable entity types
const lookupMaps = {};
function buildLookup(key, items) {
  if (!lookupMaps[key] && Array.isArray(items)) {
    lookupMaps[key] = new Map(items.map((item) => [item.id, item]));
  }
  return lookupMaps[key] ?? new Map();
}

// Build all lookups from data
if (data.interactionSurfaces) buildLookup('interaction-surface', data.interactionSurfaces);
if (data.specReferences) buildLookup('ux-spec', data.specReferences);
if (data.flows) buildLookup('flow-ref', data.flows);

function renderEntityRef(entityType, value) {
  switch (entityType) {
    case 'figma-page':
    case 'figma-node':
      return `<a href="${escapeHtml(figmaNodeHref(value))}"><code>${escapeHtml(value)}</code></a>`;
    case 'code-file':
    case 'workflow': {
      const href = repoHref(value);
      return href
        ? `<a href="${escapeHtml(href)}"><code>${escapeHtml(value)}</code></a>`
        : `<code>${escapeHtml(value)}</code>`;
    }
    case 'api-endpoint':
      return `<code>${escapeHtml(value)}</code>`;
    case 'ticket': {
      if (typeof value === 'object' && value.issueUrl) {
        return `<a href="${escapeHtml(value.issueUrl)}"><code>#${escapeHtml(value.issueNumber)}</code></a>`;
      }
      return `<code>${escapeHtml(value)}</code>`;
    }
    case 'ux-spec': {
      const map = lookupMaps['ux-spec'];
      const spec = map?.get(value);
      if (!spec) return `<code>${escapeHtml(value)}</code>`;
      const issue = `<a href="${escapeHtml(spec.issueUrl)}"><code>#${escapeHtml(spec.issueNumber)}</code></a>`;
      const artifact = spec.localArtifactPath
        ? ` <a href="${escapeHtml(repoHref(spec.localArtifactPath))}"><code>spec</code></a>`
        : '';
      return `${issue}${artifact}`;
    }
    case 'interaction-surface': {
      const map = lookupMaps['interaction-surface'];
      const surface = map?.get(value);
      if (!surface) return `<code>${escapeHtml(value)}</code>`;
      return `<a href="#interaction-${escapeHtml(surface.id)}"><code>${escapeHtml(surface.name)}</code></a>`;
    }
    case 'flow-ref': {
      const map = lookupMaps['flow-ref'];
      const flow = map?.get(value);
      if (!flow) return `<code>${escapeHtml(value)}</code>`;
      return `<a href="#flow-${escapeHtml(flow.id)}"><code>${escapeHtml(flow.name)}</code></a>`;
    }
    default:
      return `<code>${escapeHtml(value)}</code>`;
  }
}

function renderRefList(values, entityType, label) {
  if (!values || values.length === 0) return '';
  const refs = values.map((v) => renderEntityRef(entityType, v)).join(' ');
  return `<div class="flow-meta"><strong>${escapeHtml(label)}</strong> ${refs}</div>`;
}

function renderPathLinks(paths) {
  if (!paths || paths.length === 0) return '<span>None yet</span>';
  return paths.map((p) => renderEntityRef('code-file', p)).join(' ');
}

function renderNotes(items) {
  if (!items || items.length === 0) return '';
  return `<ul class="notes">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderDetails(items, label) {
  if (!items || items.length === 0) return '';
  return `
    <details class="details-block">
      <summary>${escapeHtml(label)} (${items.length})</summary>
      ${renderNotes(items)}
    </details>`;
}

/* ── Convergence type renderers ── */

function renderCardItem(item, convergenceType) {
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
    .map((tf) => `<p class="code-refs"><strong>${escapeHtml(tf.label)}</strong> ${escapeHtml(item[tf.key])}</p>`)
    .join('');

  // Details fields
  const detailsHtml = (ct.detailsFields ?? [])
    .filter((df) => item[df.key] && item[df.key].length > 0)
    .map((df) => renderDetails(item[df.key], df.label))
    .join('');

  // Item-level ID for anchoring
  const anchorId = item.id ? ` id="${escapeHtml(item.id)}"` : '';

  return `
    <article class="flow-card"${anchorId}>
      <header class="flow-card-header">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
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
      const aHtml = item[a.displayKey]
        ? `<a href="${escapeHtml(figmaNodeHref(item[a.key]))}">${escapeHtml(item[a.displayKey])}</a><br /><code>${escapeHtml(item[a.key])}</code>`
        : renderEntityRef(a.entityType, item[a.key]);
      const bVal = item[b.key];
      const bHtml = bVal
        ? renderEntityRef(b.entityType, bVal)
        : '<span>None yet</span>';
      const statusHtml = ct.edgeStatus
        ? badge(toTitleCase(item[ct.edgeStatus.key]), tone(ct.edgeStatus.statusSet, item[ct.edgeStatus.key]))
        : '';
      const notesHtml = ct.edgeNotes && item[ct.edgeNotes.key]
        ? item[ct.edgeNotes.key].map((n) => escapeHtml(n)).join('<br />')
        : '';
      return `<tr><td>${aHtml}</td><td>${bHtml}</td><td>${statusHtml}</td><td>${notesHtml}</td></tr>`;
    })
    .join('');

  return `
    <table class="full-table">
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderSection(section) {
  const ct = registry.convergenceTypes[section.convergenceType];
  if (!ct) return `<!-- unknown convergence type: ${escapeHtml(section.convergenceType)} -->`;

  const icon = ct.icon
    ? `<svg class="section-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">${ct.icon}</svg>`
    : '';

  const items = section.data ?? [];

  // Callout
  const calloutHtml = section.callout
    ? `<section class="callout">${section.callout.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</section>`
    : '';

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
  if (ct.projection === 'card-grid') {
    const cols = ct.columns ?? 2;
    const gridClass = cols === 2 ? 'flows-grid' : 'pages-grid';
    contentHtml = `<div class="${gridClass}">${items.map((item) => renderCardItem(item, section.convergenceType)).join('')}</div>`;
  } else if (ct.projection === 'edge-table') {
    contentHtml = renderEdgeTable(items, section.convergenceType);
  }

  const sectionUpdated = section.updated
    ? `<span style="font-size:12px;font-weight:500;color:var(--muted);margin-left:auto">${timestampHtml(section.updated)}</span>`
    : '';

  return `
    <section class="section${ct.projection === 'edge-table' ? ' table-card' : ''}" id="${escapeHtml(section.id)}">
      <h2>${icon} ${escapeHtml(section.title)}${sectionUpdated}</h2>
      ${calloutHtml}
      ${statsHtml}
      ${pillsHtml}
      ${contentHtml}
    </section>`;
}

/* ── Sidebar ── */

function buildSidebar(sections) {
  return sections.map((section) => {
    const ct = registry.convergenceTypes[section.convergenceType];
    const icon = ct?.icon ?? '';
    return `
      <a href="#${escapeHtml(section.id)}" class="nav-icon" data-target="${escapeHtml(section.id)}" aria-label="${escapeHtml(section.title)}">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">${icon}</svg>
        <span class="nav-tooltip">${escapeHtml(section.title)}</span>
      </a>`;
  }).join('');
}

/* ── Assemble HTML ── */

const sections = data.sections ?? [];
const metaJson = JSON.stringify(data, null, 2).replace(/<\/script/gi, '<\\/script');
const registryJson = JSON.stringify(registry, null, 2).replace(/<\/script/gi, '<\\/script');
const i18nJson = JSON.stringify(i18n, null, 2).replace(/<\/script/gi, '<\\/script');

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
        color: var(--muted); transition: background 0.15s, color 0.15s;
        text-decoration: none; flex-shrink: 0;
      }
      .nav-icon:hover { background: var(--neutral-bg); color: var(--ink); text-decoration: none; }
      .nav-icon.active { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
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
      .pill-row, .badge-row, .meta-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .meta-row { color: var(--muted); font-size: 13px; gap: 12px; }
      .pill {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 5px 12px; border-radius: 999px;
        background: var(--card); border: 1px solid var(--line);
        box-shadow: var(--shadow-sm); color: var(--muted); font-size: 12.5px; font-weight: 500;
      }
      .section { margin-top: 48px; padding-top: 36px; border-top: 1px solid var(--line); }
      .section:first-of-type { border-top: none; padding-top: 0; }
      .section h2 {
        margin: 0 0 20px; font-size: 19px; font-weight: 700; letter-spacing: -0.01em;
        display: flex; align-items: center; gap: 10px;
      }
      .section-icon { color: var(--muted); flex-shrink: 0; }
      .callout {
        margin-top: 20px; padding: 16px 20px; border-radius: var(--radius);
        border: 1px solid var(--line); background: var(--card); box-shadow: var(--shadow-sm);
      }
      .callout p { margin: 0 0 8px; line-height: 1.55; }
      .callout p:last-child { margin-bottom: 0; }
      .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin-top: 20px; }
      .stat-card, .flow-card, .page-card, .table-card {
        background: var(--card); border: 1px solid var(--line);
        border-radius: var(--radius); padding: 18px 20px; box-shadow: var(--shadow-sm);
      }
      .stat-card { padding: 20px; }
      .stat-card h3 { margin: 0; font-size: 12.5px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
      .stat-card .value { margin-top: 6px; font-size: 32px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
      .flows-grid, .pages-grid, .integration-grid, .interaction-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
      .flow-card-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
      h3 { margin: 0; font-size: 15px; font-weight: 650; }
      .notes { margin: 10px 0 0 18px; padding: 0; color: var(--muted); font-size: 14px; line-height: 1.5; }
      .notes li { margin-bottom: 4px; }
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
        .flows-grid, .pages-grid { grid-template-columns: 1fr; }
      }
      /* ── Compositor overlay ── */
      .comp-toggle {
        margin-top: auto; width: 40px; height: 40px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        color: var(--muted); cursor: pointer; transition: all 0.15s; flex-shrink: 0;
      }
      .comp-toggle:hover { background: var(--neutral-bg); color: var(--ink); }
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
      @media (max-width: 720px) {
        .sidebar { display: none; }
        .comp-panel { display: none; }
        .content { margin-left: 0; }
        .wrap { padding: 20px 16px 48px; }
        .summary-grid { grid-template-columns: 1fr; }
        h1 { font-size: 24px; }
      }
    </style>
  </head>
  <body>
    <script type="application/json" id="doc-meta">${metaJson}</script>

    <nav class="sidebar" aria-label="Section navigation">
      <div class="brand">${escapeHtml(data.brand ?? 'LD')}</div>
      ${buildSidebar(sections)}
      <div class="comp-toggle" id="comp-toggle" title="Open compositor">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
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
        </header>

        ${data.objective ? `
        <section class="callout" style="border-left:3px solid var(--accent)">
          <p><strong>Objective</strong> ${escapeHtml(data.objective)}</p>
          ${data.successCondition ? `<p style="color:var(--muted)"><strong>Success condition</strong> ${escapeHtml(data.successCondition)}</p>` : ''}
          ${data.syncHints ? `<p style="color:var(--muted);font-size:13px"><strong>Scope</strong> ${Object.entries(data.syncHints).map(([k, v]) => `<code>${escapeHtml(k)}: ${escapeHtml(v)}</code>`).join(' ')}</p>` : ''}
        </section>` : ''}

        ${(data.callouts ?? []).map((c) => `
        <section class="callout">
          ${c.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
        </section>`).join('')}

        ${sections.map(renderSection).join('')}

        ${data.source ? `<p class="footnote">Source: ${escapeHtml(data.source)}</p>` : ''}
        <p class="footnote" style="margin-top:${data.source ? '8px' : '40px'}">Living Doc Compositor ${escapeHtml(buildVersion)}</p>
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
      // Compositor toggle — opens the full tool as an overlay
      const compOverlay = document.getElementById('comp-overlay');
      const compToggle = document.getElementById('comp-toggle');
      const compIframe = document.getElementById('comp-iframe');

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

      // Auto-open compositor if document has no sections
      const docSections = JSON.parse(document.getElementById('doc-meta').textContent).sections || [];
      if (docSections.length === 0) {
        compOverlay.classList.add('open');
      }
    })();
    </script>

  </body>
</html>
`;

await writeFile(htmlPath, html);
const relDoc = path.relative(process.cwd(), resolvedDocPath);
const relHtml = path.relative(process.cwd(), htmlPath);
console.log(`Wrote ${relHtml} from ${relDoc}`);
