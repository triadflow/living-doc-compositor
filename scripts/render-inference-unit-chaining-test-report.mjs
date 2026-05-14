#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const ROOT = process.cwd();
const OUT_HTML = path.join(ROOT, 'docs', 'inference-unit-chaining-test-report.html');
const OUT_JSON = path.join(ROOT, 'docs', 'inference-unit-chaining-test-report.json');
const MAXIMAL_CHAIN_REPORT = path.join(ROOT, 'docs', 'inference-unit-chaining-maximal-chain.json');
const MAXIMAL_CHAIN_RUN_ROOT = path.join(ROOT, 'docs', 'inference-unit-chaining-maximal-chain-run');

const SUITES = [
  {
    id: 'contract-artifact-chain',
    label: 'Contract Artifact Chain',
    purpose: 'Mock unit instances write the same prompt, input, result, validation, and chain artifacts as real unit runs.',
    sourcePath: 'tests/contract/living-doc-harness-inference-unit-chaining.spec.mjs',
    command: ['node', ['tests/contract/living-doc-harness-inference-unit-chaining.spec.mjs']],
    testCases: [
      {
        name: 'closed-through-closure-review',
        checks: [
          'worker -> reviewer-inference -> closure-review is registry-legal',
          'reviewer closure claim does not authorize terminal state',
          'closure-review approval writes closed terminal state',
        ],
      },
      {
        name: 'commit-intent-before-closure-review',
        checks: [
          'source changes route through commit-intent before closure-review',
          'commit-intent receives changed files and required hard facts',
          'mock commit-intent does not execute a side effect',
        ],
      },
      {
        name: 'pr-review-before-closure-review',
        checks: [
          'required PR policy routes through pr-review before closure-review',
          'pr-review input carries required policy and required flag',
          'mock pr-review does not execute a side effect',
        ],
      },
      {
        name: 'repair-chain-returns-to-worker',
        checks: [
          'repairable reviewer verdict routes to balance scan',
          'balance scan routes to repair-skill',
          'repair-skill routes back to worker',
        ],
      },
      {
        name: 'continuation-returns-to-worker',
        checks: [
          'true-block reviewer verdict routes to worker',
          'worker routes back to worker',
          'terminal state remains continuation-required, not closed',
        ],
      },
      {
        name: 'closure-review-blocked-continues',
        checks: [
          'closure-review denial routes to worker',
          'terminalAllowed=false is preserved in the closure-review contract',
        ],
      },
      {
        name: 'invalid-transition-rejected',
        checks: [
          'worker cannot select pr-review directly',
          'contract validation reports selected-unit-type-not-allowed-by-current-contract',
        ],
      },
      {
        name: 'run-allowed-unit-type-rejected',
        checks: [
          'reviewer-inference cannot select pr-review when the run disallows pr-review',
          'contract validation reports selected-unit-type-not-allowed-for-run',
        ],
      },
    ],
    coverage: [
      'worker -> reviewer-inference -> closure-review -> closed',
      'worker -> reviewer-inference -> commit-intent -> closure-review',
      'worker -> reviewer-inference -> pr-review -> closure-review',
      'worker -> reviewer-inference -> living-doc-balance-scan -> repair-skill -> worker',
      'worker -> reviewer-inference -> worker -> worker',
      'reviewer-inference -> closure-review blocked -> worker',
      'invalid transition rejection',
      'run-allowed unit type rejection',
      'reviewer claim cannot authorize terminal closure',
      'non-terminal blocker cannot become closed',
    ],
  },
  {
    id: 'controller-selected-chain',
    label: 'Controller-Selected Chain',
    purpose: 'Controller finalization selects the next unit from frozen evidence, run policy, and gate state.',
    sourcePath: 'tests/contract/living-doc-harness-controller-selected-chaining.spec.mjs',
    command: ['node', ['tests/contract/living-doc-harness-controller-selected-chaining.spec.mjs']],
    testCases: [
      {
        name: 'closed-no-gates',
        checks: [
          'closed reviewer verdict selects closure-review',
          'auto closure-review artifact is written',
          'terminal action is closed',
        ],
      },
      {
        name: 'source-change-selects-commit-intent',
        checks: [
          'changed source evidence blocks closure',
          'controller selects commit-intent',
          'closure-review is not run before commit evidence exists',
        ],
      },
      {
        name: 'pr-policy-selects-pr-review',
        checks: [
          'required PR-review policy blocks closure',
          'controller selects pr-review',
          'PR-review gate status is missing',
        ],
      },
      {
        name: 'blocked-pr-evidence-selects-continuation',
        checks: [
          'blocked PR-review evidence prevents closure',
          'controller selects worker',
          'continuation input includes blocked PR-review result path',
        ],
      },
      {
        name: 'repair-selects-balance-scan',
        checks: [
          'repairable verdict with repair mode selects living-doc-balance-scan',
          'repair skill chain result is written',
        ],
      },
      {
        name: 'non-terminal-true-block',
        checks: [
          'true-block verdict remains continuation-required',
          'controller selects worker',
        ],
      },
      {
        name: 'non-terminal-pivot',
        checks: [
          'pivot verdict remains continuation-required',
          'controller selects worker',
        ],
      },
      {
        name: 'non-terminal-deferred',
        checks: [
          'deferred verdict remains continuation-required',
          'controller selects worker',
        ],
      },
      {
        name: 'non-terminal-budget-exhausted',
        checks: [
          'budget-exhausted verdict remains continuation-required',
          'controller selects worker',
        ],
      },
      {
        name: 'closure-review-denial-selects-continuation',
        checks: [
          'executed closure-review denial normalizes classification to true-block',
          'terminal kind is continuation-required',
          'controller selects worker with denial reason',
        ],
      },
      {
        name: 'pr-review-disallowed-reroutes-continuation',
        checks: [
          'required pr-review is blocked by run allowed-unit policy',
          'controller selects worker',
          'terminal kind is continuation-required',
        ],
      },
    ],
    coverage: [
      'closed reviewer verdict selects closure-review',
      'source changes without commit evidence select commit-intent',
      'required PR policy without PR evidence selects pr-review',
      'blocked PR-review evidence selects continuation',
      'repairable verdict selects balance scan and repair chain',
      'true-block, pivot, deferred, and budget-exhausted remain non-closed',
      'closure-review denial selects continuation',
      'run config disallowing PR-review blocks closure',
    ],
  },
  {
    id: 'system-invariants',
    label: 'System Invariants',
    purpose: 'Runs a mocked lifecycle and audits the produced artifact graph for policy-owned routing, artifact-ref continuity, stale-blocker override, and no preplanned unit chain.',
    sourcePath: 'tests/contract/living-doc-harness-system-invariants.spec.mjs',
    command: ['node', ['tests/contract/living-doc-harness-system-invariants.spec.mjs']],
    testCases: [
      {
        name: 'policy-table-routing-authority',
        checks: [
          'commit-intent, pr-review, closure-review, continuation, balance-scan, and terminal routes come from the policy table',
          'selected units are registered and valid next units for the source unit contract',
          'same-reason continuation loops are blocked before repeating continuation',
        ],
      },
      {
        name: 'runtime-handoff-invariant-audit',
        checks: [
          'representative lifecycle output-input artifacts use living-doc-artifact-ref/v1 for every path/ref handoff pair',
          'selected next units cite a routing policy rule and route authority',
          'new continuation output overrides an older blocked commit condition',
          'runtime artifacts do not contain a pre-planned unit chain',
        ],
      },
    ],
    coverage: [
      'policy table integration for decision-capable unit routing',
      'runtime artifact-ref invariant across lifecycle result and output-input handoffs',
      'selected next unit is registered and transition-valid',
      'latest unit recommendation wins over stale blocker state',
      'same-reason continuation loop blocks instead of self-repeating',
      'no generated artifact may carry a pre-planned unit sequence',
    ],
  },
  {
    id: 'maximal-chain',
    label: 'Maximal Lifecycle Chain',
    purpose: 'Runs one composed controller-owned chain through repair, worker re-entry, commit-intent, PR-review, closure-review, and terminal closure.',
    sourcePath: 'tests/contract/living-doc-harness-maximal-chain.spec.mjs',
    command: ['node', ['tests/contract/living-doc-harness-maximal-chain.spec.mjs']],
    artifactPath: MAXIMAL_CHAIN_REPORT,
    artifactRunRoot: MAXIMAL_CHAIN_RUN_ROOT,
    testCases: [
      {
        name: 'maximal-controller-owned-chain',
        checks: [
          'one chain contains worker, reviewer, balance scan, repair skill, worker re-entry, reviewer, commit-intent, PR-review, closure-review, and terminal closed',
          'every unit writes prompt, input, result, validation, output, and runtime artifacts',
          'selection artifacts record controller-owned next-unit choice and gate before/after state',
          'later input contracts consume earlier repair, commit, and PR-review result paths',
        ],
      },
      {
        name: 'negative-breakpoint-matrix',
        checks: [
          'commit evidence missing and bad commit scope route to recovery gates',
          'PR-review missing and blocked states route to recovery gates',
          'closure denial, ineffective repair, invalid next unit, and stale evidence are represented as deterministic breakpoints',
        ],
      },
    ],
    coverage: [
      'maximal composed chain with 9 unit steps',
      'repair loop re-entry',
      'commit gate blocked then unblocked',
      'PR-review gate blocked then unblocked',
      'closure-review-only terminal authority',
      'artifact continuity between unit outputs and later inputs',
      'controller selection artifacts for every transition',
      '8 negative breakpoint checks',
    ],
  },
  {
    id: 'headless-calibration',
    label: 'Headless Calibration',
    purpose: 'The execute:true process seam runs through a fake Codex binary while preserving the real artifact contract.',
    sourcePath: 'tests/calibration/living-doc-harness-live-inference-chaining.spec.mjs',
    command: ['npm', ['run', 'test:harness-live-calibration']],
    testCases: [
      {
        name: 'fake-live-controller-chain',
        checks: [
          'fake Codex reviewer runs through execute:true and emits closed verdict',
          'fake Codex closure-review runs through execute:true and approves closure',
          'codex-events.jsonl records required inspection commands',
          'proof records closure-review as selected next unit',
        ],
      },
      {
        name: 'missing-required-inspection-fails',
        checks: [
          'execute:true unit rejects output when required path inspection is missing',
          'failure matches did-not-inspect-required-path validation',
        ],
      },
      {
        name: 'non-verdict-live-output-normalizes',
        checks: [
          'malformed historical PR-review output runs through execute:true',
          'unit result normalizes to blocked',
          'reasonCode is pr-review-non-verdict-output',
        ],
      },
      {
        name: 'real-codex-smoke',
        optional: true,
        skippedUnless: 'LIVING_DOC_RUN_REAL_CODEX=1',
        checks: [
          'real codex binary can satisfy worker output contract',
        ],
      },
    ],
    coverage: [
      'execute:true reviewer run through fake headless Codex process',
      'execute:true closure-review run consumed by controller finalizer',
      'required inspection pass recorded in codex-events.jsonl',
      'required inspection miss rejects the unit run',
      'non-verdict PR-review output normalizes to blocked',
      'tool profile metadata recorded on live unit result',
      'optional real Codex smoke path behind LIVING_DOC_RUN_REAL_CODEX=1',
    ],
  },
];

