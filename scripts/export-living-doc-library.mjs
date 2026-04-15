#!/usr/bin/env node
import { access, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const defaultCatalogPath = path.join(os.homedir(), '.gtd', 'living-docs.json');
const defaultOutputPath = path.join(repoRoot, 'docs', 'living-doc-library.local.json');

function parseArgs(argv) {
  const options = {
    catalogPath: process.env.LIVING_DOC_CATALOG_PATH || defaultCatalogPath,
    outputPath: process.env.LIVING_DOC_LIBRARY_OUTPUT || defaultOutputPath,
    shareSafe: argv.includes('--share-safe'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--catalog' && argv[index + 1]) {
      options.catalogPath = argv[index + 1];
      index += 1;
    } else if (arg === '--out' && argv[index + 1]) {
      options.outputPath = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'living-doc';
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readDocMeta(htmlPath) {
  try {
    const html = await readFile(htmlPath, 'utf8');
    const match = html.match(/<script[^>]*id=["']doc-meta["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return null;
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function makeRelativeIfInside(filePath, baseDir) {
  const relative = path.relative(baseDir, filePath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join('/');
  }
  return null;
}

async function buildEntry(catalogEntry, options) {
  const htmlPath = catalogEntry?.doc_path ? path.resolve(catalogEntry.doc_path) : '';
  const jsonPath = htmlPath ? htmlPath.replace(/\.html$/i, '.json') : '';
  const htmlExists = htmlPath ? await fileExists(htmlPath) : false;
  const jsonExists = jsonPath ? await fileExists(jsonPath) : false;
  const docMeta = htmlExists ? await readDocMeta(htmlPath) : null;
  const outputDir = path.dirname(path.resolve(options.outputPath));
  const relativeHtml = htmlPath ? makeRelativeIfInside(htmlPath, outputDir) : null;
  const relativeJson = jsonPath ? makeRelativeIfInside(jsonPath, outputDir) : null;
  const domain = String(catalogEntry?.domain || docMeta?.docId || docMeta?.title || '').trim();
  const repo = String(catalogEntry?.repo || '').trim();
  const idSeed = [repo, domain || docMeta?.title || htmlPath].filter(Boolean).join(':');

  const entry = {
    id: slugify(idSeed),
    title: String(docMeta?.title || domain || path.basename(htmlPath, '.html') || 'Living doc').trim(),
    subtitle: String(docMeta?.subtitle || '').trim() || undefined,
    domain: domain || undefined,
    repo: repo || undefined,
    href: relativeHtml || undefined,
    jsonHref: relativeJson || undefined,
    updated: typeof docMeta?.updated === 'string' ? docMeta.updated : undefined,
    createdAt: catalogEntry?.created_at || undefined,
    sectionCount: Array.isArray(docMeta?.sections) ? docMeta.sections.length : undefined,
    syncSkill: catalogEntry?.sync_skill || undefined,
    summary: docMeta?.objective || docMeta?.scope || undefined,
    loadable: Boolean(relativeJson),
  };

  if (!options.shareSafe) {
    entry.localHtmlPath = htmlPath || undefined;
    entry.localJsonPath = jsonExists ? jsonPath : undefined;
    entry.localHtmlUrl = htmlPath ? pathToFileURL(htmlPath).href : undefined;
    entry.localJsonUrl = jsonExists ? pathToFileURL(jsonPath).href : undefined;
  }

  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined && value !== ''));
}

export async function exportLivingDocLibrary(options) {
  const catalog = JSON.parse(await readFile(options.catalogPath, 'utf8'));
  const entries = [];

  for (const catalogEntry of Array.isArray(catalog) ? catalog : []) {
    entries.push(await buildEntry(catalogEntry, options));
  }

  const manifest = {
    schema: 'living-doc-library-manifest/v1',
    generatedAt: new Date().toISOString(),
    source: options.shareSafe ? 'sanitized-gtd-catalog' : 'local-gtd-catalog',
    shareSafe: Boolean(options.shareSafe),
    entries,
  };

  await writeFile(options.outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const options = parseArgs(process.argv.slice(2));
  const manifest = await exportLivingDocLibrary(options);
  console.log(`Wrote ${path.relative(repoRoot, options.outputPath)} with ${manifest.entries.length} entries`);
}
