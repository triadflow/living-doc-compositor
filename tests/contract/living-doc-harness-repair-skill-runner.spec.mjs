import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runHarnessLifecycle } from '../../scripts/living-doc-harness-lifecycle.mjs';

function repairableVerdict() {
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification: 'repairable',
      reasonCode: 'diagram-criteria-drift',
      confidence: 'high',
      closureAllowed: false,
      basis: ['Reviewer fixture detected a repairable relationship-map alignment gap.'],
    },
    nextIteration: {
      allowed: true,
      mode: 'repair',
      instruction: 'Run balance scan and the ordered repair skill chain before resuming worker inference.',
      mustNotDo: ['Do not stop before objective closure or explicit user stop.'],
    },
  };
}

function closedVerdict() {
  return {
    schema: 'living-doc-harness-stop-verdict/v1',
    stopVerdict: {
      classification: 'closed',
      reasonCode: 'objective-proven',
      confidence: 'high',
      closureAllowed: true,
      basis: ['Reviewer fixture accepted closure after repair-chain proof.'],
    },
    nextIteration: {
      allowed: false,
      mode: 'none',
      instruction: 'Stop.',
    },
  };
}

function doc(docPath) {
  return {
    docId: 'test:repair-skill-chain',
    title: 'Repair Skill Chain Fixture',
    subtitle: 'Fixture',
    brand: 'LD',
    scope: 'test',
    owner: 'Tests',
    version: 'v1',
    canonicalOrigin: docPath,
    sourceCoverage: 'fixture',
    updated: '2026-05-08T05:50:00.000Z',
    objective: 'Prove repair skills run as independent contract-bound inference units.',
    successCondition: 'Balance scan and every ordered repair skill leave prompt, input, log, result, and validation artifacts before worker resumes.',
    runState: {
      objectiveReady: false,
      documentReady: true,
      currentPhase: 'needs-repair',
    },
    sections: [
      {
        id: 'acceptance-criteria',
        title: 'Acceptance Criteria',
        convergenceType: 'acceptance-criteria',
        updated: '2026-05-08T05:50:00.000Z',
        data: [
          {
            id: 'criterion-repair-chain',
            name: 'Repair chain runs',
            status: 'unsatisfied',
            updated: '2026-05-08T05:50:00.000Z',
          },
        ],
      },
    ],
  };
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'living-doc-harness-repair-skill-runner-'));

