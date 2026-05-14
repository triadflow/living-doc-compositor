#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, 'docs', 'inference-unit-chaining-test-report.json');
const OUT_HTML = path.join(ROOT, 'docs', 'inference-unit-chaining-test-suite-overview.html');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMs(ms) {
  if (!Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function countRunnableTests(results) {
  return results.reduce((sum, suite) => (
    sum + suite.testCases.filter((testCase) => testCase.status !== 'skipped').length
  ), 0);
}

function countSkippedTests(results) {
  return results.reduce((sum, suite) => (
    sum + suite.testCases.filter((testCase) => testCase.status === 'skipped').length
  ), 0);
}

function countCoverage(results) {
  return results.reduce((sum, suite) => sum + suite.coverage.length, 0);
}

function suiteRows(results) {
  return results.map((suite) => `
    <article class="suite-card">
      <div class="suite-top">
        <div>
          <span class="eyebrow">${esc(suite.id)}</span>
          <h3>${esc(suite.label)}</h3>
          <p>${esc(suite.purpose)}</p>
        </div>
        <div class="suite-metrics">
          <span class="status ${suite.status === 'passed' ? 'pass' : 'fail'}">${esc(suite.status)}</span>
          <strong>${esc(fmtMs(suite.durationMs))}</strong>
          <small>${suite.testCases.filter((testCase) => testCase.status !== 'skipped').length} tests</small>
        </div>
      </div>
      <div class="suite-body">
        <div>
          <h4>What It Proves</h4>
          <ul>${suite.coverage.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
        </div>
        <div>
          <h4>Named Cases</h4>
          <div class="case-list">
            ${suite.testCases.map((testCase) => `
              <span class="case ${testCase.status === 'skipped' ? 'skip' : testCase.status === 'passed' ? 'pass' : 'unknown'}">
                ${esc(testCase.name)}
              </span>
            `).join('')}
          </div>
          <p class="source">Source: <code>${esc(suite.sourcePath)}</code></p>
          <p class="source">Command: <code>${esc(suite.command)}</code></p>
        </div>
      </div>
    </article>
  `).join('');
}

function chainTimeline(report) {
  const maximal = report.results.find((suite) => suite.id === 'maximal-chain')?.chainEvidence;
  const timeline = maximal?.timeline || [];
  if (!timeline.length) {
    return '<p class="muted">No maximal-chain timeline was available in the report JSON.</p>';
  }
  return `
    <div class="timeline">
      ${timeline.map((step) => `
        <div class="step">
          <div class="step-num">${esc(step.sequence)}</div>
          <div>
            <h4>${esc(step.unitTypeId)}</h4>
            <p>${esc(step.reasonCode)}</p>
            <div class="step-meta">
              <span>status: <b>${esc(step.status)}</b></span>
              <span>next: <b>${esc(step.selectedNextUnit || 'terminal')}</b></span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function negativeMatrix(report) {
  const maximal = report.results.find((suite) => suite.id === 'maximal-chain')?.chainEvidence;
  const rows = maximal?.negativeMatrix || [];
  if (!rows.length) return '<p class="muted">No negative matrix was available in the report JSON.</p>';
  return `
    <div class="matrix">
      ${rows.map((row) => `
        <div class="matrix-row">
          <strong>${esc(row.id || row.name || 'breakpoint')}</strong>
          <span>${esc(row.expectedRoute || row.expected || row.status || 'covered')}</span>
          <p>${esc(row.description || row.reason || row.failureMode || '')}</p>
        </div>
      `).join('')}
    </div>
  `;
}

function render(report) {
  const results = report.results || [];
  const passedSuites = results.filter((suite) => suite.status === 'passed').length;
  const failedSuites = results.length - passedSuites;
  const runnableTests = countRunnableTests(results);
  const skippedTests = countSkippedTests(results);
  const coverageChecks = countCoverage(results);
  const statusClass = report.status === 'passed' ? 'pass' : 'fail';
  const generatedAt = report.generatedAt || new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inference Unit Chaining Test Suite Overview</title>
<style>
:root{
  --bg:#f4f7fb;
  --panel:#fff;
  --ink:#172033;
  --muted:#65758c;
  --line:#d9e2ee;
  --dark:#111827;
  --blue:#2563eb;
  --blue-soft:#dbeafe;
  --green:#166534;
  --green-soft:#dcfce7;
  --red:#b91c1c;
  --red-soft:#fee2e2;
  --amber:#9a5b05;
  --amber-soft:#fff3d6;
  --radius:8px;
}
*{box-sizing:border-box}
body{
  margin:0;
  background:var(--bg);
  color:var(--ink);
  font:15px/1.58 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased;
}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
.wrap{width:min(1180px,calc(100% - 40px));margin:0 auto}
header{background:#fff;border-bottom:1px solid var(--line);padding:32px 0 28px}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}
.brand{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px;font-weight:850;letter-spacing:.08em;text-transform:uppercase}
.mark{width:34px;height:34px;display:grid;place-items:center;border-radius:7px;background:var(--dark);color:#fff;font-weight:900}
.badge{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:850;text-transform:uppercase;letter-spacing:.05em}
.badge.pass,.status.pass,.case.pass{color:var(--green);background:var(--green-soft);border-color:#bbf7d0}
.badge.fail,.status.fail{color:var(--red);background:var(--red-soft);border-color:#fecaca}
h1{max-width:880px;margin:0;font-size:clamp(32px,5vw,58px);line-height:1.02;letter-spacing:0;font-weight:920}
.lede{max-width:900px;margin:14px 0 0;color:var(--muted);font-size:17px}
.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:26px}
.metric{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:14px}
.metric strong{display:block;font-size:30px;line-height:1;margin-bottom:6px}
.metric span{color:var(--muted);font-size:12px;font-weight:850;text-transform:uppercase;letter-spacing:.06em}
main{padding:28px 0 70px}
section{padding:28px 0;border-bottom:1px solid var(--line)}
section:last-child{border-bottom:0}
.section-head{display:grid;grid-template-columns:290px 1fr;gap:28px;align-items:start;margin-bottom:18px}
h2{font-size:28px;line-height:1.15;margin:0}
.copy{color:var(--muted);margin:0}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.panel,.suite-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius)}
.panel{padding:18px}
.panel h3{margin:0 0 8px;font-size:18px}
.panel p{margin:0;color:var(--muted)}
.panel ul{margin:10px 0 0;padding-left:20px}
.panel li{margin:5px 0}
.flow{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
.flow-card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:14px;min-height:156px}
.flow-card b{display:block;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--blue);margin-bottom:8px}
.flow-card p{margin:0;color:var(--muted)}
.suite-card{overflow:hidden;margin-bottom:14px}
.suite-top{display:grid;grid-template-columns:1fr auto;gap:18px;padding:16px;background:#eef3f8;border-bottom:1px solid var(--line)}
.eyebrow{display:block;color:var(--muted);font-size:11px;font-weight:850;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
.suite-top h3{margin:0 0 6px;font-size:20px}
.suite-top p{margin:0;color:var(--muted)}
.suite-metrics{text-align:right;min-width:120px}
.suite-metrics strong{display:block;margin:8px 0 2px;font-size:22px}
.suite-metrics small{color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.05em}
.status{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:4px 9px;font-size:11px;font-weight:850;text-transform:uppercase}
.suite-body{display:grid;grid-template-columns:1fr 1fr}
.suite-body>div{padding:16px}
.suite-body>div+div{border-left:1px solid var(--line)}
h4{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#334155}
ul{margin:0;padding-left:20px}
li{margin:5px 0}
.case-list{display:flex;flex-wrap:wrap;gap:6px}
.case{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:4px 8px;font-size:12px;font-weight:750;background:#f8fafc}
.case.skip{color:var(--amber);background:var(--amber-soft);border-color:#f5d08c}
.case.unknown{color:var(--muted)}
.source{margin:10px 0 0;color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.timeline{display:grid;gap:10px}
.step{display:grid;grid-template-columns:54px 1fr;gap:12px;background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:12px}
.step-num{width:42px;height:42px;border-radius:7px;background:var(--blue);color:#fff;display:grid;place-items:center;font-weight:900;font-size:20px}
.step h4{margin:0 0 4px;font-size:17px;letter-spacing:0;text-transform:none;color:var(--ink)}
.step p{margin:0;color:var(--muted)}
.step-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.step-meta span{background:#f8fafc;border:1px solid var(--line);border-radius:999px;padding:3px 8px;font-size:12px}
.matrix{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.matrix-row{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:13px}
.matrix-row strong{display:block;margin-bottom:4px}
.matrix-row span{display:inline-flex;color:var(--blue);background:var(--blue-soft);border:1px solid #bfdbfe;border-radius:999px;padding:3px 8px;font-size:12px;font-weight:850}
.matrix-row p{margin:8px 0 0;color:var(--muted)}
.callout{background:#111827;color:#fff;border-radius:var(--radius);padding:18px}
.callout h3{margin:0 0 8px}
.callout p{margin:0;color:#d1d5db}
.truth-table{display:grid;gap:8px}
.truth-row{display:grid;grid-template-columns:230px 1fr;gap:10px;background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:12px}
.truth-row strong{color:var(--ink)}
.truth-row span{color:var(--muted)}
.muted{color:var(--muted)}
footer{padding:22px 0 34px;color:var(--muted);font-size:13px}
@media(max-width:860px){
  .metrics,.flow,.grid-2,.suite-body,.section-head,.matrix,.truth-row{grid-template-columns:1fr}
  .suite-body>div+div{border-left:0;border-top:1px solid var(--line)}
  .suite-top{grid-template-columns:1fr}
  .suite-metrics{text-align:left}
}
</style>
</head>
<body>
<header>
  <div class="wrap">
    <div class="top">
      <div class="brand"><span class="mark">IU</span><span>Living Doc Harness</span></div>
      <span class="badge ${statusClass}">${esc(report.status)}</span>
    </div>
    <h1>Inference Unit Chaining Test Suite</h1>
    <p class="lede">A practical map of what the current chaining suite proves, how it hardens the harness, and how it should guide every future unit type, routing policy, side-effect gate, and dashboard surface.</p>
    <div class="metrics">
      <div class="metric"><strong>${results.length}</strong><span>suites</span></div>
      <div class="metric"><strong>${runnableTests}</strong><span>tests run</span></div>
      <div class="metric"><strong>${skippedTests}</strong><span>optional skipped</span></div>
      <div class="metric"><strong>${coverageChecks}</strong><span>coverage checks</span></div>
      <div class="metric"><strong>${esc(fmtMs(report.totalDurationMs))}</strong><span>total time</span></div>
    </div>
  </div>
</header>
<main class="wrap">
  <section>
    <div class="section-head">
      <h2>What This Suite Is For</h2>
      <p class="copy">The suite is not trying to prove that one agent prompt is smart. It proves that the controller can chain contract-bound inference units without believing model text as authority. Each test pushes on a boundary where the harness could otherwise drift into a monolithic agent loop.</p>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>The Core Claim</h3>
        <p>A unit may claim, recommend, or produce an artifact. The harness must decide what that claim means through registry validation, routing policy, artifact refs, side-effect gates, and terminal authority.</p>
      </div>
      <div class="panel">
        <h3>The Practical Benefit</h3>
        <p>When a new unit type or policy is added, the developer gets a concrete proof checklist: contract shape, allowed transition, routing rule, runtime handoff, negative case, dashboard visibility, and generated evidence.</p>
      </div>
    </div>
  </section>

  <section>
    <div class="section-head">
      <h2>Proof Layers</h2>
      <p class="copy">The suite is intentionally layered. Each layer catches a different failure mode, from local contract mistakes to composed lifecycle drift.</p>
    </div>
    <div class="flow">
      <div class="flow-card"><b>1. Contract Shape</b><p>Mock unit instances must write the same input, result, validation, output, and artifact layout as real units.</p></div>
      <div class="flow-card"><b>2. Controller Selection</b><p>Frozen evidence and policy determine the next unit. A unit cannot directly start the next unit.</p></div>
      <div class="flow-card"><b>3. System Invariants</b><p>Runtime handoffs are audited as a graph: refs resolve, selected units cite policy, and stale blockers do not dominate new output.</p></div>
      <div class="flow-card"><b>4. Maximal Chain</b><p>One composed path exercises repair, worker re-entry, commit-intent, PR-review, closure-review, and terminal closure.</p></div>
      <div class="flow-card"><b>5. Headless Calibration</b><p>The execute:true path is exercised through a fake Codex process, including required inspection and malformed output handling.</p></div>
    </div>
  </section>

  <section>
    <div class="section-head">
      <h2>Current Test Run</h2>
      <p class="copy">Generated from <code>docs/inference-unit-chaining-test-report.json</code> at <code>${esc(generatedAt)}</code>. Git commit recorded by the report: <code>${esc(report.gitCommit || 'unknown')}</code>.</p>
    </div>
    ${suiteRows(results)}
  </section>

  <section>
    <div class="section-head">
      <h2>Maximal Chain</h2>
      <p class="copy">This is the high-value composition proof. It shows the hardest path as one controller-owned chain, not as disconnected unit tests.</p>
    </div>
    ${chainTimeline(report)}
  </section>

  <section>
    <div class="section-head">
      <h2>Negative Breakpoints</h2>
      <p class="copy">A strong chain suite must show where the system refuses to proceed. These cases protect against false closure, gate bypass, invalid transitions, stale evidence, and ineffective repair.</p>
    </div>
    ${negativeMatrix(report)}
  </section>

  <section>
    <div class="section-head">
      <h2>How It Hardens The System</h2>
      <p class="copy">The value is not the count of tests. The value is that common future mistakes have a named place to fail.</p>
    </div>
    <div class="truth-table">
      <div class="truth-row"><strong>New unit type</strong><span>Add registry metadata, real contract fixtures, legal and illegal transitions, required input refs, and dashboard graph coverage.</span></div>
      <div class="truth-row"><strong>New routing policy</strong><span>Add a policy-table case, a controller-selected fixture, a stale/negative case, and a generated-report entry explaining the route.</span></div>
      <div class="truth-row"><strong>New side-effect gate</strong><span>Prove blocked and unblocked states. A gate is not mature if it only proves the happy path.</span></div>
      <div class="truth-row"><strong>New handoff artifact</strong><span>Add path/ref pair coverage and runtime invariant assertions so later runs resolve object refs instead of local strings.</span></div>
      <div class="truth-row"><strong>New dashboard surface</strong><span>Feed it object refs and assert graph cards, links, and detail views resolve through the same artifact-ref model.</span></div>
      <div class="truth-row"><strong>New terminal path</strong><span>Prove reviewer output alone cannot close. Terminal state must come from the authorized closure path plus controller persistence.</span></div>
    </div>
  </section>

  <section>
    <div class="section-head">
      <h2>Extension Checklist</h2>
      <p class="copy">Use this checklist when invoking the inference-unit-chain-extension skill for a new unit type, policy, side-effect gate, or artifact surface.</p>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>Minimum Required Proof</h3>
        <ul>
          <li>Registry entry with input contract, output contract, verdicts, allowed next units, evidence, and side-effect permissions.</li>
          <li>Positive chain path proving the new behavior in context.</li>
          <li>Negative path proving the controller blocks or reroutes the unsafe case.</li>
          <li>Runtime handoff proof that required paths have object refs where cross-run resolution matters.</li>
          <li>Report evidence with names, timings, status, and coverage text generated from the test run.</li>
        </ul>
      </div>
      <div class="panel">
        <h3>Do Not Accept</h3>
        <ul>
          <li>Only a prose explanation of the architecture.</li>
          <li>A mock that does not match real input/output/result/validation shape.</li>
          <li>A route that is special-cased outside the policy table without a clear reason.</li>
          <li>A string path where a later unit or dashboard needs an artifact ref.</li>
          <li>A report card that is edited by hand instead of generated from the run.</li>
        </ul>
      </div>
    </div>
  </section>

  <section>
    <div class="section-head">
      <h2>Honest Limits</h2>
      <p class="copy">This is a strong deterministic contract suite, not a guarantee that every future production run is correct.</p>
    </div>
    <div class="callout">
      <h3>What It Still Does Not Prove</h3>
      <p>It does not prove every real Codex model output will be good, every possible objective will converge, or every future dashboard field is automatically covered. Its real strength is narrower and more useful: when the harness changes, it protects the controller-owned chaining contract and gives new unit or policy work a concrete proof bar.</p>
    </div>
  </section>

  <section>
    <div class="section-head">
      <h2>Commands</h2>
      <p class="copy">These are the commands this overview expects developers to use while extending the chain.</p>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>Run The Suite</h3>
        <ul>
          <li><code>npm run test:harness-chaining-report</code></li>
          <li><code>npm run test:contract</code></li>
          <li><code>node tests/contract/living-doc-harness-system-invariants.spec.mjs</code></li>
        </ul>
      </div>
      <div class="panel">
        <h3>Rendered Evidence</h3>
        <ul>
          <li><code>docs/inference-unit-chaining-test-report.html</code></li>
          <li><code>docs/inference-unit-chaining-test-report.json</code></li>
          <li><code>docs/inference-unit-chaining-maximal-chain.json</code></li>
          <li><code>docs/inference-unit-chaining-test-suite-overview.html</code></li>
        </ul>
      </div>
    </div>
  </section>
</main>
<footer class="wrap">
  Static overview generated from the latest chaining test report. Source report: <code>docs/inference-unit-chaining-test-report.json</code>.
</footer>
</body>
</html>`;
}

const report = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
await writeFile(OUT_HTML, render(report), 'utf8');
console.log(`wrote ${path.relative(ROOT, OUT_HTML)}`);
