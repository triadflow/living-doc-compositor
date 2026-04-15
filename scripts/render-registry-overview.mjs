#!/usr/bin/env node
import { access, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const registryPath = path.join(__dirname, 'living-doc-registry.json');
const defaultOutputPath = path.join(repoRoot, 'docs', 'living-doc-registry-overview.html');
const DEFAULT_CATALOG_PATH = process.env.LIVING_DOC_CATALOG_PATH || path.join(os.homedir(), '.gtd', 'living-docs.json');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatKey(value) {
  return String(value ?? '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderPill(text, tone = '') {
  const className = tone ? `pill ${tone}` : 'pill';
  return `<span class="${className}">${escapeHtml(text)}</span>`;
}

function renderList(items, className = 'stack-list') {
  if (!items?.length) return '<p class="empty">None</p>';
  return `<ul class="${className}">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function entityLabel(registry, entityType) {
  if (!entityType) return 'Inline note';
  return registry.entityTypes?.[entityType]?.label ?? formatKey(entityType);
}

function renderSources(registry, ct) {
  let items = [];
  if (ct.sources?.length) {
    items = ct.sources.map((source) => {
      const label = source.label ?? entityLabel(registry, source.entityType);
      const entity = entityLabel(registry, source.entityType);
      const extra = [];
      if (source.key) extra.push(renderPill(source.key, 'neutral'));
      if (source.resolve) extra.push('resolved');
      return `
        <li>
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(entity)}</span>
          ${extra.length ? `<div class="mini-row">${extra.map((part) => typeof part === 'string' && part === 'resolved' ? renderPill('resolved', 'neutral') : part).join('')}</div>` : ''}
        </li>
      `;
    });
  } else {
    const edgeSources = [];
    if (ct.sourceA) edgeSources.push({ side: 'Source A', ...ct.sourceA });
    if (ct.sourceB) edgeSources.push({ side: 'Source B', ...ct.sourceB });
    items = edgeSources.map((source) => {
      const entity = entityLabel(registry, source.entityType);
      const extra = [];
      if (source.key) extra.push(renderPill(source.key, 'neutral'));
      if (source.displayKey) extra.push(renderPill(`display ${source.displayKey}`, 'neutral'));
      return `
        <li>
          <strong>${escapeHtml(source.side)}</strong>
          <span>${escapeHtml(entity)}</span>
          ${extra.length ? `<div class="mini-row">${extra.join('')}</div>` : ''}
        </li>
      `;
    });
  }

  if (!items.length) return '<p class="empty">No sources</p>';
  return `<ul class="source-list">${items.join('')}</ul>`;
}

function renderStatusFields(registry, ct) {
  const fields = [];
  for (const field of ct.statusFields ?? []) {
    fields.push({
      key: field.key,
      statusSet: field.statusSet,
    });
  }
  if (ct.edgeStatus) {
    fields.push({
      key: ct.edgeStatus.key,
      statusSet: ct.edgeStatus.statusSet,
    });
  }
  if (!fields.length) return '<p class="empty">No status fields</p>';
  return `<ul class="stack-list">${fields.map((field) => {
    const statusDef = registry.statusSets?.[field.statusSet];
    const valueCount = statusDef?.values?.length ?? 0;
    return `<li><strong><code>${escapeHtml(field.key)}</code></strong><span>${escapeHtml(formatKey(field.statusSet))}</span><div class="mini-row">${renderPill(pluralize(valueCount, 'value'), 'neutral')}</div></li>`;
  }).join('')}</ul>`;
}

function renderFieldList(fields, emptyLabel) {
  if (!fields?.length) return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
  return `<ul class="stack-list">${fields.map((field) => `<li><strong>${escapeHtml(field.label ?? formatKey(field.key))}</strong><span><code>${escapeHtml(field.key)}</code></span></li>`).join('')}</ul>`;
}

function toWebPath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function inferRepoName(docPath) {
  const parts = path.resolve(docPath).split(path.sep);
  const docsIndex = parts.lastIndexOf('docs');
  return docsIndex > 0 ? parts[docsIndex - 1] : 'repo';
}

function sampleScore(sample) {
  return (
    (sample.itemCount * 10) +
    (sample.hasStats ? 18 : 0) +
    (sample.hasCallout ? 12 : 0) +
    (sample.hasPills ? 6 : 0) +
    sample.sectionFieldCount +
    sample.itemFieldCount
  );
}

async function parseDocMeta(htmlPath) {
  try {
    const html = await readFile(htmlPath, 'utf8');
    const match = html.match(/<script[^>]*id=["']doc-meta["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return null;
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function createUsageBuckets(registry) {
  return Object.fromEntries(Object.keys(registry.convergenceTypes ?? {}).map((key) => [key, {
    sectionCount: 0,
    docs: new Set(),
    sectionFields: new Set(),
    itemFields: new Set(),
    samples: [],
  }]));
}

function addSectionUsage(byType, section, sampleBase) {
  const typeKey = section?.convergenceType;
  if (!typeKey || !byType[typeKey]) return false;

  const bucket = byType[typeKey];
  bucket.sectionCount += 1;
  bucket.docs.add(sampleBase.docKey);

  for (const fieldKey of Object.keys(section ?? {})) {
    if (!['id', 'title', 'convergenceType'].includes(fieldKey)) {
      bucket.sectionFields.add(fieldKey);
    }
  }

  const dataItems = Array.isArray(section?.data) ? section.data : [];
  for (const item of dataItems) {
    if (!item || typeof item !== 'object') continue;
    for (const fieldKey of Object.keys(item)) {
      bucket.itemFields.add(fieldKey);
    }
  }

  bucket.samples.push({
    repoName: sampleBase.repoName,
    docTitle: sampleBase.docTitle,
    docHref: sampleBase.docHref,
    htmlHref: sampleBase.htmlHref,
    htmlExists: sampleBase.htmlExists,
    sectionTitle: section.title || section.id || typeKey,
    itemCount: dataItems.length,
    hasStats: Array.isArray(section?.stats) && section.stats.length > 0,
    hasCallout: Boolean(section?.callout),
    hasPills: Array.isArray(section?.pills) && section.pills.length > 0,
    sectionFieldCount: Object.keys(section ?? {}).filter((fieldKey) => !['id', 'title', 'convergenceType'].includes(fieldKey)).length,
    itemFieldCount: new Set(dataItems.flatMap((item) => item && typeof item === 'object' ? Object.keys(item) : [])).size,
  });

  return true;
}

async function collectUsageSamples(registry, outputPath, catalogPath = DEFAULT_CATALOG_PATH) {
  const byType = createUsageBuckets(registry);
  let scannedDocs = 0;
  let scannedSections = 0;
  let livingDocs = [];
  try {
    livingDocs = JSON.parse(await readFile(catalogPath, 'utf8'));
  } catch {
    livingDocs = [];
  }

  for (const livingDoc of Array.isArray(livingDocs) ? livingDocs : []) {
    const htmlPath = livingDoc?.doc_path;
    if (!htmlPath) continue;
    const htmlExists = await fileExists(htmlPath);
    const meta = livingDoc?.meta ?? await parseDocMeta(htmlPath);
    const sections = Array.isArray(meta?.sections) ? meta.sections : [];
    const jsonPath = htmlPath.replace(/\.html$/i, '.json');
    const repoName = livingDoc?.repo ? String(livingDoc.repo).split('/').pop() : inferRepoName(htmlPath);
    const htmlHrefBase = htmlExists ? toWebPath(path.relative(path.dirname(outputPath), htmlPath)) : null;
    const sampleBase = {
      repoName,
      docTitle: meta?.title || path.basename(jsonPath, '.json'),
      docKey: jsonPath,
      docHref: toWebPath(path.relative(path.dirname(outputPath), jsonPath)),
      htmlHref: htmlHrefBase,
      htmlExists,
    };

    scannedDocs += 1;
    for (const section of sections) {
      scannedSections += 1;
      const sectionHref = htmlHrefBase && section?.id ? `${htmlHrefBase}#${section.id}` : htmlHrefBase;
      addSectionUsage(byType, section, { ...sampleBase, htmlHref: sectionHref });
    }
  }

  for (const bucket of Object.values(byType)) {
    bucket.samples.sort((a, b) => sampleScore(b) - sampleScore(a) || a.docTitle.localeCompare(b.docTitle));
    bucket.samples = bucket.samples.slice(0, 4);
  }

  return { byType, scannedDocs, scannedSections, discovery: 'catalog', catalogPath, livingDocCount: scannedDocs };
}

