#!/usr/bin/env node
// Ordered repair-skill executor for the standalone living-doc harness.
//
// This turns repair routing into execution: balance scan runs first as a
// contract-bound inference unit, then every skill in its ordered list runs as a
// separate contract-bound inference unit with prior-result handoff.

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runContractBoundInferenceUnit } from './living-doc-harness-inference-unit.mjs';

const __filename = fileURLToPath(import.meta.url);

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function slug(value) {
  return String(value || 'skill')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'skill';
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

function rel(runDir, filePath) {
  return filePath ? path.relative(runDir, filePath) : null;
}

function skillPath(skill) {
  return path.join('.agents', 'skills', skill, 'SKILL.md');
}

async function readSkillInstructions(skill) {
  try {
    return await readFile(skillPath(skill), 'utf8');
  } catch {
    return `# ${skill}\n\nNo local SKILL.md was found. Use the input contract and living doc evidence to produce the required structured result.`;
  }
}

function normalizeOrderedSkills(result) {
  return arr(result?.orderedSkills || result?.outputContract?.orderedSkills || result?.recommendedSkillOrder)
    .map((item) => typeof item === 'string' ? item : item?.skill)
    .filter(Boolean);
}

function defaultBalanceScanResult(handover) {
  const orderedSkills = arr(handover?.actions)
    .filter((action) => action.kind === 'skill')
    .map((action) => action.skill)
    .filter((skill) => skill !== 'living-doc-balance-scan');
  return {
    status: orderedSkills.length ? 'ordered' : 'no-op',
    basis: orderedSkills.length
      ? ['Derived ordered repair skills from routing handover actions.']
      : ['No repair skills were present in the routing handover.'],
    orderedSkills,
  };
}

function defaultCommitIntent({ skill, changedFiles = [] }) {
  const files = arr(changedFiles);
  if (!files.length) {
    return {
      required: false,
      reason: 'No changed files were reported by the repair skill.',
    };
  }
  return {
    required: true,
    reason: 'Repair skill changed files under commit-intent-only policy.',
    message: `ldoc repair: ${skill}`,
    body: [
      `Repair skill: ${skill}`,
      'Commit policy: commit-intent-only; the headless repair unit must not run git commit directly.',
      `Changed files: ${files.join(', ')}`,
    ],
    changedFiles: files,
  };
}

function repairSkillResult({ skill, sequence, status = 'no-op', basis = [], livingDocPath, renderedHtmlPath, rawJsonlLogPath, balanceScanResultPath, priorRepairResultPaths = [], changedFiles = [], nextRecommendedAction = 'continue-repair-chain', commitIntent = null }) {
  return {
    status,
    basis: basis.length ? basis : [`${skill} completed in fixture mode.`],
    outputContract: {
      schema: 'living-doc-repair-skill-result/v1',
      skill,
      sequence,
      status,
      basis: basis.length ? basis : [`${skill} completed in fixture mode.`],
      changedFiles,
      livingDocPath,
      renderedHtmlPath,
      rawJsonlLogPath,
      nextRecommendedAction,
      balanceScanResultPath,
      priorRepairResultPaths,
      commitPolicy: {
        mode: 'commit-intent-only',
        gitCommitAllowed: false,
      },
      commitIntent: commitIntent || defaultCommitIntent({ skill, changedFiles }),
    },
  };
}

function normalizeCommitIntent({ skill, outputContract }) {
  const changedFiles = arr(outputContract.changedFiles);
  const intent = outputContract.commitIntent && typeof outputContract.commitIntent === 'object'
    ? outputContract.commitIntent
    : defaultCommitIntent({ skill, changedFiles });
  if (changedFiles.length && intent.required !== true) {
    return {
      ...intent,
      required: true,
      reason: intent.reason || 'Changed files require a deferred commit intent.',
      changedFiles,
    };
  }
  return intent;
}

function classifyCommitBlocked(outputContract) {
  const text = [
    ...arr(outputContract.basis),
    outputContract.nextRecommendedAction,
  ].filter(Boolean).join('\n').toLowerCase();
  return text.includes('index.lock') || text.includes('git commit') || text.includes('could not create') || text.includes('unable to create');
}

function renderLivingDoc(docPath, cwd) {
  if (!docPath) return null;
  const result = spawnSync(process.execPath, ['scripts/render-living-doc.mjs', docPath], {
    cwd,
    encoding: 'utf8',
  });
  return {
    command: `node scripts/render-living-doc.mjs ${docPath}`,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    renderedHtml: docPath.replace(/\.json$/i, '.html'),
  };
}

async function rawWorkerJsonlPathsFromReviewer(runDir, reviewerVerdictPath) {
  const reviewer = await readJson(reviewerVerdictPath, null);
  const inputPath = reviewer?.reviewerInputPath
    ? path.resolve(runDir, reviewer.reviewerInputPath)
    : null;
  const input = inputPath ? await readJson(inputPath, null) : null;
  return arr(input?.logInspection?.rawWorkerJsonlPaths)
    .map((entry) => entry?.path)
    .filter(Boolean);
}

function balanceScanPrompt(input) {
  return `You are the living-doc-balance-scan inference unit in a standalone lifecycle harness.

Read the input contract. Return JSON only.

Classify the living-doc imbalance and return an ordered repair skill list. Do not claim repair. This unit only diagnoses and orders repair skills.

Mandatory evidence-path inspection:
- The input contract contains requiredInspectionPaths.
- Before emitting JSON, run commands that inspect every path in requiredInspectionPaths.
- If a path cannot be read, return status "blocked" and name the unreadable path in basis.

Required JSON shape:
{
  "status": "ordered|no-op|blocked|failed",
  "basis": ["specific evidence"],
  "orderedSkills": ["skill-name"]
}

Input contract:
${JSON.stringify(input, null, 2)}
`;
}

function repairSkillPrompt({ skill, skillInstructions, input }) {
  return `You are the ${skill} repair-skill inference unit in a standalone living-doc lifecycle harness.

Run this skill as an independent inference unit. Do not rely on prior chat. Read the input contract paths and produce JSON only.

Mandatory evidence-path inspection:
- The input contract contains requiredInspectionPaths.
- Before emitting JSON, run commands that inspect every path in requiredInspectionPaths.
- If a path cannot be read, return status "blocked" and name the unreadable path in basis.

Skill instructions:
${skillInstructions}

Required JSON shape:
{
  "status": "repaired|no-op|blocked|failed|aligned|criteria-gap|objective-gap|stale-map",
  "basis": ["specific evidence"],
  "changedFiles": ["path"],
  "nextRecommendedAction": "short action",
  "commitIntent": {
    "required": true,
    "reason": "why a commit is needed, or why no commit is needed",
    "message": "short commit subject when required",
    "body": ["detailed commit body lines"],
    "changedFiles": ["path"]
  }
}

Commit policy:
- This harness runs repair skills in commit-intent-only mode.
- Do not run git add, git commit, git reset, or any command that writes the git index.
- If the skill instructions say to commit, satisfy that requirement by returning commitIntent with a detailed message/body and changedFiles.
- If no files changed, return commitIntent.required false.

Input contract:
${JSON.stringify(input, null, 2)}
`;
}

export async function runRepairSkillChain({
  runDir,
  iteration = 1,
  livingDocPath,
  renderedHtmlPath = null,
  reviewerVerdictPath,
  handoverPath,
  repairSkillPlan = {},
  executeUnits = false,
  codexBin = 'codex',
  cwd = process.cwd(),
  now = new Date().toISOString(),
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!livingDocPath) throw new Error('livingDocPath is required');
  if (!reviewerVerdictPath) throw new Error('reviewerVerdictPath is required');
  if (!handoverPath) throw new Error('handoverPath is required');

  const repairRoot = path.join(runDir, 'repair-skills', `iteration-${iteration}`);
  await mkdir(repairRoot, { recursive: true });
  const handover = await readJson(handoverPath, {});
  const rawWorkerJsonlPaths = await rawWorkerJsonlPathsFromReviewer(runDir, reviewerVerdictPath);
  const rootInput = {
    schema: 'living-doc-repair-skill-chain-input/v1',
    runId: handover.runId || null,
    iteration,
    livingDocPath,
    renderedHtmlPath: renderedHtmlPath || livingDocPath.replace(/\.json$/i, '.html'),
    reviewerVerdictPath: rel(runDir, reviewerVerdictPath),
    handoverPath: rel(runDir, handoverPath),
    rawWorkerJsonlPaths,
  };
  const rootRequiredInspectionPaths = [
    path.resolve(cwd, livingDocPath),
    reviewerVerdictPath,
    handoverPath,
    ...rawWorkerJsonlPaths,
  ].filter(Boolean);

  const balanceInput = {
    ...rootInput,
    unitRole: 'balance-scan',
    requiredInspectionPaths: rootRequiredInspectionPaths,
    handoverActions: arr(handover.actions),
    unresolvedObjectiveTerms: arr(handover.unresolvedObjectiveTerms),
    unprovenAcceptanceCriteria: arr(handover.unprovenAcceptanceCriteria),
  };
  const balanceFixture = repairSkillPlan.balanceScanResult || defaultBalanceScanResult(handover);
  const balanceUnit = await runContractBoundInferenceUnit({
    runDir,
    rootDir: 'repair-skills',
    iteration,
    sequence: 0,
    unitId: 'living-doc-balance-scan',
    role: 'balance-scan',
    prompt: balanceScanPrompt(balanceInput),
    inputContract: balanceInput,
    fixtureResult: {
      status: balanceFixture.status || 'ordered',
      basis: arr(balanceFixture.basis).length ? balanceFixture.basis : ['Balance scan produced an ordered repair list.'],
      outputContract: {
        schema: 'living-doc-balance-scan-result/v1',
        status: balanceFixture.status || 'ordered',
        basis: arr(balanceFixture.basis),
        orderedSkills: arr(balanceFixture.orderedSkills),
      },
    },
    execute: executeUnits,
    codexBin,
    cwd,
    now,
  });
  const orderedSkills = normalizeOrderedSkills(balanceUnit.result.outputContract);
  const balanceScanResultPath = rel(runDir, balanceUnit.resultPath);
  const skillResults = [];
  const priorRepairResultPaths = [];
  const providedResults = arr(repairSkillPlan.skillResults);

  for (const [index, skill] of orderedSkills.entries()) {
    const sequence = index + 1;
    const inputContract = {
      ...rootInput,
      unitRole: 'repair-skill',
      skill,
      sequence,
      commitPolicy: {
        mode: 'commit-intent-only',
        gitCommitAllowed: false,
        forbiddenCommands: ['git add', 'git commit', 'git reset'],
        instruction: 'If the skill would normally commit, emit commitIntent in the result JSON instead of running git commit.',
      },
      balanceScanResultPath,
      priorRepairResultPaths: [...priorRepairResultPaths],
      requiredInspectionPaths: [
        ...rootRequiredInspectionPaths,
        path.resolve(runDir, balanceScanResultPath),
        ...priorRepairResultPaths.map((resultPath) => path.resolve(runDir, resultPath)),
      ],
    };
    const skillInstructions = await readSkillInstructions(skill);
    const provided = providedResults[index] || {};
    const fixture = repairSkillResult({
      skill,
      sequence,
      status: provided.status || 'no-op',
      basis: arr(provided.basis),
      livingDocPath,
      renderedHtmlPath: renderedHtmlPath || livingDocPath.replace(/\.json$/i, '.html'),
      rawJsonlLogPath: '',
      balanceScanResultPath,
      priorRepairResultPaths: [...priorRepairResultPaths],
      changedFiles: arr(provided.changedFiles),
      commitIntent: provided.commitIntent || null,
      nextRecommendedAction: provided.nextRecommendedAction || (index === orderedSkills.length - 1 ? 'run-objective-execution-readiness' : 'continue-repair-chain'),
    });
    const unit = await runContractBoundInferenceUnit({
      runDir,
      rootDir: 'repair-skills',
      iteration,
      sequence,
      unitId: skill,
      role: 'repair-skill',
      prompt: repairSkillPrompt({ skill, skillInstructions, input: inputContract }),
      inputContract,
      fixtureResult: fixture,
      execute: executeUnits,
      codexBin,
      cwd,
      now,
    });
    const outputContract = {
      ...unit.result.outputContract,
      commitPolicy: {
        mode: 'commit-intent-only',
        gitCommitAllowed: false,
      },
      commitIntent: normalizeCommitIntent({ skill, outputContract: unit.result.outputContract }),
      rawJsonlLogPath: rel(runDir, unit.codexEventsPath),
      resultPath: rel(runDir, unit.resultPath),
      validationPath: rel(runDir, unit.validationPath),
    };
    if (['blocked', 'failed'].includes(outputContract.status) && classifyCommitBlocked(outputContract)) {
      outputContract.status = 'blocked';
      outputContract.reasonCode = 'repair-skill-commit-policy-blocked';
      outputContract.commitIntent = normalizeCommitIntent({
        skill,
        outputContract: {
          ...outputContract,
          changedFiles: arr(outputContract.changedFiles),
          commitIntent: {
            ...outputContract.commitIntent,
            required: arr(outputContract.changedFiles).length > 0 || outputContract.commitIntent?.required === true,
            reason: 'Repair skill attempted or reported a git commit/index failure under commit-intent-only policy.',
          },
        },
      });
    }
    await writeJson(unit.resultPath, {
      ...unit.result,
      outputContract,
    });
    const didChangeDoc = arr(outputContract.changedFiles).some((file) => path.resolve(cwd, file) === path.resolve(cwd, livingDocPath));
    const render = didChangeDoc || outputContract.status === 'repaired'
      ? renderLivingDoc(livingDocPath, cwd)
      : null;
    const summary = {
      skill,
      sequence,
      status: outputContract.status,
      basis: arr(outputContract.basis),
      resultPath: rel(runDir, unit.resultPath),
      validationPath: rel(runDir, unit.validationPath),
      rawJsonlLogPath: rel(runDir, unit.codexEventsPath),
      changedFiles: arr(outputContract.changedFiles),
      commitPolicy: outputContract.commitPolicy,
      commitIntent: outputContract.commitIntent,
      reasonCode: outputContract.reasonCode || null,
      render,
      nextRecommendedAction: outputContract.nextRecommendedAction,
    };
    skillResults.push(summary);
    priorRepairResultPaths.push(summary.resultPath);
    await appendJsonl(path.join(runDir, 'skill-invocations.jsonl'), {
      schema: 'living-doc-harness-skill-invocation/v1',
      at: now,
      runId: handover.runId || null,
      iteration,
      skill,
      status: outputContract.status,
      reason: arr(outputContract.basis)[0] || `Executed ${skill}.`,
      stopClassification: handover.stopVerdict?.classification || null,
      stopReasonCode: handover.stopVerdict?.reasonCode || null,
      handoverPath: rel(runDir, handoverPath),
      resultPath: summary.resultPath,
      rawJsonlLogPath: summary.rawJsonlLogPath,
      commitIntent: summary.commitIntent,
    });
    if (['blocked', 'failed'].includes(outputContract.status)) break;
  }

  const blocked = skillResults.find((item) => ['blocked', 'failed'].includes(item.status));
  const chain = {
    schema: 'living-doc-repair-skill-chain-result/v1',
    runId: handover.runId || null,
    iteration,
    createdAt: now,
    status: blocked ? blocked.status : 'complete',
    livingDocPath,
    renderedHtmlPath: renderedHtmlPath || livingDocPath.replace(/\.json$/i, '.html'),
    reviewerVerdictPath: rel(runDir, reviewerVerdictPath),
    handoverPath: rel(runDir, handoverPath),
    rawWorkerJsonlPaths,
    balanceScan: {
      resultPath: balanceScanResultPath,
      status: balanceUnit.result.status,
      orderedSkills,
    },
    skillResults,
    nextRecommendedAction: blocked ? 'stop-repair-chain' : 'run-objective-execution-readiness',
  };
  const chainPath = path.join(repairRoot, 'repair-chain-result.json');
  await writeJson(chainPath, chain);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    event: 'repair-skill-chain-complete',
    at: now,
    runId: handover.runId || null,
    iteration,
    status: chain.status,
    orderedSkills,
    chainPath: rel(runDir, chainPath),
  });

  return {
    chain,
    chainPath,
    balanceScanResultPath: balanceUnit.resultPath,
    skillResults,
  };
}