try {
  const docPath = path.join(tmp, 'doc.json');
  await writeFile(docPath, `${JSON.stringify(doc(docPath), null, 2)}\n`, 'utf8');
  await writeFile(docPath.replace(/\.json$/i, '.html'), '<!doctype html><title>repair fixture</title>\n', 'utf8');

  const orderedSkills = [
    'equilibrium-rebalance',
    'objective-conservation-audit',
    'relationship-map-alignment',
    'reaction-path-validator',
    'activation-energy-review',
    'objective-execution-readiness',
  ];
  const sequencePath = path.join(tmp, 'sequence.json');
  await writeFile(sequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'repairable',
        unresolvedObjectiveTerms: ['repair skills must run independently'],
        unprovenAcceptanceCriteria: ['criterion-repair-chain'],
        acceptanceCriteriaSatisfied: 'fail',
        closureAllowed: false,
        traceMessage: 'Worker stopped with a repairable relationship-map alignment gap.',
        reviewerVerdict: repairableVerdict(),
        repairSkillPlan: {
          balanceScanResult: {
            status: 'ordered',
            basis: ['Relationship-map drift requires ordered repair skills.'],
            orderedSkills,
          },
          skillResults: orderedSkills.map((skill) => ({
            status: skill === 'relationship-map-alignment' ? 'aligned' : 'no-op',
            basis: [`${skill} fixture result preserved the repair chain contract.`],
            changedFiles: [],
            commitIntent: {
              required: false,
              reason: 'Fixture did not change files.',
            },
          })),
        },
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Repair-chain proof is complete.',
        reviewerVerdict: closedVerdict(),
      },
    ],
  }, null, 2)}\n`, 'utf8');

  const result = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'runs'),
    evidenceDir: path.join(tmp, 'evidence'),
    dashboardPath: path.join(tmp, 'dashboard.html'),
    evidenceSequencePath: sequencePath,
    executeRepairSkills: true,
    now: '2026-05-08T05:50:00.000Z',
  });

  assert.equal(result.iterationCount, 2);
  assert.equal(result.finalState.kind, 'closed');
  assert.match(result.iterations[0].repairSkillResultPath, /repair-chain-result\.json$/);

  const firstRunDir = path.resolve(process.cwd(), result.iterations[0].runDir);
  const chain = JSON.parse(await readFile(path.resolve(process.cwd(), result.iterations[0].repairSkillResultPath), 'utf8'));
  assert.equal(chain.schema, 'living-doc-repair-skill-chain-result/v1');
  assert.equal(chain.status, 'complete');
  assert.deepEqual(chain.balanceScan.orderedSkills, orderedSkills);
  assert.equal(chain.skillResults.length, orderedSkills.length);
  assert.equal(chain.skillResults[2].skill, 'relationship-map-alignment');
  assert.equal(chain.skillResults[2].status, 'aligned');
  assert.ok(chain.rawWorkerJsonlPaths.length >= 1);

  const balanceInput = JSON.parse(await readFile(path.join(firstRunDir, 'repair-skills', 'iteration-1', '00-living-doc-balance-scan', 'input-contract.json'), 'utf8'));
  assert.equal(balanceInput.unitRole, 'balance-scan');
  assert.equal(balanceInput.rawWorkerJsonlPaths.length >= 1, true);
  assert.equal(balanceInput.toolProfile.name, 'local-repair');
  assert.equal(balanceInput.toolProfile.sandboxMode, 'danger-full-access');
  assert.deepEqual(balanceInput.toolProfile.mcpAllowlist, ['living_doc_compositor']);

  for (const [index, skill] of orderedSkills.entries()) {
    const dir = path.join(firstRunDir, 'repair-skills', 'iteration-1', `${String(index + 1).padStart(2, '0')}-${skill}`);
    const input = JSON.parse(await readFile(path.join(dir, 'input-contract.json'), 'utf8'));
    const resultArtifact = JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8'));
    const validation = JSON.parse(await readFile(path.join(dir, 'validation.json'), 'utf8'));
    const events = await readFile(path.join(dir, 'codex-events.jsonl'), 'utf8');
    assert.equal(input.skill, skill);
    assert.equal(input.sequence, index + 1);
    assert.equal(input.toolProfile.name, 'local-repair');
    assert.equal(input.toolProfile.sandboxMode, 'danger-full-access');
    assert.deepEqual(input.toolProfile.mcpAllowlist, ['living_doc_compositor']);
    assert.equal(input.commitPolicy.mode, 'commit-intent-only');
    assert.equal(input.commitPolicy.gitCommitAllowed, false);
    assert.equal(resultArtifact.schema, 'living-doc-contract-bound-inference-result/v1');
    assert.equal(resultArtifact.outputContract.schema, 'living-doc-repair-skill-result/v1');
    assert.equal(resultArtifact.outputContract.commitPolicy.mode, 'commit-intent-only');
    assert.equal(resultArtifact.outputContract.commitPolicy.gitCommitAllowed, false);
    assert.equal(typeof resultArtifact.outputContract.commitIntent.required, 'boolean');
    assert.equal(validation.ok, true);
    assert.match(events, /turn.completed/);
  }

  const invocations = await readFile(path.join(firstRunDir, 'skill-invocations.jsonl'), 'utf8');
  for (const skill of orderedSkills) {
    assert.match(invocations, new RegExp(skill));
  }
  assert.match(invocations, /"status":"aligned"/);

  const bundle = JSON.parse(await readFile(path.join(tmp, 'evidence', result.iterations[0].runId, 'bundle.json'), 'utf8'));
  assert.equal(bundle.repairSkillChain.status, 'complete');
  assert.equal(bundle.repairSkillChain.resultCount, orderedSkills.length);
  assert.equal(bundle.skillTimeline.some((item) => item.skill === 'relationship-map-alignment' && item.status === 'aligned'), true);

  const dashboard = await readFile(path.join(tmp, 'dashboard.html'), 'utf8');
  assert.match(dashboard, /Repair chain:/);
  assert.match(dashboard, /relationship-map-alignment/);

  const fakeRepairCodexPath = path.join(tmp, 'fake-repair-codex.mjs');
  await writeFile(fakeRepairCodexPath, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const outputPath = args[args.indexOf('-o') + 1];
const prompt = readFileSync(0, 'utf8');
const marker = 'Input contract:\\n';
const start = prompt.lastIndexOf(marker);
const end = prompt.indexOf('\\n\\nHarness tool profile:', start);
const input = JSON.parse(prompt.slice(start + marker.length, end));
for (const requiredPath of input.requiredInspectionPaths || []) {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'command_execution',
      command: "sed -n '1,5p' " + JSON.stringify(requiredPath),
      status: 'completed'
    }
  }));
}
const result = input.unitRole === 'balance-scan'
  ? {
    status: 'ordered',
    basis: ['Fake balance scan returned shorthand JSON without outputContract.schema.'],
    orderedSkills: ['objective-execution-readiness']
  }
  : {
    status: 'no-op',
    basis: ['Fake repair skill returned shorthand JSON without outputContract.schema.'],
    changedFiles: [],
    commitIntent: {
      required: false,
      reason: 'Fake repair skill did not change files.'
    },
    nextRecommendedAction: 'run-objective-execution-readiness'
  };
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\\n');
console.log(JSON.stringify({ type: 'turn.completed' }));
`, 'utf8');
  await chmod(fakeRepairCodexPath, 0o755);

  const shorthandSequencePath = path.join(tmp, 'shorthand-sequence.json');
  await writeFile(shorthandSequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'repairable',
        unresolvedObjectiveTerms: ['repair chain must survive shorthand inference output'],
        unprovenAcceptanceCriteria: ['criterion-repair-chain'],
        acceptanceCriteriaSatisfied: 'fail',
        closureAllowed: false,
        traceMessage: 'Worker stopped with a repairable gap.',
        reviewerVerdict: repairableVerdict(),
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Repair-chain shorthand output was normalized and the lifecycle continued.',
        reviewerVerdict: closedVerdict(),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const shorthand = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'shorthand-runs'),
    evidenceDir: path.join(tmp, 'shorthand-evidence'),
    dashboardPath: path.join(tmp, 'shorthand-dashboard.html'),
    evidenceSequencePath: shorthandSequencePath,
    executeRepairSkills: true,
    executeRepairSkillUnits: true,
    codexBin: fakeRepairCodexPath,
    now: '2026-05-08T06:05:00.000Z',
  });
  assert.equal(shorthand.finalState.kind, 'closed');
  assert.equal(shorthand.iterationCount, 2);
  assert.match(shorthand.iterations[0].repairSkillResultPath, /repair-chain-result\.json$/);
  const shorthandRunDir = path.resolve(process.cwd(), shorthand.iterations[0].runDir);
  const shorthandChain = JSON.parse(await readFile(path.resolve(process.cwd(), shorthand.iterations[0].repairSkillResultPath), 'utf8'));
  assert.equal(shorthandChain.status, 'complete');
  assert.deepEqual(shorthandChain.balanceScan.orderedSkills, ['objective-execution-readiness']);
  assert.equal(shorthandChain.skillResults[0].skill, 'objective-execution-readiness');
  const shorthandBalanceValidation = JSON.parse(await readFile(path.join(shorthandRunDir, 'repair-skills', 'iteration-1', '00-living-doc-balance-scan', 'validation.json'), 'utf8'));
  assert.equal(shorthandBalanceValidation.ok, true);
  const shorthandSkillValidation = JSON.parse(await readFile(path.join(shorthandRunDir, 'repair-skills', 'iteration-1', '01-objective-execution-readiness', 'validation.json'), 'utf8'));
  assert.equal(shorthandSkillValidation.ok, true);

  const blockedSequencePath = path.join(tmp, 'blocked-sequence.json');
  await writeFile(blockedSequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'repairable',
        unresolvedObjectiveTerms: ['repair skills must complete before resume'],
        unprovenAcceptanceCriteria: ['criterion-repair-chain'],
        acceptanceCriteriaSatisfied: 'fail',
        closureAllowed: false,
        traceMessage: 'Worker stopped with a repairable gap.',
        reviewerVerdict: repairableVerdict(),
        repairSkillPlan: {
          balanceScanResult: {
            status: 'ordered',
            basis: ['Relationship-map drift requires repair before resume.'],
            orderedSkills: ['relationship-map-alignment'],
          },
          skillResults: [
            {
              status: 'blocked',
              basis: ['Required diagram evidence was unreadable.'],
              changedFiles: [],
              nextRecommendedAction: 'stop-repair-chain',
            },
          ],
        },
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'This iteration must not run because repair is blocked.',
        reviewerVerdict: closedVerdict(),
      },
    ],
  }, null, 2)}\n`, 'utf8');

  const blocked = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'blocked-runs'),
    evidenceDir: path.join(tmp, 'blocked-evidence'),
    dashboardPath: path.join(tmp, 'blocked-dashboard.html'),
    evidenceSequencePath: blockedSequencePath,
    executeRepairSkills: true,
    now: '2026-05-08T06:20:00.000Z',
  });
  assert.equal(blocked.iterationCount, 2);
  assert.equal(blocked.finalState.kind, 'closed');
  assert.equal(blocked.iterations[0].classification, 'true-block');
  assert.equal(blocked.iterations[0].terminalKind, 'continuation-required');
  assert.equal(blocked.iterations[0].nextAction.action, 'start-next-worker-iteration');
  const blockedChain = JSON.parse(await readFile(path.resolve(process.cwd(), blocked.iterations[0].repairSkillResultPath), 'utf8'));
  assert.equal(blockedChain.status, 'blocked');
  assert.equal(blockedChain.skillResults.length, 1);
  assert.equal(blockedChain.skillResults[0].skill, 'relationship-map-alignment');

  const commitPolicySequencePath = path.join(tmp, 'commit-policy-sequence.json');
  await writeFile(commitPolicySequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'repairable',
        unresolvedObjectiveTerms: ['repair skill must produce commit intent'],
        unprovenAcceptanceCriteria: ['criterion-repair-chain'],
        acceptanceCriteriaSatisfied: 'fail',
        closureAllowed: false,
        traceMessage: 'Worker stopped with a repairable gap that changes the living doc.',
        reviewerVerdict: repairableVerdict(),
        repairSkillPlan: {
          balanceScanResult: {
            status: 'ordered',
            basis: ['Living doc change requires commit-intent evidence.'],
            orderedSkills: ['catalytic-repair-run'],
          },
          skillResults: [
            {
              status: 'repaired',
              basis: ['Patched the living doc and rendered HTML; commit is deferred to the harness commit policy.'],
              changedFiles: [docPath, docPath.replace(/\\.json$/i, '.html')],
              commitIntent: {
                required: true,
                reason: 'Repair skill changed the calibration living doc.',
                message: 'ldoc repair: catalytic repair calibration',
                body: [
                  'Repair skill: catalytic-repair-run',
                  'Changed the calibration living doc and rendered HTML.',
                ],
                changedFiles: [docPath, docPath.replace(/\\.json$/i, '.html')],
              },
              nextRecommendedAction: 'run-objective-execution-readiness',
            },
          ],
        },
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Commit-intent proof is complete.',
        reviewerVerdict: closedVerdict(),
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Commit-policy blocker was routed into continuation and resolved.',
        reviewerVerdict: closedVerdict(),
      },
    ],
  }, null, 2)}\n`, 'utf8');

  const commitPolicy = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'commit-policy-runs'),
    evidenceDir: path.join(tmp, 'commit-policy-evidence'),
    dashboardPath: path.join(tmp, 'commit-policy-dashboard.html'),
    evidenceSequencePath: commitPolicySequencePath,
    executeRepairSkills: true,
    now: '2026-05-08T06:40:00.000Z',
  });
  assert.equal(commitPolicy.finalState.kind, 'closed');
  const commitPolicyChain = JSON.parse(await readFile(path.resolve(process.cwd(), commitPolicy.iterations[0].repairSkillResultPath), 'utf8'));
  assert.equal(commitPolicyChain.status, 'complete');
  assert.equal(commitPolicyChain.skillResults[0].skill, 'catalytic-repair-run');
  assert.equal(commitPolicyChain.skillResults[0].commitPolicy.mode, 'commit-intent-only');
  assert.equal(commitPolicyChain.skillResults[0].commitIntent.required, true);
  assert.equal(commitPolicyChain.skillResults[0].commitIntent.message, 'ldoc repair: catalytic repair calibration');

  const commitBlockedSequencePath = path.join(tmp, 'commit-blocked-sequence.json');
  await writeFile(commitBlockedSequencePath, `${JSON.stringify({
    iterations: [
      {
        stageAfter: 'repairable',
        unresolvedObjectiveTerms: ['git commit should not run inside repair unit'],
        unprovenAcceptanceCriteria: ['criterion-repair-chain'],
        acceptanceCriteriaSatisfied: 'fail',
        closureAllowed: false,
        traceMessage: 'Worker stopped with a repairable gap.',
        reviewerVerdict: repairableVerdict(),
        repairSkillPlan: {
          balanceScanResult: {
            status: 'ordered',
            basis: ['Repair skill would normally commit.'],
            orderedSkills: ['catalytic-repair-run'],
          },
          skillResults: [
            {
              status: 'blocked',
              basis: ['git commit failed: could not create .git/index.lock'],
              changedFiles: [docPath],
              nextRecommendedAction: 'stop-repair-chain',
            },
          ],
        },
      },
      {
        stageAfter: 'closed',
        unresolvedObjectiveTerms: [],
        unprovenAcceptanceCriteria: [],
        acceptanceCriteriaSatisfied: 'pass',
        closureAllowed: true,
        traceMessage: 'Commit-policy blocker was routed into continuation and resolved.',
        reviewerVerdict: closedVerdict(),
      },
    ],
  }, null, 2)}\n`, 'utf8');
  const commitBlocked = await runHarnessLifecycle({
    docPath,
    runsDir: path.join(tmp, 'commit-blocked-runs'),
    evidenceDir: path.join(tmp, 'commit-blocked-evidence'),
    dashboardPath: path.join(tmp, 'commit-blocked-dashboard.html'),
    evidenceSequencePath: commitBlockedSequencePath,
    executeRepairSkills: true,
    now: '2026-05-08T06:50:00.000Z',
  });
  assert.equal(commitBlocked.finalState.kind, 'closed');
  assert.equal(commitBlocked.iterations[0].classification, 'true-block');
  const commitBlockedChain = JSON.parse(await readFile(path.resolve(process.cwd(), commitBlocked.iterations[0].repairSkillResultPath), 'utf8'));
  assert.equal(commitBlockedChain.skillResults[0].reasonCode, 'repair-skill-commit-policy-blocked');
  assert.equal(commitBlockedChain.skillResults[0].commitIntent.required, true);
  const commitBlockedTerminal = JSON.parse(await readFile(path.resolve(process.cwd(), commitBlocked.iterations[0].runDir, 'terminal', 'iteration-1-continuation-required.json'), 'utf8'));
  assert.equal(commitBlockedTerminal.stopVerdict.reasonCode, 'repair-skill-commit-policy-blocked');
  assert.equal(commitBlockedTerminal.loopMayContinue, true);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('living-doc harness repair skill runner contract spec: all assertions passed');
