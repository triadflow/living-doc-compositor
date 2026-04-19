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

const GH_ORG = 'triadflow';
const CURRENT_REPO = 'living-doc-compositor';
const LINK_VERIFY_TIMEOUT_MS = 4000;

const ICON_GRID = `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>`;
const ICON_EDGE = `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="3.5" cy="8" r="1.8"/><circle cx="12.5" cy="8" r="1.8"/><path d="M5.3 8 H10.7"/></svg>`;

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

function entityLabel(registry, entityType) {
  if (!entityType) return 'Inline note';
  return registry.entityTypes?.[entityType]?.label ?? formatKey(entityType);
}

function toWebPath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function buildPublicUrl(htmlPath, repoSlug) {
  const m = String(htmlPath ?? '').match(/\/projects\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const repoName = repoSlug?.split('/')?.[1] ?? m[1];
  let pathInRepo = m[2];
  if (repoName === CURRENT_REPO && pathInRepo.startsWith('docs/')) {
    pathInRepo = pathInRepo.slice(5);
  }
  return `https://${GH_ORG}.github.io/${repoName}/${pathInRepo}`;
}

async function verifyUrl(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), LINK_VERIFY_TIMEOUT_MS);
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
    clearTimeout(t);
    if (res.status === 404 || res.status === 410) return 'missing';
    if (res.status >= 200 && res.status < 400) return 'ok';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

async function verifyPublicUrls(usageSummary) {
  const urlSet = new Set();
  for (const bucket of Object.values(usageSummary.byType)) {
    for (const s of bucket.samples) {
      if (s.publicUrl) urlSet.add(s.publicUrl);
    }
  }
  const entries = await Promise.all([...urlSet].map(async (url) => [url, await verifyUrl(url)]));
  const results = new Map(entries);
  for (const bucket of Object.values(usageSummary.byType)) {
    for (const s of bucket.samples) {
      s.linkState = s.publicUrl ? (results.get(s.publicUrl) ?? 'unknown') : 'unknown';
    }
  }
  return results;
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
  const parts = String(docPath ?? '').split(path.sep).filter(Boolean);
  const idx = parts.lastIndexOf('docs');
  return idx > 0 ? parts[idx - 1] : parts[parts.length - 2] ?? '';
}

function sampleScore(sample) {
  let score = sample.itemCount * 2;
  if (sample.hasStats) score += 2;
  if (sample.hasCallout) score += 2;
  if (sample.hasPills) score += 1;
  score += Math.min(sample.sectionFieldCount ?? 0, 8);
  score += Math.min(sample.itemFieldCount ?? 0, 8);
  return score;
}