function renderObservedFieldPills(fields, emptyLabel) {
  if (!fields?.size) return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
  return `<div class="pill-row">${[...fields].sort((a, b) => a.localeCompare(b)).map((field) => renderPill(field, 'neutral')).join('')}</div>`;
}

function renderSamples(usage) {
  if (!usage || usage.sectionCount === 0) {
    return '<p class="empty">No local samples found for this type.</p>';
  }

  return `
    <div class="sample-meta">
      ${renderPill(pluralize(usage.sectionCount, 'section'), 'blue')}
      ${renderPill(pluralize(usage.docs.size, 'doc'), 'teal')}
    </div>
    <ul class="sample-list">
      ${usage.samples.map((sample) => `
        <li>
          <div class="sample-heading">
            <strong>${escapeHtml(sample.sectionTitle)}</strong>
            <span>${escapeHtml(sample.docTitle)}</span>
          </div>
          <div class="mini-row">
            ${renderPill(sample.repoName, 'amber')}
            ${renderPill(pluralize(sample.itemCount, 'item'), 'neutral')}
            ${sample.hasStats ? renderPill('stats', 'neutral') : ''}
            ${sample.hasCallout ? renderPill('callout', 'neutral') : ''}
            ${sample.hasPills ? renderPill('pills', 'neutral') : ''}
          </div>
          <div class="sample-links">
            ${sample.htmlExists ? `<a href="${escapeHtml(sample.htmlHref)}">Open HTML sample</a>` : ''}
            <a href="${escapeHtml(sample.docHref)}">Open JSON source</a>
          </div>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderTypeCard(registry, key, ct, usage) {
  const projectionLabel = ct.projection === 'edge-table' ? 'Edge Table' : 'Card Grid';
  const columnsLabel = Array.isArray(ct.columns)
    ? `${ct.columns.length} columns`
    : `${Number(ct.columns ?? 1)} column${Number(ct.columns ?? 1) === 1 ? '' : 's'}`;
  const sourceCount = ct.sources?.length ?? [ct.sourceA, ct.sourceB].filter(Boolean).length;
  const statusCount = (ct.statusFields?.length ?? 0) + (ct.edgeStatus ? 1 : 0);
  const statusTonePills = (ct.statusFields ?? []).map((field) => renderPill(formatKey(field.statusSet), 'neutral')).join('');
  const edgeTonePill = ct.edgeStatus ? renderPill(formatKey(ct.edgeStatus.statusSet), 'neutral') : '';
  const notesLine = ct.edgeNotes ? `<div class="meta-inline"><strong>Edge notes</strong><code>${escapeHtml(ct.edgeNotes.key)}</code></div>` : '';

  return `
    <article class="type-card" id="${escapeHtml(key)}">
      <header class="type-header">
        <div class="type-mark" style="--type-color:${escapeHtml(ct.iconColor ?? '#475569')}">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">${ct.icon ?? ''}</svg>
        </div>
        <div class="type-title-block">
          <div class="type-kicker"><code>${escapeHtml(key)}</code></div>
          <h2>${escapeHtml(ct.name ?? formatKey(key))}</h2>
          <p>${escapeHtml(ct.description ?? '')}</p>
        </div>
      </header>

      <div class="type-meta">
        ${renderPill(projectionLabel, ct.projection === 'edge-table' ? 'rose' : 'blue')}
        ${renderPill(columnsLabel, 'teal')}
        ${renderPill(pluralize(sourceCount, 'source'), 'amber')}
        ${renderPill(pluralize(statusCount, 'status field'), 'neutral')}
        ${ct.nestable ? renderPill('Nestable', 'mint') : ''}
      </div>

      <section class="detail-block contract-block">
        <h3>Structural contract</h3>
        <p>${escapeHtml(ct.structuralContract ?? 'No structural contract defined.')}</p>
      </section>

      <section class="detail-block sample-block">
        <h3>Observed in real docs</h3>
        ${renderSamples(usage)}
      </section>

      <div class="detail-grid">
        <section class="detail-block">
          <h3>Sources</h3>
          ${renderSources(registry, ct)}
        </section>

        <section class="detail-block">
          <h3>Status fields</h3>
          ${renderStatusFields(registry, ct)}
          ${(statusTonePills || edgeTonePill) ? `<div class="status-tones">${statusTonePills}${edgeTonePill}</div>` : ''}
          ${notesLine}
        </section>

        <section class="detail-block">
          <h3>Text fields</h3>
          ${renderFieldList(ct.textFields, 'No text fields')}
        </section>

        <section class="detail-block">
          <h3>Details fields</h3>
          ${renderFieldList(ct.detailsFields, 'No details fields')}
        </section>
      </div>

      <div class="detail-grid">
        <section class="detail-block">
          <h3>Observed section fields</h3>
          ${renderObservedFieldPills(usage?.sectionFields, 'No local section fields observed yet')}
        </section>

        <section class="detail-block">
          <h3>Observed item fields</h3>
          ${renderObservedFieldPills(usage?.itemFields, 'No local item fields observed yet')}
        </section>
      </div>

      <section class="detail-block not-for-block">
        <h3>Not for</h3>
        ${renderList((ct.notFor ?? []).map((item) => escapeHtml(item)))}
      </section>
    </article>
  `;
}

function buildHtml(registry, usageSummary) {
  const convergenceEntries = Object.entries(registry.convergenceTypes ?? {});
  const cardGridCount = convergenceEntries.filter(([, ct]) => ct.projection === 'card-grid').length;
  const edgeTableCount = convergenceEntries.filter(([, ct]) => ct.projection === 'edge-table').length;
  const nestableCount = convergenceEntries.filter(([, ct]) => ct.nestable).length;
  const statusSetCount = Object.keys(registry.statusSets ?? {}).length;
  const entityTypeCount = Object.keys(registry.entityTypes ?? {}).length;
  const sampledTypeCount = convergenceEntries.filter(([key]) => usageSummary.byType[key]?.sectionCount > 0).length;

  const navLinks = convergenceEntries.map(([key, ct]) => {
    const color = ct.iconColor ?? '#475569';
    return `<a href="#${escapeHtml(key)}" class="nav-link" style="--nav-color:${escapeHtml(color)}"><span class="nav-dot"></span>${escapeHtml(ct.name ?? formatKey(key))}</a>`;
  }).join('');

  const cards = convergenceEntries.map(([key, ct]) => renderTypeCard(registry, key, ct, usageSummary.byType[key])).join('');

  const entityRows = Object.entries(registry.entityTypes ?? {}).map(([key, entity]) => {
    return `<tr><td><code>${escapeHtml(key)}</code></td><td>${escapeHtml(entity.label ?? formatKey(key))}</td><td>${escapeHtml(entity.refRender ?? 'inline')}</td></tr>`;
  }).join('');

  const statusRows = Object.entries(registry.statusSets ?? {}).map(([key, statusSet]) => {
    return `<tr><td><code>${escapeHtml(key)}</code></td><td>${escapeHtml(pluralize(statusSet.values?.length ?? 0, 'value'))}</td><td>${escapeHtml((statusSet.values ?? []).join(', '))}</td></tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Living Doc Registry Overview</title>
<style>
  :root {
    --paper: #f6f0e5;
    --paper-strong: #fffdfa;
    --ink: #183244;
    --muted: #5d7284;
    --line: rgba(24, 50, 68, 0.12);
    --blue: #225cc5;
    --teal: #0f7b74;
    --amber: #a86610;
    --rose: #b34d67;
    --mint: #d8f0e8;
    --neutral: #eef3f6;
    --shadow: 0 18px 40px rgba(24, 50, 68, 0.07);
    --radius-xl: 34px;
    --radius-lg: 22px;
    --radius-md: 16px;
    --radius-sm: 12px;
    --content: 1280px;
  }

  * { box-sizing: border-box; }

  html {
    scroll-behavior: smooth;
  }

  body {
    margin: 0;
    background:
      radial-gradient(circle at top left, rgba(34, 92, 197, 0.10), transparent 26%),
      radial-gradient(circle at top right, rgba(15, 123, 116, 0.08), transparent 24%),
      linear-gradient(180deg, #fbf7ef 0%, var(--paper) 100%);
    color: var(--ink);
    font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif;
    line-height: 1.5;
  }

  a {
    color: var(--blue);
    text-decoration: none;
  }

  a:hover { text-decoration: underline; }

  code {
    font-family: "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.9em;
    background: rgba(24, 50, 68, 0.05);
    border: 1px solid rgba(24, 50, 68, 0.08);
    border-radius: 7px;
    padding: 0.1em 0.45em;
  }

  .page {
    max-width: var(--content);
    margin: 0 auto;
    padding: 38px 24px 72px;
  }

  .hero,
  .card,
  .type-card,
  .table-card {
    background: rgba(255, 255, 255, 0.74);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
  }

  .hero {
    overflow: hidden;
    position: relative;
    border-radius: var(--radius-xl);
    background: linear-gradient(140deg, rgba(255, 253, 250, 0.98), rgba(225, 239, 252, 0.82));
  }

  .hero::before,
  .hero::after {
    content: "";
    position: absolute;
    border-radius: 999px;
    pointer-events: none;
  }

  .hero::before {
    width: 280px;
    height: 280px;
    top: -90px;
    right: -80px;
    background: radial-gradient(circle, rgba(34, 92, 197, 0.14), transparent 68%);
  }

  .hero::after {
    width: 260px;
    height: 260px;
    left: -80px;
    bottom: -120px;
    background: radial-gradient(circle, rgba(15, 123, 116, 0.15), transparent 72%);
  }

  .hero-inner {
    position: relative;
    z-index: 1;
    padding: 44px;
    display: grid;
    gap: 24px;
  }

  .eyebrow {
    display: inline-flex;
    width: fit-content;
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(24, 50, 68, 0.06);
    color: var(--muted);
    font: 600 13px/1.1 "Helvetica Neue", Arial, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1, h2, h3 {
    margin: 0;
    line-height: 1.05;
    font-weight: 700;
  }

  h1 {
    font-size: clamp(2.7rem, 5vw, 4.9rem);
    letter-spacing: -0.045em;
    max-width: 12ch;
  }

  h2 {
    font-size: 1.7rem;
    letter-spacing: -0.03em;
  }

  h3 {
    font-size: 0.82rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-family: "Helvetica Neue", Arial, sans-serif;
    color: var(--muted);
    margin-bottom: 10px;
  }

  p {
    margin: 0;
    font-size: 1.04rem;
  }

  .lead {
    font-size: 1.16rem;
    max-width: 66ch;
  }

  .summary-grid,
  .overview-grid,
  .detail-grid,
  .tables-grid {
    display: grid;
    gap: 16px;
  }

  .summary-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .summary-card {
    padding: 18px 18px 16px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.74);
  }

  .summary-card strong {
    display: block;
    margin-bottom: 8px;
    color: var(--muted);
    font: 700 0.8rem/1.2 "Helvetica Neue", Arial, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .summary-card span {
    font-size: 1.02rem;
  }

  main {
    display: grid;
    gap: 22px;
    margin-top: 28px;
  }

  .card {
    padding: 26px;
  }

  .overview-grid {
    grid-template-columns: 280px minmax(0, 1fr);
    align-items: start;
  }

  .sticky-card {
    position: sticky;
    top: 20px;
  }

  .nav-links {
    display: grid;
    gap: 8px;
    margin-top: 18px;
  }

  .nav-link {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    color: var(--ink);
    background: rgba(255, 255, 255, 0.56);
    border: 1px solid rgba(24, 50, 68, 0.08);
    text-decoration: none;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 0.93rem;
    font-weight: 600;
  }

  .nav-link:hover {
    text-decoration: none;
    background: color-mix(in srgb, var(--nav-color, var(--blue)) 8%, white);
  }

  .nav-dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: var(--nav-color, var(--blue));
    flex: 0 0 auto;
  }

  .type-stack {
    display: grid;
    gap: 18px;
  }

  .type-card {
    padding: 24px;
  }

  .type-header {
    display: grid;
    grid-template-columns: 62px minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }

  .type-mark {
    width: 62px;
    height: 62px;
    border-radius: 18px;
    display: grid;
    place-items: center;
    color: var(--type-color, var(--blue));
    background: color-mix(in srgb, var(--type-color, var(--blue)) 10%, white);
    border: 1px solid color-mix(in srgb, var(--type-color, var(--blue)) 18%, rgba(24, 50, 68, 0.10));
  }

  .type-kicker {
    margin-bottom: 8px;
    color: var(--muted);
    font: 700 0.8rem/1.2 "Helvetica Neue", Arial, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .type-title-block p {
    margin-top: 10px;
    color: var(--ink);
  }

  .type-meta,
  .mini-row,
  .status-tones,
  .sample-meta,
  .pill-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .type-meta {
    margin-top: 18px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px solid rgba(24, 50, 68, 0.10);
    background: rgba(255, 255, 255, 0.88);
    color: var(--muted);
    font: 600 0.81rem/1.2 "Helvetica Neue", Arial, sans-serif;
  }

  .pill.blue { color: var(--blue); }
  .pill.teal { color: var(--teal); }
  .pill.amber { color: var(--amber); }
  .pill.rose { color: var(--rose); }
  .pill.mint { color: var(--teal); background: var(--mint); }
  .pill.neutral { color: var(--muted); background: var(--neutral); }

  .contract-block {
    margin-top: 18px;
    background: linear-gradient(135deg, rgba(223, 243, 236, 0.86), rgba(255, 253, 250, 0.92));
  }

  .sample-block {
    margin-top: 16px;
    background: linear-gradient(135deg, rgba(221, 234, 251, 0.74), rgba(255, 253, 250, 0.9));
  }

  .detail-block {
    padding: 18px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.7);
  }

  .instruction-grid {
    display: grid;
    grid-template-columns: 1.05fr 0.95fr;
    gap: 16px;
  }

  .command-panel {
    margin-top: 14px;
    padding: 16px 18px;
    border-radius: var(--radius-sm);
    background: rgba(255, 253, 250, 0.95);
    border: 1px solid rgba(24, 50, 68, 0.10);
    overflow-x: auto;
    font-family: "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.92rem;
    line-height: 1.5;
  }

  .instruction-list {
    margin: 12px 0 0;
    padding-left: 20px;
  }

  .instruction-list li + li {
    margin-top: 8px;
  }

  .detail-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 16px;
  }

  .source-list,
  .stack-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 10px;
  }

  .source-list li,
  .stack-list li {
    display: grid;
    gap: 4px;
    padding: 10px 0;
    border-bottom: 1px solid rgba(24, 50, 68, 0.08);
  }

  .source-list li:last-child,
  .stack-list li:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }

  .source-list strong,
  .stack-list strong,
  .meta-inline strong {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 0.84rem;
    color: var(--ink);
  }

  .source-list span,
  .stack-list span,
  .meta-inline {
    font-size: 0.96rem;
    color: var(--muted);
  }

  .meta-inline {
    margin-top: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .empty {
    color: var(--muted);
    font-style: italic;
  }

  .not-for-block {
    margin-top: 16px;
  }

  .sample-list {
    list-style: none;
    padding: 0;
    margin: 12px 0 0;
    display: grid;
    gap: 12px;
  }

  .sample-list li {
    padding: 14px 0;
    border-bottom: 1px solid rgba(24, 50, 68, 0.08);
    display: grid;
    gap: 8px;
  }

  .sample-list li:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }

  .sample-heading {
    display: grid;
    gap: 4px;
  }

  .sample-heading strong {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 0.92rem;
    color: var(--ink);
  }

  .sample-heading span {
    color: var(--muted);
    font-size: 0.98rem;
  }

  .sample-links {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .tables-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .table-card {
    overflow: hidden;
  }

  .table-card header {
    padding: 20px 22px 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 14px 16px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--line);
  }

  th {
    font: 700 0.8rem/1.2 "Helvetica Neue", Arial, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    background: rgba(34, 92, 197, 0.05);
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  footer {
    margin-top: 26px;
    padding: 0 6px;
    color: var(--muted);
    font-size: 0.95rem;
  }

  @media (max-width: 1024px) {
    .summary-grid,
    .instruction-grid,
    .detail-grid,
    .tables-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .overview-grid {
      grid-template-columns: 1fr;
    }

    .sticky-card {
      position: static;
    }
  }

  @media (max-width: 720px) {
    .page {
      padding: 20px 14px 48px;
    }

    .hero-inner,
    .card,
    .type-card {
      padding: 20px;
    }

    .summary-grid,
    .instruction-grid,
    .detail-grid,
    .tables-grid,
    .type-header {
      grid-template-columns: 1fr;
    }
  }
</style>
</head>
<body>
  <div class="page">
    <header class="hero">
      <div class="hero-inner">
        <div class="eyebrow">Registry Overview</div>
        <h1>Current convergence type language</h1>
        <p class="lead">
          This page is generated directly from <code>scripts/living-doc-registry.json</code>. It shows the current formal type system that drives the compositor and the universal renderer.
        </p>
        <div class="summary-grid">
          <div class="summary-card"><strong>Convergence types</strong><span>${escapeHtml(String(convergenceEntries.length))}</span></div>
          <div class="summary-card"><strong>Card-grid types</strong><span>${escapeHtml(String(cardGridCount))}</span></div>
          <div class="summary-card"><strong>Edge-table types</strong><span>${escapeHtml(String(edgeTableCount))}</span></div>
          <div class="summary-card"><strong>Nestable types</strong><span>${escapeHtml(String(nestableCount))}</span></div>
          <div class="summary-card"><strong>Registry support</strong><span>${escapeHtml(`${entityTypeCount} entity types / ${statusSetCount} status sets`)}</span></div>
          <div class="summary-card"><strong>Sampled types</strong><span>${escapeHtml(`${sampledTypeCount} with local examples`)}</span></div>
        </div>
      </div>
    </header>

    <main>
      <section class="card">
        <h2>How to read this page</h2>
        <p>
          Each convergence type should be treated as a formal reasoning contract, not just a visual template. The description tells you what kind of thing the type is. The structural contract tells you what a valid section should look like. The source and status definitions show which borrowed properties the type depends on. The “not for” block marks nearby patterns that should not be collapsed into this type.
        </p>
        <p style="margin-top:14px;">
          This overview also reads the current local living-doc catalog and shows real sections that implement each type. That makes it easier for both humans and LLMs to see the actual implementation level of a type instead of reasoning from the abstract definition alone.
        </p>
        <div class="sample-meta" style="margin-top:16px;">
          ${renderPill(`${usageSummary.scannedDocs} local docs scanned`, 'blue')}
          ${renderPill(`${usageSummary.scannedSections} sections indexed`, 'teal')}
          ${renderPill(`catalog ${usageSummary.catalogPath}`, 'amber')}
        </div>
      </section>

      <section class="card">
        <h2>Regenerate This Page</h2>
        <div class="instruction-grid" style="margin-top:16px;">
          <div class="detail-block">
            <h3>Command</h3>
            <p>Run this from the repo root to rebuild the overview HTML from the current type registry and living-doc catalog.</p>
            <div class="command-panel">node scripts/render-registry-overview.mjs</div>
            <p style="margin-top:14px;">Optional: point to a different catalog file for this run.</p>
            <div class="command-panel">LIVING_DOC_CATALOG_PATH=/path/to/living-docs.json node scripts/render-registry-overview.mjs</div>
          </div>

          <div class="detail-block">
            <h3>What Must Be In Place</h3>
            <ol class="instruction-list">
              <li><code>scripts/living-doc-registry.json</code> must contain the current convergence types.</li>
              <li>The living-doc catalog at <code>${escapeHtml(usageSummary.catalogPath)}</code> must contain the docs you want sampled.</li>
              <li>Each catalog entry should point to a rendered <code>.html</code> living doc with an embedded <code>doc-meta</code> block.</li>
              <li>If you want JSON source links, the cataloged HTML should have a sibling <code>.json</code> file with the same basename.</li>
            </ol>
          </div>
        </div>
      </section>

      <section class="overview-grid">
        <aside class="card sticky-card">
          <h2>Type Index</h2>
          <p>Jump directly to a specific convergence type.</p>
          <nav class="nav-links">
            ${navLinks}
          </nav>
        </aside>

        <div class="type-stack">
          ${cards}
        </div>
      </section>

      <section class="tables-grid">
        <article class="table-card">
          <header>
            <h2>Entity Types</h2>
            <p>Reference building blocks available to convergence types.</p>
          </header>
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Label</th>
                <th>Render mode</th>
              </tr>
            </thead>
            <tbody>
              ${entityRows}
            </tbody>
          </table>
        </article>

        <article class="table-card">
          <header>
            <h2>Status Sets</h2>
            <p>Shared status vocabularies used by type fields.</p>
          </header>
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Size</th>
                <th>Values</th>
              </tr>
            </thead>
            <tbody>
              ${statusRows}
            </tbody>
          </table>
        </article>
      </section>
    </main>

    <footer>
      Generated from <code>scripts/living-doc-registry.json</code>. Regenerate with <code>node scripts/render-registry-overview.mjs</code>.
    </footer>
  </div>
</body>
</html>`;
}

export async function renderRegistryOverview(outputPath = defaultOutputPath) {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const usageSummary = await collectUsageSamples(registry, outputPath);
  const html = buildHtml(registry, usageSummary);
  await writeFile(outputPath, html);
  return { outputPath, typeCount: Object.keys(registry.convergenceTypes ?? {}).length };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const outputArg = process.argv[2];
  const outputPath = outputArg ? path.resolve(outputArg) : defaultOutputPath;
  const result = await renderRegistryOverview(outputPath);
  console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)} with ${result.typeCount} convergence types`);
}
