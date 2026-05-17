#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function usage() {
  return `Usage:
  node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs <doc.json|doc.html|file://...> [--out <path>] [--model-out <path>]
  node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs --from-model <model.json> [--out <path>]

Examples:
  node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs docs/workstream.json
  node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs file:///path/to/workstream.html#status-snapshot --model-out docs/workstream-accountability-path.nl.json
  node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs --from-model docs/workstream-accountability-path.nl.json`;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    process.exit(args.length ? 0 : 1);
  }
  let input = null;
  let out = null;
  let modelOut = null;
  let fromModel = null;
  let locale = 'nl';
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out') {
      out = args[i + 1];
      i += 1;
    } else if (args[i] === '--model-out') {
      modelOut = args[i + 1];
      i += 1;
    } else if (args[i] === '--from-model') {
      fromModel = args[i + 1];
      i += 1;
    } else if (args[i] === '--locale') {
      locale = args[i + 1];
      i += 1;
    } else {
      if (input) throw new Error(`Unexpected extra input: ${args[i]}`);
      input = args[i];
    }
  }
  if (locale !== 'nl') throw new Error('Dutch is the only supported accountability output locale for this skill.');
  if (!input && !fromModel) throw new Error('Expected an input doc or --from-model <model.json>');
  return { input, out, modelOut, fromModel, locale };
}

function resolveInput(input) {
  let raw = input;
  if (raw.startsWith('file://')) {
    raw = fileURLToPath(raw.split('#')[0]);
  }
  raw = path.resolve(raw);
  if (raw.endsWith('.html')) {
    raw = raw.replace(/\.html$/i, '.json');
  }
  if (!raw.endsWith('.json')) {
    throw new Error(`Expected a living doc JSON or sibling rendered HTML path, got: ${input}`);
  }
  return raw;
}

function defaultOutputPath(sourcePath, explicitOut, locale = 'nl', extension = 'html') {
  if (explicitOut) return path.resolve(explicitOut);
  const ext = path.extname(sourcePath);
  const base = sourcePath.slice(0, -ext.length);
  return `${base}-accountability-path.${locale}.${extension}`;
}

const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (ch) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}[ch]));

const slug = (value) => String(value ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '') || 'item';

function arr(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.criterion === 'string') return value.criterion;
    if (typeof value.definition === 'string') return value.definition;
    return Object.values(value).map(textOf).filter(Boolean).join(' ');
  }
  return String(value);
}

function section(doc, id) {
  return (doc.sections || []).find((s) => s.id === id) || { id, data: [] };
}

function cards(doc, id) {
  const s = section(doc, id);
  return s.data || s.cards || [];
}

function allCards(doc) {
  const out = [];
  for (const s of doc.sections || []) {
    for (const card of (s.data || s.cards || [])) {
      out.push({ section: s, card });
    }
  }
  return out;
}

function makeCardIndex(doc) {
  return new Map(allCards(doc).map((entry) => [entry.card.id, entry]));
}

function relatedByTicket(doc, criterion) {
  const ids = new Set(arr(criterion.ticketIds));
  if (!ids.size) return [];
  return allCards(doc).filter(({ card }) => card.id !== criterion.id && arr(card.ticketIds).some((id) => ids.has(id)));
}

function relatedByCriterion(doc, criterion) {
  return allCards(doc).filter(({ card }) => arr(card.criterionIds).includes(criterion.id));
}

function inferState(criterion, related) {
  const states = [criterion.status, ...related.map(({ card }) => card.status)].filter(Boolean).map((s) => String(s).toLowerCase());
  if (states.some((s) => ['blocked'].includes(s))) return 'blocked';
  if (states.some((s) => ['missing', 'planned', 'not-built', 'specified', 'reference'].includes(s))) return 'open';
  if (states.some((s) => ['partial', 'partially-resolved'].includes(s))) return 'partial';
  if (states.length && states.every((s) => ['built', 'closed', 'complete', 'current', 'ground-truth', 'required'].includes(s))) return 'partial';
  return 'unclear';
}

