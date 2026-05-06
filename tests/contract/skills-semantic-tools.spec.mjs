import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const skillPaths = [
  '.agents/skills/living-doc/SKILL.md',
  '.agents/skills/inference-living-doc-run-codex/SKILL.md',
];

const requiredTerms = [
  'living_doc_semantic_context',
  'living_doc_convergence_type_contract',
  'living_doc_relationship_gaps',
  'living_doc_stage_diagnostics',
  'living_doc_valid_stage_operations',
  'patchDraft',
  'living_doc_patch_validate',
  'living_doc_patch_apply',
];

for (const skillPath of skillPaths) {
  const body = await readFile(skillPath, 'utf8');
  for (const term of requiredTerms) {
    assert.ok(body.includes(term), `${skillPath} must reference ${term}`);
  }
}

const inferenceSkill = await readFile('.agents/skills/inference-living-doc-run-codex/SKILL.md', 'utf8');
assert.ok(
  inferenceSkill.includes('Do not treat tool success as objective completion'),
  'inference harness must preserve objective completion boundary',
);

console.log(`skills semantic-tools contract ok: ${skillPaths.length} skills`);
