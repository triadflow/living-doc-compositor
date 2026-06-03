import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  checkObjectiveClosurePlans,
  computeObjectiveClosurePlanFingerprint,
} from '../../scripts/check-objective-closure-plan.mjs';
import { convergenceTypeDefinitions } from '../../scripts/living-doc-definitions/index.mjs';

const registry = JSON.parse(await readFile('scripts/living-doc-registry.json', 'utf8'));

const typeDefinition = convergenceTypeDefinitions.find((definition) => definition.id === 'objective-closure-plan');
assert.ok(typeDefinition, 'objective-closure-plan must exist as a code-defined convergence type');
assert.equal(
  registry.convergenceTypes['objective-closure-plan']?.projection,
  'card-grid',
  'objective-closure-plan must use the registry-driven card-grid projection',
);
assert.deepEqual(
  registry.convergenceTypes['objective-closure-plan']?.textFields.map((field) => field.key),
  ['managementSummary', 'planningQuestion', 'objectiveRef', 'successConditionRef', 'freshnessBasis', 'staleWhen'],
  'objective-closure-plan must expose the management summary before detailed planning fields',
);
assert.deepEqual(
  registry.convergenceTypes['objective-closure-plan']?.detailsFields.map((field) => field.key),
  ['watchedSections', 'watchedCards', 'closureGates', 'nextGoalCandidates', 'check', 'diagrams'],
  'objective-closure-plan must expose planning/check/diagram details as structured card fields',
);
assert.ok(registry.statusSets['closure-plan-state'], 'closure-plan-state status set must exist');

function fixtureDoc() {
  return {
    schemaVersion: 2,
    title: 'Objective Closure Plan Fixture',
    objective: 'Deliver the production path.',
    successCondition: 'The production path is closed when accepted evidence is mobile-visible.',
    sections: [
      {
        id: 'issue-lanes',
        title: 'Issue Lanes',
        convergenceType: 'issue-orbit',
        data: [
          {
            id: 'issue-1',
            name: 'Production lane',
            status: 'open-active',
          },
        ],
      },
      {
        id: 'acceptance-criteria',
        title: 'Acceptance Criteria',
        convergenceType: 'acceptance-criteria',
        data: [
          {
            id: 'criterion-live-mobile-visible',
            name: 'Accepted order is mobile-visible',
            status: 'unsatisfied',
            criterion: 'Accepted production output reaches mobile-visible state.',
          },
        ],
      },
      {
        id: 'proof-ladder',
        title: 'Proof Ladder',
        convergenceType: 'proof-ladder',
        data: [
          {
            id: 'proof-live-email',
            name: 'Live email proof',
            status: 'partial',
          },
        ],
      },
      {
        id: 'closure-path',
        title: 'Closure Path',
        convergenceType: 'accountability-closure-path',
        data: [
          {
            id: 'gate-live-mobile-visible',
            name: 'Live mobile visibility',
            state: 'open',
          },
        ],
      },
      {
        id: 'objective-closure-plan',
        title: 'Objective Closure Plan',
        convergenceType: 'objective-closure-plan',
        data: [
          {
            id: 'plan-production-close',
            name: 'Close production path',
            state: 'current',
            managementSummary: 'The production path is not formally closed until the remaining audit and closure gates are resolved.',
            planningQuestion: 'What closes the objective?',
            objectiveRef: 'root.objective',
            successConditionRef: 'root.successCondition',
            watchedSections: ['issue-lanes', 'acceptance-criteria', 'proof-ladder', 'closure-path'],
            watchedCards: ['criterion-live-mobile-visible'],
            closureGates: [
              {
                id: 'gate-live-mobile-visible',
                label: 'Accepted result becomes mobile-visible',
                sourceCardIds: ['criterion-live-mobile-visible'],
                exitCriterion: 'The criterion reaches satisfied state with source evidence.',
              },
            ],
            nextGoalCandidates: [
              {
                id: 'goal-live-mobile-visible',
                whyNext: 'It is the first unsatisfied closure criterion.',
              },
            ],
            check: [],
            diagrams: [
              {
                title: 'Closure path',
                text: 'flowchart LR\n  Objective["Objective"] --> Criteria["Acceptance criteria"]',
              },
            ],
          },
        ],
      },
    ],
  };
}

const currentDoc = fixtureDoc();
const currentPlan = currentDoc.sections.at(-1).data[0];
const currentFingerprint = computeObjectiveClosurePlanFingerprint(currentDoc, currentPlan);
currentPlan.check = [
  {
    basisFingerprint: currentFingerprint,
    lastCheckedAt: '2026-06-03T00:00:00.000Z',
    status: 'current',
  },
];

const currentResult = checkObjectiveClosurePlans(currentDoc);
assert.equal(currentResult.status, 'current', 'matching objective closure plan fingerprint should be current');
assert.equal(currentResult.plans[0].currentFingerprint, currentFingerprint);
assert.deepEqual(currentResult.plans[0].driftReasons, []);

const driftedDoc = structuredClone(currentDoc);
driftedDoc.sections[1].data[0].status = 'satisfied';
const driftedResult = checkObjectiveClosurePlans(driftedDoc);
assert.equal(driftedResult.status, 'stale', 'watched acceptance criterion change should stale the plan');
assert.equal(driftedResult.plans[0].status, 'stale');
assert.notEqual(driftedResult.plans[0].currentFingerprint, currentFingerprint);
assert.ok(
  driftedResult.plans[0].driftReasons.includes('stored basis fingerprint does not match watched living-doc content'),
  'stale result should explain fingerprint mismatch',
);

const missingWatchedCardDoc = structuredClone(currentDoc);
missingWatchedCardDoc.sections[1].data[0].id = 'criterion-renamed';
const missingWatchedCardResult = checkObjectiveClosurePlans(missingWatchedCardDoc);
assert.equal(missingWatchedCardResult.plans[0].status, 'stale');
assert.ok(
  missingWatchedCardResult.plans[0].driftReasons.includes(
    'watched card not found: criterion-live-mobile-visible',
  ),
  'checker should report missing watched cards explicitly',
);

console.log('objective closure plan contract ok');