function accountabilityTypes(text, related) {
  const lower = `${text} ${related.map(({ card }) => textOf(card)).join(' ')}`.toLowerCase();
  const types = new Set(['proof/evidence work']);
  if (/implement|code|worker|parser|validator|normaliz|adapter|dashboard|test|fixture/.test(lower)) types.add('implementation work');
  if (/decid|choose|select|primitive|scope|risk|downgrade/.test(lower)) types.add('decision work');
  if (/review|accept|approve|signoff|pr|plan/.test(lower)) types.add('review and acceptance work');
  if (/aws|terraform|queue|dynamodb|s3|iam|vllm|gpu|endpoint|resource|deploy/.test(lower)) types.add('infrastructure/resource work');
  if (/cost|fund|access|gpu/.test(lower)) types.add('access/funding work');
  if (/risk|skip|defer|downgrade|scope/.test(lower)) types.add('risk acceptance work');
  if (/operate|owner|dashboard|runtime|apply|deployment|production/.test(lower)) types.add('operational ownership work');
  return [...types];
}

function ownerRequiredFor(types, text) {
  const lower = text.toLowerCase();
  if (types.some((type) => type !== 'implementation work' && type !== 'proof/evidence work')) return true;
  return /owner|review|accept|aws|terraform|fund|cost|decision|approve|apply|production/.test(lower);
}

function summarizeRelated(related, keys) {
  const lines = [];
  for (const { card } of related) {
    for (const key of keys) {
      const value = card[key];
      if (!value) continue;
      for (const item of arr(value)) {
        const text = textOf(item).trim();
        if (text) lines.push(`${card.id}: ${text}`);
      }
    }
  }
  return [...new Set(lines)].slice(0, 5);
}

function buildGenericModel(doc, sourcePath) {
  const criteria = cards(doc, 'acceptance-criteria');
  const gates = [];
  gates.push({
    name: 'Afsluitlabel en scopegrens',
    state: 'open',
    must: `De finishclaim moet gekoppeld zijn aan het gedocumenteerde doel en de succesvoorwaarde: ${doc.successCondition || doc.objective || 'geen succesvoorwaarde gevonden'}`,
    proof: ['De accountability-pagina koppelt het finishlabel aan expliciete afsluitpoorten.', 'Elke verwijderde of gedowngrade scope legt geaccepteerd risico en de ongeldig gemaakte finishclaim vast.'],
    bottleneck: 'Het gevraagde finishantwoord is onverenigbaar met de living-doc definitie van done tenzij alle vereiste poorten bewezen zijn of expliciet zijn verwijderd met benoemd risico.',
    types: ['decision work', 'risk acceptance work', 'proof/evidence work'],
    owner: 'Eigenaar vereist: product/technisch eigenaar voor scopeverwijdering, risicodowngrade of acceptatie van het finishlabel.',
    refs: ['objective', 'successCondition'],
  });

  for (const criterion of criteria) {
    const related = [...relatedByCriterion(doc, criterion), ...relatedByTicket(doc, criterion)];
    const uniqueRelated = [...new Map(related.map((entry) => [`${entry.section.id}:${entry.card.id}`, entry])).values()];
    const criterionText = criterion.criterion || criterion.definition || textOf(criterion);
    const state = inferState(criterion, uniqueRelated);
    const proof = [
      ...summarizeRelated(uniqueRelated, ['currentCoverage', 'proofClaim', 'outputAssertion', 'evidenceRefs']),
      `Vereist criterium uit brondocument: ${criterionText}`,
    ].slice(0, 6);
    const gaps = [
      ...arr(criterion.gaps).map(textOf),
      ...arr(criterion.gap).map(textOf),
      ...summarizeRelated(uniqueRelated, ['blockers', 'gaps', 'gap', 'nextStep']),
    ].filter(Boolean);
    const types = accountabilityTypes(criterionText, uniqueRelated);
    gates.push({
      name: criterion.name || criterion.title || criterion.id,
      state,
      must: criterionText,
      proof: proof.length ? proof : ['Het living doc vereist een bewijsartifact, maar de gerelateerde kaarten bevatten geen bewijsdetail.'],
      bottleneck: gaps[0] || 'Geen benoemd knelpunt zichtbaar op gerelateerde kaarten; eigenaar moet bewijsvoldoendeheid bevestigen.',
      types,
      owner: ownerRequiredFor(types, `${criterionText} ${gaps.join(' ')}`)
        ? `Eigenaar vereist: ${types.filter((type) => type !== 'implementation work' && type !== 'proof/evidence work').map((type) => typeLabel(type, 'nl')).join(', ') || 'acceptatie'}-eigenaar is niet uit het doc afleidbaar.`
        : 'Implementatie-eigenaar is afleidbaar uit gerelateerde code/testvlakken; acceptatie-eigenaar is niet uit het doc afleidbaar.',
      refs: [criterion.id, ...uniqueRelated.slice(0, 5).map(({ card }) => card.id)],
    });
  }

  return finishModel(doc, sourcePath, gates);
}

