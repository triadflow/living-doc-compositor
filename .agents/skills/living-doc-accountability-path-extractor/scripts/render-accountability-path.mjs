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

function inferGateLens(criterion, related) {
  void related;
  const keySource = [
    criterion.id,
    criterion.name,
    criterion.title,
  ].filter(Boolean).join(' ').toLowerCase();
  const detailSource = [
    criterion.criterion,
    criterion.definition,
  ].filter(Boolean).join(' ').toLowerCase();
  const source = keySource || detailSource;
  const has = (...patterns) => patterns.some((pattern) => pattern.test(source));

  if (has(/shared source|separate path|separate queue|own resources|same raw|queue/)) {
    return {
      name: 'Gedeelde bron, gescheiden verwerkingspad',
      must: 'De nieuwe route moet dezelfde bron kunnen lezen zonder de bestaande verwerking te wijzigen, en moet daarna via eigen wachtrij, werker, opslag, index en bewijsoppervlak lopen.',
      proof: [
        'Architectuur- of Terraformbewijs toont gedeelde bronlezing en gescheiden vervolgmiddelen.',
        'Tests of statische checks bewijzen dat wachtrij, werker en opslag niet samenvallen met productieparser-middelen.',
        'Runbewijs toont dat een bronobject door de nieuwe route kan lopen zonder productieroute-mutatie.',
      ],
      bottleneck: 'Zonder bewijs van padenscheiding blijft onduidelijk wie risico, uitrol en operationele gevolgen bezit.',
    };
  }

  if (has(/preflight|short-circuit|deterministic|candidate_hint|required field|complete/)) {
    return {
      name: 'Deterministische preflight sluit alleen volledige gevallen kort',
      must: 'De deterministische stap mag alleen zonder model doorgaan wanneer verplichte velden compleet zijn, bewijsankers oplossen en er geen conflicten of blokkerende onzekerheden zijn.',
      proof: [
        'Testsets tonen volledige kortsluitgevallen en gevallen die verplicht naar modelverwerking gaan.',
        'Tests bewijzen dat optionele hints niet als beslissend bewijs worden gepromoveerd.',
        'Validatiebewijs toont dat kortgesloten uitvoer dezelfde recordvorm gebruikt als modeluitvoer.',
      ],
      bottleneck: 'Als preflight te ruim accepteert, ontstaat stille datadrift en wordt modelvalidatie omzeild.',
    };
  }

  if (has(/storage|s3|dynamodb|artifact|encrypted|index|reproducible/)) {
    return {
      name: 'Opslagcontract is gescheiden en reproduceerbaar',
      must: 'Bewijsstukken en indexrecords moeten een eigen opslagpad, eigen sleutelvorm, reproduceerbare verwijzingen en controleerbare scheiding van bestaande systemen hebben.',
      proof: [
        'Opslagbewijs toont bewijslocatie, sleutelversie, indexprojectie en versleutelingsgrens.',
        'Tests bewijzen dat records terug te vinden zijn via de afgesproken referenties.',
        'Scheiding van bestaande opslag of tabellen is aantoonbaar in configuratie en runbewijs.',
      ],
      bottleneck: 'Zonder opslagbewijs bestaat er geen duurzame plek waar afsluitbewijs later kan worden gecontroleerd.',
    };
  }

  if (has(/agentic audit|audit|drift|finding|alignment/)) {
    return {
      name: 'Auditloop controleert resultaten',
      must: 'De auditloop moet resultaten, bewijsverwijzingen, validatie-uitkomsten en drift controleren zonder zelf runtime-waarheid te worden.',
      proof: [
        'Auditbewijzen tonen gecontroleerde records, bevindingen, ernst en verwijzing naar bronbewijs.',
        'Tests bewijzen dat audit geen ongeldige uitvoer promoveert tot waarheid.',
        'Opslagbewijs toont dat auditbevindingen later beoordeelbaar blijven.',
      ],
      bottleneck: 'Als audit geen bewijsstuk oplevert, blijft kwaliteitscontrole onzichtbaar en kan zij geen afsluitpoort sluiten.',
    };
  }

  if (has(/batch|metrics|cost|gpu cost|throughput|estimate/)) {
    return {
      name: 'Batchverwerking, metrieken en kosten zijn bewijsbaar',
      must: 'De run moet meetbaar maken hoeveel werk is verwerkt, welke uitvoeringsomgeving is gebruikt, wat fouten kostten en welke kostenaanname onder de afsluitclaim ligt.',
      proof: [
        'Een metriekbewijsstuk bevat aantallen, uitvoeringsduur, foutstatussen en kostenberekening.',
        'Kostenbewijs noemt expliciet de gebruikte compute-aanname.',
        'Afwijkingen of ontbrekende metrieken zijn zichtbaar als review- of risicopunt.',
      ],
      bottleneck: 'Zonder meet- en kostenbewijs kan management geen eerlijke afsluitclaim maken over uitvoerbaarheid of schaalrisico.',
    };
  }

  if (has(/local runtime|lm studio|adapter|runtime adapter|runtime selection/)) {
    return {
      name: 'Lokale uitvoeringsadapter is bruikbaar',
      must: 'De lokale ontwikkelomgeving moet dezelfde contractvorm leveren als de doelomgeving, zonder validatie, opslag of routegedrag te veranderen.',
      proof: [
        'Adaptertests tonen dezelfde omhulsel- en foutvorm voor lokale en doelomgeving.',
        'Een lokale rooktest toont modelaanroep, antwoordverwerking en foutpad.',
        'Bewijs markeert lokale omgeving expliciet als ontwikkelbewijs, niet als productie- of AWS-afsluiting.',
      ],
      bottleneck: 'Als lokaal bewijs als eindbewijs wordt gelezen, ontstaat een valse afsluitclaim voor infrastructuur die nog niet bewezen is.',
    };
  }

  if (has(/normaliz|normalis|html|evidence anchor|source-faithful|email text|raw html/)) {
    return {
      name: 'E-mailnormalisatie bewaart bewijsankers',
      must: 'De normalisatiestap moet ruis verwijderen zonder bronbetekenis, metadata of bewijsankers te verliezen die later nodig zijn voor validatie en beoordeling.',
      proof: [
        'Gouden normalisatiebewijzen tonen input, opgeschoonde tekst, metadata en bewijsankers.',
        'Tests bewijzen dat ruwe HTML niet onnodig naar het model gaat.',
        'Moeilijke bronvoorbeelden hebben beoordeelde fragmenten die aantonen dat relevante gegevens behouden blijven.',
      ],
      bottleneck: 'Zonder brongetrouwe normalisatie kan validatie niet betrouwbaar naar bewijs terugwijzen.',
    };
  }

  if (has(/aws proof|required aws|aws-backed|aws backed|real aws|deployment proof/)) {
    return {
      name: 'AWS-bewijs is verplicht',
      must: 'Er moet een echte AWS-run bestaan die de afsluitclaim draagt. Lokaal bewijs mag ontwikkeling ondersteunen, maar mag deze poort niet vervangen.',
      proof: [
        'Een AWS-runbewijsstuk koppelt bronreferentie, eindpunt, validatieroute, opslagbewijs, metrieken en kosteninschatting.',
        'Het bewijs maakt zichtbaar welke AWS-middelen de run hebben gedragen.',
        'Een beoordelaar kan uit het bewijsstuk afleiden dat dit geen lokale simulatie is.',
      ],
      bottleneck: 'Als AWS-bewijs ontbreekt, kan alleen lokale prototype-afsluiting worden geclaimd; AWS-gedragen afsluiting blijft geblokkeerd.',
    };
  }

  if (has(/production parser unchanged|parser isolation|current production parser|untouched/)) {
    return {
      name: 'Productieparser blijft onaangeraakt',
      must: 'De bestaande productieroute moet aantoonbaar buiten de wijziging blijven: geen gedeelde queue-mutatie, geen wijziging in processorpad, geen gewijzigde productietabel en geen deploymentkoppeling met deze nieuwe route.',
      proof: [
        'Een wijzigings- of beoordelingsbewijs toont dat de bestaande parserroute niet is aangepast.',
        'Tests of statische checks bewijzen dat de nieuwe route eigen middelen en eigen uitvoer gebruikt.',
        'Uitrolbewijs toont dat productieparser en nieuwe verwerking onafhankelijk blijven.',
      ],
      bottleneck: 'Zonder isolatiebewijs kan de nieuwe route niet als af worden beschouwd, omdat sluiting dan impliciet leunt op een productierisico dat niet is geaccepteerd.',
    };
  }

  if (has(/validated output|validated extraction|schema|contract|extraction-result|validation|accepted|review|rejected/)) {
    return {
      name: 'Uitvoer is gevalideerd en routeerbaar',
      must: 'Elke uitvoer moet een stabiele recordvorm hebben met validatiestatus, bewijsverwijzingen, route, versievelden en bewijsstukverwijzingen voordat zij als afsluitbewijs telt.',
      proof: [
        'Contracttests accepteren geldige records en weigeren drift in omhulsel, route, bewijsverwijzing of verplichte velden.',
        'Testsets tonen geaccepteerde, te beoordelen en afgewezen uitvoer.',
        'Opslag- en indexbewijs tonen waar de gevalideerde uitvoer terug te vinden is.',
      ],
      bottleneck: 'Zonder validatiecontract kan modeluitvoer activiteit lijken, maar geen afsluitbewijs worden.',
    };
  }

  if (has(/production parser unchanged|parser isolation|current production parser|untouched/)) {
    return {
      name: 'Productieparser blijft onaangeraakt',
      must: 'De bestaande productieroute moet aantoonbaar buiten de wijziging blijven: geen gedeelde queue-mutatie, geen wijziging in processorpad, geen gewijzigde productietabel en geen deploymentkoppeling met deze nieuwe route.',
      proof: [
        'Een wijzigings- of beoordelingsbewijs toont dat de bestaande parserroute niet is aangepast.',
        'Tests of statische checks bewijzen dat de nieuwe route eigen middelen en eigen uitvoer gebruikt.',
        'Uitrolbewijs toont dat productieparser en nieuwe verwerking onafhankelijk blijven.',
      ],
      bottleneck: 'Zonder isolatiebewijs kan de nieuwe route niet als af worden beschouwd, omdat sluiting dan impliciet leunt op een productierisico dat niet is geaccepteerd.',
    };
  }

  if (has(/aws proof|required aws|aws-backed|aws backed|real aws|deployment proof/)) {
    return {
      name: 'AWS-bewijs is verplicht',
      must: 'Er moet een echte AWS-run bestaan die de afsluitclaim draagt. Lokaal bewijs mag ontwikkeling ondersteunen, maar mag deze poort niet vervangen.',
      proof: [
        'Een AWS-runbewijsstuk koppelt bronreferentie, eindpunt, validatieroute, opslagbewijs, metrieken en kosteninschatting.',
        'Het bewijs maakt zichtbaar welke AWS-middelen de run hebben gedragen.',
        'Een beoordelaar kan uit het bewijsstuk afleiden dat dit geen lokale simulatie is.',
      ],
      bottleneck: 'Als AWS-bewijs ontbreekt, kan alleen lokale prototype-afsluiting worden geclaimd; AWS-gedragen afsluiting blijft geblokkeerd.',
    };
  }

  if (has(/vllm|gpu|inference server|openai-compatible|openai compatible|model server/)) {
    return {
      name: 'Inferentieserver draait op doelinfrastructuur',
      must: 'De modelserver moet bereikbaar zijn via de afgesproken API-vorm en dezelfde validatie- en routegrenzen gebruiken als de rest van het afsluitpad.',
      proof: [
        'Een rooktest toont eindpunt, modelidentiteit, verzoek, antwoord, foutgedrag en timeoutgedrag.',
        'Configuratiebewijs toont dat runtimekeuze niet in applicatielogica is verstopt.',
        'Resourcebewijs toont welke compute-keuze de server draagt.',
      ],
      bottleneck: 'Zonder gekozen en bewezen compute-primitief kan infrastructuurafsluiting niet worden bewezen.',
    };
  }

  if (has(/local runtime|lm studio|adapter|runtime adapter|runtime selection/)) {
    return {
      name: 'Lokale uitvoeringsadapter is bruikbaar',
      must: 'De lokale ontwikkelomgeving moet dezelfde contractvorm leveren als de doelomgeving, zonder validatie, opslag of routegedrag te veranderen.',
      proof: [
        'Adaptertests tonen dezelfde omhulsel- en foutvorm voor lokale en doelomgeving.',
        'Een lokale rooktest toont modelaanroep, antwoordverwerking en foutpad.',
        'Bewijs markeert lokale omgeving expliciet als ontwikkelbewijs, niet als productie- of AWS-afsluiting.',
      ],
      bottleneck: 'Als lokaal bewijs als eindbewijs wordt gelezen, ontstaat een valse afsluitclaim voor infrastructuur die nog niet bewezen is.',
    };
  }

  if (has(/normaliz|normalis|html|evidence anchor|source-faithful|email text|raw html/)) {
    return {
      name: 'E-mailnormalisatie bewaart bewijsankers',
      must: 'De normalisatiestap moet ruis verwijderen zonder bronbetekenis, metadata of bewijsankers te verliezen die later nodig zijn voor validatie en beoordeling.',
      proof: [
        'Gouden normalisatiebewijzen tonen input, opgeschoonde tekst, metadata en bewijsankers.',
        'Tests bewijzen dat ruwe HTML niet onnodig naar het model gaat.',
        'Moeilijke bronvoorbeelden hebben beoordeelde fragmenten die aantonen dat relevante gegevens behouden blijven.',
      ],
      bottleneck: 'Zonder brongetrouwe normalisatie kan validatie niet betrouwbaar naar bewijs terugwijzen.',
    };
  }

  if (has(/validated output|schema|contract|extraction-result|validation|accepted|review|rejected/)) {
    return {
      name: 'Uitvoer is gevalideerd en routeerbaar',
      must: 'Elke uitvoer moet een stabiele recordvorm hebben met validatiestatus, bewijsverwijzingen, route, versievelden en bewijsstukverwijzingen voordat zij als afsluitbewijs telt.',
      proof: [
        'Contracttests accepteren geldige records en weigeren drift in omhulsel, route, bewijsverwijzing of verplichte velden.',
        'Testsets tonen geaccepteerde, te beoordelen en afgewezen uitvoer.',
        'Opslag- en indexbewijs tonen waar de gevalideerde uitvoer terug te vinden is.',
      ],
      bottleneck: 'Zonder validatiecontract kan modeluitvoer activiteit lijken, maar geen afsluitbewijs worden.',
    };
  }

  if (has(/batch|metrics|cost|gpu cost|runtime|throughput|estimate/)) {
    return {
      name: 'Batchverwerking, metrieken en kosten zijn bewijsbaar',
      must: 'De run moet meetbaar maken hoeveel werk is verwerkt, welke uitvoeringsomgeving is gebruikt, wat fouten kostten en welke kostenaanname onder de afsluitclaim ligt.',
      proof: [
        'Een metriekbewijsstuk bevat aantallen, uitvoeringsduur, foutstatussen en kostenberekening.',
        'Kostenbewijs noemt expliciet de gebruikte compute-aanname.',
        'Afwijkingen of ontbrekende metrieken zijn zichtbaar als review- of risicopunt.',
      ],
      bottleneck: 'Zonder meet- en kostenbewijs kan management geen eerlijke afsluitclaim maken over uitvoerbaarheid of schaalrisico.',
    };
  }

  if (has(/agentic audit|audit|drift|finding|alignment/)) {
    return {
      name: 'Auditloop controleert resultaten',
      must: 'De auditloop moet resultaten, bewijsverwijzingen, validatie-uitkomsten en drift controleren zonder zelf runtime-waarheid te worden.',
      proof: [
        'Auditbewijzen tonen gecontroleerde records, bevindingen, ernst en verwijzing naar bronbewijs.',
        'Tests bewijzen dat audit geen ongeldige uitvoer promoveert tot waarheid.',
        'Opslagbewijs toont dat auditbevindingen later beoordeelbaar blijven.',
      ],
      bottleneck: 'Als audit geen bewijsstuk oplevert, blijft kwaliteitscontrole onzichtbaar en kan zij geen afsluitpoort sluiten.',
    };
  }

  if (has(/storage|s3|dynamodb|artifact|encrypted|index|reproducible/)) {
    return {
      name: 'Opslagcontract is gescheiden en reproduceerbaar',
      must: 'Bewijsstukken en indexrecords moeten een eigen opslagpad, eigen sleutelvorm, reproduceerbare verwijzingen en controleerbare scheiding van bestaande systemen hebben.',
      proof: [
        'Opslagbewijs toont bewijslocatie, sleutelversie, indexprojectie en versleutelingsgrens.',
        'Tests bewijzen dat records terug te vinden zijn via de afgesproken referenties.',
        'Scheiding van bestaande opslag of tabellen is aantoonbaar in configuratie en runbewijs.',
      ],
      bottleneck: 'Zonder opslagbewijs bestaat er geen duurzame plek waar afsluitbewijs later kan worden gecontroleerd.',
    };
  }

  if (has(/preflight|short-circuit|deterministic|candidate_hint|required field|complete/)) {
    return {
      name: 'Deterministische preflight sluit alleen volledige gevallen kort',
      must: 'De deterministische stap mag alleen zonder model doorgaan wanneer verplichte velden compleet zijn, bewijsankers oplossen en er geen conflicten of blokkerende onzekerheden zijn.',
      proof: [
        'Testsets tonen volledige kortsluitgevallen en gevallen die verplicht naar modelverwerking gaan.',
        'Tests bewijzen dat optionele hints niet als beslissend bewijs worden gepromoveerd.',
        'Validatiebewijs toont dat kortgesloten uitvoer dezelfde recordvorm gebruikt als modeluitvoer.',
      ],
      bottleneck: 'Als preflight te ruim accepteert, ontstaat stille datadrift en wordt modelvalidatie omzeild.',
    };
  }

  if (has(/shared source|separate path|separate queue|own resources|same raw|queue/)) {
    return {
      name: 'Gedeelde bron, gescheiden verwerkingspad',
      must: 'De nieuwe route moet dezelfde bron kunnen lezen zonder de bestaande verwerking te wijzigen, en moet daarna via eigen wachtrij, werker, opslag, index en bewijsoppervlak lopen.',
      proof: [
        'Architectuur- of Terraformbewijs toont gedeelde bronlezing en gescheiden vervolgmiddelen.',
        'Tests of statische checks bewijzen dat wachtrij, werker en opslag niet samenvallen met productieparser-middelen.',
        'Runbewijs toont dat een bronobject door de nieuwe route kan lopen zonder productieroute-mutatie.',
      ],
      bottleneck: 'Zonder bewijs van padenscheiding blijft onduidelijk wie risico, uitrol en operationele gevolgen bezit.',
    };
  }

  if (has(/terraform|iam|resource|deploy|environment|infrastructure/)) {
    return {
      name: 'Infrastructuur is reviewbaar vastgelegd',
      must: 'De benodigde infrastructuur moet als beoordeelbare configuratie bestaan, met eigenaarschap, toegangsgrenzen, uitrolpad en rollback- of risicopad.',
      proof: [
        'Configuratiebewijs toont resources, permissies, omgeving en uitrolstap.',
        'Reviewbewijs bevestigt dat resourcegrenzen en eigenaarschap zijn geaccepteerd.',
        'Een run- of planartifact toont dat de configuratie uitvoerbaar is.',
      ],
      bottleneck: 'Zonder infrastructuurreview blijft afsluiting afhankelijk van een niet-bewezen omgeving.',
    };
  }

  if (has(/test|fixture|coverage|golden/)) {
    return {
      name: 'Test- en fixturebewijs sluit de poort',
      must: 'De poort moet door gerichte tests en representatieve fixtures aantonen dat het gevraagde gedrag herhaalbaar is.',
      proof: [
        'Testuitvoer toont welke contracten en randgevallen zijn geraakt.',
        'Fixtures zijn traceerbaar naar het gedrag dat zij moeten bewijzen.',
        'Ontbrekende coverage is zichtbaar als open bewijs- of acceptatiepunt.',
      ],
      bottleneck: 'Zonder gericht testbewijs blijft de poort afhankelijk van interpretatie in plaats van herhaalbare controle.',
    };
  }

  throw new Error(`Geen specifieke Nederlandse poortlens voor acceptatiecriterium: ${criterion.id || criterion.name || criterion.title || 'zonder id'}. Voeg een lens toe of lever een expliciet accountability-model aan; de renderer publiceert geen generieke fallbacktekst.`);
}

