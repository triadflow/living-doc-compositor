#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderRegistryOverview } from './render-registry-overview.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const docsPath = path.join(repoRoot, 'docs');
const compositorPath = path.join(repoRoot, 'docs', 'living-doc-compositor.html');
const overviewPath = path.join(repoRoot, 'docs', 'living-doc-registry-overview.html');
const registryPath = path.join(__dirname, 'living-doc-registry.json');
const i18nPath = path.join(__dirname, 'living-doc-i18n.json');
const rendererPath = path.join(__dirname, 'render-living-doc.mjs');
const fingerprintPath = path.join(__dirname, 'meta-fingerprint.mjs');
const syncEmbedsSourcePath = path.join(__dirname, 'sync-compositor-embeds.mjs');
const jszipPath = path.join(__dirname, 'vendor', 'jszip.min.js');
const profilesDir = path.join(__dirname, 'living-doc-profiles');

const LOCALES_START = '  /* <generated:locales> */';
const LOCALES_END = '  /* </generated:locales> */';
const REGISTRY_START = '  /* <generated:embedded-registry> */';
const REGISTRY_END = '  /* </generated:embedded-registry> */';
const TEMPLATES_START = '  /* <generated:embedded-templates> */';
const TEMPLATES_END = '  /* </generated:embedded-templates> */';
const PROFILES_START = '  /* <generated:embedded-profiles> */';
const PROFILES_END = '  /* </generated:embedded-profiles> */';
const RENDERER_START = '  /* <generated:embedded-renderer> */';
const RENDERER_END = '  /* </generated:embedded-renderer> */';
const SYNC_EMBEDS_START = '  /* <generated:embedded-sync-embeds> */';
const SYNC_EMBEDS_END = '  /* </generated:embedded-sync-embeds> */';
const FINGERPRINT_START = '  /* <generated:embedded-fingerprint> */';
const FINGERPRINT_END = '  /* </generated:embedded-fingerprint> */';
const JSZIP_START = '/* <generated:embedded-jszip> */';
const JSZIP_END = '/* </generated:embedded-jszip> */';

function escapeClosingScript(code) {
  return String(code).replace(/<\/script/gi, '<\\/script');
}

function indentBlock(text, indent = '  ') {
  return String(text)
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
}

function replaceMarkedBlock(source, startMarker, endMarker, body) {
  const startIndex = source.indexOf(startMarker);
  if (startIndex < 0) {
    throw new Error(`Missing start marker: ${startMarker}`);
  }
  const endIndex = source.indexOf(endMarker, startIndex);
  if (endIndex < 0) {
    throw new Error(`Missing end marker: ${endMarker}`);
  }

  const before = source.slice(0, startIndex);
  const after = source.slice(endIndex + endMarker.length);
  return `${before}${startMarker}\n${body}\n${endMarker}${after}`;
}

async function loadEmbeddedTemplates() {
  const filenames = (await readdir(docsPath))
    .filter((name) => name.startsWith('living-doc-template-') && name.endsWith('.json'))
    .sort();

  const templates = [];
  for (const filename of filenames) {
    const jsonPath = path.join(docsPath, filename);
    const json = JSON.parse(await readFile(jsonPath, 'utf8'));
    const sections = Array.isArray(json.sections) ? json.sections : [];
    const templateMeta = json.templateMeta && typeof json.templateMeta === 'object' ? json.templateMeta : {};
    templates.push({
      filename,
      htmlFilename: filename.replace(/\.json$/i, '.html'),
      title: String(json.title ?? filename).trim(),
      subtitle: String(json.subtitle ?? '').trim(),
      scope: String(json.scope ?? json.docScope ?? '').trim(),
      objective: String(json.objective ?? '').trim(),
      successCondition: String(json.successCondition ?? '').trim(),
      updated: typeof json.updated === 'string' ? json.updated : '',
      sectionCount: sections.length,
      sectionTitles: sections.map((section) => String(section?.title ?? '').trim()).filter(Boolean),
      sectionTypes: sections.map((section) => String(section?.convergenceType ?? '').trim()).filter(Boolean),
      templateMeta,
      json,
    });
  }

  return templates;
}

async function loadEmbeddedProfiles() {
  let names;
  try {
    names = (await readdir(profilesDir))
      .filter((n) => n.endsWith('.json') && n !== 'index.json')
      .sort();
  } catch {
    return [];
  }
  const profiles = [];
  for (const name of names) {
    const body = await readFile(path.join(profilesDir, name), 'utf8');
    try { profiles.push(JSON.parse(body)); } catch {}
  }
  return profiles;
}

