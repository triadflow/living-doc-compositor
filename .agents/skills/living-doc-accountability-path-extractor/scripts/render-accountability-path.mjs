#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

function usage() {
  return `Usage:
  node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs <doc.json|doc.html|file://...> [--locale en|nl|id]

Examples:
  node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs docs/workstream.json --locale en
  node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs file:///path/to/workstream.html#status-snapshot --locale nl

This updates the living doc JSON in place with an accountability closure-path section and renders the normal living doc HTML. It does not create a standalone accountability dossier.`;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    process.exit(args.length ? 0 : 1);
  }
  let input = null;
  let locale = 'nl';
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out' || args[i] === '--model-out' || args[i] === '--from-model') {
      throw new Error(`${args[i]} is no longer supported. This skill only integrates into the living doc and rerenders the living doc HTML.`);
    } else if (args[i] === '--locale') {
      locale = args[i + 1];
      i += 1;
    } else {
      if (input) throw new Error(`Unexpected extra input: ${args[i]}`);
      input = args[i];
    }
  }
  if (!['en', 'nl', 'id'].includes(locale)) throw new Error('Expected --locale en, --locale nl, or --locale id.');
  if (!input) throw new Error('Expected a living doc input.');
  return { input, locale };
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

  throw new Error(`Geen specifieke poortlens voor acceptatiecriterium: ${criterion.id || criterion.name || criterion.title || 'zonder id'}. Voeg een specifieke lens met Engelse, Nederlandse en Bahasa Indonesia-tekst toe; de renderer publiceert geen generieke tekst.`);
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

function localizeModel(model, locale) {
  if (!['en', 'nl', 'id'].includes(locale)) throw new Error('Expected locale en, nl, or id.');
  return {
    ...model,
    locale,
    schema: 'living-doc-accountability-path/v1',
  };
}

const ml = (en, nl, id) => ({ en, nl, id });

const SECTION_TEXT = {
  title: ml('When is it done?', 'Wanneer is het af?', 'Kapan selesai?'),
  calloutTitle: ml('Not reducible to a date', 'Niet te reduceren tot een datum', 'Tidak bisa direduksi menjadi tanggal'),
  schedulingBasis: ml(
    'This cannot be honestly reduced to a date from the current document. The remaining finish condition is a set of proof gates.',
    'Dit kan vanuit het huidige document niet eerlijk tot een datum worden gereduceerd. De resterende afrondingsvoorwaarde is een set bewijs-poorten.',
    'Dari dokumen saat ini, ini tidak bisa secara jujur direduksi menjadi tanggal. Syarat penyelesaiannya adalah sekumpulan gerbang bukti.'
  ),
  readout: ml(
    'This is not a single implementation task. The living doc defines completion as proof gates, with coding work separated from decisions, acceptance, infrastructure, access, evidence, operational ownership, risk acceptance, or explicit scope removal.',
    'Dit is geen enkele implementatietaak. Het levende document definieert voltooiing als bewijs-poorten, waarbij codewerk gescheiden blijft van besluiten, acceptatie, infrastructuur, toegang, bewijs, operationeel eigenaarschap, risicoacceptatie of expliciete reikwijdteverwijdering.',
    'Ini bukan satu tugas implementasi. Living doc mendefinisikan selesai sebagai gerbang bukti, dengan pekerjaan kode dipisahkan dari keputusan, penerimaan, infrastruktur, akses, bukti, kepemilikan operasional, penerimaan risiko, atau penghapusan cakupan secara eksplisit.'
  ),
  implementationAlone: ml('Implementation alone', 'Alleen implementatie', 'Implementasi saja'),
  ownerRequired: ml('Owner required', 'Eigenaar vereist', 'Pemilik diperlukan'),
  gates: ml('Gates', 'Poorten', 'Gerbang'),
  nonImplementation: ml('Non-implementation gates', 'Niet-implementatiepoorten', 'Gerbang non-implementasi'),
};

