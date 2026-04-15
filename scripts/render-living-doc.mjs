#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncCompositorEmbeds } from './sync-compositor-embeds.mjs';

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
await syncCompositorEmbeds();
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const i18n = JSON.parse(await readFile(i18nPath, 'utf8'));
const compositorHtml = await readFile(compositorPath, 'utf8');
const data = JSON.parse(await readFile(resolvedDocPath, 'utf8'));
const snapshotGeneratedAt = new Date().toISOString();
const defaultCanonicalOrigin = path.relative(process.cwd(), resolvedDocPath) || resolvedDocPath;

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

function buildSnapshotMeta(doc) {
  return {
    docId: readDocField(doc, 'docId', ['id']) || `doc:${slugifyValue(path.basename(resolvedDocPath, path.extname(resolvedDocPath))) || 'living-doc'}`,
    title: String(doc?.title ?? '').trim() || 'Untitled Living Doc',
    scope: readDocField(doc, 'scope', ['docScope']),
    owner: readDocField(doc, 'owner', ['owningTeam']),
    generatedAt: snapshotGeneratedAt,
    version: readDocField(doc, 'version', ['revision']),
    canonicalOrigin: readDocField(doc, 'canonicalOrigin', ['canonicalUrl']) || defaultCanonicalOrigin,
    derivedFrom: readDocField(doc, 'derivedFrom', ['derivedFromSnapshot', 'derivedFromVersion']),
    sourceCoverage: readDocField(doc, 'sourceCoverage') || describeSourceCoverage(doc?.syncHints),
  };
}

function renderSnapshotPanel(meta) {
  const renderValue = (value, options = {}) => {
    if (!value) return '<span class="snapshot-missing">Unknown</span>';
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
        <span class="snapshot-pill">HTML Snapshot</span>
      </div>
      <p class="snapshot-note">This standalone HTML is a shareable snapshot and may drift from its canonical origin.</p>
      <div class="snapshot-grid">
        ${item('Doc ID', meta.docId, { code: true })}
        ${item('Title', meta.title)}
        ${item('Scope', meta.scope)}
        ${item('Owner / Team', meta.owner)}
        ${item('Generated', meta.generatedAt, { time: true, relativeToSnapshot: false, snapshotAnchor: true })}
        ${item('Version / Revision', meta.version, { code: true })}
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
    .map((tf) => `<p class="code-refs"><strong>${escapeHtml(tf.label)}</strong> ${renderInlineText(item[tf.key])}</p>`)
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

function renderSection(section) {
  const ct = registry.convergenceTypes[section.convergenceType];
  if (!ct) return `<!-- unknown convergence type: ${escapeHtml(section.convergenceType)} -->`;
  const projection = ct.projection;
  const iconColorStyle = ct.iconColor ? ` style="color:${escapeHtml(ct.iconColor)}"` : '';

  const icon = ct.icon
    ? `<svg class="section-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"${iconColorStyle}>${ct.icon}</svg>`
    : '';

  const items = section.data ?? [];

  // Callout
  const calloutHtml = section.callout ? renderCallout(section.callout) : '';

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
    contentHtml = `<div class="card-grid" style="--grid-cols:${escapeHtml(String(cols))}">${items.map((item) => renderCardItem(item, section.convergenceType)).join('')}</div>`;
  } else if (projection === 'edge-table') {
    contentHtml = renderEdgeTable(items, section.convergenceType);
  }

  const sectionUpdated = section.updated
    ? `<span style="font-size:12px;font-weight:500;color:var(--muted);margin-left:auto">${timestampHtml(section.updated)}</span>`
    : '';

  return `
    <section class="section${projection === 'edge-table' ? ' table-card' : ''}" id="${escapeHtml(section.id)}">
      <h2>${icon} ${escapeHtml(section.title)}${sectionUpdated}</h2>
      ${calloutHtml}
      ${statsHtml}
      ${pillsHtml}
      ${contentHtml}
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
const snapshotMeta = buildSnapshotMeta(data);
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

await writeFile(htmlPath, html.replace(/[ \t]+$/gm, ''));
const relDoc = path.relative(process.cwd(), resolvedDocPath);
const relHtml = path.relative(process.cwd(), htmlPath);
console.log(`Wrote ${relHtml} from ${relDoc}`);