function finishModel(doc, sourcePath, gates, proofOverride = null) {
  const statusCounts = gates.reduce((acc, gate) => {
    acc[gate.state] = (acc[gate.state] || 0) + 1;
    return acc;
  }, {});
  const typeCounts = {};
  for (const gate of gates) {
    for (const type of gate.types) typeCounts[type] = (typeCounts[type] || 0) + 1;
  }
  const implementationAlone = gates.every((gate) => gate.types.every((type) => type === 'implementation work' || type === 'proof/evidence work')) ? 'Ja' : 'Nee';
  const ownerRequiredCount = gates.filter((gate) => gate.owner.toLowerCase().includes('eigenaar vereist')).length;
  const nonImplementationCount = gates.filter((gate) => gate.types.some((type) => type !== 'implementation work' && type !== 'proof/evidence work')).length;
  const blocked = gates.filter((gate) => gate.state === 'blocked' || gate.owner.toLowerCase().includes('eigenaar vereist'));
  const proofLedger = proofOverride || {
    proven: gates.filter((gate) => gate.state === 'closed').map((gate) => `${gate.name}: ${gate.proof[0] || 'gesloten bewijs bestaat.'}`),
    partial: gates.filter((gate) => gate.state === 'partial').map((gate) => `${gate.name}: ${gate.proof[0] || 'gedeeltelijk bewijs bestaat.'}`),
    missing: gates.filter((gate) => ['open', 'blocked', 'unclear'].includes(gate.state)).map((gate) => `${gate.name}: ${gate.proof[0] || 'bewijs ontbreekt of is onduidelijk.'}`),
    invalid: ['Activiteit, planning, lokaal-only bewijs of discussie sluit geen poort tenzij het op die poort als bewijsartifact is benoemd.'],
  };
  const finishLabel = 'het doel, de succesvoorwaarde, acceptatiecriteria, bewijsartifacts en expliciete risicoacceptaties die in het living doc zijn benoemd.';
  return {
    sourcePath,
    title: doc.title || path.basename(sourcePath, '.json'),
    subtitle: doc.subtitle || '',
    updated: doc.updated || '',
    objective: doc.objective || '',
    successCondition: doc.successCondition || '',
    generatedAt: new Date().toISOString(),
    accountabilityReadout: 'Dit is geen enkele implementatietaak. Het living doc definieert voltooiing als een set bewijs-poorten. Sommige poorten zijn codewerk, maar andere vereisen besluiten, acceptatie-eigenaarschap, infrastructuur, toegang tot resources, bewijs, review, operationeel eigenaarschap, risicoacceptatie of expliciete scopeverwijdering.',
    schedulingBasis: 'Dit kan vanuit het huidige document niet eerlijk tot een datum worden gereduceerd. De resterende afrondingsvoorwaarde is een set bewijs-poorten.',
    implementationAlone,
    statusCounts,
    typeCounts,
    ownerRequiredCount,
    gates,
    bottlenecks: blocked.slice(0, 8).map((gate, index) => ({
      name: gate.bottleneck.split('.')[0] || gate.name,
      blocks: `Poort ${gates.indexOf(gate) + 1}: ${gate.name}`,
      why: gate.bottleneck,
      owner: gate.owner.toLowerCase().includes('eigenaar vereist') ? gate.owner : 'Eigenaar vereist: acceptatie-eigenaar is niet uit het doc afleidbaar.',
      ifSkipped: index === 0
        ? `Als dit wordt overgeslagen, moet de finishclaim worden gedowngraded; "${modelFinishWord(doc)}" kan niet eerlijk worden geclaimd.`
        : `Als dit wordt overgeslagen, kan ${gate.name} niet als gesloten worden geteld.`,
    })),
    proofLedger,
    finishLabel,
    finishCheck: 'Het gevraagde finishantwoord is onverenigbaar met de huidige living-doc definitie van done tenzij de vereiste bewijs-poorten zijn afgerond of expliciet zijn verwijderd met benoemd risico.',
    managerSummary: `${gates.length} poorten blijven over in het verantwoordingspad, en ${nonImplementationCount} zijn niet alleen van implementatie afhankelijk. De blokkerende poorten zijn ${blocked.slice(0, 4).map((gate) => gate.name).join(', ')}${blocked.length > 4 ? ', plus aanvullende poorten waarvoor eigenaarschap vereist is' : ''}. Afsluiting vereist bewijsartifacts en eigenaarschapsbesluiten, geen datumgok.`,
  };
}

