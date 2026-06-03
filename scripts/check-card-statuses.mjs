#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(__dirname, 'living-doc-registry.json');

export function normalizeStatusToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
}

function cardIdentity(card, index) {
  return String(card?.id ?? card?.name ?? `index:${index}`).trim();
}

function statusFieldsForConvergenceType(ct) {
  if (!ct || typeof ct !== 'object') return [];
  if (ct.projection === 'edge-table') {
    return ct.edgeStatus ? [ct.edgeStatus] : [];
  }
  return Array.isArray(ct.statusFields) ? ct.statusFields : [];
}

function allowedStatusMap(registry, statusSetId) {
  const values = registry?.statusSets?.[statusSetId]?.values ?? [];
  return new Map(values.map((value) => [normalizeStatusToken(value), value]));
}

function statusValueKind(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 'missing';
  return 'invalid';
}

export function checkCardStatuses(doc, registry, options = {}) {
  const findings = [];
  const fixes = [];
  const sectionFilter = options.sectionId ? String(options.sectionId) : '';
  const cardFilter = options.cardId ? String(options.cardId) : '';
  const allowMissing = options.allowMissing === true;

  for (const [sectionIndex, section] of (doc.sections ?? []).entries()) {
    if (sectionFilter && section.id !== sectionFilter) continue;

    const ct = registry.convergenceTypes?.[section.convergenceType];
    if (!ct) {
      findings.push({
        kind: 'unknown-convergence-type',
        sectionId: section.id ?? `index:${sectionIndex}`,
        convergenceType: section.convergenceType ?? '',
        message: `Unknown convergence type: ${section.convergenceType ?? '(missing)'}`,
      });
      continue;
    }

    const statusFields = statusFieldsForConvergenceType(ct);
    if (statusFields.length === 0) continue;

    for (const [cardIndex, card] of (section.data ?? []).entries()) {
      const id = cardIdentity(card, cardIndex);
      if (cardFilter && id !== cardFilter) continue;

      for (const field of statusFields) {
        const key = field.key;
        const statusSetId = field.statusSet;
        const allowed = allowedStatusMap(registry, statusSetId);
        const rawValue = card?.[key];
        const normalized = normalizeStatusToken(rawValue);
        const canonical = allowed.get(normalized);

        if (canonical && rawValue === canonical) continue;

        if (canonical && options.fix) {
          card[key] = canonical;
          fixes.push({
            sectionId: section.id,
            cardId: id,
            convergenceType: section.convergenceType,
            field: key,
            statusSet: statusSetId,
            from: rawValue,
            to: canonical,
          });
          continue;
        }

        if (canonical) {
          findings.push({
            kind: 'normalizable',
            sectionId: section.id,
            cardId: id,
            convergenceType: section.convergenceType,
            field: key,
            statusSet: statusSetId,
            value: rawValue,
            suggestedValue: canonical,
            allowedValues: [...allowed.values()],
            message: `${section.id}/${id}.${key} uses "${rawValue}" but registered value is "${canonical}"`,
          });
          continue;
        }

        const kind = statusValueKind(rawValue);
        if (kind === 'missing' && allowMissing) continue;
        findings.push({
          kind,
          sectionId: section.id,
          cardId: id,
          convergenceType: section.convergenceType,
          field: key,
          statusSet: statusSetId,
          value: rawValue ?? null,
          allowedValues: [...allowed.values()],
          message: `${section.id}/${id}.${key} ${kind === 'missing' ? 'is missing' : `uses unregistered status "${rawValue}"`}`,
        });
      }
    }
  }

  return {
    status: findings.length === 0 ? 'current' : 'diverged',
    checkedAt: new Date().toISOString(),
    findingCount: findings.length,
    fixCount: fixes.length,
    findings,
    fixes,
  };
}

function printUsageAndExit(code = 1) {
  console.error('Usage: check-card-statuses.mjs <living-doc.json> [--fix] [--json] [--section SECTION_ID] [--card CARD_ID] [--allow-missing]');
  process.exit(code);
}

function parseArgs(argv) {
  const options = {
    docPath: '',
    fix: false,
    json: false,
    allowMissing: false,
    sectionId: '',
    cardId: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') printUsageAndExit(0);
    if (arg === '--fix') {
      options.fix = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--allow-missing') {
      options.allowMissing = true;
      continue;
    }
    if (arg === '--section') {
      options.sectionId = argv[++index] ?? '';
      if (!options.sectionId) printUsageAndExit(1);
      continue;
    }
    if (arg === '--card') {
      options.cardId = argv[++index] ?? '';
      if (!options.cardId) printUsageAndExit(1);
      continue;
    }
    if (arg.startsWith('--')) {
      console.error(`Unknown option: ${arg}`);
      printUsageAndExit(1);
    }
    if (!options.docPath) {
      options.docPath = arg;
      continue;
    }
    console.error(`Unexpected extra argument: ${arg}`);
    printUsageAndExit(1);
  }

  if (!options.docPath) printUsageAndExit(1);
  return options;
}

export function formatCardStatusSummary(result, options = {}) {
  const lines = [];
  const filePath = options.filePath ? ` for ${options.filePath}` : '';
  lines.push(`card status check${filePath}: ${result.status}`);
  lines.push(`findings: ${result.findingCount}`);
  if (result.fixCount > 0) lines.push(`fixed: ${result.fixCount}`);
  for (const fix of result.fixes) {
    lines.push(`- fixed ${fix.sectionId}/${fix.cardId}.${fix.field}: ${JSON.stringify(fix.from)} -> ${fix.to}`);
  }
  for (const finding of result.findings) {
    lines.push(`- ${finding.kind}: ${finding.message}`);
    if (finding.suggestedValue) lines.push(`  suggested: ${finding.suggestedValue}`);
    lines.push(`  allowed: ${finding.allowedValues.join(', ') || '(none)'}`);
  }
  return lines.join('\n');
}

function printHuman(result) {
  console.log(formatCardStatusSummary(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const resolvedDocPath = path.resolve(options.docPath);
  const doc = JSON.parse(await readFile(resolvedDocPath, 'utf8'));
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const result = checkCardStatuses(doc, registry, options);

  if (options.fix && result.fixCount > 0) {
    await writeFile(resolvedDocPath, `${JSON.stringify(doc, null, 2)}\n`);
  }

  if (options.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);

  process.exit(result.findingCount === 0 ? 0 : 2);
}
