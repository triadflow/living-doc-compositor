import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderRegistryOverview } from '../../scripts/render-registry-overview.mjs';

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'living-doc-render-'));
const jsonPath = path.join(tmpDir, 'feature-doc.json');
const htmlPath = path.join(tmpDir, 'feature-doc.html');
const invalidStatusJsonPath = path.join(tmpDir, 'invalid-status-doc.json');
const invalidStatusHtmlPath = path.join(tmpDir, 'invalid-status-doc.html');
const aiJsonPath = path.join(tmpDir, 'ai-enhanced-doc.json');
const aiHtmlPath = path.join(tmpDir, 'ai-enhanced-doc.html');
const semanticJsonPath = path.join(tmpDir, 'surface-delivery-template.json');
const semanticHtmlPath = path.join(tmpDir, 'surface-delivery-template.html');

await copyFile('tests/fixtures/feature-doc.json', jsonPath);
await copyFile('tests/fixtures/ai-enhanced-doc.json', aiJsonPath);
await copyFile('docs/living-doc-template-surface-delivery.json', semanticJsonPath);

const featureDoc = JSON.parse(await readFile(jsonPath, 'utf8'));
featureDoc.sections.push({
  id: 'objective-closure-plan',
  title: 'Objective Closure Plan',
  convergenceType: 'objective-closure-plan',
  updated: '2026-04-16T00:00:00.000Z',
  data: [
    {
      id: 'plan-subgraph-render',
      name: 'Renderer subgraph coverage',
      state: 'current',
      managementSummary: 'Renderer fixture for Mermaid subgraph support.',
      planningQuestion: 'Can the renderer show a real legend subgraph?',
      objectiveRef: 'root.objective',
      successConditionRef: 'root.successCondition',
      freshnessBasis: 'Fixture-local renderer contract.',
      staleWhen: 'The renderer stops supporting subgraph blocks.',
      watchedSections: ['status-snapshot', 'tooling'],
      watchedCards: ['renderer'],
      closureGates: [],
      nextGoalCandidates: [
        {
          id: 'goal-renderer-link-check',
          title: 'Check renderer links',
          whyNext: 'The objective closure plan should expose linked source references.',
          doneWhen: 'Internal links resolve to the referenced section and card.',
          sourceCardIds: ['renderer'],
        },
      ],
      check: [],
      diagrams: [
        {
          title: 'Subgraph legend fixture',
          text: `flowchart LR
  Objective["Objective\\nroot.objective"] --> Decision{"Close?"}

  subgraph Legend["Legend"]
    LRoot["Objective / success condition\\nissue-371-residual_cross-owner-history / open-active"]
    LDecision{"Closure decision"}
  end

  class Objective,LRoot root
  class Decision,LDecision decision
  classDef root fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
  classDef decision fill:#f3e8ff,stroke:#7c3aed,color:#3b0764`,
        },
      ],
    },
  ],
});
await writeFile(jsonPath, `${JSON.stringify(featureDoc, null, 2)}\n`);

const invalidStatusDoc = structuredClone(featureDoc);
invalidStatusDoc.canonicalOrigin = 'invalid-status-doc.json';
invalidStatusDoc.sections.at(-1).data[0].state = 'invented-ready-state';
await writeFile(invalidStatusJsonPath, `${JSON.stringify(invalidStatusDoc, null, 2)}\n`);

const invalidRender = spawnSync(process.execPath, ['scripts/render-living-doc.mjs', invalidStatusJsonPath], {
  encoding: 'utf8',
});
assert.equal(invalidRender.status, 2, 'renderer should block docs with unregistered card statuses');
assert.match(invalidRender.stderr, /Render blocked/, 'renderer should explain that card status drift blocks rendering');
assert.match(invalidRender.stderr, /invented-ready-state/, 'renderer error should name the invalid status');
await assert.rejects(
  readFile(invalidStatusHtmlPath, 'utf8'),
  /ENOENT/,
  'renderer should not write HTML when status validation fails',
);

const render = spawnSync(process.execPath, ['scripts/render-living-doc.mjs', jsonPath], {
  encoding: 'utf8',
});

assert.equal(render.status, 0, render.stderr || render.stdout);

