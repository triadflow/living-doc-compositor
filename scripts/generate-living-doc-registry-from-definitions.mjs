#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convergenceTypeDefinitions } from './living-doc-definitions/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultRegistryPath = path.join(repoRoot, 'scripts/living-doc-registry.json');

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function definitionMap(definitions) {
  const map = new Map();
  for (const definition of definitions) {
    if (map.has(definition.id)) throw new Error(`Duplicate convergence type definition: ${definition.id}`);
    map.set(definition.id, definition);
  }
  return map;
}

function registryEntryFromDefinition(definition, currentEntry = {}) {
  const entry = clonePlain(definition.registryEntry);
  delete entry.id;

  for (const generatedField of definition.generatedFields || []) {
    if (currentEntry[generatedField] !== undefined) {
      entry[generatedField] = clonePlain(currentEntry[generatedField]);
    }
  }

  return entry;
}

export function buildRegistryFromDefinitions(registry, {
  definitions = convergenceTypeDefinitions,
  strict = false,
} = {}) {
  const source = clonePlain(registry);
  const definitionsById = definitionMap(definitions);
  const currentTypes = source.convergenceTypes || {};
  const missingDefinitions = Object.keys(currentTypes)
    .filter((typeId) => !definitionsById.has(typeId))
    .sort();

  if (strict && missingDefinitions.length > 0) {
    throw new Error(
      `Strict registry generation requires code definitions for all convergence types. Missing: ${missingDefinitions.join(', ')}`,
    );
  }

  const nextTypes = {};
  for (const [typeId, currentEntry] of Object.entries(currentTypes)) {
    const definition = definitionsById.get(typeId);
    nextTypes[typeId] = definition
      ? registryEntryFromDefinition(definition, currentEntry)
      : clonePlain(currentEntry);
  }

  for (const [typeId, definition] of [...definitionsById.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (nextTypes[typeId]) continue;
    nextTypes[typeId] = registryEntryFromDefinition(definition);
  }

  source.convergenceTypes = nextTypes;
  return {
    registry: source,
    definedTypeIds: [...definitionsById.keys()].sort(),
    legacyTypeIds: missingDefinitions,
  };
}

export async function syncRegistryFromDefinitions({
  registryPath = defaultRegistryPath,
  definitions = convergenceTypeDefinitions,
  check = false,
  strict = false,
} = {}) {
  const current = await readFile(registryPath, 'utf8');
  const source = JSON.parse(current);
  const result = buildRegistryFromDefinitions(source, { definitions, strict });
  const next = `${JSON.stringify(result.registry, null, 2)}\n`;
  const changed = current !== next;

  if (check) {
    return { ...result, ok: !changed, changed };
  }

  if (changed) await writeFile(registryPath, next);
  return { ...result, ok: true, changed };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const check = process.argv.includes('--check');
  const strict = process.argv.includes('--strict');

  try {
    const result = await syncRegistryFromDefinitions({ check, strict });
    const summary = `${result.definedTypeIds.length} code-defined type(s), ${result.legacyTypeIds.length} legacy type(s)`;
    if (check) {
      if (!result.ok) {
        console.error(
          `scripts/living-doc-registry.json is out of date with code-defined convergence types. Run node scripts/generate-living-doc-registry-from-definitions.mjs`,
        );
        process.exit(1);
      }
      console.log(`registry definitions are up to date: ${summary}`);
    } else if (result.changed) {
      console.log(`Wrote scripts/living-doc-registry.json from convergence type definitions: ${summary}`);
    } else {
      console.log(`registry definitions already up to date: ${summary}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