function modelFinishWord(doc) {
  if (doc.title?.toLowerCase().includes('mvp')) return 'MVP compleet';
  return 'done';
}

const UI = {
  nl: {
    lang: 'nl',
    pageTitleSuffix: 'Verantwoordingspad',
    navReadout: 'Uitlezing',
    navDashboard: 'Dashboard',
    navGates: 'Poorten',
    navBottlenecks: 'Knelpunten',
    navProof: 'Bewijs',
    navSummary: 'Samenvatting',
    eyebrow: 'Bewijsgericht afsluitpad',
    sourceDoc: 'Brondocument',
    generated: 'Gegenereerd',
    docUpdated: 'Doc bijgewerkt',
    objective: 'Doel',
    successCondition: 'Succesvoorwaarde',
    accountabilityReadout: 'Verantwoordingsuitlezing',
    implementationAlone: 'Alleen implementatie',
    gateDashboard: 'Poortdashboard',
    ownerRequired: 'eigenaar vereist',
    finishLanguage: 'Afsluit-taal',
    currentlyMeans: 'betekent nu',
    closurePath: 'Afsluitpad',
    closureIntro: 'De volgorde hieronder is het kleinste eerlijke pad naar de gedocumenteerde succesvoorwaarde. Lokaal implementatiewerk is zichtbaar, maar infrastructuur, review, acceptatie, kosten, deployment en bewijs-eigenaarschap worden niet tot implementatie gereduceerd.',
    gate: 'Poort',
    currentState: 'Huidige staat',
    mustBecomeTrue: 'Moet waar worden',
    proofRequired: 'Vereist bewijs',
    bottleneckRisk: 'Knelpuntrisico',
    accountabilityType: 'Verantwoordelijkheidstype',
    bottleneckMap: 'Knelpuntenkaart',
    blocks: 'Blokkeert',
    whyBottleneck: 'Waarom dit een knelpunt is',
    ifSkipped: 'Als dit wordt overgeslagen',
    proofLedger: 'Bewijsboekhouding',
    proven: 'Bewezen',
    partial: 'Gedeeltelijk',
    missing: 'Ontbreekt',
    invalidForClosure: 'Ongeldig voor afsluiting',
    managerSummary: 'Managementsamenvatting',
    footer: 'Gegenereerd door living-doc-accountability-path-extractor. Deze pagina is een bewijsgericht afsluitpad, geen planningsschatting.',
    printNote: 'Printnotitie: bronpad en gegenereerde timestamp blijven bewaard als reviewbewijs.',
  },
};

