import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const sync = spawnSync(process.execPath, ['scripts/sync-compositor-embeds.mjs', '--check'], {
  encoding: 'utf8',
});

assert.equal(sync.status, 0, sync.stderr || sync.stdout);

const i18n = JSON.parse(await readFile('scripts/living-doc-i18n.json', 'utf8'));
const compositorHtml = await readFile('docs/living-doc-compositor.html', 'utf8');
const localeEntries = Object.entries(i18n);

assert.ok(localeEntries.length > 0, 'expected at least one locale');

const baseKeys = Object.keys(i18n.en).sort();
assert.ok(baseKeys.length > 0, 'expected en locale keys');

for (const [locale, strings] of localeEntries) {
  const keys = Object.keys(strings).sort();
  assert.deepEqual(keys, baseKeys, `${locale} locale keys differ from en`);

  const emptyKeys = keys.filter((key) => strings[key] === '');
  assert.deepEqual(emptyKeys, [], `${locale} has empty translation values`);
}

const translationCalls = [
  ...compositorHtml.matchAll(/(?<![\w$.])t\('([A-Za-z][A-Za-z0-9_]*)'\)/g),
].map((match) => match[1]);
const uniqueCalls = [...new Set(translationCalls)].sort();

assert.ok(uniqueCalls.length > 0, 'expected translation calls in compositor');

for (const [locale, strings] of localeEntries) {
  const missing = uniqueCalls.filter((key) => !(key in strings));
  assert.deepEqual(missing, [], `${locale} is missing compositor translation keys`);
}

console.log(`i18n contract ok: ${localeEntries.length} locales, ${baseKeys.length} keys`);
