import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  checkCardStatuses,
  normalizeStatusToken,
} from '../../scripts/check-card-statuses.mjs';

const registry = JSON.parse(await readFile('scripts/living-doc-registry.json', 'utf8'));

function fixtureDoc(state) {
  return {
    title: 'Card Status Fixture',
    objective: 'Keep card statuses bound to convergence type status sets.',
    successCondition: 'Status drift is detected before render or goal closure.',
    sections: [
      {
        id: 'objective-closure-plan',
        title: 'Objective Closure Plan',
        convergenceType: 'objective-closure-plan',
        data: [
          {
            id: 'plan-status-check',
            name: 'Status check plan',
            state,
          },
        ],
      },
    ],
  };
}

assert.equal(normalizeStatusToken('Open Active'), 'open-active');
assert.equal(normalizeStatusToken('audit_open'), 'audit-open');

const inventedResult = checkCardStatuses(fixtureDoc('ready-for-management'), registry);
assert.equal(inventedResult.status, 'diverged');
assert.equal(inventedResult.findings[0].kind, 'invalid');
assert.deepEqual(
  inventedResult.findings[0].allowedValues,
  ['current', 'stale', 'blocked', 'complete', 'unknown'],
);

const normalizableDoc = fixtureDoc('Current');
const normalizableResult = checkCardStatuses(normalizableDoc, registry);
assert.equal(normalizableResult.status, 'diverged');
assert.equal(normalizableResult.findings[0].kind, 'normalizable');
assert.equal(normalizableResult.findings[0].suggestedValue, 'current');

const fixedResult = checkCardStatuses(normalizableDoc, registry, { fix: true });
assert.equal(fixedResult.status, 'current');
assert.equal(fixedResult.fixCount, 1);
assert.equal(normalizableDoc.sections[0].data[0].state, 'current');

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-card-status-'));
const docPath = path.join(tmpDir, 'status-fixture.json');
await writeFile(docPath, `${JSON.stringify(fixtureDoc('Current'), null, 2)}\n`);

const cliFix = spawnSync(process.execPath, ['scripts/check-card-statuses.mjs', docPath, '--fix'], {
  encoding: 'utf8',
});
assert.equal(cliFix.status, 0, cliFix.stderr || cliFix.stdout);
const fixedDoc = JSON.parse(await readFile(docPath, 'utf8'));
assert.equal(fixedDoc.sections[0].data[0].state, 'current');

await writeFile(docPath, `${JSON.stringify(fixtureDoc('invented-lane-state'), null, 2)}\n`);
const cliFail = spawnSync(process.execPath, ['scripts/check-card-statuses.mjs', docPath], {
  encoding: 'utf8',
});
assert.equal(cliFail.status, 2, 'invented status should fail the CLI check');
assert.match(cliFail.stdout, /invented-lane-state/);

console.log('card status check contract ok');