const TYPE_LABELS_I18N = {
  'implementation work': ml('implementation work', 'implementatiewerk', 'pekerjaan implementasi'),
  'decision work': ml('decision work', 'besluitwerk', 'pekerjaan keputusan'),
  'review and acceptance work': ml('review and acceptance work', 'beoordelings- en acceptatiewerk', 'pekerjaan tinjauan dan penerimaan'),
  'infrastructure/resource work': ml('infrastructure/resource work', 'infrastructuur- en middelenwerk', 'pekerjaan infrastruktur/sumber daya'),
  'access/funding work': ml('access/funding work', 'toegang/financiering', 'akses/pendanaan'),
  'risk acceptance work': ml('risk acceptance work', 'risicoacceptatie', 'penerimaan risiko'),
  'proof/evidence work': ml('proof/evidence work', 'bewijswerk', 'pekerjaan bukti'),
  'operational ownership work': ml('operational ownership work', 'operationeel eigenaarschap', 'kepemilikan operasional'),
};

function typeLabel(type, locale) {
  const label = TYPE_LABELS_I18N[type]?.[locale];
  if (!label) throw new Error(`No ${locale} accountability type label for "${type}". Add an explicit translation; no fallback is allowed.`);
  return label;
}

const GATE_I18N = {
  'Afsluitlabel en reikwijdtegrens': {
    name: ml('Finish label and scope boundary', 'Afsluitlabel en reikwijdtegrens', 'Label selesai dan batas cakupan'),
    must: ml(
      'The finish claim must be tied to the objective, success condition, and acceptance criteria. That connection must be proven or explicitly removed with named risk.',
      'De afsluitclaim moet gekoppeld zijn aan het doel, de succesvoorwaarde en de acceptatiecriteria. Die koppeling moet bewezen zijn of expliciet zijn verwijderd met benoemd risico.',
      'Klaim selesai harus terikat pada tujuan, kondisi sukses, dan kriteria penerimaan. Kaitan itu harus dibuktikan atau dihapus secara eksplisit dengan risiko bernama.'
    ),
    proof: [
      ml('The accountability section links the finish label to explicit closure gates.', 'De verantwoordingssectie koppelt het afsluitlabel aan expliciete afsluitpoorten.', 'Seksi akuntabilitas mengaitkan label selesai dengan gerbang penutupan eksplisit.'),
      ml('Removed or downgraded scope records accepted risk and the finish claim it invalidates.', 'Verwijderde of afgewaardeerde reikwijdte legt geaccepteerd risico en de ongeldig gemaakte afsluitclaim vast.', 'Cakupan yang dihapus atau diturunkan mencatat risiko yang diterima dan klaim selesai yang menjadi tidak sah.')
    ],
    bottleneck: ml('The finish answer is incompatible with the current closure definition until every required gate is proven or explicitly removed with named risk.', 'Het afsluitantwoord is onverenigbaar met de huidige definitie van af totdat elke vereiste poort bewezen is of expliciet is verwijderd met benoemd risico.', 'Jawaban selesai tidak cocok dengan definisi penutupan saat ini sampai setiap gerbang wajib terbukti atau dihapus secara eksplisit dengan risiko bernama.')
  },
  'Gedeelde bron, gescheiden verwerkingspad': {
    name: ml('Shared source, separate processing path', 'Gedeelde bron, gescheiden verwerkingspad', 'Sumber bersama, jalur pemrosesan terpisah'),
    must: ml('The new route must read the same source without changing existing processing, then continue through its own queue, worker, storage, index, and proof surface.', 'De nieuwe route moet dezelfde bron kunnen lezen zonder de bestaande verwerking te wijzigen, en moet daarna via eigen wachtrij, werker, opslag, index en bewijsoppervlak lopen.', 'Rute baru harus membaca sumber yang sama tanpa mengubah pemrosesan yang ada, lalu berjalan melalui antrean, pekerja, penyimpanan, indeks, dan permukaan bukti miliknya sendiri.'),
    proof: [ml('Architecture or Terraform proof shows shared source reading and separated downstream resources.', 'Architectuur- of Terraformbewijs toont gedeelde bronlezing en gescheiden vervolgmiddelen.', 'Bukti arsitektur atau Terraform menunjukkan pembacaan sumber bersama dan sumber daya lanjutan yang terpisah.'), ml('Static checks or tests prove queue, worker, and storage do not overlap production parser resources.', 'Tests of statische checks bewijzen dat wachtrij, werker en opslag niet samenvallen met productieparser-middelen.', 'Tes atau pemeriksaan statis membuktikan antrean, pekerja, dan penyimpanan tidak bertumpang tindih dengan sumber daya parser produksi.')],
    bottleneck: ml('Without path-separation proof, ownership of risk, deployment, and operational impact remains blocked.', 'Zonder bewijs van padenscheiding blijft onduidelijk wie risico, uitrol en operationele gevolgen bezit.', 'Tanpa bukti pemisahan jalur, kepemilikan risiko, deployment, dan dampak operasional tetap terblokir.')
  },
  'Inferentieserver draait op doelinfrastructuur': {
    name: ml('Inference server runs on target infrastructure', 'Inferentieserver draait op doelinfrastructuur', 'Server inferensi berjalan di infrastruktur target'),
    must: ml('The model server must be reachable through the agreed API shape and use the same validation and routing boundaries as the closure path.', 'De modelserver moet bereikbaar zijn via de afgesproken API-vorm en dezelfde validatie- en routegrenzen gebruiken als de rest van het afsluitpad.', 'Server model harus dapat dijangkau lewat bentuk API yang disepakati dan memakai batas validasi serta routing yang sama dengan jalur penutupan.'),
    proof: [ml('A smoke run shows endpoint, model identity, request, response, error behavior, and timeout behavior.', 'Een rooktest toont eindpunt, modelidentiteit, verzoek, antwoord, foutgedrag en timeoutgedrag.', 'Uji asap menunjukkan endpoint, identitas model, permintaan, respons, perilaku galat, dan perilaku timeout.'), ml('Configuration proof shows runtime choice is not hidden inside application logic.', 'Configuratiebewijs toont dat runtimekeuze niet in applicatielogica is verstopt.', 'Bukti konfigurasi menunjukkan pilihan runtime tidak disembunyikan dalam logika aplikasi.')],
    bottleneck: ml('Without a selected and proven compute primitive, infrastructure closure cannot be proven.', 'Zonder gekozen en bewezen compute-primitief kan infrastructuurafsluiting niet worden bewezen.', 'Tanpa primitif komputasi yang dipilih dan dibuktikan, penutupan infrastruktur tidak dapat dibuktikan.')
  },
  'Lokale uitvoeringsadapter is bruikbaar': {
    name: ml('Local runtime adapter is usable', 'Lokale uitvoeringsadapter is bruikbaar', 'Adapter runtime lokal dapat dipakai'),
    must: ml('The local development environment must produce the same contract shape as the target environment without changing validation, storage, or routing behavior.', 'De lokale ontwikkelomgeving moet dezelfde contractvorm leveren als de doelomgeving, zonder validatie, opslag of routegedrag te veranderen.', 'Lingkungan pengembangan lokal harus menghasilkan bentuk kontrak yang sama dengan lingkungan target tanpa mengubah validasi, penyimpanan, atau perilaku routing.'),
    proof: [ml('Adapter tests show the same envelope and error shape for local and target environments.', 'Adaptertests tonen dezelfde omhulsel- en foutvorm voor lokale en doelomgeving.', 'Tes adapter menunjukkan bentuk envelope dan galat yang sama untuk lingkungan lokal dan target.'), ml('Local proof is explicitly marked as development proof, not production or AWS closure.', 'Bewijs markeert de lokale omgeving expliciet als ontwikkelbewijs, niet als productie- of AWS-afsluiting.', 'Bukti lokal ditandai eksplisit sebagai bukti pengembangan, bukan penutupan produksi atau AWS.')],
    bottleneck: ml('If local proof is read as final proof, it creates a false infrastructure closure claim.', 'Als lokaal bewijs als eindbewijs wordt gelezen, ontstaat een valse afsluitclaim voor infrastructuur die nog niet bewezen is.', 'Jika bukti lokal dibaca sebagai bukti akhir, klaim penutupan infrastruktur menjadi palsu.')
  },
  'E-mailnormalisatie bewaart bewijsankers': {
    name: ml('Email normalization preserves evidence anchors', 'E-mailnormalisatie bewaart bewijsankers', 'Normalisasi email menjaga jangkar bukti'),
    must: ml('Normalization must remove noise without losing source meaning, metadata, or evidence anchors needed for validation and review.', 'De normalisatiestap moet ruis verwijderen zonder bronbetekenis, metadata of bewijsankers te verliezen die later nodig zijn voor validatie en beoordeling.', 'Normalisasi harus menghapus noise tanpa kehilangan makna sumber, metadata, atau jangkar bukti yang dibutuhkan untuk validasi dan tinjauan.'),
    proof: [ml('Golden normalization artifacts show input, cleaned text, metadata, and evidence anchors.', 'Gouden normalisatiebewijzen tonen input, opgeschoonde tekst, metadata en bewijsankers.', 'Artefak normalisasi emas menunjukkan input, teks bersih, metadata, dan jangkar bukti.'), ml('Hard source examples have reviewed snippets proving relevant data is retained.', 'Moeilijke bronvoorbeelden hebben beoordeelde fragmenten die aantonen dat relevante gegevens behouden blijven.', 'Contoh sumber sulit memiliki cuplikan yang ditinjau dan membuktikan data relevan tetap terjaga.')],
    bottleneck: ml('Without source-faithful normalization, validation cannot reliably point back to evidence.', 'Zonder brongetrouwe normalisatie kan validatie niet betrouwbaar naar bewijs terugwijzen.', 'Tanpa normalisasi yang setia pada sumber, validasi tidak dapat menunjuk balik ke bukti secara andal.')
  },
  'Uitvoer is gevalideerd en routeerbaar': {
    name: ml('Output is validated and routable', 'Uitvoer is gevalideerd en routeerbaar', 'Keluaran tervalidasi dan dapat dirutekan'),
    must: ml('Every output must have a stable record shape with validation status, evidence references, route, version fields, and artifact references before it counts as closure proof.', 'Elke uitvoer moet een stabiele recordvorm hebben met validatiestatus, bewijsverwijzingen, route, versievelden en bewijsstukverwijzingen voordat zij als afsluitbewijs telt.', 'Setiap keluaran harus punya bentuk record stabil dengan status validasi, referensi bukti, rute, field versi, dan referensi artefak sebelum dihitung sebagai bukti penutupan.'),
    proof: [ml('Contract tests accept valid records and reject drift in envelope, route, evidence reference, or required fields.', 'Contracttests accepteren geldige records en weigeren drift in omhulsel, route, bewijsverwijzing of verplichte velden.', 'Tes kontrak menerima record valid dan menolak drift pada envelope, rute, referensi bukti, atau field wajib.'), ml('Accepted, review, and rejected outputs are represented by fixtures.', 'Testsets tonen geaccepteerde, te beoordelen en afgewezen uitvoer.', 'Fixture menunjukkan keluaran diterima, perlu ditinjau, dan ditolak.')],
    bottleneck: ml('Without a validation contract, model output is activity, not closure proof.', 'Zonder validatiecontract kan modeluitvoer activiteit lijken, maar geen afsluitbewijs worden.', 'Tanpa kontrak validasi, keluaran model hanyalah aktivitas, bukan bukti penutupan.')
  },
  'Batchverwerking, metrieken en kosten zijn bewijsbaar': {
    name: ml('Batch processing, metrics, and cost are provable', 'Batchverwerking, metrieken en kosten zijn bewijsbaar', 'Batch, metrik, dan biaya dapat dibuktikan'),
    must: ml('The run must measure processed work, runtime environment, error cost, and the cost assumption behind the finish claim.', 'De run moet meetbaar maken hoeveel werk is verwerkt, welke uitvoeringsomgeving is gebruikt, wat fouten kostten en welke kostenaanname onder de afsluitclaim ligt.', 'Run harus mengukur pekerjaan yang diproses, lingkungan runtime, biaya galat, dan asumsi biaya di balik klaim selesai.'),
    proof: [ml('A metric artifact contains counts, runtime, error states, and cost calculation.', 'Een metriekbewijsstuk bevat aantallen, uitvoeringsduur, foutstatussen en kostenberekening.', 'Artefak metrik berisi jumlah, runtime, status galat, dan perhitungan biaya.'), ml('Cost proof names the compute assumption explicitly.', 'Kostenbewijs noemt expliciet de gebruikte compute-aanname.', 'Bukti biaya menyebut asumsi komputasi secara eksplisit.')],
    bottleneck: ml('Without metrics and cost proof, management cannot make an honest closure claim about viability or scaling risk.', 'Zonder meet- en kostenbewijs kan management geen eerlijke afsluitclaim maken over uitvoerbaarheid of schaalrisico.', 'Tanpa bukti metrik dan biaya, manajemen tidak dapat membuat klaim penutupan yang jujur tentang kelayakan atau risiko skala.')
  },
  'Auditloop controleert resultaten': {
    name: ml('Audit loop checks results', 'Auditloop controleert resultaten', 'Loop audit memeriksa hasil'),
    must: ml('The audit loop must check results, evidence references, validation outcomes, and drift without becoming runtime truth itself.', 'De auditloop moet resultaten, bewijsverwijzingen, validatie-uitkomsten en drift controleren zonder zelf runtime-waarheid te worden.', 'Loop audit harus memeriksa hasil, referensi bukti, keluaran validasi, dan drift tanpa menjadi kebenaran runtime itu sendiri.'),
    proof: [ml('Audit evidence shows checked records, findings, severity, and source-evidence references.', 'Auditbewijzen tonen gecontroleerde records, bevindingen, ernst en verwijzing naar bronbewijs.', 'Bukti audit menunjukkan record yang diperiksa, temuan, tingkat keparahan, dan referensi bukti sumber.'), ml('Tests prove audit does not promote invalid output into truth.', 'Tests bewijzen dat audit geen ongeldige uitvoer promoveert tot waarheid.', 'Tes membuktikan audit tidak mempromosikan keluaran tidak valid menjadi kebenaran.')],
    bottleneck: ml('If audit produces no proof artifact, quality control remains invisible and cannot close a gate.', 'Als audit geen bewijsstuk oplevert, blijft kwaliteitscontrole onzichtbaar en kan zij geen afsluitpoort sluiten.', 'Jika audit tidak menghasilkan artefak bukti, kontrol kualitas tetap tidak terlihat dan tidak dapat menutup gerbang.')
  },
  'Productieparser blijft onaangeraakt': {
    name: ml('Production parser remains untouched', 'Productieparser blijft onaangeraakt', 'Parser produksi tetap tidak tersentuh'),
    must: ml('The existing production route must remain outside the change: no shared queue mutation, processor-path change, table change, or deployment coupling.', 'De bestaande productieroute moet aantoonbaar buiten de wijziging blijven: geen gedeelde queue-mutatie, geen wijziging in processorpad, geen gewijzigde productietabel en geen deploymentkoppeling met deze nieuwe route.', 'Rute produksi yang ada harus tetap di luar perubahan: tidak ada mutasi antrean bersama, perubahan jalur prosesor, perubahan tabel, atau coupling deployment.'),
    proof: [ml('Diff or review proof shows the existing parser route was not changed.', 'Een wijzigings- of beoordelingsbewijs toont dat de bestaande parserroute niet is aangepast.', 'Bukti diff atau tinjauan menunjukkan rute parser yang ada tidak berubah.'), ml('Deployment proof shows production parser and new processing remain independent.', 'Uitrolbewijs toont dat productieparser en nieuwe verwerking onafhankelijk blijven.', 'Bukti deployment menunjukkan parser produksi dan pemrosesan baru tetap independen.')],
    bottleneck: ml('Without isolation proof, closure would silently accept production risk.', 'Zonder isolatiebewijs kan de nieuwe route niet als af worden beschouwd, omdat sluiting dan impliciet leunt op een productierisico dat niet is geaccepteerd.', 'Tanpa bukti isolasi, penutupan diam-diam menerima risiko produksi.')
  },
  'AWS-bewijs is verplicht': {
    name: ml('AWS proof is required', 'AWS-bewijs is verplicht', 'Bukti AWS wajib'),
    must: ml('A real AWS run must carry the finish claim. Local proof may support development but cannot replace this gate.', 'Er moet een echte AWS-run bestaan die de afsluitclaim draagt. Lokaal bewijs mag ontwikkeling ondersteunen, maar mag deze poort niet vervangen.', 'Run AWS nyata harus menopang klaim selesai. Bukti lokal boleh mendukung pengembangan, tetapi tidak boleh menggantikan gerbang ini.'),
    proof: [ml('An AWS run artifact links source reference, endpoint, validation route, storage proof, metrics, and cost estimate.', 'Een AWS-runbewijsstuk koppelt bronreferentie, eindpunt, validatieroute, opslagbewijs, metrieken en kosteninschatting.', 'Artefak run AWS mengaitkan referensi sumber, endpoint, rute validasi, bukti penyimpanan, metrik, dan estimasi biaya.'), ml('The artifact makes visible which AWS resources carried the run.', 'Het bewijs maakt zichtbaar welke AWS-middelen de run hebben gedragen.', 'Artefak menunjukkan sumber daya AWS mana yang menopang run.')],
    bottleneck: ml('If AWS proof is missing, only local prototype closure can be claimed.', 'Als AWS-bewijs ontbreekt, kan alleen lokale prototype-afsluiting worden geclaimd; AWS-gedragen afsluiting blijft geblokkeerd.', 'Jika bukti AWS hilang, yang bisa diklaim hanya penutupan prototipe lokal.')
  },
  'Opslagcontract is gescheiden en reproduceerbaar': {
    name: ml('Storage contract is separate and reproducible', 'Opslagcontract is gescheiden en reproduceerbaar', 'Kontrak penyimpanan terpisah dan dapat direproduksi'),
    must: ml('Artifacts and index records need their own storage path, key shape, reproducible references, and auditable separation from existing systems.', 'Bewijsstukken en indexrecords moeten een eigen opslagpad, eigen sleutelvorm, reproduceerbare verwijzingen en controleerbare scheiding van bestaande systemen hebben.', 'Artefak dan record indeks perlu jalur penyimpanan, bentuk kunci, referensi yang dapat direproduksi, dan pemisahan yang dapat diaudit dari sistem yang ada.'),
    proof: [ml('Storage proof shows artifact location, key version, index projection, and encryption boundary.', 'Opslagbewijs toont bewijslocatie, sleutelversie, indexprojectie en versleutelingsgrens.', 'Bukti penyimpanan menunjukkan lokasi artefak, versi kunci, proyeksi indeks, dan batas enkripsi.'), ml('Tests prove records can be found through the agreed references.', 'Tests bewijzen dat records terug te vinden zijn via de afgesproken referenties.', 'Tes membuktikan record dapat ditemukan melalui referensi yang disepakati.')],
    bottleneck: ml('Without storage proof, there is no durable place to inspect closure evidence later.', 'Zonder opslagbewijs bestaat er geen duurzame plek waar afsluitbewijs later kan worden gecontroleerd.', 'Tanpa bukti penyimpanan, tidak ada tempat tahan lama untuk memeriksa bukti penutupan nanti.')
  },
  'Deterministische preflight sluit alleen volledige gevallen kort': {
    name: ml('Deterministic preflight only short-circuits complete cases', 'Deterministische preflight sluit alleen volledige gevallen kort', 'Preflight deterministik hanya memintas kasus lengkap'),
    must: ml('The deterministic step may proceed without the model only when required fields are complete, evidence anchors resolve, and no conflicts or blockers remain.', 'De deterministische stap mag alleen zonder model doorgaan wanneer verplichte velden compleet zijn, bewijsankers oplossen en er geen conflicten of blokkerende onzekerheden zijn.', 'Langkah deterministik hanya boleh lanjut tanpa model ketika field wajib lengkap, jangkar bukti terselesaikan, dan tidak ada konflik atau blocker.'),
    proof: [ml('Fixtures show complete short-circuit cases and cases that must go to model processing.', 'Fixtures tonen volledige kortsluitgevallen en gevallen die verplicht naar modelverwerking gaan.', 'Fixture menunjukkan kasus lengkap yang boleh dipintas dan kasus yang wajib masuk pemrosesan model.'), ml('Validation proof shows short-circuited output uses the same record shape as model output.', 'Validatiebewijs toont dat kortgesloten uitvoer dezelfde recordvorm gebruikt als modeluitvoer.', 'Bukti validasi menunjukkan keluaran yang dipintas memakai bentuk record yang sama dengan keluaran model.')],
    bottleneck: ml('If preflight accepts too broadly, silent data drift bypasses model validation.', 'Als preflight te ruim accepteert, ontstaat stille datadrift en wordt modelvalidatie omzeild.', 'Jika preflight menerima terlalu luas, drift data senyap melewati validasi model.')
  }
};

