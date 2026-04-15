#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const docsPath = path.join(repoRoot, 'docs');
const compositorPath = path.join(repoRoot, 'docs', 'living-doc-compositor.html');
const registryPath = path.join(__dirname, 'living-doc-registry.json');
const i18nPath = path.join(__dirname, 'living-doc-i18n.json');

const LOCALES_START = '  /* <generated:locales> */';
const LOCALES_END = '  /* </generated:locales> */';
const REGISTRY_START = '  /* <generated:embedded-registry> */';
const REGISTRY_END = '  /* </generated:embedded-registry> */';
const TEMPLATES_START = '  /* <generated:embedded-templates> */';
const TEMPLATES_END = '  /* </generated:embedded-templates> */';

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

export async function syncCompositorEmbeds(options = {}) {
  const { write = true } = options;
  const [html, registryJson, i18nJson, templates] = await Promise.all([
    readFile(compositorPath, 'utf8'),
    readFile(registryPath, 'utf8'),
    readFile(i18nPath, 'utf8'),
    loadEmbeddedTemplates(),
  ]);

  const registry = JSON.parse(registryJson);
  const locales = JSON.parse(i18nJson);

  const localesBlock = indentBlock(`const LOCALES = ${JSON.stringify(locales, null, 2)};`);
  const registryBlock = indentBlock(`const EMBEDDED_REGISTRY = ${JSON.stringify(registry, null, 2)};`);
  const templatesBlock = indentBlock(`const EMBEDDED_TEMPLATES = ${JSON.stringify(templates, null, 2)};`);

  const withLocales = replaceMarkedBlock(html, LOCALES_START, LOCALES_END, localesBlock);
  const withRegistry = replaceMarkedBlock(withLocales, REGISTRY_START, REGISTRY_END, registryBlock);
  const syncedHtml = replaceMarkedBlock(withRegistry, TEMPLATES_START, TEMPLATES_END, templatesBlock);

  if (syncedHtml !== html) {
    if (write) {
      await writeFile(compositorPath, syncedHtml);
    }
    return { changed: true, path: compositorPath };
  }

  return { changed: false, path: compositorPath };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const checkOnly = process.argv.includes('--check');
  const result = await syncCompositorEmbeds({ write: !checkOnly });
  if (checkOnly) {
    if (result.changed) {
      console.error(`Out of sync: ${path.relative(repoRoot, result.path)}`);
      process.exit(1);
    }
    console.log(`Up to date: ${path.relative(repoRoot, result.path)}`);
  } else {
    console.log(`${result.changed ? 'Synced' : 'Already up to date'} ${path.relative(repoRoot, result.path)}`);
  }
}
