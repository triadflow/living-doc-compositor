#!/usr/bin/env node
// Deterministic controller-owned proof routes for the living-doc harness.
//
// These routes run outside the worker inference unit. They produce typed proof
// artifacts that reviewer/closure units can inspect without treating worker
// test attempts as authoritative proof.

import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

function arr(value) {
  return Array.isArray(value) ? value : [];
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function appendJsonl(filePath, event) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
}

function slug(value) {
  return String(value || 'proof-route').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'proof-route';
}

function normalizeRoute(route, index = 0) {
  const id = slug(route?.id || route?.proofRoute || route?.kind || `proof-route-${index + 1}`);
  return {
    id,
    kind: route?.kind || route?.proofRoute || 'command',
    command: route?.command || null,
    required: route?.required !== false,
    timeoutMs: Number.isInteger(route?.timeoutMs) && route.timeoutMs > 0 ? route.timeoutMs : 120000,
    acceptanceCriteria: arr(route?.acceptanceCriteria),
    description: route?.description || '',
  };
}

function unquoteShellToken(value) {
  const text = String(value || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function lifecycleRunDocPathFromCommand(command) {
  const text = String(command || '');
  const match = text.match(/(?:^|\s)(?:node\s+)?(?:"[^"]*living-doc-harness-lifecycle\.mjs"|'[^']*living-doc-harness-lifecycle\.mjs'|\S*living-doc-harness-lifecycle\.mjs)\s+run\s+("[^"]+"|'[^']+'|\S+)/);
  const docToken = unquoteShellToken(match?.[1] || '');
  if (!docToken || docToken.startsWith('-')) return null;
  return docToken;
}

function recursiveLifecycleProofRouteGuard(route, { cwd, docPath } = {}) {
  const lifecycleDocPath = lifecycleRunDocPathFromCommand(route?.command);
  if (!lifecycleDocPath || !docPath) return { blocked: false };
  const targetDocPath = path.resolve(cwd, lifecycleDocPath);
  const currentDocPath = path.resolve(cwd, docPath);
  if (targetDocPath !== currentDocPath) return { blocked: false };
  return {
    blocked: true,
    reasonCode: 'recursive-lifecycle-proof-route',
    failureClass: 'recursive-lifecycle-proof-route',
    message: 'Blocked proof route before execution because it would start the lifecycle harness on the same living doc.',
    lifecycleDocPath,
    docPath,
  };
}

export async function loadProofRoutesFromDoc(docPath, { cwd = process.cwd() } = {}) {
  if (!docPath) return [];
  const doc = await readJson(path.resolve(cwd, docPath), null);
  return arr(doc?.runState?.proofRoutes).map(normalizeRoute);
}

async function probeLocalBind() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => res.end('ok'));
    server.once('error', (err) => {
      resolve({
        ok: false,
        failureClass: 'local-server-bind-denied',
        message: err.message,
        code: err.code || null,
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve({
        ok: true,
        address,
      }));
    });
  });
}

async function probeChromiumLaunch() {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const version = await browser.version();
    await browser.close();
    return { ok: true, version };
  } catch (err) {
    return {
      ok: false,
      failureClass: classifyEnvironmentFailure(`${err?.message || err}`),
      message: String(err?.message || err).split('\n')[0],
    };
  }
}

export async function probeProofEnvironment(kind) {
  if (kind !== 'browser-e2e') return {
    ok: true,
    checks: [],
  };
  const bind = await probeLocalBind();
  const chromium = bind.ok ? await probeChromiumLaunch() : null;
  return {
    ok: bind.ok && chromium?.ok === true,
    checks: [
      { name: 'local-bind-127.0.0.1', ...bind },
      ...(chromium ? [{ name: 'chromium-launch', ...chromium }] : []),
    ],
  };
}

function classifyEnvironmentFailure(text) {
  if (/EACCES|EPERM|Operation not permitted|Permission denied/i.test(text)) {
    if (/bootstrap_check_in|Mach|Chromium|browser/i.test(text)) return 'browser-launch-denied';
    if (/listen|127\.0\.0\.1|localhost|bind/i.test(text)) return 'local-server-bind-denied';
    return 'permission-denied';
  }
  if (/Executable doesn't exist|browserType\.launch|No such file/i.test(text)) return 'browser-binary-missing';
  if (/Host system is missing dependencies|dependency/i.test(text)) return 'browser-dependency-missing';
  return 'test-command-failed';
}

async function runCommand(command, { cwd, timeoutMs, stdoutPath, stderrPath }) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', async (exitCode, signal) => {
      clearTimeout(timer);
      await writeFile(stdoutPath, stdout, 'utf8');
      await writeFile(stderrPath, stderr, 'utf8');
      resolve({
        exitCode,
        signal,
        timedOut,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        failureClass: exitCode === 0 ? null : timedOut ? 'proof-route-timeout' : classifyEnvironmentFailure(`${stdout}\n${stderr}`),
      });
    });
  });
}

