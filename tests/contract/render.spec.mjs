import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
const embeddedRoot = path.join(tmpDir, 'embedded-pages');
const manifestPath = path.join(tmpDir, 'embedded-manifest.json');
const manifestSourceA = path.join(tmpDir, 'manifest-source-a');
const manifestSourceB = path.join(tmpDir, 'manifest-source-b');

function pdfFixtureBytes(label = 'Embedded PDF fixture') {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 160] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(`BT /F1 18 Tf 42 86 Td (${label}) Tj ET`, 'utf8')} >>\nstream\nBT /F1 18 Tf 42 86 Td (${label}) Tj ET\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'utf8');
}

await copyFile('tests/fixtures/feature-doc.json', jsonPath);
await copyFile('tests/fixtures/ai-enhanced-doc.json', aiJsonPath);
await copyFile('docs/living-doc-template-surface-delivery.json', semanticJsonPath);
await mkdir(path.join(embeddedRoot, 'notes'), { recursive: true });
await writeFile(path.join(embeddedRoot, 'overview.html'), '<!doctype html><html><head><title>Embedded Overview</title></head><body><h1>Integrated HTML Page</h1></body></html>\n');
await writeFile(path.join(embeddedRoot, 'notes', 'context.md'), '# Context Note\n\nMarkdown content stays intact.\n');
await writeFile(path.join(embeddedRoot, 'plain.txt'), 'Plain text stays intact.\n');
await writeFile(path.join(embeddedRoot, 'notes', 'proof.pdf'), pdfFixtureBytes('Folder PDF fixture'));
await mkdir(manifestSourceA, { recursive: true });
await mkdir(manifestSourceB, { recursive: true });
await writeFile(path.join(manifestSourceA, 'selected.html'), '<!doctype html><html><head><title>Selected HTML</title></head><body><h1>Selected from A</h1></body></html>\n');
await writeFile(path.join(manifestSourceB, 'external-note.md'), '# External Note\n\nSelected from B.\n');
await writeFile(path.join(manifestSourceB, 'selected-proof.pdf'), pdfFixtureBytes('Manifest PDF fixture'));
await writeFile(manifestPath, `${JSON.stringify({
  label: 'Manifest selected files',
  files: [
    { path: './manifest-source-a/selected.html', as: 'pages/selected.html' },
    { path: './manifest-source-b/external-note.md', as: 'notes/external-note.md', title: 'Renamed Markdown Note' },
    { path: './manifest-source-b/selected-proof.pdf', as: 'proof/selected-proof.pdf', title: 'Selected Proof PDF' },
  ],
}, null, 2)}\n`);