function isoNow() {
  return new Date().toISOString();
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shellCommand([cmd, args]) {
  return [cmd, ...args].join(' ');
}

async function readSuiteArtifact(suite) {
  if (!suite.artifactPath) return null;
  try {
    return JSON.parse(await readFile(suite.artifactPath, 'utf8'));
  } catch {
    return null;
  }
}

function runSuite(suite) {
  const [cmd, args] = suite.command;
  const startedAt = isoNow();
  const started = performance.now();
  return new Promise((resolve) => {
    const startChild = async () => {
      if (suite.artifactPath) await rm(suite.artifactPath, { force: true });
      if (suite.artifactRunRoot) await rm(suite.artifactRunRoot, { recursive: true, force: true });
      if (suite.artifactPath) await mkdir(path.dirname(suite.artifactPath), { recursive: true });
      if (suite.artifactRunRoot) await mkdir(path.dirname(suite.artifactRunRoot), { recursive: true });
      return spawn(cmd, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        // Keep the calibration report deterministic unless the caller explicitly
        // opts into real Codex smoke behavior.
        LIVING_DOC_RUN_REAL_CODEX: process.env.LIVING_DOC_RUN_REAL_CODEX || '',
        ...(suite.artifactPath ? { LIVING_DOC_MAXIMAL_CHAIN_REPORT_PATH: suite.artifactPath } : {}),
        ...(suite.artifactRunRoot ? { LIVING_DOC_MAXIMAL_CHAIN_RUN_ROOT: suite.artifactRunRoot } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    };
    let stdout = '';
    let stderr = '';
    startChild().then((child) => {
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('close', async (code, signal) => {
      const endedAt = isoNow();
      const durationMs = Math.round(performance.now() - started);
      resolve({
        id: suite.id,
        label: suite.label,
        purpose: suite.purpose,
        sourcePath: suite.sourcePath,
        command: shellCommand(suite.command),
        testCases: suite.testCases.map((testCase) => ({
          ...testCase,
          status: testCase.optional && process.env.LIVING_DOC_RUN_REAL_CODEX !== '1' ? 'skipped' : code === 0 ? 'passed' : 'unknown',
        })),
        coverage: suite.coverage,
        chainEvidence: await readSuiteArtifact(suite),
        startedAt,
        endedAt,
        durationMs,
        exitCode: code,
        signal,
        status: code === 0 ? 'passed' : 'failed',
        stdout,
        stderr,
      });
      });
      child.on('error', async (error) => {
      const endedAt = isoNow();
      const durationMs = Math.round(performance.now() - started);
      resolve({
        id: suite.id,
        label: suite.label,
        purpose: suite.purpose,
        sourcePath: suite.sourcePath,
        command: shellCommand(suite.command),
        testCases: suite.testCases.map((testCase) => ({
          ...testCase,
          status: testCase.optional && process.env.LIVING_DOC_RUN_REAL_CODEX !== '1' ? 'skipped' : 'unknown',
        })),
        coverage: suite.coverage,
        chainEvidence: await readSuiteArtifact(suite),
        startedAt,
        endedAt,
        durationMs,
        exitCode: 127,
        signal: null,
        status: 'failed',
        stdout,
        stderr: `${stderr}${error.stack || error.message || String(error)}\n`,
      });
    });
    }).catch((error) => {
      const endedAt = isoNow();
      const durationMs = Math.round(performance.now() - started);
      resolve({
        id: suite.id,
        label: suite.label,
        purpose: suite.purpose,
        sourcePath: suite.sourcePath,
        command: shellCommand(suite.command),
        testCases: suite.testCases.map((testCase) => ({ ...testCase, status: 'unknown' })),
        coverage: suite.coverage,
        chainEvidence: null,
        startedAt,
        endedAt,
        durationMs,
        exitCode: 127,
        signal: null,
        status: 'failed',
        stdout,
        stderr: `${stderr}${error.stack || error.message || String(error)}\n`,
      });
    });
  });
}

function renderHtml(report) {
  const passed = report.results.filter((result) => result.status === 'passed').length;
  const failed = report.results.length - passed;
  const coverageCount = report.results.reduce((sum, result) => sum + result.coverage.length, 0);
  const testCaseCount = report.results.reduce(
    (sum, result) => sum + result.testCases.filter((testCase) => testCase.status !== 'skipped').length,
    0,
  );
  const skippedTestCaseCount = report.results.reduce(
    (sum, result) => sum + result.testCases.filter((testCase) => testCase.status === 'skipped').length,
    0,
  );
  const chainEvidence = report.results.map((result) => result.chainEvidence).filter(Boolean);
  const chainStepCount = chainEvidence.reduce((sum, evidence) => sum + (evidence.timeline?.length || 0), 0);
  const status = failed === 0 ? 'passed' : 'failed';
  const statusLabel = failed === 0 ? 'All suites passed' : `${failed} suite${failed === 1 ? '' : 's'} failed`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inference Unit Chaining Test Report</title>
<style>
:root{--bg:#f6f8fb;--panel:#fff;--ink:#172033;--muted:#61718a;--line:#d8e1ec;--green:#166534;--green-bg:#dcfce7;--red:#b91c1c;--red-bg:#fee2e2;--blue:#2563eb;--blue-bg:#dbeafe;--amber:#9a5b05;--amber-bg:#fff3d6;--dark:#111827;--radius:8px}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.58 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
.wrap{width:min(1180px,calc(100% - 40px));margin:0 auto}
header{padding:32px 0 24px;border-bottom:1px solid var(--line);background:#fff}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}
.brand{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px;font-weight:850;letter-spacing:.08em;text-transform:uppercase}
.mark{width:32px;height:32px;display:grid;place-items:center;border-radius:7px;background:var(--dark);color:#fff;font-weight:900}
.pill{display:inline-flex;align-items:center;gap:7px;min-height:30px;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:850;border:1px solid var(--line)}
.pill.pass{background:var(--green-bg);color:var(--green);border-color:#bbf7d0}.pill.fail{background:var(--red-bg);color:var(--red);border-color:#fecaca}.pill.info{background:var(--blue-bg);color:#1e40af;border-color:#bfdbfe}.pill.warn{background:var(--amber-bg);color:var(--amber);border-color:#f5d08c}
h1{margin:0;max-width:900px;font-size:clamp(30px,4vw,46px);line-height:1.08;font-weight:900;letter-spacing:0}
.lede{max-width:860px;margin:12px 0 0;color:var(--muted);font-size:16px}
.cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:24px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:14px}
.card strong{display:block;font-size:28px;line-height:1;margin-bottom:6px}.card span{color:var(--muted);font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
main{padding:24px 0 64px}
section{padding:26px 0;border-bottom:1px solid var(--line)}section:last-child{border-bottom:0}
.section-head{display:grid;grid-template-columns:280px 1fr;gap:24px;margin-bottom:16px;align-items:start}
h2{margin:0;font-size:28px;line-height:1.15}.copy{color:var(--muted)}
.suite{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;margin-bottom:14px}
.suite-head{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start;padding:16px;border-bottom:1px solid var(--line);background:#eef3f8}
.suite h3{margin:0 0 6px;font-size:18px}.cmd{color:var(--muted);overflow-wrap:anywhere}
.suite-body{display:grid;grid-template-columns:1fr 1fr;gap:0}
.suite-body>div{padding:16px}.suite-body>div+div{border-left:1px solid var(--line)}
.test-list{display:grid;gap:10px}
.test-case{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:13px 14px}
.test-case-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px}.test-case h4{margin:0;font-size:15px}.test-source{color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.chain{display:grid;gap:12px}
.chain-step{display:grid;grid-template-columns:72px 1fr 1fr;gap:12px;background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:13px 14px}
.chain-step h4{margin:0 0 4px;font-size:16px}.chain-step .seq{font-size:28px;font-weight:900;line-height:1;color:var(--blue)}
.path-list{display:grid;gap:4px;margin-top:8px}.path-list code{display:block;padding:5px 7px;border:1px solid var(--line);border-radius:6px;background:#f8fafc;overflow-wrap:anywhere}
.gate-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.gate-box{border:1px solid var(--line);border-radius:7px;padding:8px}.gate-box strong{display:block;margin-bottom:4px}
.negative-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.negative-case{border:1px solid var(--line);border-radius:7px;padding:8px;background:#fff}
.test-table{background:#fff;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.test-row{display:grid;grid-template-columns:1.15fr 1.8fr .6fr .7fr .7fr .55fr .7fr;gap:12px;align-items:start;padding:12px 14px;border-top:1px solid var(--line)}
.test-row:first-child{border-top:0}.test-row.head{background:#eef3f8;color:var(--muted);font-size:12px;font-weight:850;letter-spacing:.06em;text-transform:uppercase}.test-row b{display:block}.test-row .muted{color:var(--muted)}
ul{margin:8px 0 0;padding-left:18px;color:var(--muted)}li+li{margin-top:5px}
pre{margin:0;padding:13px 14px;border-radius:var(--radius);background:var(--dark);color:#e5eefc;line-height:1.45;font-size:12.5px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.stdout{margin-top:10px}.stderr{margin-top:10px;border:1px solid #fecaca}
.meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}
.meta div{border:1px solid var(--line);border-radius:7px;padding:8px;color:var(--muted);font-size:13px}.meta b{display:block;color:var(--ink)}
.coverage{margin-top:12px}.coverage h4{margin:0 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.06em}
.json-link{display:inline-flex;margin-top:10px;color:var(--blue);font-weight:800;text-decoration:none}
@media(max-width:1000px){.test-row{grid-template-columns:1fr}.test-row.head{display:none}}
@media(max-width:900px){.wrap{width:min(100% - 28px,1180px)}.cards,.section-head,.suite-body,.chain-step,.gate-grid,.negative-grid{grid-template-columns:1fr}.suite-body>div+div{border-left:0;border-top:1px solid var(--line)}.meta{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <div class="wrap">
    <div class="top">
      <div class="brand"><div class="mark">LD</div> Generated Test Report</div>
      <div class="pill ${status === 'passed' ? 'pass' : 'fail'}">${esc(statusLabel)}</div>
    </div>
    <h1>Inference-unit chaining test report</h1>
    <p class="lede">Generated from a real test run. This report is intentionally narrow: commands, timings, exit codes, captured output, and exercised mock/fake-headless coverage.</p>
    <div class="cards">
      <div class="card"><strong>${report.results.length}</strong><span>suites run</span></div>
      <div class="card"><strong>${testCaseCount}</strong><span>tests run</span></div>
      <div class="card"><strong>${skippedTestCaseCount}</strong><span>tests skipped</span></div>
      <div class="card"><strong>${coverageCount}</strong><span>coverage checks</span></div>
      <div class="card"><strong>${chainStepCount}</strong><span>chain steps</span></div>
    </div>
  </div>
</header>
<main class="wrap">
  <section>
    <div class="section-head">
      <h2>Run Metadata</h2>
      <div class="copy">
        <p><strong>Generated at:</strong> <code>${esc(report.generatedAt)}</code></p>
        <p><strong>Commit:</strong> <code>${esc(report.gitCommit || 'unknown')}</code></p>
        <p><strong>Total test time:</strong> <code>${esc(report.totalDurationMs)} ms</code></p>
        <p><strong>Runtime:</strong> <code>${esc(report.environment.nodeVersion)}</code> on <code>${esc(report.environment.platform)}/${esc(report.environment.arch)}</code></p>
        <p><strong>Workflow use:</strong> the deploy smoke action should run this same generator and upload both HTML and JSON artifacts.</p>
        <a class="json-link" href="./inference-unit-chaining-test-report.json">Open JSON evidence</a>
      </div>
    </div>
  </section>
  ${chainEvidence.length ? `<section>
    <div class="section-head">
      <h2>Maximal Chain Timeline</h2>
      <p class="copy">Generated from the maximal-chain test artifact. This is the composed lifecycle path, including selected next units, gate transitions, and unit artifact paths.</p>
    </div>
    ${chainEvidence.map((evidence) => `
    <div class="chain">
      <div class="suite">
        <div class="suite-head">
          <div>
            <h3>${esc(evidence.testName)}</h3>
            <div class="cmd">Run dir: <code>${esc(evidence.runDir)}</code></div>
            <div class="cmd">Terminal state: <code>${esc(evidence.terminalStatePath)}</code></div>
          </div>
          <span class="pill ${evidence.status === 'passed' ? 'pass' : 'fail'}">${esc(evidence.status)}</span>
        </div>
      </div>
      ${evidence.timeline.map((step) => `
      <article class="chain-step">
        <div>
          <div class="seq">${esc(step.sequence)}</div>
          <span class="pill info">${esc(step.status)}</span>
        </div>
        <div>
          <h4>${esc(step.unitTypeId)}</h4>
          <div class="cmd">Selected next: <code>${esc(step.selectedNextUnit || 'terminal')}</code></div>
          <div class="cmd">Reason: <code>${esc(step.reasonCode || 'none')}</code></div>
          <div class="path-list">
            <code>input: ${esc(step.artifacts.inputContractPath)}</code>
            <code>result: ${esc(step.artifacts.resultPath)}</code>
            <code>validation: ${esc(step.artifacts.validationPath)}</code>
            ${step.selectionPath ? `<code>selection: ${esc(step.selectionPath)}</code>` : ''}
          </div>
        </div>
        <div>
          <div class="gate-grid">
            <div class="gate-box"><strong>Gate before</strong><pre>${esc(JSON.stringify(step.gateBefore || {}, null, 2))}</pre></div>
            <div class="gate-box"><strong>Gate after</strong><pre>${esc(JSON.stringify(step.gateAfter || {}, null, 2))}</pre></div>
          </div>
          <div class="coverage">
            <h4>Input carryover</h4>
            <ul>${Object.entries(step.inputReferences || {}).filter(([, value]) => Array.isArray(value) ? value.length : value).map(([key, value]) => `<li><code>${esc(key)}</code>: ${esc(Array.isArray(value) ? value.join(', ') : value)}</li>`).join('') || '<li>none</li>'}</ul>
          </div>
        </div>
      </article>`).join('')}
      <div class="coverage">
        <h4>Negative breakpoint matrix</h4>
        <div class="negative-grid">${(evidence.negativeMatrix || []).map((item) => `<div class="negative-case"><strong>${esc(item.name)}</strong><div class="cmd">Recovery unit: <code>${esc(item.expectedSelectedUnit)}</code></div></div>`).join('')}</div>
      </div>
    </div>`).join('')}
  </section>` : ''}
  <section>
    <div class="section-head">
      <h2>Test Overview</h2>
      <p class="copy">One row per executed suite. Test count is the number of concrete named test cases represented by the assertion script.</p>
    </div>
    <div class="test-table">
      <div class="test-row head">
        <div>Suite</div>
        <div>Purpose</div>
        <div>Tests</div>
        <div>Coverage</div>
        <div>Time</div>
        <div>Exit</div>
        <div>Status</div>
      </div>
      ${report.results.map((result) => `
      <div class="test-row">
        <div><b>${esc(result.label)}</b><span class="muted"><code>${esc(result.id)}</code></span></div>
        <div>${esc(result.purpose)}</div>
        <div><b>${esc(result.testCases.filter((testCase) => testCase.status !== 'skipped').length)}</b><span class="muted">${result.testCases.some((testCase) => testCase.status === 'skipped') ? `+ ${result.testCases.filter((testCase) => testCase.status === 'skipped').length} skipped` : 'run'}</span></div>
        <div><b>${esc(result.coverage.length)}</b><span class="muted">checks</span></div>
        <div><b>${esc(result.durationMs)} ms</b></div>
        <div><b>${esc(result.exitCode)}</b></div>
        <div><span class="pill ${result.status === 'passed' ? 'pass' : 'fail'}">${esc(result.status)}</span></div>
      </div>`).join('')}
    </div>
  </section>
  <section>
    <div class="section-head">
      <h2>Tests Executed</h2>
      <p class="copy">These are the concrete test cases represented inside the assertion scripts. Each passed case ran against the same command, source file, and artifacts shown below.</p>
    </div>
    <div class="test-list">
      ${report.results.flatMap((result) => result.testCases.map((testCase) => `
      <article class="test-case">
        <div class="test-case-head">
          <div>
            <h4>${esc(testCase.name)}</h4>
            <div class="test-source">${esc(result.label)} · <code>${esc(result.sourcePath)}</code></div>
          </div>
          <span class="pill ${testCase.status === 'passed' ? 'pass' : testCase.status === 'skipped' ? 'warn' : 'fail'}">${esc(testCase.status)}</span>
        </div>
        ${testCase.skippedUnless ? `<div class="copy">Skipped unless <code>${esc(testCase.skippedUnless)}</code>.</div>` : ''}
        <ul>${testCase.checks.map((check) => `<li>${esc(check)}</li>`).join('')}</ul>
      </article>`)).join('')}
    </div>
  </section>
  <section>
    <div class="section-head">
      <h2>Suite Evidence</h2>
      <p class="copy">Command lines, timestamps, explicit coverage items, and captured output from the same run shown in the overview.</p>
    </div>
    ${report.results.map((result) => `
    <article class="suite">
      <div class="suite-head">
        <div>
          <h3>${esc(result.label)}</h3>
          <div class="cmd">${esc(result.purpose)}</div>
          <div class="cmd"><code>${esc(result.command)}</code></div>
        </div>
        <div class="pill ${result.status === 'passed' ? 'pass' : 'fail'}">${esc(result.status)} · exit ${esc(result.exitCode)}</div>
      </div>
      <div class="suite-body">
        <div>
          <div class="meta">
            <div><b>${esc(result.durationMs)} ms</b>duration</div>
            <div><b>${esc(result.startedAt)}</b>started</div>
            <div><b>${esc(result.endedAt)}</b>ended</div>
          </div>
          <div class="coverage">
            <h4>Coverage exercised</h4>
            <ul>${result.coverage.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
          </div>
        </div>
        <div>
          <strong>stdout</strong>
          <pre class="stdout">${esc(result.stdout || '(empty)')}</pre>
          ${result.stderr ? `<strong>stderr</strong><pre class="stderr">${esc(result.stderr)}</pre>` : ''}
        </div>
      </div>
    </article>`).join('')}
  </section>
</main>
</body>
</html>
`;
}

async function gitCommit() {
  const result = await new Promise((resolve) => {
    const child = spawn('git', ['rev-parse', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('close', (code) => resolve(code === 0 ? stdout.trim() : null));
    child.on('error', () => resolve(null));
  });
  return result;
}

async function main() {
  const started = performance.now();
  const generatedAt = isoNow();
  const results = [];
  for (const suite of SUITES) {
    const result = await runSuite(suite);
    results.push(result);
  }
  const report = {
    schema: 'living-doc-inference-unit-chaining-test-report/v1',
    generatedAt,
    gitCommit: await gitCommit(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: ROOT,
    },
    totalDurationMs: Math.round(performance.now() - started),
    status: results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
    results,
  };

  await mkdir(path.dirname(OUT_HTML), { recursive: true });
  await writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(OUT_HTML, renderHtml(report), 'utf8');

  process.stdout.write(`wrote ${path.relative(ROOT, OUT_HTML)}\n`);
  process.stdout.write(`wrote ${path.relative(ROOT, OUT_JSON)}\n`);
  for (const result of results) {
    process.stdout.write(`${result.status === 'passed' ? 'PASS' : 'FAIL'} ${result.label} (${result.durationMs}ms)\n`);
  }
  if (report.status !== 'passed') process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
