#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPPORTED_EXTENSIONS = new Set(['.html', '.htm', '.md', '.txt', '.pdf']);
const SKIPPED_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules']);

function mediaTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'text/html';
  if (ext === '.md') return 'text/markdown';
  if (ext === '.txt') return 'text/plain';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function posixPath(value) {
  return value.split(path.sep).join('/');
}

function expandUserPath(value) {
  const raw = String(value || '');
  if (raw === '~') return process.env.HOME || raw;
  if (raw.startsWith(`~${path.sep}`) || raw.startsWith('~/')) {
    return path.join(process.env.HOME || '~', raw.slice(2));
  }
  return raw;
}

function normalizeLibraryPath(value) {
  const raw = String(value || '').trim().replaceAll('\\', '/');
  if (!raw) throw new Error('Embedded file manifest entry is missing an "as" library path');
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) {
    throw new Error(`Embedded file manifest library path must be relative: ${raw}`);
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    throw new Error(`Embedded file manifest library path cannot escape the library root: ${raw}`);
  }
  return normalized;
}

function titleFromContent(filePath, bytes) {
  const ext = path.extname(filePath).toLowerCase();
  const fallback = path.basename(filePath);
  if (ext === '.pdf') return fallback;
  const text = bytes.toString('utf8');
  if (ext === '.html' || ext === '.htm') {
    const match = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (match?.[1]) return match[1].replace(/\s+/g, ' ').trim() || fallback;
  }
  if (ext === '.md') {
    const match = text.match(/^\s*#\s+(.+)$/m);
    if (match?.[1]) return match[1].trim() || fallback;
  }
  return fallback;
}

async function buildEntry(filePath, libraryPath, options = {}) {
  const bytes = await readFile(filePath);
  return {
    path: libraryPath,
    title: options.title || titleFromContent(filePath, bytes),
    mediaType: mediaTypeForPath(filePath),
    encoding: 'base64',
    byteLength: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    content: bytes.toString('base64'),
  };
}

async function collectFiles(rootPath, options, currentPath = rootPath) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(rootPath, options, entryPath));
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!options.extensions.has(ext)) continue;
    files.push(entryPath);
  }

  return files;
}

export async function buildEmbeddedFileLibrary(rootPath, options = {}) {
  const resolvedRoot = path.resolve(rootPath);
  const stat = await lstat(resolvedRoot);
  if (!stat.isDirectory()) {
    throw new Error(`Embedded file library root must be a directory: ${resolvedRoot}`);
  }

  const extensions = new Set(
    (options.extensions || [...SUPPORTED_EXTENSIONS])
      .map((value) => String(value).toLowerCase().replace(/^\./, ''))
      .map((value) => `.${value}`),
  );
  const filePaths = (await collectFiles(resolvedRoot, { extensions })).sort((a, b) => a.localeCompare(b));
  const entries = [];
  let totalBytes = 0;

  for (const filePath of filePaths) {
    const relativePath = posixPath(path.relative(resolvedRoot, filePath));
    const entry = await buildEntry(filePath, relativePath);
    totalBytes += entry.byteLength;
    entries.push(entry);
  }

  return {
    schema: 'living-doc-embedded-file-library/v1',
    rootLabel: options.rootLabel || path.basename(resolvedRoot) || resolvedRoot,
    generatedAt: new Date().toISOString(),
    source: 'local-folder',
    entryCount: entries.length,
    totalBytes,
    entries,
  };
}

function normalizeManifestFileSpec(spec, index, manifestDir) {
  const raw = typeof spec === 'string' ? { path: spec } : spec;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Embedded file manifest entry ${index + 1} must be a string or object`);
  }
  const source = String(raw.path || raw.file || raw.source || '').trim();
  if (!source) {
    throw new Error(`Embedded file manifest entry ${index + 1} is missing "path"`);
  }
  const resolvedSource = path.isAbsolute(expandUserPath(source))
    ? path.resolve(expandUserPath(source))
    : path.resolve(manifestDir, expandUserPath(source));
  const libraryPath = normalizeLibraryPath(raw.as || raw.libraryPath || raw.embedPath || path.basename(source));
  return {
    source,
    resolvedSource,
    libraryPath,
    title: raw.title ? String(raw.title) : '',
  };
}

export async function buildEmbeddedFileLibraryFromManifest(manifestPath, options = {}) {
  const resolvedManifestPath = path.resolve(expandUserPath(manifestPath));
  const manifestDir = path.dirname(resolvedManifestPath);
  const manifest = JSON.parse(await readFile(resolvedManifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Embedded file manifest must be a JSON object: ${resolvedManifestPath}`);
  }

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (!files.length) {
    throw new Error(`Embedded file manifest has no files: ${resolvedManifestPath}`);
  }

  const specs = files.map((entry, index) => normalizeManifestFileSpec(entry, index, manifestDir));
  const seenLibraryPaths = new Set();
  const entries = [];
  let totalBytes = 0;

  for (const spec of specs) {
    if (seenLibraryPaths.has(spec.libraryPath)) {
      throw new Error(`Embedded file manifest maps multiple files to the same library path: ${spec.libraryPath}`);
    }
    seenLibraryPaths.add(spec.libraryPath);

    const stat = await lstat(spec.resolvedSource);
    if (!stat.isFile()) {
      throw new Error(`Embedded file manifest path must be a file: ${spec.source}`);
    }
    const ext = path.extname(spec.resolvedSource).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      throw new Error(`Embedded file manifest path has unsupported extension: ${spec.source}`);
    }

    const entry = await buildEntry(spec.resolvedSource, spec.libraryPath, { title: spec.title });
    totalBytes += entry.byteLength;
    entries.push(entry);
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    schema: 'living-doc-embedded-file-library/v1',
    rootLabel: options.rootLabel || manifest.rootLabel || manifest.label || path.basename(resolvedManifestPath, path.extname(resolvedManifestPath)),
    generatedAt: new Date().toISOString(),
    source: 'local-manifest',
    entryCount: entries.length,
    totalBytes,
    entries,
  };
}

function printUsageAndExit(code = 1) {
  console.error('Usage: embedded-file-library.mjs <root-folder> [--out file.json] [--root-label LABEL]');
  console.error('       embedded-file-library.mjs --manifest manifest.json [--out file.json] [--root-label LABEL]');
  process.exit(code);
}

async function main() {
  const argv = process.argv.slice(2);
  let rootPath = '';
  let manifestPath = '';
  let outputPath = '';
  let rootLabel = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') printUsageAndExit(0);
    if (arg === '--out') {
      outputPath = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--root-label') {
      rootLabel = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--manifest') {
      manifestPath = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      console.error(`Unknown option: ${arg}`);
      printUsageAndExit(1);
    }
    if (!rootPath) {
      rootPath = arg;
      continue;
    }
    console.error(`Unexpected extra argument: ${arg}`);
    printUsageAndExit(1);
  }

  if (!rootPath && !manifestPath) printUsageAndExit(1);
  if (rootPath && manifestPath) {
    console.error('Use either a root folder or --manifest, not both.');
    printUsageAndExit(1);
  }
  const library = manifestPath
    ? await buildEmbeddedFileLibraryFromManifest(manifestPath, { rootLabel })
    : await buildEmbeddedFileLibrary(rootPath, { rootLabel });
  if (outputPath) {
    await writeFile(path.resolve(outputPath), `${JSON.stringify(library, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(library, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await main();
}