const STATUS_LABELS = {
  nl: { closed: 'gesloten', partial: 'gedeeltelijk', open: 'open', blocked: 'geblokkeerd', unclear: 'onduidelijk' },
};

const TYPE_LABELS = {
  nl: {
    'implementation work': 'implementatiewerk',
    'decision work': 'besluitwerk',
    'review and acceptance work': 'review- en acceptatiewerk',
    'infrastructure/resource work': 'infrastructuur/resourcewerk',
    'access/funding work': 'toegang/financiering',
    'risk acceptance work': 'risicoacceptatie',
    'proof/evidence work': 'bewijswerk',
    'operational ownership work': 'operationeel eigenaarschap',
  },
};

function ui(locale) {
  return UI[locale] || UI.nl;
}

function statusLabel(state, locale) {
  return STATUS_LABELS[locale]?.[state] || state;
}

function typeLabel(type, locale) {
  return TYPE_LABELS[locale]?.[type] || type;
}

function localizeModel(model, locale) {
  if (locale !== 'nl') throw new Error('Dutch is the only supported accountability output locale for this skill.');
  return {
    ...model,
    locale: 'nl',
    schema: 'living-doc-accountability-path/v1',
    implementationAlone: model.implementationAlone === 'Yes' ? 'Ja' : model.implementationAlone,
  };
}

