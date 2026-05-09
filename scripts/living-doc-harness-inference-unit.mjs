#!/usr/bin/env node
// Contract-bound inference unit runner for the standalone living-doc harness.
//
// A unit is the primitive the harness can chain: prompt + input contract +
// evidence paths + context -> headless inference run -> structured result +
// validation + proof log.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function slug(value) {
  return String(value || 'unit')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unit';
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function copyIfExists(sourcePath, targetPath, fallback = '') {
  await mkdir(path.dirname(targetPath), { recursive: true });
  if (!sourcePath) {
    await writeFile(targetPath, fallback, 'utf8');
    return false;
  }
  try {
    await copyFile(sourcePath, targetPath);
    return true;
  } catch {
    await writeFile(targetPath, fallback, 'utf8');
    return false;
  }
}

async function appendJsonl(filePath, event) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('inference unit produced empty output');
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('inference unit output did not contain JSON');
  }
}

async function runCodex({ codexBin, cwd, prompt, stdoutPath, stderrPath, lastMessagePath }) {
  await mkdir(path.dirname(stdoutPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(codexBin, ['exec', '--json', '-C', cwd, '-o', lastMessagePath, '-'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutStream = createWriteStream(stdoutPath, { flags: 'w' });
    const stderrStream = createWriteStream(stderrPath, { flags: 'w' });
    let stdout = '';
    let stderr = '';
    let streamError = null;
    stdoutStream.on('error', (err) => { streamError = err; child.kill('SIGTERM'); });
    stderrStream.on('error', (err) => { streamError = err; child.kill('SIGTERM'); });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      stdoutStream.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      stderrStream.write(chunk);
    });
    child.on('error', (err) => {
      stdoutStream.end();
      stderrStream.end();
      reject(err);
    });
    child.on('close', async (code) => {
      await Promise.all([
        new Promise((finish) => stdoutStream.end(finish)),
        new Promise((finish) => stderrStream.end(finish)),
      ]);
      if (streamError) {
        reject(streamError);
        return;
      }
      if (code !== 0) {
        reject(new Error(`inference unit command exited ${code}: ${stderr || stdout}`));
      } else {
        resolve(stdout);
      }
    });
    child.stdin.end(prompt);
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function pathWasInspected(command, targetPath) {
  const text = String(command || '');
  if (!text || !targetPath) return false;
  return text.includes(targetPath) || text.includes(shellQuote(targetPath)) || text.includes(path.basename(targetPath));
}

async function assertRequiredInspectionPaths({ eventsPath, requiredInspectionPaths = [] }) {
  const targets = arr(requiredInspectionPaths).filter(Boolean);
  if (!targets.length) return;
  let raw = '';
  try {
    raw = await readFile(eventsPath, 'utf8');
  } catch {
    throw new Error(`inference unit events log is missing: ${eventsPath}`);
  }
  const inspected = new Set();
  for (const line of raw.split('\n').filter(Boolean)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const item = entry.item;
    if (item?.type !== 'command_execution') continue;
    for (const target of targets) {
      if (pathWasInspected(item.command, target)) inspected.add(target);
    }
  }
  const missing = targets.filter((target) => !inspected.has(target));
  if (missing.length) {
    throw new Error(`inference unit did not inspect required path(s): ${missing.join(', ')}`);
  }
}

export function validateInferenceUnitResult(result) {
  const violations = [];
  if (result?.schema !== 'living-doc-contract-bound-inference-result/v1') {
    violations.push({ path: '$.schema', message: 'schema must be living-doc-contract-bound-inference-result/v1' });
  }
  for (const key of ['unitId', 'role', 'status']) {
    if (typeof result?.[key] !== 'string' || !result[key]) {
      violations.push({ path: `$.${key}`, message: `${key} is required` });
    }
  }
  if (!Array.isArray(result?.basis) || result.basis.length === 0) {
    violations.push({ path: '$.basis', message: 'basis must contain at least one item' });
  }
  if (!result?.outputContract || typeof result.outputContract !== 'object') {
    violations.push({ path: '$.outputContract', message: 'outputContract is required' });
  }
  for (const key of ['promptPath', 'inputContractPath', 'codexEventsPath', 'lastMessagePath']) {
    if (typeof result?.[key] !== 'string' || !result[key]) {
      violations.push({ path: `$.${key}`, message: `${key} is required` });
    }
  }
  return { ok: violations.length === 0, violations };
}

export async function runContractBoundInferenceUnit({
  runDir,
  rootDir = 'inference-units',
  iteration = 1,
  sequence = 1,
  unitId,
  role,
  prompt,
  inputContract,
  outputContract = null,
  fixtureResult = null,
  execute = false,
  codexBin = 'codex',
  cwd = process.cwd(),
  now = new Date().toISOString(),
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!unitId) throw new Error('unitId is required');
  if (!role) throw new Error('role is required');
  if (!prompt) throw new Error('prompt is required');
  if (!inputContract || typeof inputContract !== 'object') throw new Error('inputContract is required');

  const sequenceLabel = String(sequence).padStart(2, '0');
  const unitDir = path.join(runDir, rootDir, `iteration-${iteration}`, `${sequenceLabel}-${slug(unitId)}`);
  const promptPath = path.join(unitDir, 'prompt.md');
  const inputContractPath = path.join(unitDir, 'input-contract.json');
  const codexEventsPath = path.join(unitDir, 'codex-events.jsonl');
  const stderrPath = path.join(unitDir, 'stderr.log');
  const lastMessagePath = path.join(unitDir, 'last-message.txt');
  const resultPath = path.join(unitDir, 'result.json');
  const validationPath = path.join(unitDir, 'validation.json');

  await mkdir(unitDir, { recursive: true });
  await writeFile(promptPath, prompt, 'utf8');
  await writeJson(inputContractPath, inputContract);

  let rawResult;
  let mode = 'fixture';
  if (execute) {
    mode = 'headless-codex';
    const stdout = await runCodex({ codexBin, cwd, prompt, stdoutPath: codexEventsPath, stderrPath, lastMessagePath });
    await assertRequiredInspectionPaths({
      eventsPath: codexEventsPath,
      requiredInspectionPaths: inputContract.requiredInspectionPaths,
    });
    const lastMessage = await readFile(lastMessagePath, 'utf8').catch(() => stdout);
    rawResult = extractJson(lastMessage || stdout);
  } else {
    rawResult = fixtureResult || outputContract || {
      status: 'no-op',
      basis: ['Fixture-mode inference unit produced a deterministic no-op result.'],
    };
    await writeFile(lastMessagePath, `${JSON.stringify(rawResult, null, 2)}\n`, 'utf8');
    await writeFile(stderrPath, '', 'utf8');
    await appendJsonl(codexEventsPath, {
      type: 'turn.completed',
      item: {
        type: 'agent_message',
        status: 'completed',
        mode: 'fixture',
        unitId,
        role,
      },
    });
  }

  const result = {
    schema: 'living-doc-contract-bound-inference-result/v1',
    unitId,
    role,
    mode,
    iteration,
    sequence,
    createdAt: now,
    promptPath: path.relative(runDir, promptPath),
    inputContractPath: path.relative(runDir, inputContractPath),
    codexEventsPath: path.relative(runDir, codexEventsPath),
    lastMessagePath: path.relative(runDir, lastMessagePath),
    stderrPath: path.relative(runDir, stderrPath),
    status: rawResult.status || rawResult.verdict || 'no-op',
    basis: arr(rawResult.basis).length ? rawResult.basis : ['Inference unit completed without a detailed basis.'],
    outputContract: rawResult.outputContract || rawResult,
  };
  const validation = validateInferenceUnitResult(result);
  await writeJson(resultPath, result);
  await writeJson(validationPath, validation);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'contract-bound-inference-unit-written',
    at: now,
    unitId,
    role,
    iteration,
    sequence,
    mode,
    status: result.status,
    resultPath: path.relative(runDir, resultPath),
    validationPath: path.relative(runDir, validationPath),
  });
  if (!validation.ok) {
    throw new Error(`invalid inference unit result: ${validation.violations.map((v) => v.message).join('; ')}`);
  }

  return {
    unitDir,
    promptPath,
    inputContractPath,
    codexEventsPath,
    stderrPath,
    lastMessagePath,
    resultPath,
    validationPath,
    result,
    validation,
  };
}

export async function writeContractBoundInferenceUnitSnapshot({
  runDir,
  rootDir = 'inference-units',
  iteration = 1,
  sequence = 1,
  unitId,
  role,
  prompt,
  inputContract,
  sourcePaths = {},
  mode = 'snapshot',
  status = 'recorded',
  basis = ['Inference unit snapshot was recorded from an externally managed process.'],
  outputContract = {},
  now = new Date().toISOString(),
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!unitId) throw new Error('unitId is required');
  if (!role) throw new Error('role is required');
  if (!prompt) throw new Error('prompt is required');
  if (!inputContract || typeof inputContract !== 'object') throw new Error('inputContract is required');

  const sequenceLabel = String(sequence).padStart(2, '0');
  const unitDir = path.join(runDir, rootDir, `iteration-${iteration}`, `${sequenceLabel}-${slug(unitId)}`);
  const promptPath = path.join(unitDir, 'prompt.md');
  const inputContractPath = path.join(unitDir, 'input-contract.json');
  const codexEventsPath = path.join(unitDir, 'codex-events.jsonl');
  const stderrPath = path.join(unitDir, 'stderr.log');
  const lastMessagePath = path.join(unitDir, 'last-message.txt');
  const resultPath = path.join(unitDir, 'result.json');
  const validationPath = path.join(unitDir, 'validation.json');

  await mkdir(unitDir, { recursive: true });
  await writeFile(promptPath, prompt, 'utf8');
  await writeJson(inputContractPath, inputContract);
  await copyIfExists(sourcePaths.codexEventsPath, codexEventsPath);
  await copyIfExists(sourcePaths.stderrPath, stderrPath);
  await copyIfExists(sourcePaths.lastMessagePath, lastMessagePath);

  const result = {
    schema: 'living-doc-contract-bound-inference-result/v1',
    unitId,
    role,
    mode,
    iteration,
    sequence,
    createdAt: now,
    promptPath: path.relative(runDir, promptPath),
    inputContractPath: path.relative(runDir, inputContractPath),
    codexEventsPath: path.relative(runDir, codexEventsPath),
    lastMessagePath: path.relative(runDir, lastMessagePath),
    stderrPath: path.relative(runDir, stderrPath),
    status,
    basis: arr(basis).length ? basis : ['Inference unit snapshot recorded.'],
    outputContract,
  };
  const validation = validateInferenceUnitResult(result);
  await writeJson(resultPath, result);
  await writeJson(validationPath, validation);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'contract-bound-inference-unit-written',
    at: now,
    unitId,
    role,
    iteration,
    sequence,
    mode,
    status: result.status,
    resultPath: path.relative(runDir, resultPath),
    validationPath: path.relative(runDir, validationPath),
  });
  if (!validation.ok) {
    throw new Error(`invalid inference unit snapshot: ${validation.violations.map((v) => v.message).join('; ')}`);
  }

  return {
    unitDir,
    promptPath,
    inputContractPath,
    codexEventsPath,
    stderrPath,
    lastMessagePath,
    resultPath,
    validationPath,
    result,
    validation,
  };
}