export async function syncCompositorEmbeds(options = {}) {
  const { write = true } = options;
  const [html, registryJson, i18nJson, templates, profiles, rendererSrc, fingerprintSrc, syncEmbedsSrc, jszipSrc] = await Promise.all([
    readFile(compositorPath, 'utf8'),
    readFile(registryPath, 'utf8'),
    readFile(i18nPath, 'utf8'),
    loadEmbeddedTemplates(),
    loadEmbeddedProfiles(),
    readFile(rendererPath, 'utf8'),
    readFile(fingerprintPath, 'utf8'),
    readFile(syncEmbedsSourcePath, 'utf8'),
    readFile(jszipPath, 'utf8').catch(() => ''),
  ]);

  const registry = JSON.parse(registryJson);
  const locales = JSON.parse(i18nJson);

  const localesBlock = indentBlock(`const LOCALES = ${JSON.stringify(locales, null, 2)};`);
  const registryBlock = indentBlock(`const EMBEDDED_REGISTRY = ${JSON.stringify(registry, null, 2)};`);
  const templatesBlock = indentBlock(`const EMBEDDED_TEMPLATES = ${JSON.stringify(templates, null, 2)};`);
  const profilesBlock = indentBlock(`const EMBEDDED_PROFILES = ${JSON.stringify(profiles, null, 2)};`);
  // Source-as-string embeds: base64-encoded so the contents can't contain our own marker strings
  // (sync-compositor-embeds.mjs inlines itself; the markers must not match as substrings on re-run).
  const toB64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
  const rendererBlock = indentBlock(`const EMBEDDED_RENDERER_B64 = ${JSON.stringify(toB64(rendererSrc))};`);
  const fingerprintBlock = indentBlock(`const EMBEDDED_FINGERPRINT_B64 = ${JSON.stringify(toB64(fingerprintSrc))};`);
  const syncEmbedsBlock = indentBlock(`const EMBEDDED_SYNC_EMBEDS_B64 = ${JSON.stringify(toB64(syncEmbedsSrc))};`);
  // JSZip: inlined verbatim into its own <script> tag. Defensive escape of </script.
  const jszipBlock = jszipSrc ? escapeClosingScript(jszipSrc) : '/* JSZip not vendored — run scripts/vendor/jszip.min.js download to enable offline bundle export */';

  let out = html;
  out = replaceMarkedBlock(out, LOCALES_START, LOCALES_END, localesBlock);
  out = replaceMarkedBlock(out, REGISTRY_START, REGISTRY_END, registryBlock);
  out = replaceMarkedBlock(out, TEMPLATES_START, TEMPLATES_END, templatesBlock);
  out = replaceMarkedBlock(out, PROFILES_START, PROFILES_END, profilesBlock);
  out = replaceMarkedBlock(out, RENDERER_START, RENDERER_END, rendererBlock);
  out = replaceMarkedBlock(out, FINGERPRINT_START, FINGERPRINT_END, fingerprintBlock);
  out = replaceMarkedBlock(out, SYNC_EMBEDS_START, SYNC_EMBEDS_END, syncEmbedsBlock);
  out = replaceMarkedBlock(out, JSZIP_START, JSZIP_END, jszipBlock);

  const compositorChanged = out !== html;
  if (compositorChanged && write) {
    await writeFile(compositorPath, out);
  }

  // Keep the registry overview page in sync with the registry. Skip the
  // network HEAD checks that the standalone CLI does — keeping sync local and
  // CI-friendly. Run the standalone command when you want public-URL verification.
  const overview = await renderRegistryOverview(overviewPath, { write: false, verifyLinks: false });
  const existingOverview = await readFile(overviewPath, 'utf8').catch(() => '');
  const overviewChanged = overview.html !== existingOverview;
  if (overviewChanged && write) {
    await writeFile(overviewPath, overview.html);
  }

  return {
    changed: compositorChanged || overviewChanged,
    compositor: { path: compositorPath, changed: compositorChanged },
    overview: { path: overviewPath, changed: overviewChanged },
  };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const checkOnly = process.argv.includes('--check');
  const result = await syncCompositorEmbeds({ write: !checkOnly });
  const targets = [result.compositor, result.overview];
  if (checkOnly) {
    const drifted = targets.filter((t) => t.changed);
    if (drifted.length > 0) {
      for (const t of drifted) {
        console.error(`Out of sync: ${path.relative(repoRoot, t.path)}`);
      }
      process.exit(1);
    }
    for (const t of targets) {
      console.log(`Up to date: ${path.relative(repoRoot, t.path)}`);
    }
  } else {
    for (const t of targets) {
      console.log(`${t.changed ? 'Synced' : 'Already up to date'} ${path.relative(repoRoot, t.path)}`);
    }
  }
}