function renderHtml(model) {
  const labels = ui('nl');
  const locale = 'nl';
  const chip = (text, cls = '') => `<span class="chip ${cls}">${esc(text)}</span>`;
  const list = (items) => `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
  const refChips = (refs) => refs.map((ref) => chip(ref, 'ref')).join('');
  const stateClass = (state) => `state-${slug(state)}`;
  const typeHtml = (types) => types.map((type) => chip(typeLabel(type, locale), 'type')).join('');
  const statusOrder = ['closed', 'partial', 'open', 'blocked', 'unclear'];

  return `<!doctype html>
<html lang="${esc(labels.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.title)} - ${esc(labels.pageTitleSuffix)}</title>
<style>
  :root {
    --bg: #f5f7f9;
    --panel: #ffffff;
    --ink: #151b23;
    --muted: #5b6876;
    --line: #d9e0e8;
    --line-strong: #aeb8c5;
    --green: #12743e;
    --green-bg: #e8f6ee;
    --amber: #985700;
    --amber-bg: #fff1d7;
    --blue: #245d91;
    --blue-bg: #e9f2fb;
    --red: #aa2a25;
    --red-bg: #fde9e7;
    --gray: #55616d;
    --gray-bg: #eef2f5;
    --shadow: 0 16px 36px rgba(18, 28, 45, 0.08);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body, .page, header, main, aside, section, article, div, p, li, span { min-width: 0; overflow-wrap: anywhere; }
  a { color: inherit; text-decoration-thickness: 1px; text-underline-offset: 3px; }
  .topbar { position: sticky; top: 0; z-index: 10; background: rgba(245, 247, 249, 0.94); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
  .topbar-inner { max-width: 1520px; margin: 0 auto; padding: 10px 28px; display: flex; align-items: center; justify-content: space-between; gap: 14px; }
  .topbar-title { font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nav { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
  .nav a { display: inline-flex; align-items: center; min-height: 28px; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; background: #fff; color: var(--muted); font-size: 12px; font-weight: 750; text-decoration: none; }
  .page { display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); gap: 24px; max-width: 1520px; margin: 0 auto; padding: 24px 28px 34px; }
  header { grid-column: 1 / -1; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); overflow: hidden; }
  .hero-line { height: 7px; background: linear-gradient(90deg, var(--red), var(--amber), var(--blue)); }
  .hero { padding: 24px; }
  .eyebrow { color: var(--muted); text-transform: uppercase; font-size: 12px; letter-spacing: .08em; font-weight: 800; }
  h1 { margin: 6px 0 10px; font-size: clamp(30px, 4vw, 48px); line-height: 1.04; letter-spacing: 0; max-width: 920px; }
  h2 { margin: 0 0 14px; font-size: 20px; line-height: 1.2; letter-spacing: 0; }
  h3 { margin: 0 0 8px; font-size: 16px; line-height: 1.3; letter-spacing: 0; }
  p { margin: 0; }
  p + p { margin-top: 10px; }
  .meta { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; margin-top: 18px; }
  .meta div, .metric, .panel, .gate, .bottleneck, .ledger-column { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
  .meta div { padding: 10px 12px; }
  .label { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .07em; font-weight: 800; }
  .value { display: block; margin-top: 3px; font-weight: 650; }
  .summary-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin-top: 14px; }
  .field { padding: 12px; background: #fbfcfd; border: 1px solid var(--line); border-radius: 6px; }
  .field p { margin-top: 5px; }
  .rail { position: sticky; top: 66px; align-self: start; display: grid; gap: 14px; }
  .main { display: grid; gap: 18px; }
  .panel { padding: 18px; }
  .readout { border-left: 6px solid var(--red); }
  .direct { font-size: 18px; font-weight: 780; line-height: 1.36; }
  .schedule { color: var(--red); font-weight: 800; }
  .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .metric { padding: 12px; }
  .metric strong { display: block; font-size: 25px; line-height: 1; }
  .metric span { display: block; color: var(--muted); margin-top: 5px; text-transform: capitalize; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
  .chip { display: inline-flex; align-items: center; max-width: 100%; min-height: 24px; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line); background: #fff; font-size: 12px; font-weight: 750; color: var(--ink); }
  .chip.type { background: #f4f7fb; color: #2b3a48; }
  .chip.ref { background: #f8fafc; color: #526170; font-weight: 650; }
  .state-closed { color: var(--green); background: var(--green-bg); border-color: #b8e3c9; }
  .state-partial { color: var(--amber); background: var(--amber-bg); border-color: #f0ce91; }
  .state-open { color: var(--blue); background: var(--blue-bg); border-color: #bfd8f1; }
  .state-blocked { color: var(--red); background: var(--red-bg); border-color: #f2b7b3; }
  .state-unclear { color: var(--gray); background: var(--gray-bg); border-color: #d2dae3; }
  .gate { padding: 0; overflow: hidden; border-left: 7px solid var(--line-strong); }
  .gate.state-partial { border-left-color: #d68b18; }
  .gate.state-open { border-left-color: #2f6da5; }
  .gate.state-blocked { border-left-color: #bf3029; }
  .gate.state-closed { border-left-color: #18824a; }
  .gate-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; padding: 16px 18px; border-bottom: 1px solid var(--line); background: #fff; }
  .gate-title { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .gate-number { color: var(--muted); font-weight: 850; }
  .gate-body { padding: 16px 18px 18px; display: grid; gap: 12px; }
  .grid-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  ul { margin: 8px 0 0; padding-left: 18px; }
  li + li { margin-top: 5px; }
  .owner-required { border-color: #efb4af; background: #fff7f6; color: #99211b; font-weight: 800; }
  .bottlenecks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .bottleneck { padding: 14px; border-left: 5px solid var(--red); }
  .ledger { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .ledger-column { padding: 14px; }
  .finish-check { border-left: 5px solid var(--blue); }
  .footer { color: var(--muted); font-size: 12px; border-top: 1px solid var(--line); padding-top: 16px; }
  .print-note { display: none; }
  @media (max-width: 1040px) {
    .topbar { position: static; }
    .topbar-inner { padding: 10px 16px; align-items: flex-start; flex-direction: column; }
    .nav { justify-content: flex-start; }
    .page { grid-template-columns: 1fr; padding: 16px; }
    .rail { position: static; }
    .meta, .summary-grid, .grid-two, .bottlenecks, .ledger { grid-template-columns: 1fr; }
    .gate-header { grid-template-columns: 1fr; }
  }
  @media print {
    body { background: #fff; }
    .topbar { display: none; }
    .page { display: block; max-width: none; padding: 0; }
    header, .rail, .panel, .gate, .bottleneck, .ledger-column, .metric { box-shadow: none; break-inside: avoid; }
    .rail { position: static; margin: 16px 0; }
    .main { display: block; }
    .main > * { margin-bottom: 16px; }
    .print-note { display: block; }
  }
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-inner">
    <div class="topbar-title">${esc(model.title)}</div>
    <nav class="nav" aria-label="Page sections">
      <a href="#readout">${esc(labels.navReadout)}</a>
      <a href="#dashboard">${esc(labels.navDashboard)}</a>
      <a href="#closure-path">${esc(labels.navGates)}</a>
      <a href="#bottlenecks">${esc(labels.navBottlenecks)}</a>
      <a href="#proof-ledger">${esc(labels.navProof)}</a>
      <a href="#summary">${esc(labels.navSummary)}</a>
    </nav>
  </div>
</div>
<div class="page">
  <header>
    <div class="hero-line"></div>
    <div class="hero">
      <div class="eyebrow">${esc(labels.eyebrow)}</div>
      <h1>${esc(model.title)}</h1>
      ${model.subtitle ? `<p>${esc(model.subtitle)}</p>` : ''}
      <div class="meta">
        <div><span class="label">${esc(labels.sourceDoc)}</span><span class="value">${esc(model.sourcePath)}</span></div>
        <div><span class="label">${esc(labels.generated)}</span><span class="value">${esc(model.generatedAt)}</span></div>
        <div><span class="label">${esc(labels.docUpdated)}</span><span class="value">${esc(model.updated)}</span></div>
      </div>
      <div class="summary-grid">
        <div class="field"><span class="label">${esc(labels.objective)}</span><p>${esc(model.objective)}</p></div>
        <div class="field"><span class="label">${esc(labels.successCondition)}</span><p>${esc(model.successCondition)}</p></div>
      </div>
    </div>
  </header>

  <aside class="rail">
    <section class="panel readout" id="readout">
      <h2>${esc(labels.accountabilityReadout)}</h2>
      <p class="direct">${esc(model.accountabilityReadout)}</p>
      <p><strong>${esc(labels.implementationAlone)}:</strong> ${esc(model.implementationAlone)}</p>
      <p class="schedule">${esc(model.schedulingBasis)}</p>
    </section>
    <section class="panel" id="dashboard">
      <h2>${esc(labels.gateDashboard)}</h2>
      <div class="metrics">
        ${statusOrder.map((state) => `<div class="metric ${stateClass(state)}"><strong>${model.statusCounts[state] || 0}</strong><span>${esc(statusLabel(state, locale))}</span></div>`).join('')}
        <div class="metric"><strong>${model.ownerRequiredCount}</strong><span>${esc(labels.ownerRequired)}</span></div>
      </div>
      <div class="chips">${Object.entries(model.typeCounts).map(([type, count]) => chip(`${typeLabel(type, locale)}: ${count}`, 'type')).join('')}</div>
    </section>
    <section class="panel finish-check">
      <h2>${esc(labels.finishLanguage)}</h2>
      <p><strong>"${esc(modelFinishWord(model))}" ${esc(labels.currentlyMeans)}:</strong> ${esc(model.finishLabel)}</p>
      <p>${esc(model.finishCheck)}</p>
    </section>
  </aside>

  <main class="main">
    <section class="panel" id="closure-path">
      <h2>${esc(labels.closurePath)}</h2>
      <p>${esc(labels.closureIntro)}</p>
    </section>
    ${model.gates.map((gate, index) => `<article class="gate ${stateClass(gate.state)}" id="gate-${index + 1}">
      <div class="gate-header">
        <div>
          <div class="gate-title"><span class="gate-number">${esc(labels.gate)} ${index + 1}</span><h3>${esc(gate.name)}</h3></div>
          <div class="chips">${chip(statusLabel(gate.state, locale), stateClass(gate.state))}${typeHtml(gate.types)}${gate.owner.toLowerCase().includes('eigenaar vereist') ? chip('Eigenaar vereist', 'owner-required') : ''}</div>
        </div>
      </div>
      <div class="gate-body">
        <div class="grid-two">
          <div class="field"><span class="label">${esc(labels.currentState)}</span><p>${esc(statusLabel(gate.state, locale))}</p></div>
          <div class="field"><span class="label">${esc(labels.mustBecomeTrue)}</span><p>${esc(gate.must)}</p></div>
          <div class="field"><span class="label">${esc(labels.proofRequired)}</span>${list(gate.proof)}</div>
          <div class="field"><span class="label">${esc(labels.bottleneckRisk)}</span><p>${esc(gate.bottleneck)}</p></div>
          <div class="field"><span class="label">${esc(labels.accountabilityType)}</span><div class="chips">${typeHtml(gate.types)}</div></div>
          <div class="field"><span class="label">${esc(labels.ownerRequired)}</span><p>${esc(gate.owner)}</p></div>
        </div>
        <div class="chips">${refChips(gate.refs)}</div>
      </div>
    </article>`).join('\n')}

    <section class="panel" id="bottlenecks">
      <h2>${esc(labels.bottleneckMap)}</h2>
      <div class="bottlenecks">
        ${model.bottlenecks.map((bottleneck) => `<article class="bottleneck">
          <h3>${esc(bottleneck.name)}</h3>
          <p><strong>${esc(labels.blocks)}:</strong> ${esc(bottleneck.blocks)}</p>
          <p><strong>${esc(labels.whyBottleneck)}:</strong> ${esc(bottleneck.why)}</p>
          <p><strong>${esc(labels.ownerRequired)}:</strong> ${esc(bottleneck.owner)}</p>
          <p><strong>${esc(labels.ifSkipped)}:</strong> ${esc(bottleneck.ifSkipped)}</p>
        </article>`).join('\n')}
      </div>
    </section>

    <section class="panel" id="proof-ledger">
      <h2>${esc(labels.proofLedger)}</h2>
      <div class="ledger">
        <div class="ledger-column"><h3>${esc(labels.proven)}</h3>${list(model.proofLedger.proven)}</div>
        <div class="ledger-column"><h3>${esc(labels.partial)}</h3>${list(model.proofLedger.partial)}</div>
        <div class="ledger-column"><h3>${esc(labels.missing)}</h3>${list(model.proofLedger.missing)}</div>
        <div class="ledger-column"><h3>${esc(labels.invalidForClosure)}</h3>${list(model.proofLedger.invalid)}</div>
      </div>
    </section>

    <section class="panel" id="summary">
      <h2>${esc(labels.managerSummary)}</h2>
      <p class="direct">${esc(model.managerSummary)}</p>
    </section>

    <section class="panel footer">
      <p>${esc(labels.footer)}</p>
      <p>${esc(labels.sourceDoc)}: ${esc(model.sourcePath)} | ${esc(labels.generated)}: ${esc(model.generatedAt)}</p>
      <p class="print-note">${esc(labels.printNote)}</p>
    </section>
  </main>
</div>
</body>
</html>`;
}

async function main() {
  const { input, out, modelOut, fromModel, locale } = parseArgs(process.argv);
  let sourcePath = null;
  let model = null;
  if (fromModel) {
    const modelPath = path.resolve(fromModel);
    model = JSON.parse(await fs.readFile(modelPath, 'utf8'));
    sourcePath = model.sourcePath || modelPath;
  } else {
    sourcePath = resolveInput(input);
    const doc = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
    model = buildGenericModel(doc, sourcePath);
  }
  model = localizeModel(model, locale);
  const outputPath = defaultOutputPath(sourcePath, out, locale, 'html');
  if (modelOut) {
    const modelPath = defaultOutputPath(sourcePath, modelOut, locale, 'json');
    await fs.mkdir(path.dirname(modelPath), { recursive: true });
    await fs.writeFile(modelPath, `${JSON.stringify(model, null, 2)}\n`);
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, renderHtml(model));
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