const html = await readFile(htmlPath, 'utf8');

assert.match(html, /<script type="application\/json" id="doc-meta">/, 'rendered HTML should include doc-meta');
assert.match(html, /Fixture Feature Living Doc/, 'rendered HTML should include fixture title');
assert.match(html, /Portable Snapshot/, 'rendered HTML should include snapshot identity panel');
assert.match(html, /Identity and lineage/, 'rendered HTML should include lineage heading');
assert.match(html, /data-target="status-snapshot"/, 'rendered HTML should include section navigation');
assert.match(html, /data-view-target="board"/, 'rendered HTML should include board view switch');
assert.match(html, /data-view-target="graph"/, 'rendered HTML should include graph view switch');
assert.match(html, /id="board-view"/, 'rendered HTML should include registry-derived board view');
assert.match(html, /id="graph-view"/, 'rendered HTML should include JSON structure graph view');
assert.match(html, /JSON Structure Graph/, 'graph should expose the living-doc JSON structure overview');
assert.match(html, /Tooling Surface · Status/, 'board should expose the status dimension for boardable sections');
assert.match(html, /<span>Trusted<\/span>/, 'board should render status-set lanes from the registry');
assert.match(html, /<span class="type-badge"[^>]*>status-snapshot<\/span>/, 'section headers should expose their convergence type');
assert.match(html, /<span class="type-badge"[^>]*>objective-closure-plan<\/span>/, 'objective closure plan section should expose its convergence type');
assert.match(html, /<span class="skill-badge"[^>]*>skill: objective-closure-plan<\/span>/, 'objective closure plan sections should show their authoring skill');
assert.match(html, /href="#status-snapshot" class="internal-ref-chip internal-ref-section"/, 'watched sections should render as internal section links');
assert.match(html, /href="#renderer" class="internal-ref-chip internal-ref-card"/, 'watched cards should render as internal card links');
assert.match(html, /Source cards[\s\S]*href="#renderer"/, 'structured details should render source card links');
assert.match(html, /id="comp-iframe" srcdoc="/, 'rendered HTML should embed compositor iframe');
assert.match(html, /Living Doc Compositor/, 'rendered HTML should include embedded compositor source');
assert.match(html, /class="mermaid-subgraph" data-subgraph-id="Legend"/, 'Mermaid subgraphs should render as grouped SVG elements');
assert.match(html, /class="mermaid-subgraph-title"[^>]*>Legend<\/text>/, 'Mermaid subgraphs should render their label');
const fixtureMermaidSvg = html.match(/<svg class="mermaid-svg"[\s\S]*?<\/svg>/)?.[0] ?? '';
assert.doesNotMatch(fixtureMermaidSvg, />end</, 'Mermaid subgraph terminators should not render as node text');
assert.doesNotMatch(fixtureMermaidSvg, /LegendTitle/, 'Mermaid legends should not need fake workflow nodes');
assert.match(fixtureMermaidSvg, /class="mermaid-node-trace-label"[^>]*>root\.objective<\/tspan>/, 'Mermaid trace lines should render with trace-label styling');
assert.match(fixtureMermaidSvg, /issue 371 residual cross/, 'Mermaid trace lines should replace id separators with readable spaces in rendered labels');
assert.doesNotMatch(fixtureMermaidSvg, /issue-371-residual_cross-owner-history/, 'Mermaid SVG labels should not render raw long id separators');

const aiRender = spawnSync(process.execPath, ['scripts/render-living-doc.mjs', aiJsonPath], {
  encoding: 'utf8',
});

assert.equal(aiRender.status, 0, aiRender.stderr || aiRender.stdout);

const aiHtml = await readFile(aiHtmlPath, 'utf8');
const aiSpecMatch = aiHtml.match(/<script type="application\/ai-render-graph\+json" id="doc-ai-spec">([\s\S]*?)<\/script>/);
assert.ok(aiSpecMatch?.[1], 'enhanced rendered HTML should expose the raw ai-render-graph spec payload');
const aiSpecPayload = aiSpecMatch[1];

assert.match(aiHtml, /<script type="application\/ai-render-graph\+json" id="doc-ai-spec">/, 'enhanced rendered HTML should include embedded AI spec');
assert.match(aiHtml, /<script type="application\/json" id="doc-ai-meta">/, 'enhanced rendered HTML should include separate advisory metadata');
assert.match(aiHtml, /Section advisory/, 'enhanced rendered HTML should include document-native advisory UI');
assert.match(aiHtml, /data-ai-source="surface-flow"/, 'enhanced rendered HTML should mark AI source sections');
assert.match(aiHtml, /data-ai-task="surface-flow:surface-brief"/, 'enhanced rendered HTML should include task bindings for design-code-spec-flow');
assert.match(aiHtml, /data-ai-task="verification-main:verification-brief"/, 'enhanced rendered HTML should include task bindings for verification-surface');
assert.match(aiHtml, /data-ai-task="proof-ladder:proof-state-brief"/, 'enhanced rendered HTML should include task bindings for proof-ladder');
assert.match(aiHtml, /"from": "props\.sources\.surface-flow\.text"/, 'enhanced rendered HTML should use ai-render-graph source bindings for section text');
assert.doesNotMatch(aiSpecPayload, /"runtime":/, 'ai-render-graph spec should not embed living-doc runtime metadata');
assert.doesNotMatch(aiSpecPayload, /"resultAliases":/, 'ai-render-graph spec should not embed living-doc alias metadata');
assert.match(aiHtml, /Run section pass/, 'enhanced rendered HTML should include a local section action affordance');
assert.match(aiHtml, /This pass reads the current section only and writes no source data\./, 'enhanced rendered HTML should explain the grounding boundary');

const semanticRender = spawnSync(process.execPath, ['scripts/render-living-doc.mjs', semanticJsonPath], {
  encoding: 'utf8',
});

assert.equal(semanticRender.status, 0, semanticRender.stderr || semanticRender.stdout);

const semanticHtml = await readFile(semanticHtmlPath, 'utf8');
const semanticContextMatch = semanticHtml.match(/<script type="application\/json" id="doc-semantic-context">([\s\S]*?)<\/script>/);
assert.ok(semanticContextMatch?.[1], 'rendered semantic template should include embedded semantic context');
const semanticContext = JSON.parse(semanticContextMatch[1]);
assert.equal(semanticContext.schema, 'living-doc-semantic-context/v1');
assert.equal(semanticContext.templateId, 'surface-delivery');
assert.equal(semanticContext.inferredFromDoc.method, 'docId');
assert.ok(
  semanticContext.graph.template.relationships.some((relationship) => relationship.id === 'alignment-requires-verification'),
  'embedded semantic context should include generated relationship graph',
);
assert.ok(
  semanticContext.graph.template.convergenceTypes?.['design-code-spec-flow']?.structuralContract,
  'embedded semantic context should include composed convergence type contracts',
);
assert.match(
  semanticContext.diagram.template.mermaid,
  /design_implementation_alignment -- "requires-verification" --> verification_checkpoints/,
  'embedded semantic context should include generated Mermaid diagram source',
);

const registryOverview = await renderRegistryOverview(path.join(tmpDir, 'living-doc-registry-overview.html'), {
  write: false,
  verifyLinks: false,
  useCatalog: false,
});
const overviewIndex = registryOverview.html.match(/<div class="index-grid">([\s\S]*?)<\/div>\n<\/section>/)?.[1];
assert.ok(overviewIndex, 'registry overview should render a type index');
assert.doesNotMatch(registryOverview.html, /\[object Object\]/, 'registry overview should not stringify localized labels');
assert.match(
  overviewIndex,
  /href="#accountability-closure-path"[\s\S]*<span>Accountability Closure Path<\/span>/,
  'registry overview index should render the English label for localized names',
);
assert.match(
  overviewIndex,
  /href="#visual-page-draft-assessment"[\s\S]*<span>Visual Page Draft Assessment<\/span>/,
  'registry overview index should render newly added localized type names',
);
assert.match(
  overviewIndex,
  /href="#acceptance-criteria"[\s\S]*<span>Acceptance Criteria<\/span>/,
  'registry overview index should preserve plain string type names',
);

console.log(`render contract ok: ${htmlPath}`);
