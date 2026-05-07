// Sanitized reader for native Codex inference traces.
//
// Reads Codex session JSONL files and emits proof-safe summaries: hashes,
// timestamps, event counts, and structural signal only. It does not include
// raw prompt, message, reasoning, tool output, or other payload content.

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function increment(map, key) {
  const safeKey = key || '(missing)';
  map[safeKey] = (map[safeKey] || 0) + 1;
}

function hashMaybe(value) {
  if (typeof value !== 'string' || !value) return null;
  return sha256(value);
}

async function walk(dir, acc = []) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      acc.push(full);
    }
  }
  return acc;
}

export async function discoverCodexTraceFiles({ codexHome = path.join(os.homedir(), '.codex'), limit = 50 } = {}) {
  const sessionsDir = path.join(codexHome, 'sessions');
  const archivedDir = path.join(codexHome, 'archived_sessions');
  const files = [
    ...await walk(sessionsDir),
    ...await walk(archivedDir),
  ];
  const withStats = [];
  for (const filePath of files) {
    const info = await stat(filePath);
    withStats.push({
      path: filePath,
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
    });
  }
  return withStats
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, limit);
}

export async function summarizeCodexTrace(tracePath) {
  const raw = await readFile(tracePath, 'utf8');
  const info = await stat(tracePath);
  const lines = raw.split('\n').filter(Boolean);
  const eventTypes = {};
  const payloadTypes = {};
  const responseItemTypes = {};
  const turnModels = {};
  const toolCallNames = {};
  const invalidJsonLines = [];
  const session = {
    id: null,
    source: null,
    cliVersion: null,
    modelProvider: null,
    cwdHash: null,
  };
  let firstTimestamp = null;
  let lastTimestamp = null;

  lines.forEach((line, index) => {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      invalidJsonLines.push(index + 1);
      return;
    }

    if (entry.timestamp) {
      if (!firstTimestamp) firstTimestamp = entry.timestamp;
      lastTimestamp = entry.timestamp;
    }
    increment(eventTypes, entry.type);

    const payload = entry.payload;
    if (!payload || typeof payload !== 'object') return;
    increment(payloadTypes, payload.type);

    if (entry.type === 'session_meta') {
      session.id = payload.id || session.id;
      session.source = payload.source || session.source;
      session.cliVersion = payload.cli_version || session.cliVersion;
      session.modelProvider = payload.model_provider || session.modelProvider;
      session.cwdHash = hashMaybe(payload.cwd) || session.cwdHash;
    }

    if (entry.type === 'turn_context') {
      increment(turnModels, payload.model);
    }

    if (entry.type === 'response_item') {
      increment(responseItemTypes, payload.type);
      if (payload.name) increment(toolCallNames, payload.name);
      if (payload.item?.type) increment(responseItemTypes, payload.item.type);
      if (payload.item?.name) increment(toolCallNames, payload.item.name);
    }
  });

  return {
    schema: 'living-doc-harness-native-trace-summary/v1',
    traceRef: tracePath,
    traceHash: sha256(raw),
    sizeBytes: info.size,
    modifiedAt: info.mtime.toISOString(),
    lineCount: lines.length,
    invalidJsonLines,
    firstTimestamp,
    lastTimestamp,
    session,
    eventTypes,
    payloadTypes,
    responseItemTypes,
    turnModels,
    toolCallNames,
    privacy: {
      rawPayloadIncluded: false,
      contentFieldsOmitted: true,
      cwdIsHashed: true,
    },
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function appendJsonl(filePath, event) {
  await writeFile(filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
}

export async function attachTraceSummaryToRun({ runDir, tracePath, now = new Date().toISOString() } = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!tracePath) throw new Error('tracePath is required');

  const summary = await summarizeCodexTrace(tracePath);
  const tracesDir = path.join(runDir, 'traces');
  await mkdir(tracesDir, { recursive: true });
  const summaryFile = `${path.basename(tracePath).replace(/\.jsonl$/i, '')}.summary.json`;
  const summaryPath = path.join(tracesDir, summaryFile);
  await writeJson(summaryPath, summary);

  const contractPath = path.join(runDir, 'contract.json');
  const statePath = path.join(runDir, 'state.json');
  const eventsPath = path.join(runDir, 'events.jsonl');
  const contract = await readJson(contractPath);
  const state = await readJson(statePath);

  if (!contract.artifacts) contract.artifacts = {};
  if (!Array.isArray(contract.artifacts.nativeTraceRefs)) contract.artifacts.nativeTraceRefs = [];
  const traceRef = {
    traceRef: summary.traceRef,
    summaryPath: path.relative(runDir, summaryPath),
    traceHash: summary.traceHash,
    lineCount: summary.lineCount,
    firstTimestamp: summary.firstTimestamp,
    lastTimestamp: summary.lastTimestamp,
    rawPayloadIncluded: false,
  };
  if (!contract.artifacts.nativeTraceRefs.some((ref) => ref.traceHash === traceRef.traceHash)) {
    contract.artifacts.nativeTraceRefs.push(traceRef);
  }
  contract.updatedAt = now;

  state.updatedAt = now;
  state.nativeTraceRefs = contract.artifacts.nativeTraceRefs;
  state.nextAction = 'emit iteration proof handover from native trace summary';

  await writeJson(contractPath, contract);
  await writeJson(statePath, state);
  await appendJsonl(eventsPath, {
    event: 'native-trace-summary-attached',
    at: now,
    runId: contract.runId,
    summaryPath: traceRef.summaryPath,
    traceHash: traceRef.traceHash,
  });

  return {
    runDir,
    summaryPath,
    traceRef,
    summary,
  };
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!command || !['discover', 'summarize', 'attach'].includes(command)) {
    throw new Error('usage: living-doc-harness-trace-reader.mjs <discover|summarize|attach> [args] [--out <file>] [--codex-home <dir>] [--limit <n>]');
  }
  const options = {
    command,
    tracePath: null,
    runDir: null,
    out: null,
    codexHome: path.join(os.homedir(), '.codex'),
    limit: 50,
  };
  if (command === 'summarize') {
    options.tracePath = args.shift();
    if (!options.tracePath) throw new Error('summarize requires a trace.jsonl path');
  } else if (command === 'attach') {
    options.runDir = args.shift();
    options.tracePath = args.shift();
    if (!options.runDir || !options.tracePath) throw new Error('attach requires <runDir> <trace.jsonl>');
  }
  while (args.length) {
    const flag = args.shift();
    if (flag === '--out') {
      options.out = args.shift();
      if (!options.out) throw new Error('--out requires a value');
    } else if (flag === '--codex-home') {
      options.codexHome = args.shift();
      if (!options.codexHome) throw new Error('--codex-home requires a value');
    } else if (flag === '--limit') {
      options.limit = Number(args.shift());
      if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error('--limit requires an integer >= 1');
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  return options;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.command === 'discover'
      ? await discoverCodexTraceFiles({ codexHome: options.codexHome, limit: options.limit })
      : options.command === 'attach'
        ? await attachTraceSummaryToRun({ runDir: options.runDir, tracePath: options.tracePath })
        : await summarizeCodexTrace(options.tracePath);
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (options.out) {
      await writeFile(options.out, json, 'utf8');
    } else {
      process.stdout.write(json);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
