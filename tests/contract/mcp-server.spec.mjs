import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const expectedTools = [
  'living_doc_registry_summary',
  'living_doc_registry_explain_type',
  'living_doc_registry_match_objective',
  'living_doc_registry_propose_type_gap',
  'living_doc_objective_decompose',
  'living_doc_structure_select',
  'living_doc_structure_reflect',
  'living_doc_structure_refine',
  'living_doc_scaffold',
  'living_doc_sources_add',
  'living_doc_sources_create',
  'living_doc_sources_link',
  'living_doc_coverage_map',
  'living_doc_coverage_find_gaps',
  'living_doc_coverage_evaluate_success_condition',
  'living_doc_governance_list_invariants',
  'living_doc_governance_evaluate',
  'living_doc_governance_classify_trap',
  'living_doc_governance_suggest_invariant',
  'living_doc_governance_refine_invariant',
  'living_doc_governance_check_patch',
  'living_doc_patch_validate',
  'living_doc_patch_apply',
  'living_doc_render',
];

function createMcpClient() {
  const child = spawn(process.execPath, ['scripts/living-doc-mcp-server.mjs'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  const stderr = [];

  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline).toString('utf8').trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });

  child.stderr.on('data', (chunk) => stderr.push(chunk));

  function request(method, params = {}) {
    const id = nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    child.stdin.write(`${body}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`MCP request timed out: ${method}\n${Buffer.concat(stderr).toString('utf8')}`));
      }, 10_000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  async function callTool(name, args = {}) {
    const message = await request('tools/call', { name, arguments: args });
    assert.equal(message.error, undefined, `${name} failed: ${JSON.stringify(message.error)}`);
    return message.result.structuredContent;
  }

  return {
    request,
    callTool,
    close() {
      child.kill();
    },
  };
}

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-mcp-contract-'));
const client = createMcpClient();

try {
  const init = await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'living-doc-contract', version: '0' },
  });
  assert.equal(init.result.serverInfo.name, 'living-doc-compositor');

  const list = await client.request('tools/list');
  const toolNames = list.result.tools.map((tool) => tool.name);
  for (const toolName of expectedTools) {
    assert.ok(toolNames.includes(toolName), `missing MCP tool: ${toolName}`);
  }

  const type = await client.callTool('living_doc_registry_explain_type', { convergenceType: 'capability-surface' });
  assert.equal(type.id, 'capability-surface');
  assert.ok(type.inferenceUse.sourcesConstrainGrouping.length > 0);

  const match = await client.callTool('living_doc_structure_select', {
    objective: 'Ship a settings toggle and prove it works',
    success: 'Toggle persists and tests pass',
  });
  assert.equal(match.strategy, 'feature shipping');

  const docPath = path.join(tmpDir, 'settings-toggle.json');
  const scaffold = await client.callTool('living_doc_scaffold', {
    objective: 'Ship a settings toggle and prove it works',
    success: 'Toggle persists and tests pass',
    title: 'Settings Toggle',
    out: docPath,
  });
  assert.equal(scaffold.ok, true);

  const card = await client.callTool('living_doc_sources_add', {
    doc: docPath,
    sectionId: 'capability-surface',
    card: {
      id: 'settings-toggle',
      name: 'Settings toggle',
      status: 'built',
      notes: 'inline detail '.repeat(260),
    },
  });
  assert.equal(card.ok, true);

  const coverage = await client.callTool('living_doc_coverage_map', {
    doc: docPath,
    facetId: 'frame-objective',
    sectionId: 'capability-surface',
    cardId: 'settings-toggle',
    rationale: 'The card anchors the objective framing.',
  });
  assert.equal(coverage.ok, true);

  const reflect = await client.callTool('living_doc_structure_reflect', { doc: docPath });
  assert.ok(reflect.sectionDiagnostics.length > 0);
  assert.ok(reflect.recommendations.some((rec) => rec.kind === 'create-source-material'));
  assert.ok(reflect.recommendations.some((rec) => rec.kind === 'add-source-links'));

  const governance = await client.callTool('living_doc_governance_evaluate', { doc: docPath });
  assert.equal(governance.ok, false);
  assert.ok(governance.violations.some((violation) => violation.kind === 'status-needs-evidence'));
  assert.ok(governance.violations.some((violation) => violation.kind === 'source-detail-owned-by-source'));

  const source = await client.callTool('living_doc_sources_create', {
    kind: 'local-json',
    payload: { title: 'Settings Toggle Evidence', data: { passed: true } },
    policy: { allowWrite: true },
  });
  assert.equal(source.kind, 'local-json');
  assert.equal(JSON.parse(await readFile(source.entityRef.path, 'utf8')).data.passed, true);

  const link = await client.callTool('living_doc_sources_link', {
    doc: docPath,
    sectionId: 'capability-surface',
    cardId: 'settings-toggle',
    entityRef: source.entityRef,
    edgeType: 'verified-by',
  });
  assert.equal(link.ok, true);

  const trap = await client.callTool('living_doc_governance_classify_trap', {
    event: 'I marked a card done without evidence',
  });
  assert.equal(trap.kind, 'missing-evidence');

  const invariant = await client.callTool('living_doc_governance_suggest_invariant', {
    doc: docPath,
    trap: trap.kind,
    invariant: { name: 'Evidence before done', statement: trap.suggestedInvariant },
    apply: true,
  });
  assert.equal(invariant.applied, true);

  const patch = {
    schema: 'living-doc-ai-patch/v1',
    requestId: 'contract',
    summary: 'Add evidence field',
    changes: [
      {
        changeId: 'c1',
        kind: 'card-update',
        sectionId: 'capability-surface',
        cardId: 'settings-toggle',
        fields: { evidence: [{ kind: 'local-json', path: source.entityRef.path }] },
      },
    ],
  };
  assert.equal((await client.callTool('living_doc_patch_validate', { doc: docPath, patch })).ok, true);
  assert.equal((await client.callTool('living_doc_patch_apply', { doc: docPath, patch })).ok, true);

  const success = await client.callTool('living_doc_coverage_evaluate_success_condition', { doc: docPath });
  assert.ok(Array.isArray(success.uncoveredFacets));

  const render = await client.callTool('living_doc_render', { doc: docPath });
  assert.equal(render.ok, true);
  assert.match(render.html, /settings-toggle\.html$/);
} finally {
  client.close();
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('mcp-server contract spec: all assertions passed');