function requiredI18nForGate(gate) {
  const entry = GATE_I18N[gate.name];
  if (!entry) throw new Error(`No multilingual living-doc gate text for "${gate.name}". Add a specific gate translation; no fallback is allowed.`);
  return entry;
}

function localizedTypeList(types) {
  return ml(
    types.map((type) => typeLabel(type, 'en')).join(', '),
    types.map((type) => typeLabel(type, 'nl')).join(', '),
    types.map((type) => typeLabel(type, 'id')).join(', ')
  );
}

function localizedImplementationAlone(value) {
  const yes = value === 'Ja' || value === 'Yes' || value === true;
  return yes ? ml('Yes', 'Ja', 'Ya') : ml('No', 'Nee', 'Tidak');
}

function ownerText(gate) {
  const needsOwner = gate.owner.toLowerCase().includes('eigenaar vereist');
  if (!needsOwner) {
    return ml(
      'Implementation ownership is inferable; acceptance ownership still needs review.',
      'Implementatie-eigenaarschap is afleidbaar; acceptatie-eigenaarschap moet nog worden beoordeeld.',
      'Kepemilikan implementasi dapat diturunkan; kepemilikan penerimaan tetap perlu ditinjau.'
    );
  }
  return ml(
    `Owner required for: ${localizedTypeList(gate.types).en}.`,
    `Eigenaar vereist voor: ${localizedTypeList(gate.types).nl}.`,
    `Pemilik diperlukan untuk: ${localizedTypeList(gate.types).id}.`
  );
}