function buildGenericModel(doc, sourcePath) {
  const criteria = cards(doc, 'acceptance-criteria');
  const gates = [];
  gates.push({
    name: 'Afsluitlabel en reikwijdtegrens',
    state: 'open',
    must: 'De afsluitclaim moet gekoppeld zijn aan het doel, de succesvoorwaarde en de acceptatiecriteria van het levende document. Die koppeling moet bewezen zijn of expliciet zijn verwijderd met benoemd risico.',
    proof: ['De verantwoordingspagina koppelt het afsluitlabel aan expliciete afsluitpoorten.', 'Elke verwijderde of afgewaardeerde reikwijdte legt geaccepteerd risico en de ongeldig gemaakte afsluitclaim vast.'],
    bottleneck: 'Het gevraagde afsluitantwoord is onverenigbaar met de definitie van af tenzij alle vereiste poorten bewezen zijn of expliciet zijn verwijderd met benoemd risico.',
    types: ['decision work', 'risk acceptance work', 'proof/evidence work'],
    owner: 'Eigenaar vereist: product/technisch eigenaar voor reikwijdteverwijdering, risicoafwaardering of acceptatie van het afsluitlabel.',
    refs: ['objective', 'successCondition'],
  });

  for (const [index, criterion] of criteria.entries()) {
    const related = [...relatedByCriterion(doc, criterion), ...relatedByTicket(doc, criterion)];
    const uniqueRelated = [...new Map(related.map((entry) => [`${entry.section.id}:${entry.card.id}`, entry])).values()];
    const criterionText = criterion.criterion || criterion.definition || textOf(criterion);
    const state = inferState(criterion, uniqueRelated);
    const lens = inferGateLens(criterion, uniqueRelated);
    const gaps = [
      ...arr(criterion.gaps).map(textOf),
      ...arr(criterion.gap).map(textOf),
      ...summarizeRelated(uniqueRelated, ['blockers', 'gaps', 'gap', 'nextStep']),
    ].filter(Boolean);
    const types = accountabilityTypes(criterionText, uniqueRelated);
    gates.push({
      name: lens.name,
      state,
      must: lens.must,
      proof: lens.proof,
      bottleneck: gaps.length
        ? lens.bottleneck
        : lens.bottleneck,
      types,
      owner: ownerRequiredFor(types, `${criterionText} ${gaps.join(' ')}`)
        ? `Eigenaar vereist: eigenaar voor ${types.filter((type) => type !== 'implementation work' && type !== 'proof/evidence work').map((type) => typeLabel(type, 'nl')).join(', ') || 'acceptatie'} is niet uit het document afleidbaar.`
        : 'Implementatie-eigenaar is afleidbaar uit gerelateerde code- en testvlakken; acceptatie-eigenaar is niet uit het document afleidbaar.',
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
    invalid: ['Activiteit, planning, uitsluitend lokaal bewijs of discussie sluit geen poort tenzij het op die poort als bewijsstuk is benoemd.'],
  };
  const finishLabel = 'het doel, de succesvoorwaarde, acceptatiecriteria, bewijsstukken en expliciete risicoacceptaties die in het levende document zijn benoemd.';
  return {
    sourcePath,
    title: doc.title || path.basename(sourcePath, '.json'),
    displayTitle: 'Wanneer is het af?',
    subtitle: doc.subtitle || '',
    updated: doc.updated || '',
    objective: doc.objective || '',
    successCondition: doc.successCondition || '',
    generatedAt: new Date().toISOString(),
    accountabilityReadout: 'Dit is geen enkele implementatietaak. Het levende document definieert voltooiing als een set bewijs-poorten. Sommige poorten zijn codewerk, maar andere vereisen besluiten, acceptatie-eigenaarschap, infrastructuur, toegang tot middelen, bewijs, beoordeling, operationeel eigenaarschap, risicoacceptatie of expliciete reikwijdteverwijdering.',
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
      owner: gate.owner.toLowerCase().includes('eigenaar vereist') ? gate.owner : 'Eigenaar vereist: acceptatie-eigenaar is niet uit het document afleidbaar.',
      ifSkipped: index === 0
        ? `Als dit wordt overgeslagen, moet de afsluitclaim worden afgewaardeerd; "${modelFinishWord(doc)}" kan niet eerlijk worden geclaimd.`
        : `Als dit wordt overgeslagen, kan ${gate.name} niet als gesloten worden geteld.`,
    })),
    proofLedger,
    finishLabel,
    finishCheck: 'Het gevraagde afsluitantwoord is onverenigbaar met de huidige definitie van af tenzij de vereiste bewijs-poorten zijn afgerond of expliciet zijn verwijderd met benoemd risico.',
    managerSummary: `${gates.length} poorten blijven over in het verantwoordingspad, en ${nonImplementationCount} zijn niet alleen van implementatie afhankelijk. De blokkerende poorten zijn ${blocked.slice(0, 4).map((gate) => gate.name).join(', ')}${blocked.length > 4 ? ', plus aanvullende poorten waarvoor eigenaarschap vereist is' : ''}. Afsluiting vereist bewijsstukken en eigenaarschapsbesluiten, geen datumgok.`,
  };
}