const featureDoc = JSON.parse(await readFile(jsonPath, 'utf8'));
featureDoc.sections.find((section) => section.id === 'tooling').rationale = 'Renderer tooling rationale stays visible.';
featureDoc.locale = 'en';
featureDoc.contentLocales = {
  source: 'en',
  locales: [
    { id: 'en', label: 'English' },
    { id: 'nl', label: 'Nederlands' },
  ],
};
featureDoc.contentTranslations = {
  nl: {
    document: {
      title: 'Fixture Feature Living Doc NL',
      subtitle: 'Nederlandse fixture-ondertitel',
      objective: 'Nederlandse fixture-doelstelling',
    },
    sections: {
      tooling: {
        title: 'Tooling-oppervlak',
        rationale: 'De rationale voor renderer-tooling blijft zichtbaar.',
        cards: {
          renderer: {
            title: 'Universele renderer',
            purpose: 'Rendert canonieke JSON naar zelfstandige HTML met de compositor ingebed.',
            caveats: [
              'Het JSON-bestand blijft canoniek; HTML is alleen de draagbare snapshot.',
            ],
          },
        },
      },
    },
  },
};
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
      managementSummary: {
        en: 'Renderer fixture for Mermaid subgraph support.',
        nl: 'Deze test laat zien dat de Mermaid-grafiek goed wordt getoond.',
      },
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
          id: 'diagram-with-id-and-source',
          title: 'Subgraph legend fixture',
          kind: 'mermaid',
          source: `flowchart LR
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

const render = spawnSync(process.execPath, ['scripts/render-living-doc.mjs', jsonPath, '--embed-file-library', embeddedRoot, '--embed-file-library-label', 'Fixture embedded pages'], {
  encoding: 'utf8',
});

assert.equal(render.status, 0, render.stderr || render.stdout);

const html = await readFile(htmlPath, 'utf8');

assert.match(html, /<script type="application\/json" id="doc-meta">/, 'rendered HTML should include doc-meta');
assert.match(html, /<script type="application\/json" id="embedded-file-library-data">/, 'rendered HTML should include embedded file-library payload');
assert.match(html, /living-doc-embedded-file-library\/v1/, 'embedded file-library payload should expose its schema');
assert.match(html, /Fixture embedded pages/, 'embedded file-library should carry the configured root label');
assert.match(html, /overview\.html/, 'embedded file-library should preserve HTML relative paths');
assert.match(html, /notes\/context\.md/, 'embedded file-library should preserve nested Markdown relative paths');
assert.match(html, /notes\/proof\.pdf/, 'embedded file-library should preserve nested PDF relative paths');
assert.match(html, /application\/pdf/, 'embedded PDF entries should use the PDF media type');
assert.doesNotMatch(html, /id="embedded-file-library"/, 'embedded files should not render as a document body section');
assert.match(html, /living-doc-open-embedded-file/, 'rendered HTML should bridge embedded file opens from the compositor library');
assert.match(html, /id="embedded-file-modal"/, 'rendered HTML should include the embedded file modal');
assert.match(html, /setAttribute\('sandbox', 'allow-scripts'\)/, 'embedded HTML files should be allowed to run their own static report scripts');
assert.match(html, /embedded-pdf-frame/, 'rendered HTML should include the PDF modal viewer runtime');
assert.match(html, /Open PDF/, 'rendered HTML should include the PDF fallback link label');
assert.match(render.stdout, /Embedded file library "Fixture embedded pages" with 4 files/, 'renderer output should summarize embedded file inclusion');
assert.match(html, /Fixture Feature Living Doc/, 'rendered HTML should include fixture title');
assert.match(html, /id="doc-content-localization"/, 'rendered HTML should include document-content localization payload');
assert.match(html, /living-doc-content-localization\/v1/, 'localization payload should expose its schema');
assert.match(html, /id="content-locale-select"/, 'multilingual documents should render a content language selector');
assert.match(html, /Fixture Feature Living Doc NL/, 'localization payload should include translated document title');
assert.match(html, /Tooling-oppervlak/, 'localization payload should include translated section title keyed by section id');
assert.match(html, /Universele renderer/, 'localization payload should include translated card title keyed by card id');
assert.match(html, /Rendert canonieke JSON naar zelfstandige HTML/, 'localization payload should include registry text-field translation');
assert.match(html, /Render canonical JSON into standalone HTML with the compositor embedded\./, 'source text should remain available as fallback');
const localizationMatch = html.match(/<script type="application\/json" id="doc-content-localization">([\s\S]*?)<\/script>/);
assert.ok(localizationMatch?.[1], 'rendered HTML should expose parseable document-content localization JSON');
const localizationPayload = JSON.parse(localizationMatch[1]);
assert.equal(localizationPayload.schema, 'living-doc-content-localization/v1');
assert.equal(localizationPayload.sourceLocale, 'en');
assert.deepEqual(localizationPayload.locales.map((entry) => entry.id), ['en', 'nl']);
assert.equal(localizationPayload.entries['document.title'].values.nl, 'Fixture Feature Living Doc NL');
assert.equal(localizationPayload.entries['section.tooling.title'].values.nl, 'Tooling-oppervlak');
assert.equal(localizationPayload.entries['section.tooling.rationale'].values.nl, 'De rationale voor renderer-tooling blijft zichtbaar.');
assert.equal(localizationPayload.entries['card.tooling.renderer.name'].values.nl, 'Universele renderer', 'card title translations should alias to rendered card name keys');
assert.equal(localizationPayload.entries['card.tooling.renderer.purpose'].values.nl, 'Rendert canonieke JSON naar zelfstandige HTML met de compositor ingebed.');
assert.equal(localizationPayload.entries['card.tooling.renderer.whenToUse'].values.nl, featureDoc.sections.find((section) => section.id === 'tooling').data[0].whenToUse, 'missing translations should fall back per field');
assert.equal(localizationPayload.entries['card.tooling.renderer.caveats.0.text'].values.nl, 'Het JSON-bestand blijft canoniek; HTML is alleen de draagbare snapshot.');
assert.match(html, /<article class="flow-card" id="renderer" data-section-id="tooling" data-card-key="renderer">/, 'translated cards should keep stable DOM ids and card keys');
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
assert.match(html, /class="management-summary"/, 'objective closure plan should render management summary as a prominent block');
assert.match(html, /class="management-summary-eyebrow"[^>]*>Management summary<\/div>/, 'management summary block should keep its label visible');
assert.match(html, /Renderer fixture for Mermaid subgraph support\./, 'management summary block should render the plan summary text');
assert.match(html, /Nederlandse uitleg/, 'management summary block should label the Dutch simplified translation');
assert.match(html, /Deze uitleg is bewust simpel gehouden\./, 'management summary block should warn that the Dutch wording is simplified');
assert.match(html, /Deze test laat zien dat de Mermaid-grafiek goed wordt getoond\./, 'management summary block should render Dutch translation without replacing English');
assert.match(html, /href="#status-snapshot" class="internal-ref-chip internal-ref-section"/, 'watched sections should render as internal section links');
assert.match(html, /href="#renderer" class="internal-ref-chip internal-ref-card"/, 'watched cards should render as internal card links');
assert.match(html, /Source cards[\s\S]*href="#renderer"/, 'structured details should render source card links');
assert.match(html, /id="comp-iframe" srcdoc="/, 'rendered HTML should embed compositor iframe');
assert.match(html, /Living Doc Compositor/, 'rendered HTML should include embedded compositor source');
assert.match(html, /class="mermaid-subgraph" data-subgraph-id="Legend"/, 'Mermaid subgraphs should render as grouped SVG elements');
assert.doesNotMatch(html, /note-line">diagram-with-id-and-source</, 'Mermaid diagram objects with ids should not collapse into their id text');
assert.match(html, /class="mermaid-subgraph-title"[^>]*>Legend<\/text>/, 'Mermaid subgraphs should render their label');
const fixtureMermaidSvg = html.match(/<svg class="mermaid-svg"[\s\S]*?<\/svg>/)?.[0] ?? '';
assert.doesNotMatch(fixtureMermaidSvg, />end</, 'Mermaid subgraph terminators should not render as node text');
assert.doesNotMatch(fixtureMermaidSvg, /LegendTitle/, 'Mermaid legends should not need fake workflow nodes');
assert.match(fixtureMermaidSvg, /class="mermaid-node-trace-label"[^>]*>root\.objective<\/tspan>/, 'Mermaid trace lines should render with trace-label styling');
assert.match(fixtureMermaidSvg, /issue 371 residual cross/, 'Mermaid trace lines should replace id separators with readable spaces in rendered labels');
assert.doesNotMatch(fixtureMermaidSvg, /issue-371-residual_cross-owner-history/, 'Mermaid SVG labels should not render raw long id separators');

const manifestRender = spawnSync(process.execPath, ['scripts/render-living-doc.mjs', jsonPath, '--embed-file-library-manifest', manifestPath], {
  encoding: 'utf8',
});
assert.equal(manifestRender.status, 0, manifestRender.stderr || manifestRender.stdout);
const manifestHtml = await readFile(htmlPath, 'utf8');
assert.match(manifestHtml, /Manifest selected files/, 'manifest label should become the embedded library label');
assert.match(manifestHtml, /local-manifest/, 'embedded library should record manifest source mode');
assert.match(manifestHtml, /pages\/selected\.html/, 'manifest should control embedded HTML library path');
assert.match(manifestHtml, /notes\/external-note\.md/, 'manifest should control embedded Markdown library path');
assert.match(manifestHtml, /proof\/selected-proof\.pdf/, 'manifest should control embedded PDF library path');
assert.match(manifestHtml, /Renamed Markdown Note/, 'manifest entry title override should be preserved');
assert.match(manifestHtml, /Selected Proof PDF/, 'manifest PDF title override should be preserved');
assert.doesNotMatch(manifestHtml, /manifest-source-a\/selected\.html/, 'source filesystem layout should not leak into the library path');
assert.match(manifestRender.stdout, /Embedded file library "Manifest selected files" with 3 files/, 'renderer output should summarize manifest inclusion');

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
