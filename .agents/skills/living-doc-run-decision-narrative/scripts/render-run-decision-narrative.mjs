#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = [...argv];
  const target = args.shift();
  if (!target) {
    throw new Error('usage: render-run-decision-narrative.mjs <lifecycle-id-or-result-path> [--runs-dir <dir>] [--out <html>] [--title <title>]');
  }
  const options = {
    target,
    runsDir: '.living-doc-runs',
    out: null,
    title: null,
  };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--runs-dir') options.runsDir = args.shift();
    else if (flag === '--out') options.out = args.shift();
    else if (flag === '--title') options.title = args.shift();
    else throw new Error(`unknown option: ${flag}`);
  }
  return options;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readText(filePath, fallback = '') {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function compact(value, fallback = 'n/a') {
  if (value == null || value === '') return fallback;
  return String(value);
}

function relFromCwd(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? path.relative(process.cwd(), filePath) : filePath;
}

function resolveLifecyclePath({ target, runsDir }) {
  if (target.endsWith('.json') || target.includes('/')) return path.resolve(target);
  return path.resolve(runsDir, target, 'lifecycle-result.json');
}

function runDirPath(iteration) {
  return iteration?.runDir ? path.resolve(process.cwd(), iteration.runDir) : null;
}

function artifactPath(runDir, relativePath) {
  if (!runDir || !relativePath) return null;
  return path.resolve(runDir, relativePath);
}

async function inspectionCoverage(unitDir) {
  const input = await readJson(path.join(unitDir, 'input-contract.json'), {});
  const events = await readText(path.join(unitDir, 'codex-events.jsonl'), '');
  const required = arr(input.requiredInspectionPaths);
  if (!required.length) return null;
  const missing = required.filter((requiredPath) => {
    const absolute = path.resolve(requiredPath);
    const relative = path.relative(process.cwd(), absolute);
    return !events.includes(requiredPath) && !events.includes(absolute) && !events.includes(relative);
  });
  return {
    required: required.length,
    inspected: required.length - missing.length,
    missing,
  };
}

function list(items) {
  const values = arr(items).filter((item) => item != null && item !== '');
  if (!values.length) return '<p class="muted">No basis recorded.</p>';
  return `<ul>${values.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
}

function pills(items) {
  const values = arr(items).filter(Boolean);
  if (!values.length) return '';
  return `<div class="pills">${values.map((item) => `<span>${esc(item)}</span>`).join('')}</div>`;
}

function renderPlainMessage(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '<p class="muted">No worker final message captured in the inference-unit snapshot.</p>';

  const blocks = [];
  let listItems = [];
  let paragraph = [];
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${esc(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      listItems.push(bullet[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks.join('');
}

function kv(label, value) {
  return `<div class="kv"><span>${esc(label)}</span><strong>${esc(compact(value))}</strong></div>`;
}

function card({ title, eyebrow, status, body, meta = '', tone = '' }) {
  return `
    <article class="card ${esc(tone)}">
      <div class="card-head">
        <div>
          ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
          <h3>${esc(title)}</h3>
        </div>
        ${status ? `<span class="status">${esc(status)}</span>` : ''}
      </div>
      ${meta ? `<div class="meta">${meta}</div>` : ''}
      <div class="body">${body}</div>
    </article>`;
}

async function collectIteration(iteration) {
  const runDir = runDirPath(iteration);
  const number = iteration.iteration;
  const outputInput = await readJson(artifactPath(runDir, `output-input/iteration-${number}.json`), null);
  const reviewer = await readJson(artifactPath(runDir, `reviewer-inference/iteration-${number}-verdict.json`), null);
  const workerResult = await readJson(artifactPath(runDir, `inference-units/iteration-${number}/01-worker/result.json`), null);
  const workerMessage = await readText(artifactPath(runDir, `inference-units/iteration-${number}/01-worker/last-message.txt`), '');
  const evidence = await readJson(artifactPath(runDir, `artifacts/iteration-${number}-evidence.json`), null);
  const repairChain = iteration.repairSkillResultPath
    ? await readJson(path.resolve(process.cwd(), iteration.repairSkillResultPath), null)
    : null;
  const balanceResult = await readJson(artifactPath(runDir, `repair-skills/iteration-${number}/00-living-doc-balance-scan/result.json`), null);
  const closureReview = iteration.closureReviewResultPath
    ? await readJson(path.resolve(process.cwd(), iteration.closureReviewResultPath), null)
    : null;

  const repairSkills = [];
  for (const skill of arr(repairChain?.skillResults)) {
    const unitDir = skill.resultPath
      ? artifactPath(runDir, skill.resultPath.replace(/\/result\.json$/, ''))
      : null;
    repairSkills.push({
      ...skill,
      coverage: unitDir ? await inspectionCoverage(unitDir) : null,
    });
  }

  const balanceCoverage = await inspectionCoverage(artifactPath(runDir, `repair-skills/iteration-${number}/00-living-doc-balance-scan`));

  return {
    iteration,
    runDir,
    outputInput,
    reviewer,
    workerResult,
    workerMessage,
    evidence,
    repairChain,
    balanceResult,
    balanceCoverage,
    repairSkills,
    closureReview,
  };
}

function renderWorkerDecision(data) {
  const output = data.workerResult?.outputContract || data.workerResult || {};
  const changedFiles = arr(data.evidence?.workerEvidence?.filesChanged);
  return card({
    eyebrow: `Iteration ${data.iteration.iteration}`,
    title: 'Worker Output',
    status: data.iteration.classification || output.status || 'recorded',
    meta: [
      kv('terminal kind', data.iteration.terminalKind),
      kv('proof valid', data.iteration.proofValid),
    ].join(''),
    body: `
      ${renderPlainMessage(data.workerMessage)}
      <h4>Changed files recorded by evidence</h4>
      ${pills(changedFiles) || '<p class="muted">No changed files recorded in iteration evidence.</p>'}
    `,
  });
}

function renderReviewerDecision(data) {
  const verdict = data.reviewer?.verdict?.stopVerdict || {};
  const next = data.reviewer?.verdict?.nextIteration || {};
  return card({
    title: 'Reviewer Decision',
    status: verdict.classification,
    tone: verdict.closureAllowed ? 'positive' : 'warning',
    meta: [
      kv('reason', verdict.reasonCode),
      kv('closure allowed', verdict.closureAllowed),
      kv('next mode', next.mode),
    ].join(''),
    body: `
      <h4>Reasoning</h4>
      ${list(verdict.basis)}
      <h4>Next instruction</h4>
      <p>${esc(compact(next.instruction, 'No next instruction recorded.'))}</p>
    `,
  });
}

function renderPostReviewSelection(data) {
  const selection = data.outputInput?.postReviewSelection || {};
  const nextUnit = selection.nextUnit || {};
  const terminal = selection.terminalAction || {};
  return card({
    title: 'Post-Review Selection',
    status: nextUnit.unitId || terminal.kind || 'none',
    meta: [
      kv('reason', nextUnit.reasonCode || terminal.reasonCode),
      kv('role', nextUnit.role),
      kv('terminal action', terminal.kind),
    ].join(''),
    body: `
      <p>The deterministic controller used the reviewer signal and current proof state to choose the next contract-bound step.</p>
      ${pills(arr(nextUnit.requiredInputPaths))}
    `,
  });
}

function renderBalanceDecision(data) {
  if (!data.balanceResult) return '';
  const output = data.balanceResult.outputContract || data.balanceResult;
  return card({
    title: 'Balance Scan Decision',
    status: output.status,
    tone: 'warning',
    meta: [
      kv('ordered skills', arr(output.orderedSkills).join(' -> ')),
      kv('inspection coverage', data.balanceCoverage ? `${data.balanceCoverage.inspected}/${data.balanceCoverage.required}` : 'n/a'),
    ].join(''),
    body: `
      <h4>Diagnosis</h4>
      ${list(output.basis)}
      <h4>Ordered skills</h4>
      ${pills(output.orderedSkills)}
    `,
  });
}

function renderRepairSkillDecision(skill) {
  return card({
    title: skill.skill || 'Repair Skill',
    status: skill.status,
    tone: skill.status === 'blocked' || skill.status === 'failed' ? 'negative' : 'positive',
    meta: [
      kv('reason', skill.reasonCode),
      kv('inspection coverage', skill.coverage ? `${skill.coverage.inspected}/${skill.coverage.required}` : 'n/a'),
      kv('commit intent', skill.commitIntent?.required === true ? 'required' : 'not required'),
    ].join(''),
    body: `
      <h4>Reasoning</h4>
      ${list(skill.basis)}
      <h4>Changed files</h4>
      ${pills(skill.changedFiles)}
      <h4>Commit intent</h4>
      <p>${esc(skill.commitIntent?.reason || 'No commit intent reason recorded.')}</p>
      ${skill.commitIntent?.message ? `<p class="commit-message">${esc(skill.commitIntent.message)}</p>` : ''}
      <h4>Next recommendation</h4>
      <p>${esc(compact(skill.nextRecommendedAction, 'No recommendation recorded.'))}</p>
    `,
  });
}

function renderRepairChain(data) {
  if (!data.repairChain) return '';
  return `
    <section class="section">
      <div class="section-head">
        <h2>Repair Chain</h2>
        <p>Inference units selected by balance scan and executed before the next worker iteration.</p>
      </div>
      ${card({
        title: 'Repair Chain Result',
        status: data.repairChain.status,
        meta: kv('skill results', arr(data.repairChain.skillResults).length),
        body: '<p>The chain is complete only when every ordered skill has a validated result or an explicit blocked state.</p>',
      })}
      ${data.repairSkills.map(renderRepairSkillDecision).join('')}
    </section>`;
}

function renderClosureDecision(data) {
  if (!data.closureReview) return '';
  const output = data.closureReview.outputContract || {};
  return card({
    title: 'Closure Review Decision',
    status: output.approved ? 'approved' : 'rejected',
    tone: output.approved ? 'positive' : 'negative',
    meta: [
      kv('reason', output.reasonCode),
      kv('terminal allowed', output.terminalAllowed),
      kv('confidence', output.confidence),
    ].join(''),
    body: `
      <h4>Reasoning</h4>
      ${list(output.basis)}
    `,
  });
}

function renderIteration(data) {
  return `
    <section class="section">
      <div class="section-head">
        <h2>Iteration ${esc(data.iteration.iteration)}</h2>
        <p>${esc(data.iteration.runId || path.basename(data.runDir || ''))}</p>
      </div>
      <div class="grid">
        ${renderWorkerDecision(data)}
        ${renderReviewerDecision(data)}
        ${renderPostReviewSelection(data)}
        ${renderBalanceDecision(data)}
        ${renderClosureDecision(data)}
      </div>
      ${renderRepairChain(data)}
    </section>`;
}

function htmlPage({ title, lifecycle, iterations, sourcePath }) {
  const finalState = lifecycle.finalState || {};
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #132033;
      --muted: #607086;
      --line: #d9e1ec;
      --paper: #f6f8fb;
      --card: #ffffff;
      --blue: #2857c5;
      --teal: #0f766e;
      --amber: #a16207;
      --red: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      padding: 32px 40px 24px;
      background: #fff;
      border-bottom: 1px solid var(--line);
    }
    .wrap { max-width: 1180px; margin: 0 auto; }
    h1, h2, h3, h4, p { margin-top: 0; }
    h1 { font-size: 30px; line-height: 1.15; margin-bottom: 10px; }
    h2 { font-size: 20px; margin-bottom: 4px; }
    h3 { font-size: 16px; margin-bottom: 0; }
    h4 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 18px 0 6px; }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-top: 20px;
    }
    .kv {
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 8px;
      padding: 10px 12px;
      min-width: 0;
    }
    .kv span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
    .kv strong { display: block; margin-top: 3px; overflow-wrap: anywhere; }
    main { padding: 28px 40px 48px; }
    .section { margin: 0 auto 28px; max-width: 1180px; }
    .section-head { margin: 0 0 12px; }
    .section-head p { color: var(--muted); margin-bottom: 0; overflow-wrap: anywhere; }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-top: 4px solid var(--blue);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 8px 24px rgba(19, 32, 51, .05);
    }
    .card.warning { border-top-color: var(--amber); }
    .card.positive { border-top-color: var(--teal); }
    .card.negative { border-top-color: var(--red); }
    .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .eyebrow { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }
    .status {
      flex: 0 0 auto;
      border: 1px solid var(--line);
      background: #f8fafc;
      color: var(--ink);
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 700;
    }
    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }
    .meta .kv { background: #f9fbfe; padding: 8px 10px; }
    .body p:last-child { margin-bottom: 0; }
    ul { padding-left: 18px; margin: 0; }
    li + li { margin-top: 6px; }
    .pills { display: flex; flex-wrap: wrap; gap: 6px; }
    .pills span {
      border: 1px solid var(--line);
      background: #f8fafc;
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .muted { color: var(--muted); }
    .commit-message {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background: #f8fafc;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
    }
    footer {
      max-width: 1180px;
      margin: 0 auto;
      color: var(--muted);
      padding: 0 40px 40px;
      overflow-wrap: anywhere;
    }
    @media (max-width: 850px) {
      header, main { padding-left: 18px; padding-right: 18px; }
      .summary, .grid, .meta { grid-template-columns: 1fr; }
      footer { padding-left: 18px; padding-right: 18px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>${esc(title)}</h1>
      <p class="muted">Decision narrative generated from lifecycle and inference-unit artifacts. Raw private logs are referenced, not embedded.</p>
      <div class="summary">
        ${kv('result id', lifecycle.resultId)}
        ${kv('final state', finalState.kind)}
        ${kv('iterations', lifecycle.iterationCount)}
        ${kv('reason', finalState.reason)}
      </div>
    </div>
  </header>
  <main>
    ${iterations.map(renderIteration).join('')}
  </main>
  <footer>
    Source: ${esc(sourcePath)}
  </footer>
</body>
</html>
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const lifecyclePath = resolveLifecyclePath(options);
  const lifecycle = await readJson(lifecyclePath, null);
  if (!lifecycle) throw new Error(`could not read lifecycle result: ${lifecyclePath}`);
  const iterations = [];
  for (const iteration of arr(lifecycle.iterations)) {
    iterations.push(await collectIteration(iteration));
  }
  const title = options.title || `Decision Narrative - ${lifecycle.resultId || path.basename(path.dirname(lifecyclePath))}`;
  const out = options.out
    ? path.resolve(options.out)
    : path.resolve('docs', `${lifecycle.resultId || path.basename(path.dirname(lifecyclePath))}-decision-narrative.html`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, htmlPage({ title, lifecycle, iterations, sourcePath: relFromCwd(lifecyclePath) }), 'utf8');
  console.log(out);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