async function parseDocMeta(htmlPath) {
  try {
    const raw = await readFile(htmlPath, 'utf8');
    const match = raw.match(/<script[^>]*id=["']doc-meta["'][^>]*>([\s\S]*?)<\/script>/);
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

  const publicHref = sampleBase.publicUrl
    ? (section?.id ? `${sampleBase.publicUrl}#${section.id}` : sampleBase.publicUrl)
    : null;
  bucket.samples.push({
    repoName: sampleBase.repoName,
    docTitle: sampleBase.docTitle,
    docHref: sampleBase.docHref,
    htmlHref: sampleBase.htmlHref,
    htmlExists: sampleBase.htmlExists,
    publicUrl: sampleBase.publicUrl,
    publicHref,
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
    const publicUrl = buildPublicUrl(htmlPath, livingDoc?.repo);
    const sampleBase = {
      repoName,
      docTitle: meta?.title || path.basename(jsonPath, '.json'),
      docKey: jsonPath,
      docHref: toWebPath(path.relative(path.dirname(outputPath), jsonPath)),
      htmlHref: htmlHrefBase,
      htmlExists,
      publicUrl,
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

// --- presentation helpers (matching the design) ---

function renderProjectionChip(ct) {
  if (ct.projection === 'edge-table') {
    return `<span class="chip edge">${ICON_EDGE} Edge table</span>`;
  }
  const cols = Array.isArray(ct.columns) ? ct.columns.length : Number(ct.columns ?? 1);
  return `<span class="chip grid">${ICON_GRID} Card grid · ${cols} col${cols > 1 ? 's' : ''}</span>`;
}

function renderSources(registry, ct) {
  const rows = [];
  if (ct.sources?.length) {
    for (const source of ct.sources) {
      const label = source.label ?? entityLabel(registry, source.entityType);
      const entity = entityLabel(registry, source.entityType);
      const field = [source.key, source.resolve ? 'resolved' : ''].filter(Boolean).join(' ');
      rows.push({ k: label, ent: entity, v: field });
    }
  } else {
    if (ct.sourceA) {
      rows.push({
        k: 'Source A',
        ent: entityLabel(registry, ct.sourceA.entityType),
        v: [ct.sourceA.key, ct.sourceA.displayKey ? `display ${ct.sourceA.displayKey}` : ''].filter(Boolean).join(' · '),
      });
    }
    if (ct.sourceB) {
      rows.push({
        k: 'Source B',
        ent: entityLabel(registry, ct.sourceB.entityType),
        v: [ct.sourceB.key, ct.sourceB.displayKey ? `display ${ct.sourceB.displayKey}` : ''].filter(Boolean).join(' · '),
      });
    }
  }
  if (!rows.length) {
    return `<div class="sample-empty"><span class="empty-hint">○ No sources</span></div>`;
  }
  return `<div class="kv-list">${rows.map((r) => `
        <div class="kv-row"><div class="k">${escapeHtml(r.k)}</div><div class="v"><span class="ent">${escapeHtml(r.ent)}</span>${escapeHtml(r.v)}</div></div>`).join('')}
      </div>`;
}

function renderStatusFields(registry, ct) {
  const fields = [];
  for (const f of ct.statusFields ?? []) {
    const set = registry.statusSets?.[f.statusSet];
    fields.push({ key: f.key, set: formatKey(f.statusSet), count: set?.values?.length ?? 0 });
  }
  if (ct.edgeStatus) {
    const set = registry.statusSets?.[ct.edgeStatus.statusSet];
    fields.push({ key: ct.edgeStatus.key, set: formatKey(ct.edgeStatus.statusSet), count: set?.values?.length ?? 0 });
  }
  if (!fields.length) {
    return `<div class="sample-empty"><span class="empty-hint">○ No status fields</span></div>`;
  }
  return fields.map((f) =>
    `<div class="status-field"><code>${escapeHtml(f.key)}</code><span class="set">${escapeHtml(f.set)}</span><span class="count">${f.count} value${f.count === 1 ? '' : 's'}</span></div>`
  ).join('');
}

function renderFieldList(fields) {
  if (!fields?.length) return '';
  return fields.map((f) =>
    `<div class="status-field"><code>${escapeHtml(f.key)}</code><span class="set">${escapeHtml(f.label ?? formatKey(f.key))}</span></div>`
  ).join('');
}

function renderEdgeNotes(ct) {
  if (!ct.edgeNotes) return '';
  return `<div class="status-field"><code>${escapeHtml(ct.edgeNotes.key)}</code><span class="set">Edge notes</span></div>`;
}

function renderSampleBlock(usage) {
  if (!usage || usage.sectionCount === 0) {
    return `<div class="sample-empty"><span class="empty-hint">○ No local samples found for this type.</span></div>`;
  }
  const docsCount = usage.docs.size;
  const counts = `<div class="sample-counts"><b>${usage.sectionCount}</b> section${usage.sectionCount === 1 ? '' : 's'} <span style="color:var(--ld-subtle)">·</span> <b>${docsCount}</b> doc${docsCount === 1 ? '' : 's'}</div>`;
  const samples = usage.samples.map((s) => {
    const href = s.publicHref || s.htmlHref || s.docHref;
    const isMissing = s.linkState === 'missing';
    const titleInner = isMissing
      ? `<span>${escapeHtml(s.sectionTitle)}</span><span class="s-miss" title="The published page for this sample returns 404.">not on github pages</span>`
      : `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(s.sectionTitle)}</a>`;
    return `
        <div class="sample${isMissing ? ' missing' : ''}">
          <div>
            <div class="s-title">${titleInner}</div>
            <div class="s-meta">${escapeHtml(s.docTitle)} <span style="color:var(--ld-subtle)">·</span> <code>${escapeHtml(s.repoName)}</code></div>
          </div>
          <div class="s-items">${s.itemCount} item${s.itemCount === 1 ? '' : 's'}</div>
        </div>`;
  }).join('');
  return `${counts}<div class="samples">${samples}
      </div>`;
}

function renderTypeCard(registry, key, ct, usage) {
  const sourceCount = ct.sources?.length ?? [ct.sourceA, ct.sourceB].filter(Boolean).length;
  const statusCount = (ct.statusFields?.length ?? 0) + (ct.edgeStatus ? 1 : 0);
  const nestChip = ct.nestable ? `<span class="chip nest">Nestable</span>` : '';
  const countsChips = `<span class="chip">${sourceCount} source${sourceCount === 1 ? '' : 's'}</span><span class="chip">${statusCount} status field${statusCount === 1 ? '' : 's'}</span>`;

  const textBlock = ct.textFields?.length
    ? `<div style="height:20px"></div><span class="sub-eyebrow">Text fields</span>${renderFieldList(ct.textFields)}`
    : '';
  const detailsBlock = ct.detailsFields?.length
    ? `<div style="height:20px"></div><span class="sub-eyebrow">Details fields</span>${renderFieldList(ct.detailsFields)}`
    : '';

  const notForItems = (ct.notFor ?? []).map((x) => `<span class="nf-item">${escapeHtml(x)}</span>`).join('');
  const notForBlock = notForItems
    ? `<div class="not-for"><span class="nf-label">Not for</span>${notForItems}</div>`
    : '';

  return `
  <article class="type-card" id="${escapeHtml(key)}">
    <div class="type-head">
      <div class="left">
        <span class="slug"><code>${escapeHtml(key)}</code></span>
        <h3>${escapeHtml(ct.name ?? formatKey(key))}</h3>
        <p>${escapeHtml(ct.description ?? '')}</p>
      </div>
      <div class="meta">
        ${renderProjectionChip(ct)}
        ${nestChip}
        ${countsChips}
      </div>
    </div>
    <div class="type-body">
      <div>
        <span class="sub-eyebrow">Structural contract</span>
        <p class="contract">${escapeHtml(ct.structuralContract ?? 'No structural contract defined.')}</p>

        <div style="height:24px"></div>

        <span class="sub-eyebrow">Observed in real docs</span>
        ${renderSampleBlock(usage)}
      </div>
      <div>
        <span class="sub-eyebrow">Sources</span>
        ${renderSources(registry, ct)}

        <div style="height:20px"></div>

        <span class="sub-eyebrow">Status fields</span>
        ${renderStatusFields(registry, ct)}
        ${renderEdgeNotes(ct)}
        ${textBlock}
        ${detailsBlock}
      </div>
    </div>
    ${notForBlock}
  </article>`;
}

const INLINE_STYLES = `
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:var(--ld-font-sans);background:var(--ld-bg);color:var(--ld-ink);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-size:var(--ld-size-body);line-height:var(--ld-lh-body)}
a{color:var(--ld-accent);text-decoration:none}
a:hover{text-decoration:underline}
em{font-style:normal;color:var(--ld-accent)}
code,.mono{font-family:var(--ld-font-mono);font-size:13px}

/* ---- top bar ---- */
.top-bar{display:flex;align-items:center;gap:14px;padding:14px 24px;background:rgba(255,255,255,0.82);border-bottom:1px solid var(--ld-line);position:sticky;top:0;z-index:20;backdrop-filter:blur(8px)}
.top-bar .logo{width:32px;height:32px;border-radius:8px;background:var(--ld-accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
.top-bar .crumbs{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--ld-muted)}
.top-bar .crumbs strong{color:var(--ld-ink);font-weight:600}
.top-bar .sep{color:var(--ld-subtle)}
.top-bar .spacer{flex:1}
.top-action{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:8px;border:1px solid var(--ld-line);background:var(--ld-card);color:var(--ld-ink);font-size:13px;font-weight:600;transition:all .15s}
.top-action:hover{border-color:var(--ld-accent);color:var(--ld-accent);text-decoration:none}
.top-action.primary{background:var(--ld-accent);color:#fff;border-color:var(--ld-accent)}
.top-action.primary:hover{background:var(--ld-accent-hover);border-color:var(--ld-accent-hover);color:#fff}

/* ---- layout ---- */
main{max-width:1100px;margin:0 auto;padding:0 24px}
.hero{padding:72px 0 48px;border-bottom:1px solid var(--ld-line)}
.hero .eyebrow{display:inline-block;font-size:var(--ld-size-tiny);font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ld-accent);background:var(--ld-accent-tint);padding:4px 10px;border-radius:var(--ld-radius-pill);margin-bottom:20px}
.hero h1{font-size:clamp(36px,5.2vw,52px);line-height:1.04;font-weight:800;letter-spacing:-.035em;margin-bottom:20px;max-width:920px}
.hero h1 em{color:var(--ld-accent)}
.hero .lede{font-size:var(--ld-size-body-lg);color:var(--ld-muted);max-width:680px;line-height:1.55;margin-bottom:28px}
.hero .meta{display:flex;align-items:center;gap:18px;font-size:13px;color:var(--ld-muted);flex-wrap:wrap}
.hero .meta code{background:var(--ld-card);border:1px solid var(--ld-line);padding:3px 8px;border-radius:6px;color:var(--ld-ink)}
.hero .meta .dot{color:var(--ld-subtle)}

/* ---- stats strip ---- */
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:0;margin:32px 0 0;background:var(--ld-card);border:1px solid var(--ld-line);border-radius:var(--ld-radius-lg);overflow:hidden;box-shadow:var(--ld-shadow-sm)}
.stat{padding:22px 24px;border-right:1px solid var(--ld-line)}
.stat:last-child{border-right:none}
.stat .label{font-size:var(--ld-size-tiny);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ld-muted);margin-bottom:10px}
.stat .value{font-size:30px;font-weight:800;letter-spacing:-.025em;color:var(--ld-ink);line-height:1}
.stat .sub{font-size:12.5px;color:var(--ld-muted);margin-top:6px}
.stat .value em{color:var(--ld-accent)}

/* ---- section rhythm ---- */
section.block{padding:64px 0;border-bottom:1px solid var(--ld-line)}
section.block > .eyebrow{display:inline-block;font-size:var(--ld-size-tiny);font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ld-accent);background:var(--ld-accent-tint);padding:4px 10px;border-radius:var(--ld-radius-pill);margin-bottom:18px}
section.block > h2{font-size:34px;line-height:1.12;font-weight:700;letter-spacing:-.025em;margin-bottom:14px;max-width:760px}
section.block > h2 em{color:var(--ld-accent)}
section.block > .lede{font-size:17px;color:var(--ld-muted);max-width:680px;line-height:1.6;margin-bottom:24px}

/* ---- how-to-read payoff ---- */
.read-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:20px}
.read-card{padding:20px 22px;background:var(--ld-card);border:1px solid var(--ld-line);border-radius:var(--ld-radius-md);box-shadow:var(--ld-shadow-sm)}
.read-card h4{font-size:14.5px;font-weight:700;color:var(--ld-ink);margin-bottom:6px;display:flex;align-items:center;gap:8px}
.read-card h4 .n{width:22px;height:22px;border-radius:6px;background:var(--ld-accent-tint);color:var(--ld-accent-ink);font-size:12px;font-weight:800;display:inline-flex;align-items:center;justify-content:center}
.read-card p{font-size:14px;color:var(--ld-muted);line-height:1.55}
.read-payoff{margin-top:22px;padding:18px 22px;border-left:3px solid var(--ld-accent);background:color-mix(in srgb,var(--ld-accent) 5%,var(--ld-card));border-radius:0 8px 8px 0;font-size:16px;color:var(--ld-ink)}
.read-payoff em{color:var(--ld-accent)}

/* ---- type index ---- */
.index-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
.index-pill{display:flex;align-items:center;gap:10px;padding:11px 14px;background:var(--ld-card);border:1px solid var(--ld-line);border-radius:10px;font-size:13.5px;color:var(--ld-ink);transition:all .15s;cursor:pointer}
.index-pill:hover{border-color:var(--ld-accent);color:var(--ld-accent);text-decoration:none;transform:translateY(-1px)}
.index-pill .n{font-family:var(--ld-font-mono);font-size:11px;color:var(--ld-muted);min-width:18px}
.index-pill:hover .n{color:var(--ld-accent)}
.index-pill .glyph{width:14px;height:14px;flex-shrink:0;opacity:.7}
.index-pill:hover .glyph{opacity:1}

/* ---- type cards ---- */
.types-wrap{display:flex;flex-direction:column;gap:18px;margin-top:8px}
.type-card{background:var(--ld-card);border:1px solid var(--ld-line);border-radius:var(--ld-radius-lg);overflow:hidden;scroll-margin-top:80px;box-shadow:var(--ld-shadow-sm)}
.type-head{display:grid;grid-template-columns:1fr auto;gap:24px;padding:24px 28px 20px;border-bottom:1px solid var(--ld-line);align-items:start}
.type-head .left{min-width:0}
.type-head .slug{display:inline-flex;align-items:center;gap:8px;font-family:var(--ld-font-mono);font-size:12px;color:var(--ld-accent);background:color-mix(in srgb,var(--ld-accent) 6%,var(--ld-card));border:1px solid var(--ld-accent-tint);padding:3px 8px;border-radius:6px;margin-bottom:10px}
.type-head h3{font-size:24px;font-weight:700;letter-spacing:-.02em;color:var(--ld-ink);margin-bottom:8px;line-height:1.2}
.type-head p{font-size:15px;color:var(--ld-muted);line-height:1.55;max-width:720px}
.type-head .meta{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start;justify-content:flex-end;max-width:260px}

.chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;letter-spacing:.02em;padding:4px 10px;border-radius:var(--ld-radius-pill);background:var(--ld-neutral-bg);color:var(--ld-neutral-ink);white-space:nowrap}
.chip.grid{background:var(--ld-accent-tint);color:var(--ld-accent-ink)}
.chip.edge{background:var(--ld-warning-bg);color:var(--ld-warning-ink)}
.chip.nest{background:var(--ld-positive-bg);color:var(--ld-positive-ink)}
.chip svg{width:11px;height:11px}

.type-body{display:grid;grid-template-columns:1.1fr 1fr;gap:0}
.type-body > div{padding:22px 28px}
.type-body > div + div{border-left:1px solid var(--ld-line)}
.sub-eyebrow{display:block;font-size:var(--ld-size-tiny);font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ld-accent);margin-bottom:12px}
.contract{font-size:14.5px;color:var(--ld-ink);line-height:1.6;max-width:540px}

/* samples list */
.samples{display:flex;flex-direction:column;gap:0}
.sample{padding:10px 0;border-top:1px dashed var(--ld-line);display:grid;grid-template-columns:1fr auto;gap:10px;align-items:baseline}
.sample:first-child{border-top:none;padding-top:0}
.sample .s-title{font-size:14px;font-weight:600;color:var(--ld-ink);display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.sample .s-title a{color:var(--ld-ink)}
.sample .s-title a:hover{color:var(--ld-accent)}
.sample.missing .s-title > span:first-child{color:var(--ld-muted);font-weight:500}
.sample .s-miss{font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ld-muted);padding:2px 8px;background:var(--ld-bg);border:1px dashed var(--ld-line);border-radius:999px;white-space:nowrap}
.sample .s-meta{font-size:12px;color:var(--ld-muted);margin-top:3px}
.sample .s-meta code{background:var(--ld-bg);padding:1px 6px;border-radius:4px;color:var(--ld-muted);font-size:11.5px}
.sample .s-items{font-family:var(--ld-font-mono);font-size:11.5px;color:var(--ld-muted)}
.sample-empty{padding:10px 14px;background:var(--ld-bg);border:1px dashed var(--ld-line);border-radius:8px;font-size:13px;color:var(--ld-muted)}

.sample-counts{display:flex;gap:10px;margin-bottom:12px;font-size:12px;color:var(--ld-muted)}
.sample-counts b{color:var(--ld-ink);font-weight:700}

/* sources + fields lists */
.kv-list{display:flex;flex-direction:column;gap:0;margin-bottom:20px}
.kv-list:last-child{margin-bottom:0}
.kv-row{padding:9px 0;border-top:1px dashed var(--ld-line);display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:baseline;font-size:13px}
.kv-row:first-child{border-top:none;padding-top:0}
.kv-row .k{font-weight:600;color:var(--ld-ink)}
.kv-row .v{color:var(--ld-muted);font-family:var(--ld-font-mono);font-size:12.5px}
.kv-row .v .ent{color:var(--ld-accent);background:var(--ld-accent-tint);padding:1px 7px;border-radius:5px;font-size:11.5px;margin-right:6px}

.status-field{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px dashed var(--ld-line);font-size:13px}
.status-field:first-child{border-top:none;padding-top:0}
.status-field code{font-size:12px;background:var(--ld-bg);padding:2px 7px;border-radius:5px;color:var(--ld-ink);border:1px solid var(--ld-line)}
.status-field .set{color:var(--ld-muted);flex:1}
.status-field .count{font-size:11px;color:var(--ld-muted);font-family:var(--ld-font-mono)}

.not-for{background:var(--ld-warning-bg);border-top:1px solid var(--ld-line);padding:16px 28px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.not-for .nf-label{font-size:var(--ld-size-tiny);font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ld-warning-ink);margin-right:6px}
.not-for .nf-item{font-size:13px;color:var(--ld-warning-ink);padding:3px 10px;background:#fff;border:1px solid #fed7aa;border-radius:var(--ld-radius-pill)}
.not-for .nf-item::before{content:"✕";margin-right:6px;font-weight:700;opacity:.7}

.empty-hint{display:inline-flex;align-items:center;gap:6px;color:var(--ld-muted);font-size:12.5px}

/* ---- entity + status set tables ---- */
.table-wrap{background:var(--ld-card);border:1px solid var(--ld-line);border-radius:var(--ld-radius-lg);overflow:hidden;box-shadow:var(--ld-shadow-sm)}
table.ref{width:100%;border-collapse:collapse;font-size:13.5px}
table.ref th{text-align:left;padding:14px 20px;background:var(--ld-surface-alt);font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ld-muted);border-bottom:1px solid var(--ld-line)}
table.ref td{padding:12px 20px;border-top:1px solid var(--ld-line);vertical-align:top;color:var(--ld-ink)}
table.ref tr:first-child td{border-top:none}
table.ref td.key{font-family:var(--ld-font-mono);font-size:12.5px;color:var(--ld-accent);width:220px}
table.ref td.label{font-weight:600;width:200px}
table.ref td.render{font-family:var(--ld-font-mono);font-size:12px;color:var(--ld-muted)}

.set-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:8px}
.set-card{padding:18px 20px;background:var(--ld-card);border:1px solid var(--ld-line);border-radius:var(--ld-radius-md)}
.set-card .head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px dashed var(--ld-line)}
.set-card code{font-size:12.5px;color:var(--ld-accent);background:color-mix(in srgb,var(--ld-accent) 6%,var(--ld-card));padding:3px 8px;border-radius:5px;border:1px solid var(--ld-accent-tint)}
.set-card .size{font-size:11.5px;color:var(--ld-muted);font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.set-values{display:flex;flex-wrap:wrap;gap:5px}
.set-values .v{font-family:var(--ld-font-mono);font-size:11.5px;padding:3px 8px;border-radius:5px;background:var(--ld-neutral-bg);color:var(--ld-neutral-ink)}

/* ---- regen block ---- */
.regen-grid{display:grid;grid-template-columns:1.1fr 1fr;gap:18px;margin-top:8px}
.regen-card{background:var(--ld-card);border:1px solid var(--ld-line);border-radius:var(--ld-radius-lg);padding:24px 26px;box-shadow:var(--ld-shadow-sm)}
.regen-card h3{font-size:16px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.regen-card h3 .tag{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ld-accent);background:var(--ld-accent-tint);padding:2px 8px;border-radius:var(--ld-radius-pill)}
.cmd{font-family:var(--ld-font-mono);font-size:13px;background:var(--ld-ink);color:#e2e8f0;padding:14px 16px;border-radius:8px;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin:8px 0}
.cmd .prompt{color:var(--ld-accent-glow);margin-right:8px;user-select:none}
.cmd .env{color:#fbbf24}
.regen-card p{font-size:14px;color:var(--ld-muted);line-height:1.55;margin-bottom:8px}
.regen-card ol{padding-left:20px;color:var(--ld-ink);font-size:14px;line-height:1.7}
.regen-card ol code{background:var(--ld-bg);padding:1px 6px;border-radius:4px;border:1px solid var(--ld-line);font-size:12px;color:var(--ld-accent)}

/* ---- footer ---- */
footer.pg-foot{padding:40px 0 72px;font-size:13px;color:var(--ld-muted)}
footer.pg-foot code{background:var(--ld-card);border:1px solid var(--ld-line);padding:2px 8px;border-radius:5px;color:var(--ld-ink)}

/* ---- responsive ---- */
@media (max-width:900px){
  .stats{grid-template-columns:repeat(2,1fr)}
  .stat{border-right:none;border-bottom:1px solid var(--ld-line)}
  .type-body{grid-template-columns:1fr}
  .type-body > div + div{border-left:none;border-top:1px solid var(--ld-line)}
  .type-head{grid-template-columns:1fr}
  .type-head .meta{max-width:none;justify-content:flex-start}
  .index-grid{grid-template-columns:repeat(2,1fr)}
  .read-grid,.set-grid,.regen-grid{grid-template-columns:1fr}
  .kv-row{grid-template-columns:1fr}
}
@media (max-width:560px){
  .index-grid{grid-template-columns:1fr}
  .stats{grid-template-columns:1fr}
}
`;

function buildHtml(registry, usageSummary) {
  const convergenceEntries = Object.entries(registry.convergenceTypes ?? {});
  const totalTypes = convergenceEntries.length;
  const cardGridCount = convergenceEntries.filter(([, ct]) => ct.projection === 'card-grid').length;
  const edgeTableCount = convergenceEntries.filter(([, ct]) => ct.projection === 'edge-table').length;
  const nestableCount = convergenceEntries.filter(([, ct]) => ct.nestable).length;
  const sampledTypeCount = convergenceEntries.filter(([key]) => usageSummary.byType[key]?.sectionCount > 0).length;
  const statusSetEntries = Object.entries(registry.statusSets ?? {});
  const entityEntries = Object.entries(registry.entityTypes ?? {});
  const statusSetCount = statusSetEntries.length;
  const entityTypeCount = entityEntries.length;

  const indexPills = convergenceEntries.map(([key, ct], i) => {
    const n = String(i + 1).padStart(2, '0');
    const glyph = ct.projection === 'edge-table' ? ICON_EDGE : ICON_GRID;
    return `<a class="index-pill" href="#${escapeHtml(key)}"><span class="n">${n}</span>${glyph}<span>${escapeHtml(ct.name ?? formatKey(key))}</span></a>`;
  }).join('');

  const typeCards = convergenceEntries
    .map(([key, ct]) => renderTypeCard(registry, key, ct, usageSummary.byType[key]))
    .join('');

  const entityRows = entityEntries.map(([key, entity]) => {
    const renderMode = entity.refRender ?? 'inline';
    return `<tr><td class="key">${escapeHtml(key)}</td><td class="label">${escapeHtml(entity.label ?? formatKey(key))}</td><td class="render">${escapeHtml(renderMode)}</td></tr>`;
  }).join('');

  const statusCards = statusSetEntries.map(([key, set]) => {
    const values = set.values ?? [];
    const valueSpans = values.map((v) => `<span class="v">${escapeHtml(v)}</span>`).join('');
    return `
    <div class="set-card">
      <div class="head"><code>${escapeHtml(key)}</code><span class="size">${values.length} value${values.length === 1 ? '' : 's'}</span></div>
      <div class="set-values">${valueSpans}</div>
    </div>`;
  }).join('');

  const catalogPathDisplay = usageSummary.catalogPath ?? DEFAULT_CATALOG_PATH;
  const scannedDocs = usageSummary.scannedDocs ?? 0;
  const scannedSections = usageSummary.scannedSections ?? 0;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Living doc registry overview</title>
<link rel="stylesheet" href="assets/colors_and_type.css"/>
<style>${INLINE_STYLES}</style>
</head>
<body>

<div class="top-bar">
  <div class="logo">L</div>
  <div class="crumbs">
    <a href="index.html">Living docs</a>
    <span class="sep">/</span>
    <a href="living-doc-compositor.html">Compositor</a>
    <span class="sep">/</span>
    <strong>Registry overview</strong>
  </div>
  <div class="spacer"></div>
  <a class="top-action" href="#regen">Regenerate</a>
  <a class="top-action primary" href="#types">Browse types →</a>
</div>

<main>

<!-- HERO -->
<section class="hero">
  <span class="eyebrow">Registry overview</span>
  <h1>The current convergence type <em>language</em>.</h1>
  <p class="lede">This page is generated directly from <code>scripts/living-doc-registry.json</code>. It shows the formal type system driving the compositor and the universal renderer — each type treated as a reasoning contract, not a visual template.</p>
  <div class="meta">
    <span><strong style="color:var(--ld-ink)">${scannedDocs}</strong> local doc${scannedDocs === 1 ? '' : 's'} scanned</span>
    <span class="dot">·</span>
    <span><strong style="color:var(--ld-ink)">${scannedSections}</strong> section${scannedSections === 1 ? '' : 's'} indexed</span>
    <span class="dot">·</span>
    <span>catalog <code>${escapeHtml(catalogPathDisplay)}</code></span>
  </div>

  <div class="stats">
    <div class="stat"><div class="label">Convergence types</div><div class="value">${totalTypes}</div><div class="sub">The full vocabulary</div></div>
    <div class="stat"><div class="label">Card-grid types</div><div class="value">${cardGridCount}</div><div class="sub">Most types project as cards</div></div>
    <div class="stat"><div class="label">Edge-table types</div><div class="value">${edgeTableCount}</div><div class="sub">Explicit pair relations</div></div>
    <div class="stat"><div class="label">Nestable types</div><div class="value">${nestableCount}</div><div class="sub">Can contain sub-sections</div></div>
    <div class="stat"><div class="label">Sampled locally</div><div class="value"><em>${sampledTypeCount}</em></div><div class="sub">With observed examples</div></div>
  </div>
</section>

<!-- HOW TO READ -->
<section class="block" id="read">
  <span class="eyebrow">How to read this page</span>
  <h2>Each type is a formal reasoning contract, not a visual template.</h2>
  <p class="lede">The overview reads the current local living-doc catalog and shows real sections implementing each type. That makes it easier for humans and LLMs alike to see the implementation level instead of reasoning from the abstract alone.</p>
  <div class="read-grid">
    <div class="read-card"><h4><span class="n">1</span> Description</h4><p>What kind of thing the type <em>is</em>. One sentence; unambiguous about the convergence it claims.</p></div>
    <div class="read-card"><h4><span class="n">2</span> Structural contract</h4><p>What a valid section of this type should look like — grid shape, required item semantics, where it applies.</p></div>
    <div class="read-card"><h4><span class="n">3</span> Sources &amp; status</h4><p>Which borrowed entity types and status sets the type depends on. Borrowed, never duplicated.</p></div>
    <div class="read-card"><h4><span class="n">4</span> Not for</h4><p>Nearby patterns that should <em>not</em> be collapsed into this type. The guardrail against type drift.</p></div>
  </div>
  <div class="read-payoff">Each convergence type should be treated as a reasoning contract. <em>Pick the wrong one and the doc lies to you.</em></div>
</section>

<!-- TYPE INDEX -->
<section class="block" id="index">
  <span class="eyebrow">Type index</span>
  <h2>Jump directly to a convergence type.</h2>
  <p class="lede">${totalTypes} types, grouped in order of appearance. Slugs match the anchors used in rendered docs.</p>
  <div class="index-grid">${indexPills}</div>
</section>

<!-- TYPES -->
<section class="block" id="types">
  <span class="eyebrow">Convergence types</span>
  <h2>The ${totalTypes} formal types.</h2>
  <p class="lede">Each card shows the description, structural contract, local samples, borrowed sources, status fields, and guardrails. Borrowed entity types render as <span class="mono" style="background:var(--ld-accent-tint);color:var(--ld-accent);padding:1px 6px;border-radius:4px;font-size:11.5px">chips</span>.</p>
  <div class="types-wrap">${typeCards}
  </div>
</section>

<!-- ENTITY TYPES -->
<section class="block" id="entities">
  <span class="eyebrow">Entity types</span>
  <h2>Reference building blocks.</h2>
  <p class="lede">${entityTypeCount} entity type${entityTypeCount === 1 ? '' : 's'}, available to convergence types as borrowed sources. A convergence type declares <em>what</em> it borrows; entities declare <em>how</em> they render.</p>
  <div class="table-wrap">
    <table class="ref"><thead><tr><th>Key</th><th>Label</th><th>Render mode</th></tr></thead><tbody>${entityRows}</tbody></table>
  </div>
</section>

<!-- STATUS SETS -->
<section class="block" id="status-sets">
  <span class="eyebrow">Status sets</span>
  <h2>Shared status vocabularies.</h2>
  <p class="lede">${statusSetCount} status set${statusSetCount === 1 ? '' : 's'}. Types bind one or more of their own fields to one of these enums — never invent a local one.</p>
  <div class="set-grid">${statusCards}
  </div>
</section>

<!-- REGEN -->
<section class="block" id="regen">
  <span class="eyebrow">Regenerate this page</span>
  <h2>Rebuilt from the registry and the local catalog.</h2>
  <p class="lede">Run from the repo root to rebuild the overview HTML from the current type registry and living-doc catalog.</p>
  <div class="regen-grid">
    <div class="regen-card">
      <h3>Command <span class="tag">Default</span></h3>
      <div class="cmd"><span class="prompt">$</span>node scripts/render-registry-overview.mjs</div>
      <p style="margin-top:14px">Optional — point to a different catalog file for this run:</p>
      <div class="cmd"><span class="prompt">$</span><span class="env">LIVING_DOC_CATALOG_PATH</span>=/path/to/living-docs.json \\
  node scripts/render-registry-overview.mjs</div>
    </div>
    <div class="regen-card">
      <h3>What must be in place</h3>
      <ol>
        <li><code>scripts/living-doc-registry.json</code> contains the current convergence types.</li>
        <li>The living-doc catalog at <code>${escapeHtml(catalogPathDisplay)}</code> contains the docs you want sampled.</li>
        <li>Each catalog entry points to a rendered <code>.html</code> living doc with an embedded <code>doc-meta</code> block.</li>
        <li>For JSON source links, the cataloged HTML has a sibling <code>.json</code> file with the same basename.</li>
      </ol>
    </div>
  </div>
</section>

<footer class="pg-foot">
  Generated from <code>scripts/living-doc-registry.json</code>. Regenerate with <code>node scripts/render-registry-overview.mjs</code>.
</footer>

</main>

</body>
</html>`;
}

export async function renderRegistryOverview(outputPath = defaultOutputPath, opts = {}) {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const usageSummary = await collectUsageSamples(registry, outputPath);
  let linkStats = null;
  if (opts.verifyLinks !== false) {
    const results = await verifyPublicUrls(usageSummary);
    const missing = [...results.values()].filter((v) => v === 'missing').length;
    linkStats = { checked: results.size, missing };
  }
  const html = buildHtml(registry, usageSummary);
  await writeFile(outputPath, html);
  return { outputPath, typeCount: Object.keys(registry.convergenceTypes ?? {}).length, linkStats };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const args = process.argv.slice(2);
  const skipVerify = args.includes('--skip-verify');
  const outputArg = args.find((a) => !a.startsWith('--'));
  const outputPath = outputArg ? path.resolve(outputArg) : defaultOutputPath;
  const result = await renderRegistryOverview(outputPath, { verifyLinks: !skipVerify });
  const linkSummary = result.linkStats
    ? ` · verified ${result.linkStats.checked} public URLs (${result.linkStats.missing} missing)`
    : '';
  console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)} with ${result.typeCount} convergence types${linkSummary}`);
}