export async function runProofRoute({
  runDir,
  iteration,
  route,
  cwd = process.cwd(),
  docPath = null,
  now = new Date().toISOString(),
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  const normalized = normalizeRoute(route);
  const routeDir = path.join(runDir, 'proof-routes', `iteration-${iteration}`, normalized.id);
  await mkdir(routeDir, { recursive: true });
  const stdoutPath = path.join(routeDir, 'stdout.log');
  const stderrPath = path.join(routeDir, 'stderr.log');
  const resultPath = path.join(routeDir, 'result.json');
  const environment = await probeProofEnvironment(normalized.kind);
  const recursionGuard = recursiveLifecycleProofRouteGuard(normalized, { cwd, docPath });
  let commandResult = null;
  let status = 'blocked';
  let failureClass = environment.checks.find((check) => check.ok === false)?.failureClass || null;

  if (recursionGuard.blocked) {
    status = 'blocked';
    failureClass = recursionGuard.failureClass;
    await writeFile(stdoutPath, '', 'utf8');
    await writeFile(stderrPath, `${recursionGuard.message}\n`, 'utf8');
  } else if (environment.ok && normalized.command) {
    commandResult = await runCommand(normalized.command, {
      cwd,
      timeoutMs: normalized.timeoutMs,
      stdoutPath,
      stderrPath,
    });
    status = commandResult.exitCode === 0 && !commandResult.timedOut ? 'passed' : 'failed';
    failureClass = commandResult.failureClass;
  } else {
    await writeFile(stdoutPath, '', 'utf8');
    await writeFile(stderrPath, '', 'utf8');
  }

  const result = {
    schema: 'living-doc-harness-proof-route-result/v1',
    routeId: normalized.id,
    proofRoute: normalized.kind,
    createdAt: now,
    iteration,
    status,
    required: normalized.required,
    command: normalized.command,
    acceptanceCriteria: normalized.acceptanceCriteria,
    environment,
    controllerGuard: recursionGuard.blocked ? recursionGuard : null,
    failureClass,
    reasonCode: recursionGuard.reasonCode || failureClass || null,
    stdoutPath: path.relative(runDir, stdoutPath),
    stderrPath: path.relative(runDir, stderrPath),
    commandResult,
    closureAllowedContribution: status === 'passed' ? 'pass' : status === 'blocked' ? 'blocked' : 'fail',
  };
  await writeJson(resultPath, result);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'proof-route-result-written',
    at: now,
    runId: path.basename(runDir),
    iteration,
    routeId: normalized.id,
    proofRoute: normalized.kind,
    status,
    failureClass,
    reasonCode: recursionGuard.reasonCode || failureClass || null,
    resultPath: path.relative(runDir, resultPath),
  });
  return {
    ...result,
    resultPath,
  };
}

export async function runProofRoutes({
  runDir,
  iteration,
  routes = [],
  cwd = process.cwd(),
  docPath = null,
  now = new Date().toISOString(),
} = {}) {
  const normalizedRoutes = arr(routes).map(normalizeRoute);
  const results = [];
  for (const route of normalizedRoutes) {
    results.push(await runProofRoute({ runDir, iteration, route, cwd, docPath, now }));
  }
  return {
    schema: 'living-doc-harness-proof-route-bundle/v1',
    createdAt: now,
    routeCount: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    blocked: results.filter((result) => result.status === 'blocked').length,
    results,
  };
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (command !== 'run') throw new Error('usage: living-doc-harness-proof-route.mjs run <runDir> --iteration <n> --route <json>');
  const options = {
    runDir: args.shift(),
    iteration: 1,
    route: null,
    cwd: process.cwd(),
    docPath: null,
  };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--iteration') {
      options.iteration = Number(args.shift());
    } else if (flag === '--route') {
      options.route = JSON.parse(args.shift());
    } else if (flag === '--cwd') {
      options.cwd = args.shift();
    } else if (flag === '--doc-path') {
      options.docPath = args.shift();
    } else {
      throw new Error(`unknown option: ${flag}`);
    }
  }
  if (!options.runDir) throw new Error('run requires <runDir>');
  if (!options.route) throw new Error('--route is required');
  return options;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  try {
    const result = await runProofRoute(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