function modelFinishWord(doc) {
  if (doc.title?.toLowerCase().includes('mvp')) return 'MVP af';
  return 'af';
}

const UI = {
  nl: {
    lang: 'nl',
    pageTitleSuffix: 'Verantwoordingspad',
    navReadout: 'Uitlezing',
    navDashboard: 'Overzicht',
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
    closureIntro: 'De volgorde hieronder is het kleinste eerlijke pad naar de gedocumenteerde succesvoorwaarde. Lokaal implementatiewerk is zichtbaar, maar infrastructuur, beoordeling, acceptatie, kosten, uitrol en bewijs-eigenaarschap worden niet tot implementatie gereduceerd.',
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
    printNote: 'Printnotitie: bronpad en gegenereerde timestamp blijven bewaard als beoordelingsbewijs.',
  },
};

const STATUS_LABELS = {
  nl: { closed: 'gesloten', partial: 'gedeeltelijk', open: 'open', blocked: 'geblokkeerd', unclear: 'onduidelijk' },
};

const TYPE_LABELS = {
  nl: {
    'implementation work': 'implementatiewerk',
    'decision work': 'besluitwerk',
    'review and acceptance work': 'beoordelings- en acceptatiewerk',
    'infrastructure/resource work': 'infrastructuur- en middelenwerk',
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

function renderDossierHtml(model) {
  const locale = 'nl';
  const chip = (text, cls = '') => `<span class="chip ${cls}">${esc(text)}</span>`;
  const list = (items, empty = 'Geen bewijsregel vastgelegd.') => {
    const safeItems = (items || []).filter(Boolean);
    if (!safeItems.length) return `<p>${esc(empty)}</p>`;
    return `<ul>${safeItems.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
  };
  const stateClass = (state) => `state-${slug(state)}`;
  const typeHtml = (types) => types.map((type) => chip(typeLabel(type, locale), 'type')).join('');
  const statusOrder = ['closed', 'partial', 'open', 'blocked', 'unclear'];
  const proofColumns = [
    ['Bewezen', model.proofLedger.proven],
    ['Gedeeltelijk', model.proofLedger.partial],
    ['Ontbreekt', model.proofLedger.missing],
    ['Ongeldig als afsluiting', model.proofLedger.invalid],
  ];

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.displayTitle || 'Wanneer is het af?')}</title>
<style>
  :root {
    --paper: #fffdf8;
    --paper-soft: #faf6ed;
    --bg: #e8e1d4;
    --ink: #1e211c;
    --muted: #696354;
    --faint: #9b927f;
    --rule: #d8cbb8;
    --rule-dark: #3b3429;
    --accent: #9d2d22;
    --accent-soft: #f5e3dc;
    --gold: #9a6a16;
    --gold-soft: #f6ead1;
    --blue: #295d73;
    --blue-soft: #e3eef1;
    --green: #2f734f;
    --green-soft: #e4f0e7;
    --gray-soft: #ece7dc;
    --shadow: 0 28px 70px rgba(53, 39, 20, 0.18);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.65 Georgia, "Times New Roman", serif; }
  body, .page, header, main, aside, section, article, div, p, li, span { min-width: 0; overflow-wrap: anywhere; }
  a { color: inherit; text-decoration-thickness: 1px; text-underline-offset: 3px; }
  .page { max-width: 1180px; margin: 0 auto; padding: 26px 18px 42px; }
  .sheet { background: var(--paper); border: 1px solid var(--rule); box-shadow: var(--shadow); }
  header { padding: 34px 38px 28px; border-top: 8px solid var(--rule-dark); border-bottom: 3px double var(--rule-dark); }
  .kicker, .label, nav, .chip, .folio, .stamp, .metric, .footer { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .kicker { color: var(--accent); text-transform: uppercase; font-size: 12px; font-weight: 850; letter-spacing: .08em; }
  h1 { margin: 6px 0 6px; font-size: clamp(42px, 7vw, 84px); line-height: .96; letter-spacing: 0; }
  .dek { max-width: 760px; color: var(--muted); font-size: 20px; line-height: 1.45; }
  .stamp { display: grid; grid-template-columns: 1.2fr 1fr .8fr; gap: 10px; margin-top: 26px; }
  .stamp div { min-height: 74px; padding: 12px 13px; border: 1px solid var(--rule); background: var(--paper-soft); }
  .label { display: block; color: var(--faint); font-size: 11px; font-weight: 850; text-transform: uppercase; letter-spacing: .08em; }
  .value { display: block; margin-top: 7px; color: var(--ink); font-weight: 780; }
  .body { display: grid; grid-template-columns: 278px minmax(0, 1fr); gap: 30px; padding: 28px 38px 36px; }
  aside { position: sticky; top: 18px; align-self: start; }
  nav { display: grid; gap: 7px; margin-bottom: 18px; }
  nav a { padding: 8px 0; border-bottom: 1px solid var(--rule); color: var(--muted); font-size: 13px; font-weight: 760; text-decoration: none; }
  nav a:hover { color: var(--accent); }
  .verdict { padding: 18px; border: 2px solid var(--accent); background: var(--accent-soft); }
  .verdict strong { display: block; margin-bottom: 7px; font-size: 21px; line-height: 1.15; }
  .verdict p { margin: 0; font-size: 15px; line-height: 1.45; }
  .sidebox { margin-top: 16px; padding: 16px; border: 1px solid var(--rule); background: var(--paper-soft); }
  .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  .metric { padding: 10px; border: 1px solid var(--rule); background: var(--paper); }
  .metric strong { display: block; font-size: 27px; line-height: 1; }
  .metric span { color: var(--muted); font-size: 12px; text-transform: capitalize; }
  main { display: grid; gap: 28px; }
  section { border-top: 2px solid var(--rule-dark); padding-top: 18px; }
  h2 { display: flex; gap: 12px; align-items: baseline; margin: 0 0 14px; font-size: 30px; line-height: 1.1; letter-spacing: 0; }
  h3 { margin: 0; font-size: 22px; line-height: 1.18; letter-spacing: 0; }
  p { margin: 0; }
  p + p { margin-top: 11px; }
  .number { color: var(--accent); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; font-weight: 850; }
  .memo { columns: 2 290px; column-gap: 28px; color: #2d2b25; }
  .memo p { break-inside: avoid; }
  .gate-list { display: grid; gap: 16px; }
  .criterion { display: grid; grid-template-columns: 68px minmax(0, 1fr); border: 1px solid var(--rule); background: #fffaf0; }
  .folio { padding: 15px 10px; border-right: 1px solid var(--rule); color: var(--accent); font-size: 12px; font-weight: 850; text-align: center; }
  .criterion-body { padding: 17px 18px 18px; }
  .criterion-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: start; margin-bottom: 12px; }
  .chiprow { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
  .chip { display: inline-flex; align-items: center; min-height: 25px; max-width: 100%; padding: 4px 9px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); font-size: 12px; font-weight: 790; }
  .chip.type { background: var(--blue-soft); border-color: #bfd2d9; color: #224e60; }
  .chip.owner { background: var(--accent-soft); border-color: #deb4ac; color: var(--accent); }
  .state-closed { color: var(--green); background: var(--green-soft); border-color: #b7d6c0; }
  .state-partial { color: var(--gold); background: var(--gold-soft); border-color: #e2c88f; }
  .state-open { color: var(--blue); background: var(--blue-soft); border-color: #bfd2d9; }
  .state-blocked { color: var(--accent); background: var(--accent-soft); border-color: #deb4ac; }
  .state-unclear { color: #605848; background: var(--gray-soft); border-color: var(--rule); }
  .evidence-box { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); gap: 12px; margin-top: 14px; }
  .evidence-box > div, .bottleneck, .ledger-card, .summary { padding: 14px; border: 1px solid var(--rule); background: var(--paper); }
  .evidence-box > div:nth-child(2) { background: #fff5f1; border-color: #dfbdb5; }
  ul { margin: 8px 0 0; padding-left: 19px; }
  li + li { margin-top: 6px; }
  .bottleneck-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  .bottleneck { border-left: 6px solid var(--accent); }
  .ledger { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .ledger-card:nth-child(1) { border-top: 5px solid var(--green); }
  .ledger-card:nth-child(2) { border-top: 5px solid var(--gold); }
  .ledger-card:nth-child(3) { border-top: 5px solid var(--blue); }
  .ledger-card:nth-child(4) { border-top: 5px solid var(--accent); }
  .summary { background: #fff7ed; border-left: 6px solid var(--gold); font-size: 20px; line-height: 1.5; }
  .footer { margin-top: 34px; padding-top: 16px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 12px; }
  @media (max-width: 900px) {
    .page { padding: 0; }
    .sheet { border-left: 0; border-right: 0; box-shadow: none; }
    header { padding: 26px 20px 22px; }
    .stamp, .body, .criterion, .criterion-head, .evidence-box, .bottleneck-list, .ledger { grid-template-columns: 1fr; }
    .body { padding: 22px 20px 30px; gap: 24px; }
    aside { position: static; }
    .folio { border-right: 0; border-bottom: 1px solid var(--rule); text-align: left; }
    .memo { columns: auto; }
  }
  @media print {
    body { background: #fff; }
    .page { max-width: none; padding: 0; }
    .sheet { border: 0; box-shadow: none; }
    aside { position: static; }
    .criterion, .bottleneck, .ledger-card, .summary { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="sheet">
    <header>
      <div class="kicker">Bewijsdossier</div>
      <h1>${esc(model.displayTitle || 'Wanneer is het af?')}</h1>
      <p class="dek">Formele afsluitnotitie voor bewijs, eigenaarschap, knelpunten en resterende poorten.</p>
      <div class="stamp">
        <div><span class="label">Brondocument</span><span class="value">Gekoppeld levend document</span></div>
        <div><span class="label">Gegenereerd</span><span class="value">${esc(model.generatedAt)}</span></div>
        <div><span class="label">Poorten</span><span class="value">${model.gates.length}</span></div>
      </div>
    </header>

    <div class="body">
      <aside>
        <nav aria-label="Paginadelen">
          <a href="#memo">1. Memo</a>
          <a href="#poorten">2. Afsluitpoorten</a>
          <a href="#knelpunten">3. Knelpunten</a>
          <a href="#bewijs">4. Bewijsboekhouding</a>
          <a href="#samenvatting">5. Samenvatting</a>
        </nav>
        <div class="verdict">
          <strong>Niet te reduceren tot een datum.</strong>
          <p>${esc(model.schedulingBasis)}</p>
        </div>
        <div class="sidebox">
          <span class="label">Alleen implementatie</span>
          <span class="value">${esc(model.implementationAlone)}</span>
          <div class="metrics">
            ${statusOrder.map((state) => `<div class="metric ${stateClass(state)}"><strong>${model.statusCounts[state] || 0}</strong><span>${esc(statusLabel(state, locale))}</span></div>`).join('')}
            <div class="metric"><strong>${model.ownerRequiredCount}</strong><span>eigenaar vereist</span></div>
          </div>
        </div>
      </aside>

      <main>
        <section id="memo">
          <h2><span class="number">1</span> Memo</h2>
          <div class="memo">
            <p>${esc(model.accountabilityReadout)}</p>
            <p>Het afsluitlabel betekent hier: ${esc(model.finishLabel)}</p>
            <p>${esc(model.finishCheck)}</p>
          </div>
        </section>

        <section id="poorten">
          <h2><span class="number">2</span> Afsluitpoorten</h2>
          <div class="gate-list">
            ${model.gates.map((gate, index) => `<article class="criterion" id="poort-${index + 1}">
              <div class="folio">Poort ${index + 1}</div>
              <div class="criterion-body">
                <div class="criterion-head">
                  <h3>${esc(gate.name)}</h3>
                  ${chip(statusLabel(gate.state, locale), stateClass(gate.state))}
                </div>
                <p>${esc(gate.must)}</p>
                <div class="evidence-box">
                  <div>
                    <span class="label">Vereist bewijs</span>
                    ${list(gate.proof)}
                  </div>
                  <div>
                    <span class="label">Knelpunt en eigenaar</span>
                    <p>${esc(gate.bottleneck)}</p>
                    <p>${esc(gate.owner)}</p>
                  </div>
                </div>
                <div class="chiprow">${typeHtml(gate.types)}${gate.owner.toLowerCase().includes('eigenaar vereist') ? chip('Eigenaar vereist', 'owner') : ''}</div>
              </div>
            </article>`).join('\n')}
          </div>
        </section>

        <section id="knelpunten">
          <h2><span class="number">3</span> Knelpunten</h2>
          <div class="bottleneck-list">
            ${(model.bottlenecks || []).length ? model.bottlenecks.map((bottleneck) => `<article class="bottleneck">
              <h3>${esc(bottleneck.name)}</h3>
              <p><strong>Blokkeert:</strong> ${esc(bottleneck.blocks)}</p>
              <p><strong>Waarom dit een knelpunt is:</strong> ${esc(bottleneck.why)}</p>
              <p><strong>Eigenaar vereist:</strong> ${esc(bottleneck.owner)}</p>
              <p><strong>Als dit wordt overgeslagen:</strong> ${esc(bottleneck.ifSkipped)}</p>
            </article>`).join('\n') : '<p>Geen knelpuntkaart vastgelegd.</p>'}
          </div>
        </section>

        <section id="bewijs">
          <h2><span class="number">4</span> Bewijsboekhouding</h2>
          <div class="ledger">
            ${proofColumns.map(([title, items]) => `<article class="ledger-card">
              <h3>${esc(title)}</h3>
              ${list(items)}
            </article>`).join('\n')}
          </div>
        </section>

        <section id="samenvatting">
          <h2><span class="number">5</span> Samenvatting</h2>
          <div class="summary">${esc(model.managerSummary)}</div>
        </section>

        <div class="footer">
          <p>Gegenereerd uit het Nederlandse verantwoordingsmodel. Bronpad, bronverwijzingen en ruwe kaartkoppelingen staan in het JSON-bestand.</p>
        </div>
      </main>
    </div>
  </div>
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
  await fs.writeFile(outputPath, renderDossierHtml(model));
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
