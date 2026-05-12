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

import { resolveInferenceToolProfile } from './living-doc-harness-tool-profile.mjs';
import {
  DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
  getInferenceUnitType,
  registryMetadataForUnit,
  validateInferenceUnitAllowed,
} from './living-doc-harness-inference-unit-types.mjs';

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function modeAllowsLifecycleStatus(mode) {
  return [
    'prepared',
    'snapshot',
    'external-headless-codex-starting',
  ].includes(mode);
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

async function runCodex({ codexBin, cwd, prompt, stdoutPath, stderrPath, lastMessagePath, toolProfile }) {
  await mkdir(path.dirname(stdoutPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(codexBin, [
      'exec',
      '--json',
      ...arr(toolProfile?.codexArgs),
      '-C',
      cwd,
      '-o',
      lastMessagePath,
      '-',
    ], {
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
  const lifecycleStatuses = new Set(['prepared', 'starting', 'running', 'finished', 'failed']);
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
  if (!result?.unitType || typeof result.unitType !== 'object') {
    violations.push({ path: '$.unitType', message: 'unitType registry metadata is required' });
  } else {
    for (const key of ['unitTypeId', 'inputContractSchema', 'outputContractSchema', 'allowedNextUnitTypes', 'deterministicSideEffects', 'dashboard', 'closureImplications']) {
      if (result.unitType[key] == null) violations.push({ path: `$.unitType.${key}`, message: `${key} is required` });
    }
  }
  for (const key of ['promptPath', 'inputContractPath', 'codexEventsPath', 'lastMessagePath']) {
    if (typeof result?.[key] !== 'string' || !result[key]) {
      violations.push({ path: `$.${key}`, message: `${key} is required` });
    }
  }
  try {
    const type = getInferenceUnitType(result?.unitType?.unitTypeId || result?.unitId);
    const statusAllowed = type.outputVerdicts.includes(result?.status)
      || (lifecycleStatuses.has(result?.status) && modeAllowsLifecycleStatus(result?.mode));
    if (!statusAllowed) {
      violations.push({ path: '$.status', message: `status must be one of registered output verdicts: ${type.outputVerdicts.join(', ')}` });
    }
    if (result?.outputContract?.schema !== type.outputContract.schema) {
      violations.push({ path: '$.outputContract.schema', message: `outputContract schema must be ${type.outputContract.schema}` });
    }
    if (result?.outputContract?.status != null
      && !type.outputVerdicts.includes(result.outputContract.status)
      && !modeAllowsLifecycleStatus(result?.mode)) {
      violations.push({ path: '$.outputContract.status', message: `outputContract status must be one of registered output verdicts: ${type.outputVerdicts.join(', ')}` });
    }
    for (const field of arr(type.outputContract.requiredFields)) {
      if (result?.outputContract?.[field] == null) {
        violations.push({ path: `$.outputContract.${field}`, message: `${field} is required by ${type.id} output contract` });
      }
    }
  } catch (err) {
    violations.push({ path: '$.unitType.unitTypeId', message: err.message });
  }
  return { ok: violations.length === 0, violations };
}

export function validateInferenceUnitInputContract({ unitTypeId, inputContract }) {
  const violations = [];
  try {
    const type = getInferenceUnitType(unitTypeId);
    if (inputContract?.schema !== type.inputContract.schema) {
      violations.push({
        path: '$.schema',
        message: `inputContract schema must be ${type.inputContract.schema}`,
      });
    }
    for (const field of arr(type.inputContract.requiredFields)) {
      if (inputContract?.[field] == null) {
        violations.push({
          path: `$.${field}`,
          message: `${field} is required by ${type.id} input contract`,
        });
      }
    }
  } catch (err) {
    violations.push({ path: '$.unitTypeId', message: err.message });
  }
  return { ok: violations.length === 0, violations };
}

function statusFromRawResult(rawResult) {
  if (rawResult?.status) return rawResult.status;
  if (rawResult?.verdict) return rawResult.verdict;
  if (rawResult?.schema === 'living-doc-harness-stop-verdict/v1') return rawResult.stopVerdict?.classification;
  if (rawResult?.schema === 'living-doc-harness-closure-review/v1') {
    return rawResult.approved === true && rawResult.terminalAllowed === true ? 'approved' : 'blocked';
  }
  return 'no-op';
}

function normalizePrReviewOutputContract({ output, mode }) {
  if (modeAllowsLifecycleStatus(mode)) return output;
  const allowedStatuses = getInferenceUnitType('pr-review').outputVerdicts;
  if (allowedStatuses.includes(output?.status)) return output;
  const previousReasonCode = output?.sideEffect?.reasonCode || output?.reasonCode || null;
  const reasonCode = previousReasonCode === 'unit-not-finalized'
    ? 'pr-review-non-verdict-output'
    : previousReasonCode || 'pr-review-non-verdict-output';
  return {
    ...output,
    status: 'blocked',
    reasonCode,
    basis: arr(output?.basis).length
      ? output.basis
      : ['PR-review unit completed without emitting an approved, not-required, blocked, or failed verdict.'],
    approvedActions: arr(output?.approvedActions),
    sideEffect: {
      ...(output?.sideEffect && typeof output.sideEffect === 'object' ? output.sideEffect : {}),
      type: output?.sideEffect?.type || 'github-pr-review',
      executed: output?.sideEffect?.executed === true,
      reasonCode,
    },
  };
}

function normalizeOutputContract({ rawResult, unitTypeId, inputContract, mode }) {
  const type = getInferenceUnitType(unitTypeId);
  const output = {
    ...(rawResult?.outputContract && typeof rawResult.outputContract === 'object'
      ? rawResult.outputContract
      : rawResult || {}),
  };
  if (!output.schema) output.schema = type.outputContract.schema;
  if (output.status == null && rawResult?.status != null) output.status = rawResult.status;
  if (output.basis == null && rawResult?.basis != null) output.basis = rawResult.basis;

  if (unitTypeId === 'living-doc-balance-scan') {
    if (!Array.isArray(output.basis)) output.basis = arr(rawResult?.basis).length ? rawResult.basis : ['Balance scan completed.'];
    if (!Array.isArray(output.orderedSkills)) output.orderedSkills = arr(rawResult?.orderedSkills);
  }

  if (unitTypeId === 'repair-skill') {
    if (output.skill == null) output.skill = inputContract.skill || rawResult?.skill || null;
    if (output.sequence == null) output.sequence = inputContract.sequence ?? rawResult?.sequence ?? null;
    if (!Array.isArray(output.changedFiles)) output.changedFiles = arr(rawResult?.changedFiles);
    if (!output.commitIntent || typeof output.commitIntent !== 'object') {
      output.commitIntent = {
        required: output.changedFiles.length > 0,
        reason: output.changedFiles.length > 0
          ? 'Repair skill reported changed files.'
          : 'Repair skill reported no changed files.',
        changedFiles: output.changedFiles,
      };
    }
  }

  if (unitTypeId === 'pr-review') {
    return normalizePrReviewOutputContract({ output, mode });
  }

  return output;
}

export async function runContractBoundInferenceUnit({
  runDir,
  rootDir = 'inference-units',
  iteration = 1,
  sequence = 1,
  unitId,
  role,
  unitTypeId = unitId,
  allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
  prompt,
  inputContract,
  outputContract = null,
  fixtureResult = null,
  execute = false,
  codexBin = 'codex',
  cwd = process.cwd(),
  now = new Date().toISOString(),
  toolProfile = 'local-harness',
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!unitId) throw new Error('unitId is required');
  if (!role) throw new Error('role is required');
  if (!prompt) throw new Error('prompt is required');
  if (!inputContract || typeof inputContract !== 'object') throw new Error('inputContract is required');
  const typeValidation = validateInferenceUnitAllowed({ unitTypeId, allowedUnitTypes });
  if (!typeValidation.ok) throw new Error(typeValidation.message);
  const inputValidation = validateInferenceUnitInputContract({ unitTypeId, inputContract });
  if (!inputValidation.ok) {
    throw new Error(`invalid ${unitTypeId} input contract: ${inputValidation.violations.map((violation) => `${violation.path} ${violation.message}`).join('; ')}`);
  }
  const unitType = registryMetadataForUnit(unitTypeId, typeValidation.allowedUnitTypes);

  const sequenceLabel = String(sequence).padStart(2, '0');
  const unitDir = path.join(runDir, rootDir, `iteration-${iteration}`, `${sequenceLabel}-${slug(unitId)}`);
  const promptPath = path.join(unitDir, 'prompt.md');
  const inputContractPath = path.join(unitDir, 'input-contract.json');
  const codexEventsPath = path.join(unitDir, 'codex-events.jsonl');
  const stderrPath = path.join(unitDir, 'stderr.log');
  const lastMessagePath = path.join(unitDir, 'last-message.txt');
  const resultPath = path.join(unitDir, 'result.json');
  const validationPath = path.join(unitDir, 'validation.json');
  const resolvedToolProfile = resolveInferenceToolProfile(toolProfile, { cwd });
  const inputContractWithToolProfile = {
    ...inputContract,
    unitType,
    allowedUnitTypes: typeValidation.allowedUnitTypes,
    toolProfile: resolvedToolProfile,
  };
  const promptWithToolProfile = `${prompt}

Harness tool profile:
${JSON.stringify(resolvedToolProfile, null, 2)}
`;

  await mkdir(unitDir, { recursive: true });
  await writeFile(promptPath, promptWithToolProfile, 'utf8');
  await writeJson(inputContractPath, inputContractWithToolProfile);

  let rawResult;
  let mode = 'fixture';
  if (execute) {
    mode = 'headless-codex';
    await appendJsonl(path.join(runDir, 'events.jsonl'), {
      event: 'inference-tool-profile-selected',
      at: now,
      unitId,
      role,
      iteration,
      sequence,
      toolProfile: {
        name: resolvedToolProfile.name,
        isolation: resolvedToolProfile.isolation,
        sandboxMode: resolvedToolProfile.sandboxMode,
        mcpMode: resolvedToolProfile.mcpMode,
        mcpAllowlist: resolvedToolProfile.mcpAllowlist,
        mcpDenylist: resolvedToolProfile.mcpDenylist,
      },
    });
    const stdout = await runCodex({
      codexBin,
      cwd,
      prompt: promptWithToolProfile,
      stdoutPath: codexEventsPath,
      stderrPath,
      lastMessagePath,
      toolProfile: resolvedToolProfile,
    });
    await assertRequiredInspectionPaths({
      eventsPath: codexEventsPath,
      requiredInspectionPaths: inputContractWithToolProfile.requiredInspectionPaths,
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

  const outputContractResult = normalizeOutputContract({ rawResult, unitTypeId, inputContract, mode });
  const resultStatus = unitType.outputVerdicts.includes(outputContractResult?.status)
    ? outputContractResult.status
    : statusFromRawResult(rawResult);
  const result = {
    schema: 'living-doc-contract-bound-inference-result/v1',
    unitId,
    role,
    unitType,
    mode,
    iteration,
    sequence,
    createdAt: now,
    promptPath: path.relative(runDir, promptPath),
    inputContractPath: path.relative(runDir, inputContractPath),
    codexEventsPath: path.relative(runDir, codexEventsPath),
    lastMessagePath: path.relative(runDir, lastMessagePath),
    stderrPath: path.relative(runDir, stderrPath),
    status: resultStatus,
    basis: arr(rawResult.basis).length ? rawResult.basis : ['Inference unit completed without a detailed basis.'],
    outputContract: outputContractResult,
    toolProfile: {
      name: resolvedToolProfile.name,
      isolation: resolvedToolProfile.isolation,
      sandboxMode: resolvedToolProfile.sandboxMode,
      mcpMode: resolvedToolProfile.mcpMode,
      mcpAllowlist: resolvedToolProfile.mcpAllowlist,
      mcpDenylist: resolvedToolProfile.mcpDenylist,
      pluginDenylist: resolvedToolProfile.pluginDenylist,
    },
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
  unitTypeId = unitId,
  allowedUnitTypes = DEFAULT_ALLOWED_INFERENCE_UNIT_TYPES,
  prompt,
  inputContract,
  sourcePaths = {},
  mode = 'snapshot',
  status = 'recorded',
  basis = ['Inference unit snapshot was recorded from an externally managed process.'],
  outputContract = {},
  now = new Date().toISOString(),
  toolProfile = 'local-harness',
  cwd = process.cwd(),
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!unitId) throw new Error('unitId is required');
  if (!role) throw new Error('role is required');
  if (!prompt) throw new Error('prompt is required');
  if (!inputContract || typeof inputContract !== 'object') throw new Error('inputContract is required');
  const typeValidation = validateInferenceUnitAllowed({ unitTypeId, allowedUnitTypes });
  if (!typeValidation.ok) throw new Error(typeValidation.message);
  const inputValidation = validateInferenceUnitInputContract({ unitTypeId, inputContract });
  if (!inputValidation.ok) {
    throw new Error(`invalid ${unitTypeId} input contract snapshot: ${inputValidation.violations.map((violation) => `${violation.path} ${violation.message}`).join('; ')}`);
  }
  const unitType = registryMetadataForUnit(unitTypeId, typeValidation.allowedUnitTypes);

  const sequenceLabel = String(sequence).padStart(2, '0');
  const unitDir = path.join(runDir, rootDir, `iteration-${iteration}`, `${sequenceLabel}-${slug(unitId)}`);
  const promptPath = path.join(unitDir, 'prompt.md');
  const inputContractPath = path.join(unitDir, 'input-contract.json');
  const codexEventsPath = path.join(unitDir, 'codex-events.jsonl');
  const stderrPath = path.join(unitDir, 'stderr.log');
  const lastMessagePath = path.join(unitDir, 'last-message.txt');
  const resultPath = path.join(unitDir, 'result.json');
  const validationPath = path.join(unitDir, 'validation.json');
  const resolvedToolProfile = resolveInferenceToolProfile(toolProfile, { cwd });
  const inputContractWithToolProfile = {
    ...inputContract,
    unitType,
    allowedUnitTypes: typeValidation.allowedUnitTypes,
    toolProfile: resolvedToolProfile,
  };
  const promptWithToolProfile = `${prompt}

Harness tool profile:
${JSON.stringify(resolvedToolProfile, null, 2)}
`;

  await mkdir(unitDir, { recursive: true });
  await writeFile(promptPath, promptWithToolProfile, 'utf8');
  await writeJson(inputContractPath, inputContractWithToolProfile);
  await copyIfExists(sourcePaths.codexEventsPath, codexEventsPath);
  await copyIfExists(sourcePaths.stderrPath, stderrPath);
  await copyIfExists(sourcePaths.lastMessagePath, lastMessagePath);

  const result = {
    schema: 'living-doc-contract-bound-inference-result/v1',
    unitId,
    role,
    unitType,
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
    toolProfile: {
      name: resolvedToolProfile.name,
      isolation: resolvedToolProfile.isolation,
      sandboxMode: resolvedToolProfile.sandboxMode,
      mcpMode: resolvedToolProfile.mcpMode,
      mcpAllowlist: resolvedToolProfile.mcpAllowlist,
      mcpDenylist: resolvedToolProfile.mcpDenylist,
      pluginDenylist: resolvedToolProfile.pluginDenylist,
    },
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