async function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (command !== 'run') {
    throw new Error('usage: living-doc-harness-repair-skill-runner.mjs run <runDir> --living-doc <doc.json> --reviewer-verdict <file> --handover <file> [--iteration <n>] [--plan <json>] [--execute-units]');
  }
  const runDir = args.shift();
  const options = {
    runDir,
    livingDocPath: null,
    reviewerVerdictPath: null,
    handoverPath: null,
    iteration: 1,
    repairSkillPlan: {},
    executeUnits: false,
    codexBin: 'codex',
  };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--living-doc') options.livingDocPath = args.shift();
    else if (flag === '--reviewer-verdict') options.reviewerVerdictPath = args.shift();
    else if (flag === '--handover') options.handoverPath = args.shift();
    else if (flag === '--iteration') options.iteration = Number(args.shift());
    else if (flag === '--plan') options.repairSkillPlan = JSON.parse(await readFile(args.shift(), 'utf8'));
    else if (flag === '--execute-units') options.executeUnits = true;
    else if (flag === '--codex-bin') options.codexBin = args.shift();
    else throw new Error(`unknown option: ${flag}`);
  }
  if (!options.livingDocPath) throw new Error('--living-doc is required');
  if (!options.reviewerVerdictPath) throw new Error('--reviewer-verdict is required');
  if (!options.handoverPath) throw new Error('--handover is required');
  return options;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  try {
    const options = await parseArgs(process.argv.slice(2));
    const result = await runRepairSkillChain(options);
    console.log(JSON.stringify({
      chainPath: result.chainPath,
      status: result.chain.status,
      orderedSkills: result.chain.balanceScan.orderedSkills,
    }, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