function skippedText(gate) {
  return ml(
    `If skipped, "${requiredI18nForGate(gate).name.en}" cannot count as closed and the finish claim must be downgraded.`,
    `Als dit wordt overgeslagen, kan "${requiredI18nForGate(gate).name.nl}" niet als gesloten tellen en moet de afsluitclaim worden afgewaardeerd.`,
    `Jika dilewati, "${requiredI18nForGate(gate).name.id}" tidak dapat dihitung tertutup dan klaim selesai harus diturunkan.`
  );
}

function buildAccountabilitySection(model) {
  const nonImplementationCount = model.gates.filter((gate) => gate.types.some((type) => type !== 'implementation work' && type !== 'proof/evidence work')).length;
  return {
    id: 'accountability-closure-path',
    title: SECTION_TEXT.title,
    convergenceType: 'accountability-closure-path',
    updated: model.generatedAt,
    callout: {
      tone: 'negative',
      title: SECTION_TEXT.calloutTitle,
      items: [SECTION_TEXT.schedulingBasis, SECTION_TEXT.readout],
    },
    stats: [
      { label: SECTION_TEXT.gates, value: model.gates.length },
      { label: SECTION_TEXT.ownerRequired, value: model.ownerRequiredCount },
      { label: SECTION_TEXT.implementationAlone, value: localizedImplementationAlone(model.implementationAlone) },
      { label: SECTION_TEXT.nonImplementation, value: nonImplementationCount },
    ],
    data: model.gates.map((gate, index) => {
      const copy = requiredI18nForGate(gate);
      return {
        id: `accountability-gate-${index + 1}`,
        name: copy.name,
        state: gate.state,
        must: copy.must,
        proofRequired: copy.proof[0],
        bottleneckRisk: copy.bottleneck,
        ownerRequired: ownerText(gate),
        ifSkipped: skippedText(gate),
        accountabilityType: localizedTypeList(gate.types),
        proofItems: copy.proof.map((text) => ({ text })),
        refs: gate.refs || [],
        notes: [
          {
            role: 'reference',
            title: ml('Source references', 'Bronverwijzingen', 'Referensi sumber'),
            text: ml((gate.refs || []).join('\n'), (gate.refs || []).join('\n'), (gate.refs || []).join('\n')),
          },
        ],
      };
    }),
  };
}

function upsertAccountabilitySection(doc, section) {
  const sections = Array.isArray(doc.sections) ? doc.sections : [];
  const existingIndex = sections.findIndex((entry) => entry.id === section.id || entry.convergenceType === 'accountability-closure-path');
  if (existingIndex >= 0) sections[existingIndex] = section;
  else sections.push(section);
  doc.sections = sections;
}

function renderLivingDoc(sourcePath) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '../../../..');
  const renderer = path.join(repoRoot, 'scripts', 'render-living-doc.mjs');
  execFileSync('node', [renderer, sourcePath], { cwd: repoRoot, stdio: 'inherit' });
  return sourcePath.replace(/\.json$/i, '.html');
}

async function main() {
  const { input, locale } = parseArgs(process.argv);
  const sourcePath = resolveInput(input);
  const doc = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  let model = buildGenericModel(doc, sourcePath);
  model = localizeModel(model, locale);
  doc.locale = locale;
  doc.updated = new Date().toISOString();
  upsertAccountabilitySection(doc, buildAccountabilitySection(model));
  await fs.writeFile(sourcePath, `${JSON.stringify(doc, null, 2)}\n`);
  const htmlPath = renderLivingDoc(sourcePath);
  console.log(htmlPath);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
