#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_NO_DATE_LINE = 'This cannot be honestly reduced to a date from the current document. The remaining finish condition is a set of proof gates.';

function usage() {
  return `Usage:
  node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs <doc.json|doc.html|file://...> [--out <path>] [--model-out <path>] [--locale en|nl]
  node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs --from-model <model.json> [--out <path>] [--locale en|nl]

Examples:
  node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs docs/workstream.json
  node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs file:///path/to/workstream.html#status-snapshot --model-out docs/workstream-accountability-path.json
  node .agents/skills/living-doc-accountability-path-extractor/scripts/render-accountability-path.mjs --from-model docs/workstream-accountability-path.json --locale nl`;
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
  let locale = 'en';
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
  if (!['en', 'nl'].includes(locale)) throw new Error(`Unsupported locale: ${locale}`);
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

function defaultOutputPath(sourcePath, explicitOut, locale = 'en', extension = 'html') {
  if (explicitOut) return path.resolve(explicitOut);
  const ext = path.extname(sourcePath);
  const base = sourcePath.slice(0, -ext.length);
  const suffix = locale === 'en' ? '' : `.${locale}`;
  return `${base}-accountability-path${suffix}.${extension}`;
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
    name: 'Finish label and scope boundary',
    state: 'open',
    must: `The finish claim must map to the documented objective and success condition: ${doc.successCondition || doc.objective || 'no success condition found'}`,
    proof: ['Accountability page maps the finish label to explicit closure gates.', 'Any removed or downgraded scope records accepted risk and invalidated finish claim.'],
    bottleneck: 'The requested finish answer is incompatible with the living-doc definition of done unless all required gates are proven or explicitly removed with named risk.',
    types: ['decision work', 'risk acceptance work', 'proof/evidence work'],
    owner: 'Owner required: product/technical owner for scope removal, risk downgrade, or finish-label acceptance.',
    refs: ['objective', 'successCondition'],
  });

  for (const criterion of criteria) {
    const related = [...relatedByCriterion(doc, criterion), ...relatedByTicket(doc, criterion)];
    const uniqueRelated = [...new Map(related.map((entry) => [`${entry.section.id}:${entry.card.id}`, entry])).values()];
    const criterionText = criterion.criterion || criterion.definition || textOf(criterion);
    const state = inferState(criterion, uniqueRelated);
    const proof = [
      ...summarizeRelated(uniqueRelated, ['currentCoverage', 'proofClaim', 'outputAssertion', 'evidenceRefs']),
      `Required criterion: ${criterionText}`,
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
      proof: proof.length ? proof : ['Proof artifact required by the living doc, but no proof detail is present on the related cards.'],
      bottleneck: gaps[0] || 'No named bottleneck is visible from related cards; owner must confirm proof sufficiency.',
      types,
      owner: ownerRequiredFor(types, `${criterionText} ${gaps.join(' ')}`)
        ? `Owner required: ${types.filter((type) => type !== 'implementation work' && type !== 'proof/evidence work').join(', ') || 'acceptance'} owner is not inferable from the doc.`
        : 'Implementation owner inferable from related code/test surfaces; acceptance owner is not inferable from the doc.',
      refs: [criterion.id, ...uniqueRelated.slice(0, 5).map(({ card }) => card.id)],
    });
  }

  return finishModel(doc, sourcePath, gates);
}

function buildGemmaModel(doc, sourcePath) {
  const gates = [
    {
      name: 'MVP finish label and scope boundary',
      state: 'open',
      must: 'The finish label must remain AWS-backed Gemma MVP complete, not local prototype complete. The documented success condition requires raw-email source references, deterministic preflight, separate Gemma lane, AWS vLLM, Gemma-owned artifacts and DynamoDB index, audit pass, metrics, cost estimate, and parser isolation proof.',
      proof: ['Accountability page maps MVP complete to explicit gates.', 'Any scope removal or downgrade records the accepted risk and invalidated finish claim.'],
      bottleneck: 'The requested finish answer is incompatible with the current living-doc definition of done unless AWS proof, storage proof, audit proof, and parser isolation proof are either completed or explicitly removed with named risk.',
      types: ['decision work', 'risk acceptance work', 'proof/evidence work'],
      owner: 'Owner required: product/technical owner for any MVP scope removal or risk downgrade.',
      refs: ['objective', 'successCondition', 'criterion-aws-proof-required'],
    },
    {
      name: 'Local runtime adapter and LM Studio smoke',
      state: 'partial',
      must: 'LM Studio remains a local development runtime that uses the same validation and result envelope as AWS vLLM, with provider health/model checks and retry/timeout behavior captured as artifacts.',
      proof: ['Existing local smoke artifact for gemma-4-e4b-it against http://localhost:1234/v1.', 'Required remaining proof: health/model check artifact and timeout/retry fixtures.'],
      bottleneck: 'Local proof reduces adapter risk but does not close the AWS vLLM proof gate.',
      types: ['implementation work', 'proof/evidence work'],
      owner: 'Implementation owner inferable from parser MVP code surface; acceptance owner for local runtime sufficiency is not inferable from the doc.',
      refs: ['criterion-local-runtime', 'verify-local-smoke', 'test-inference-adapter-runtime-selection'],
    },
    {
      name: 'Email normalization evidence envelope',
      state: 'partial',
      must: 'Raw .eml content must normalize into a bounded, source-faithful input envelope that removes unsafe or irrelevant HTML while preserving visible text, metadata, content-part provenance, and stable evidence anchors for validation.',
      proof: ['Current tests cover HTML normalization and prompt compaction.', 'Required remaining proof: reviewed normalized-input artifacts for plain-text, multipart HTML, HTML-only, tracking-heavy, and boilerplate-heavy emails, plus maximum input-size and warning-blocker fixtures.'],
      bottleneck: 'Normalizer review artifacts are not present, so validation evidence cannot prove source-faithful extraction across representative email shapes.',
      types: ['implementation work', 'review and acceptance work', 'proof/evidence work'],
      owner: 'Owner required: reviewer for representative normalized-input artifact acceptance.',
      refs: ['criterion-email-normalization', 'verify-normalized-input-review', 'test-email-normalizer'],
    },
    {
      name: 'Deterministic preflight and extraction-result/v1 validation',
      state: 'partial',
      must: 'Preflight may short-circuit only complete order_confirmation-style basics with resolvable evidence anchors, clean schema/date/total/currency validation, no conflicts, and known source identity. All deterministic and Gemma outputs must use extraction-result/v1.',
      proof: ['Documented local tests cover deterministic_complete order confirmation, canonical extraction-result/v1, Gemma fallback wrapping, local storage-key-v1 writing, DynamoDB projection shape, shipment/refund hints, and negative contract checks.', 'Required remaining proof: conflict/duplicate/normalizer-warning fixtures, event-specific validation, persisted evidence resolver beyond local anchors, and audit eligibility assertions.'],
      bottleneck: 'Current proof is local and fixture-bound; AWS route proof and audit sampling are still missing.',
      types: ['implementation work', 'proof/evidence work'],
      owner: 'Implementation owner inferable from tests and inference_extract.py; acceptance owner for event-specific required fields beyond v1 is not inferable from the doc.',
      refs: ['criterion-validated-output', 'criterion-deterministic-preflight-short-circuit', 'verify-deterministic-preflight-short-circuit', 'test-extraction-result-contract'],
    },
    {
      name: 'Agentic audit loop and held-email visibility',
      state: 'blocked',
      must: 'A bounded audit loop must read accepted, review/audit_pending, and rejected artifacts after deterministic validation, emit audit-finding/v1 records, preserve original route state, surface non-accepted records read-only, and never promote output to accepted truth.',
      proof: ['Required proof: audit-finding/v1 schema, local audit over LM Studio smoke and deterministic_preflight artifacts, tests proving audit cannot mutate validation status, dashboard/API evidence for review/audit_pending and rejected records, then AWS-backed audit proof.'],
      bottleneck: 'No audit runner, audit artifact, or held-email dashboard surface exists yet. This blocks the audit criterion and storage proof because audit findings must reference extraction records.',
      types: ['implementation work', 'proof/evidence work', 'operational ownership work', 'review and acceptance work'],
      owner: 'Owner required: implementation owner for audit/dashboard surfaces and acceptance owner for audit sufficiency.',
      refs: ['criterion-agentic-audit', 'verify-agentic-audit', 'verify-dashboard-held-email-surface', 'test-agentic-audit-loop'],
    },
    {
      name: 'AWS compute primitive and vLLM serving decision',
      state: 'blocked',
      must: 'An isolated AWS GPU-backed vLLM target must be selected and deployed while preserving OpenAI-compatible API behavior, separate Gemma resources, health/model checks, lifecycle controls, and cost controls.',
      proof: ['Required proof: selected AWS compute primitive, Terraform plan/review evidence, deployed endpoint health/model check, startup/config logs, and cost-control settings.'],
      bottleneck: 'AWS compute primitive is not selected, so Terraform closure and AWS smoke proof cannot be proven.',
      types: ['decision work', 'infrastructure/resource work', 'access/funding work', 'proof/evidence work'],
      owner: 'Owner required: someone must decide whether ECS GPU, AWS Batch GPU, or SageMaker-style async serving owns the vLLM runtime and approve the associated GPU cost posture.',
      refs: ['question-aws-compute', 'tf-gemma-resources', 'verify-aws-vllm', 'criterion-aws-vllm'],
    },
    {
      name: 'Terraform-managed separate Gemma lane',
      state: 'blocked',
      must: 'Terraform in the devops-dashboard email stack must add Gemma-owned queue, DLQ/review output, worker/job, vLLM target, logs, metrics, IAM, retry/cost controls, encrypted artifact storage or prefixes, and Gemma-owned DynamoDB index without reusing parser-owned resources.',
      proof: ['Required proof: devops-dashboard PR, GitHub Actions Terraform plan, review evidence, OIDC/trusted apply path, and static/review checks naming forbidden parser resources.'],
      bottleneck: 'Gemma Terraform resources and delivery route are not built; local terraform plan/apply is explicitly disallowed.',
      types: ['infrastructure/resource work', 'review and acceptance work', 'operational ownership work', 'proof/evidence work'],
      owner: 'Owner required: devops Terraform owner and reviewer for the PR/plan/apply path.',
      refs: ['tf-location', 'tf-gemma-resources', 'tf-delivery-route', 'criterion-shared-source-only', 'criterion-parser-isolation'],
    },
    {
      name: 'AWS storage and DynamoDB result index proof',
      state: 'partial',
      must: 'Gemma runs must write reproducible artifacts to Gemma-owned encrypted S3 storage or prefixes and queryable status/summary records to a Gemma-owned DynamoDB table using the storage-key-v1 contract, with reruns as new versioned records and audit findings as references.',
      proof: ['Current proof: local filesystem storage-key-v1 artifact writes and DynamoDB projection JSON are tested.', 'Required proof: actual encrypted S3/DynamoDB resources, IAM isolation, real DynamoDB writer tests or AWS smoke proof, rerun/version persistence, and audit-finding/v1 writes.'],
      bottleneck: 'Local storage proof does not satisfy AWS storage closure. Terraform-backed S3/DynamoDB resources and persistent writer evidence are missing.',
      types: ['implementation work', 'infrastructure/resource work', 'proof/evidence work'],
      owner: 'Owner required: storage/Terraform owner for encrypted S3, DynamoDB, IAM, retention, and writer proof.',
      refs: ['criterion-storage-contract', 'verify-storage-contract', 'test-storage-contract', 'definition-storage-keys-v1'],
    },
    {
      name: 'AWS queued extraction run, metrics, and cost proof',
      state: 'blocked',
      must: 'At least one isolated AWS vLLM-backed queued extraction run must process raw email source references and record endpoint health, model identity, request latency, runtime seconds, validation result, route, metrics, and estimated GPU cost.',
      proof: ['Required proof: AWS run artifact linking source reference, vLLM endpoint, validation route, metrics, cost estimate, artifact refs, and batch-metrics/v1 output.'],
      bottleneck: 'No AWS vLLM deployment or smoke artifact exists. Existing cost docs and local runtime metrics are management context, not AWS run proof.',
      types: ['infrastructure/resource work', 'proof/evidence work', 'access/funding work'],
      owner: 'Owner required: AWS runtime owner for deployment and cost-bearing smoke run.',
      refs: ['criterion-aws-proof-required', 'criterion-batch-and-metrics', 'verify-aws-vllm', 'verify-cost', 'test-aws-vllm-smoke'],
    },
    {
      name: 'Parser isolation review and acceptance',
      state: 'blocked',
      must: 'The Gemma implementation and Terraform diff must prove it shares only raw email read access and does not mutate or depend on the parser queue, parser processor Lambda, parser records table, parser graph bucket, graph runtime, or parser Lambda deployment workflow.',
      proof: ['Required proof: implementation/Terraform diff review, static checklist naming forbidden parser resources, and evidence that production parser deployment path remains untouched.'],
      bottleneck: 'No Gemma diff exists yet, so parser isolation can only be asserted from known boundaries; it cannot be accepted as closed.',
      types: ['review and acceptance work', 'proof/evidence work', 'operational ownership work'],
      owner: 'Owner required: reviewer with authority over parser production boundary and devops Terraform diff.',
      refs: ['criterion-parser-isolation', 'verify-parser-isolation', 'test-shared-source-separate-queue', 'anchor-current-parser-processor', 'anchor-email-terraform-parser-resources'],
    },
  ];
  return finishModel(doc, sourcePath, gates, {
    proven: [
      'Documented local LM Studio smoke processed ringelling-cv_shipment-created.eml against gemma-4-e4b-it, persisted gemma-model-response/v1 plus extraction-result/v1 artifacts, and routed to review with event_type=shipment.',
      'Documented local tests cover deterministic_complete order confirmation, extraction-result/v1 emission, Gemma fallback wrapping, local storage-key-v1 artifact writing, DynamoDB projection shape, candidate-hint non-authority, raw HTML omission, and negative extraction-result/v1 checks.',
      'Terraform location is identified: /Users/rene/projects/trackandback-devops-dashboard/terraform/trackandback/email/main.tf. Local terraform plan/apply is not allowed.',
    ],
    partial: [
      'Local runtime adapter proof supports LM Studio development; it does not satisfy AWS vLLM MVP closure.',
      'Email normalization and prompt compaction are partially tested; representative normalized-input artifact review is still missing.',
      'Storage contract is locally proven through filesystem artifacts and DynamoDB projection JSON; AWS encrypted S3/DynamoDB resources and real writer proof are missing.',
      'Deterministic preflight and validation contract are locally exercised; AWS route proof, audit sampling, and broader negative fixtures remain missing.',
    ],
    missing: [
      'Selected AWS compute primitive and GPU cost posture.',
      'Deployed AWS vLLM endpoint with health/model check artifact.',
      'Devops-dashboard Terraform PR, GitHub Actions plan, review evidence, and trusted apply path.',
      'AWS queued extraction run artifact linking source reference, endpoint, extraction-result/v1, validation route, metrics, and cost estimate.',
      'Agentic audit runner, audit-finding/v1 records, route-preservation tests, and held-email dashboard/API surface.',
      'Parser isolation review over actual Gemma code and Terraform diff.',
    ],
    invalid: [
      'Local LM Studio smoke is not AWS proof.',
      'Cost model CSV and existing docs are not measured AWS runtime/cost proof.',
      'Known parser boundaries are not parser isolation acceptance without a Gemma diff review.',
      'Local filesystem artifacts are not Gemma-owned encrypted AWS S3/DynamoDB proof.',
    ],
  });
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
  const implementationAlone = gates.every((gate) => gate.types.every((type) => type === 'implementation work' || type === 'proof/evidence work')) ? 'Yes' : 'No';
  const ownerRequiredCount = gates.filter((gate) => gate.owner.toLowerCase().includes('owner required')).length;
  const nonImplementationCount = gates.filter((gate) => gate.types.some((type) => type !== 'implementation work' && type !== 'proof/evidence work')).length;
  const blocked = gates.filter((gate) => gate.state === 'blocked' || gate.owner.toLowerCase().includes('owner required'));
  const proofLedger = proofOverride || {
    proven: gates.filter((gate) => gate.state === 'closed').map((gate) => `${gate.name}: ${gate.proof[0] || 'closed proof exists.'}`),
    partial: gates.filter((gate) => gate.state === 'partial').map((gate) => `${gate.name}: ${gate.proof[0] || 'partial proof exists.'}`),
    missing: gates.filter((gate) => ['open', 'blocked', 'unclear'].includes(gate.state)).map((gate) => `${gate.name}: ${gate.proof[0] || 'proof missing or unclear.'}`),
    invalid: ['Activity, planning, local-only proof, or discussion does not close a gate unless it is named as a proof artifact on that gate.'],
  };
  const finishLabel = doc.title?.toLowerCase().includes('gemma')
    ? 'AWS-backed vLLM run, validated extraction-result/v1 records, Gemma-owned S3 artifacts, DynamoDB-indexed results, storage proof, audit proof, cost/metrics proof, and parser isolation proof.'
    : 'the objective, success condition, acceptance criteria, proof artifacts, and any explicit risk acceptance named in the living doc.';
  return {
    sourcePath,
    title: doc.title || path.basename(sourcePath, '.json'),
    subtitle: doc.subtitle || '',
    updated: doc.updated || '',
    objective: doc.objective || '',
    successCondition: doc.successCondition || '',
    generatedAt: new Date().toISOString(),
    accountabilityReadout: `This is not a single implementation task. The living doc defines completion as a set of proof gates. Some gates are coding work, but others require decisions, acceptance ownership, infrastructure, resource access, proof, review, operational ownership, risk acceptance, or explicit scope removal.`,
    schedulingBasis: REQUIRED_NO_DATE_LINE,
    implementationAlone,
    statusCounts,
    typeCounts,
    ownerRequiredCount,
    gates,
    bottlenecks: blocked.slice(0, 8).map((gate, index) => ({
      name: gate.bottleneck.split('.')[0] || gate.name,
      blocks: `Gate ${gates.indexOf(gate) + 1}: ${gate.name}`,
      why: gate.bottleneck,
      owner: gate.owner.includes('Owner required') ? gate.owner : 'Owner required: acceptance owner is not inferable from the doc.',
      ifSkipped: index === 0
        ? `If skipped, the finish claim must be downgraded; "${modelFinishWord(doc)}" cannot honestly be claimed.`
        : `If skipped, ${gate.name} cannot be counted as closed.`,
    })),
    proofLedger,
    finishLabel,
    finishCheck: `The requested finish answer is incompatible with the current living-doc definition of done unless the required proof gates are completed or explicitly removed with named risk.`,
    managerSummary: `${gates.length} gates remain in the accountability path, and ${nonImplementationCount} are not owned by implementation alone. The blocking gates are ${blocked.slice(0, 4).map((gate) => gate.name).join(', ')}${blocked.length > 4 ? ', and additional owner-required proof gates' : ''}. Closure requires proof artifacts and ownership decisions, not a date guess.`,
  };
}

function modelFinishWord(doc, locale = 'en') {
  if (doc.title?.toLowerCase().includes('mvp')) return locale === 'nl' ? 'MVP compleet' : 'MVP complete';
  return locale === 'nl' ? 'done' : 'done';
}

const UI = {
  en: {
    lang: 'en',
    pageTitleSuffix: 'Accountability Path',
    navReadout: 'Readout',
    navDashboard: 'Dashboard',
    navGates: 'Gates',
    navBottlenecks: 'Bottlenecks',
    navProof: 'Proof',
    navSummary: 'Summary',
    eyebrow: 'Proof-based closure path',
    sourceDoc: 'Source doc',
    generated: 'Generated',
    docUpdated: 'Doc updated',
    objective: 'Objective',
    successCondition: 'Success condition',
    accountabilityReadout: 'Accountability Readout',
    implementationAlone: 'Implementation alone',
    gateDashboard: 'Gate Dashboard',
    ownerRequired: 'owner required',
    finishLanguage: 'Finish Language',
    currentlyMeans: 'currently means',
    closurePath: 'Closure Path',
    closureIntro: 'The sequence below is the smallest honest path to the documented success condition. Local implementation work is visible, but it does not collapse infrastructure, review, acceptance, cost, deployment, or proof ownership into implementation.',
    gate: 'Gate',
    currentState: 'Current state',
    mustBecomeTrue: 'Must become true',
    proofRequired: 'Proof required',
    bottleneckRisk: 'Bottleneck risk',
    accountabilityType: 'Accountability type',
    bottleneckMap: 'Bottleneck Map',
    blocks: 'Blocks',
    whyBottleneck: 'Why it is a bottleneck',
    ifSkipped: 'If skipped',
    proofLedger: 'Proof Ledger',
    proven: 'Proven',
    partial: 'Partial',
    missing: 'Missing',
    invalidForClosure: 'Invalid for closure',
    managerSummary: 'Manager-Facing Summary',
    footer: 'Generated by living-doc-accountability-path-extractor. This page is a proof-based closure path, not a schedule estimate.',
    printNote: 'Print note: source path and generated timestamp are preserved for review evidence.',
  },
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
  en: { closed: 'closed', partial: 'partial', open: 'open', blocked: 'blocked', unclear: 'unclear' },
  nl: { closed: 'gesloten', partial: 'gedeeltelijk', open: 'open', blocked: 'geblokkeerd', unclear: 'onduidelijk' },
};

const TYPE_LABELS = {
  en: {},
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
  return UI[locale] || UI.en;
}

function statusLabel(state, locale) {
  return STATUS_LABELS[locale]?.[state] || state;
}

function typeLabel(type, locale) {
  return TYPE_LABELS[locale]?.[type] || type;
}

function localizeModel(model, locale) {
  if (locale === 'en') return { ...model, locale: 'en', schema: 'living-doc-accountability-path/v1' };
  if (locale === 'nl' && model.title === 'Gemma Inference Extraction MVP') return translateGemmaModelNl(model);
  return {
    ...model,
    locale,
    schema: 'living-doc-accountability-path/v1',
    accountabilityReadout: 'Dit is geen enkele implementatietaak. Het living doc definieert voltooiing als een set bewijs-poorten. Sommige poorten zijn codewerk, maar andere vereisen besluiten, acceptatie-eigenaarschap, infrastructuur, toegang tot resources, bewijs, review, operationeel eigenaarschap, risicoacceptatie of expliciete scopeverwijdering.',
    schedulingBasis: 'Dit kan vanuit het huidige document niet eerlijk tot een datum worden gereduceerd. De resterende afrondingsvoorwaarde is een set bewijs-poorten.',
    implementationAlone: model.implementationAlone === 'Yes' ? 'Ja' : 'Nee',
    managerSummary: model.managerSummary,
  };
}

function translateGemmaModelNl(model) {
  const translatedGates = [
    {
      name: 'MVP-afsluitlabel en scopegrens',
      must: 'Het afsluitlabel moet AWS-backed Gemma MVP compleet blijven, niet lokaal prototype compleet. De gedocumenteerde succesvoorwaarde vereist ruwe e-mailbronreferenties, deterministische preflight, een aparte Gemma-lane, AWS vLLM, Gemma-eigen artifacts en DynamoDB-index, auditpass, metrics, kostenschatting en bewijs van parser-isolatie.',
      proof: ['De accountability-pagina koppelt MVP compleet aan expliciete poorten.', 'Elke scopeverwijdering of downgrade legt het geaccepteerde risico en de ongeldig gemaakte finishclaim vast.'],
      bottleneck: 'Het gevraagde finishantwoord is onverenigbaar met de huidige definitie van done in het living doc tenzij AWS-bewijs, opslagbewijs, auditbewijs en parser-isolatiebewijs zijn afgerond of expliciet zijn verwijderd met benoemd risico.',
      owner: 'Eigenaar vereist: product/technisch eigenaar voor elke MVP-scopeverwijdering of risicodowngrade.',
    },
    {
      name: 'Lokale runtime-adapter en LM Studio-smoke',
      must: 'LM Studio blijft een lokale ontwikkelruntime die dezelfde validatie en resultaat-envelop gebruikt als AWS vLLM, met provider health/model checks en retry/timeout-gedrag vastgelegd als artifacts.',
      proof: ['Bestaand lokaal smoke-artifact voor gemma-4-e4b-it tegen http://localhost:1234/v1.', 'Nog vereist bewijs: health/model-check artifact en timeout/retry-fixtures.'],
      bottleneck: 'Lokaal bewijs verlaagt adapterrisico, maar sluit de AWS vLLM-bewijspoort niet.',
      owner: 'Implementatie-eigenaar is afleidbaar uit het parser MVP-codevlak; acceptatie-eigenaar voor lokale runtime-voldoendeheid is niet uit het doc afleidbaar.',
    },
    {
      name: 'E-mailnormalisatie en evidence-envelop',
      must: 'Ruwe .eml-inhoud moet normaliseren naar een begrensde, brongetrouwe input-envelop die onveilige of irrelevante HTML verwijdert terwijl zichtbare tekst, metadata, content-part provenance en stabiele evidence anchors voor validatie behouden blijven.',
      proof: ['Huidige tests dekken HTML-normalisatie en prompt-compactie.', 'Nog vereist bewijs: gereviewde normalized-input artifacts voor plain-text, multipart HTML, HTML-only, tracking-heavy en boilerplate-heavy e-mails, plus maximum-input-size en warning-blocker fixtures.'],
      bottleneck: 'Normalizer-reviewartifacts ontbreken, waardoor validatiebewijs brongetrouwe extractie over representatieve e-mailvormen niet kan bewijzen.',
      owner: 'Eigenaar vereist: reviewer voor acceptatie van representatieve normalized-input artifacts.',
    },
    {
      name: 'Deterministische preflight en extraction-result/v1-validatie',
      must: 'Preflight mag alleen complete order_confirmation-basics short-circuiten met oplosbare evidence anchors, schone schema/datum/totaal/valuta-validatie, geen conflicten en bekende bronidentiteit. Alle deterministische en Gemma-outputs moeten extraction-result/v1 gebruiken.',
      proof: ['Gedocumenteerde lokale tests dekken deterministic_complete order confirmation, canonical extraction-result/v1, Gemma fallback wrapping, lokale storage-key-v1 writes, DynamoDB projection shape, shipment/refund hints en negatieve contractchecks.', 'Nog vereist bewijs: conflict/duplicate/normalizer-warning fixtures, event-specifieke validatie, persistente evidence resolver buiten lokale anchors en audit eligibility assertions.'],
      bottleneck: 'Huidig bewijs is lokaal en fixture-gebonden; AWS-routebewijs en audit sampling ontbreken nog.',
      owner: 'Implementatie-eigenaar is afleidbaar uit tests en inference_extract.py; acceptatie-eigenaar voor event-specifieke verplichte velden buiten v1 is niet uit het doc afleidbaar.',
    },
    {
      name: 'Agentic auditloop en zichtbaarheid van vastgehouden e-mails',
      must: 'Een begrensde auditloop moet accepted, review/audit_pending en rejected artifacts lezen na deterministische validatie, audit-finding/v1 records schrijven, originele route-state behouden, non-accepted records read-only tonen en nooit output naar accepted truth promoveren.',
      proof: ['Vereist bewijs: audit-finding/v1 schema, lokale audit over LM Studio-smoke en deterministic_preflight artifacts, tests die bewijzen dat audit validatiestatus niet kan muteren, dashboard/API-bewijs voor review/audit_pending en rejected records, daarna AWS-backed auditbewijs.'],
      bottleneck: 'Er is nog geen auditrunner, auditartifact of held-email dashboard surface. Dit blokkeert het auditcriterium en opslagbewijs omdat audit findings naar extractierecords moeten verwijzen.',
      owner: 'Eigenaar vereist: implementatie-eigenaar voor audit/dashboard surfaces en acceptatie-eigenaar voor auditvoldoendeheid.',
    },
    {
      name: 'AWS compute primitive en vLLM serving-besluit',
      must: 'Een geïsoleerd AWS GPU-backed vLLM-target moet worden gekozen en gedeployed met behoud van OpenAI-compatible API-gedrag, aparte Gemma-resources, health/model checks, lifecycle controls en cost controls.',
      proof: ['Vereist bewijs: gekozen AWS compute primitive, Terraform plan/review-bewijs, deployed endpoint health/model check, startup/config logs en cost-control instellingen.'],
      bottleneck: 'AWS compute primitive is niet gekozen, waardoor Terraform-afsluiting en AWS-smokebewijs niet bewezen kunnen worden.',
      owner: 'Eigenaar vereist: iemand moet beslissen of ECS GPU, AWS Batch GPU of SageMaker-style async serving de vLLM-runtime bezit en de bijbehorende GPU-kostenhouding goedkeuren.',
    },
    {
      name: 'Terraform-managed aparte Gemma-lane',
      must: 'Terraform in de devops-dashboard email stack moet Gemma-eigen queue, DLQ/review output, worker/job, vLLM target, logs, metrics, IAM, retry/cost controls, encrypted artifact storage of prefixes en Gemma-eigen DynamoDB-index toevoegen zonder parser-owned resources te hergebruiken.',
      proof: ['Vereist bewijs: devops-dashboard PR, GitHub Actions Terraform plan, reviewbewijs, OIDC/trusted apply path en static/review checks die verboden parserresources benoemen.'],
      bottleneck: 'Gemma Terraform-resources en delivery route zijn niet gebouwd; lokale terraform plan/apply is expliciet verboden.',
      owner: 'Eigenaar vereist: devops Terraform-eigenaar en reviewer voor het PR/plan/apply-pad.',
    },
    {
      name: 'AWS opslag en DynamoDB-result index bewijs',
      must: 'Gemma-runs moeten reproduceerbare artifacts schrijven naar Gemma-eigen encrypted S3 storage of prefixes en querybare status/samenvattingsrecords naar een Gemma-eigen DynamoDB-tabel met het storage-key-v1 contract, met reruns als nieuwe versioned records en audit findings als referenties.',
      proof: ['Huidig bewijs: lokale filesystem storage-key-v1 artifact writes en DynamoDB projection JSON zijn getest.', 'Vereist bewijs: echte encrypted S3/DynamoDB resources, IAM-isolatie, echte DynamoDB writer tests of AWS-smokebewijs, rerun/version persistence en audit-finding/v1 writes.'],
      bottleneck: 'Lokaal opslagbewijs voldoet niet aan AWS-opslagafsluiting. Terraform-backed S3/DynamoDB resources en persistent writer evidence ontbreken.',
      owner: 'Eigenaar vereist: storage/Terraform-eigenaar voor encrypted S3, DynamoDB, IAM, retention en writer proof.',
    },
    {
      name: 'AWS queued extraction run, metrics en kostenbewijs',
      must: 'Minstens één geïsoleerde AWS vLLM-backed queued extraction run moet ruwe e-mailbronreferenties verwerken en endpoint health, model identity, request latency, runtime seconds, validation result, route, metrics en estimated GPU cost vastleggen.',
      proof: ['Vereist bewijs: AWS-run artifact dat source reference, vLLM endpoint, validation route, metrics, cost estimate, artifact refs en batch-metrics/v1 output verbindt.'],
      bottleneck: 'Er is geen AWS vLLM deployment of smoke artifact. Bestaande kostendocs en lokale runtime metrics zijn managementcontext, geen AWS-runbewijs.',
      owner: 'Eigenaar vereist: AWS runtime-eigenaar voor deployment en cost-bearing smoke run.',
    },
    {
      name: 'Parser-isolatie review en acceptatie',
      must: 'De Gemma-implementatie en Terraform-diff moeten bewijzen dat alleen ruwe e-mail read access wordt gedeeld en dat de parser queue, parser processor Lambda, parser records table, parser graph bucket, graph runtime of parser Lambda deployment workflow niet worden gemuteerd of als afhankelijkheid gebruikt.',
      proof: ['Vereist bewijs: implementatie/Terraform diff review, static checklist die verboden parserresources benoemt en bewijs dat het productie-parser deployment path onaangeraakt blijft.'],
      bottleneck: 'Er is nog geen Gemma-diff, dus parser-isolatie kan alleen vanuit bekende grenzen worden beweerd; het kan niet als gesloten worden geaccepteerd.',
      owner: 'Eigenaar vereist: reviewer met autoriteit over productie-parsergrens en devops Terraform-diff.',
    },
  ];

  const gates = model.gates.map((gate, index) => ({
    ...gate,
    ...translatedGates[index],
  }));
  const statusCounts = model.statusCounts;
  const typeCounts = model.typeCounts;
  const blocked = gates.filter((gate) => gate.state === 'blocked' || gate.owner.toLowerCase().includes('eigenaar vereist'));

  return {
    ...model,
    schema: 'living-doc-accountability-path/v1',
    locale: 'nl',
    title: 'Gemma Inference Extractie-MVP',
    subtitle: 'Aparte inference-lane voor bijna-productie order-e-mailextractie',
    objective: 'Bewijs een apart Gemma 4 inference-extractiepad voor Track&Back order-e-mails dat leest uit dezelfde ruwe e-mailopslagbron als het huidige parsersysteem, maar draait via eigen Terraform-managed queue, worker, validatie, aparte encrypted artifact storage, DynamoDB-result index, audit storage, metrics en cost-control resources. De MVP moet deterministische e-mailnormalisatie bevatten, een deterministische preflight-parser, een AWS-hosted Gemma 4 inference server met vLLM OpenAI-compatible API, LM Studio als lokale ontwikkelruntime, gevalideerde modeloutput vóór acceptatie, een agentic auditloop zonder runtime-truth authority, en geen wijzigingen aan het huidige productie-parserpad.',
    successCondition: 'Een kleine AWS-backed Gemma 4-run kan genormaliseerde ruwe order-e-mails vanuit de gedeelde S3-bron verwerken via deterministische preflight en de aparte Gemma-lane, Gemma-eigen S3-artifacts en DynamoDB-geïndexeerde accepted/review/rejected extraction records met evidence, validatiestatus, runtime en geschatte GPU-kosten produceren, een agentic auditpass over die artifacts draaien, en via tests en Terraform-reviewbewijs aantonen dat het bestaande productie-parserpad onaangeraakt blijft.',
    accountabilityReadout: 'Dit is geen enkele implementatietaak. Het living doc definieert voltooiing als een set bewijs-poorten. Sommige poorten zijn codewerk, maar andere vereisen infrastructuurbesluiten, acceptatie-eigenaarschap, AWS-bewijs, opslagbewijs, auditbewijs, parser-isolatiereview, operationeel eigenaarschap of expliciete scopeverwijdering.',
    schedulingBasis: 'Dit kan vanuit het huidige document niet eerlijk tot een datum worden gereduceerd. De resterende afrondingsvoorwaarde is een set bewijs-poorten.',
    implementationAlone: 'Nee',
    statusCounts,
    typeCounts,
    ownerRequiredCount: gates.filter((gate) => gate.owner.toLowerCase().includes('eigenaar vereist')).length,
    gates,
    bottlenecks: blocked.slice(0, 8).map((gate) => ({
      name: gate.bottleneck.split('.')[0] || gate.name,
      blocks: `Poort ${gates.indexOf(gate) + 1}: ${gate.name}`,
      why: gate.bottleneck,
      owner: gate.owner.toLowerCase().includes('eigenaar vereist') ? gate.owner : 'Eigenaar vereist: acceptatie-eigenaar is niet uit het doc afleidbaar.',
      ifSkipped: `Als dit wordt overgeslagen, kan ${gate.name} niet als gesloten worden geteld en moet de finishclaim worden gedowngraded.`,
    })),
    proofLedger: {
      proven: [
        'Gedocumenteerde lokale LM Studio-smoke verwerkte ringelling-cv_shipment-created.eml tegen gemma-4-e4b-it, schreef gemma-model-response/v1 plus extraction-result/v1 artifacts weg en routeerde naar review met event_type=shipment.',
        'Gedocumenteerde lokale tests dekken deterministic_complete order confirmation, extraction-result/v1 emission, Gemma fallback wrapping, lokale storage-key-v1 artifact writes, DynamoDB projection shape, candidate-hint non-authority, raw HTML omission en negatieve extraction-result/v1 checks.',
        'Terraform-locatie is geïdentificeerd: /Users/rene/projects/trackandback-devops-dashboard/terraform/trackandback/email/main.tf. Lokale terraform plan/apply is niet toegestaan.',
      ],
      partial: [
        'Lokaal runtime-adapterbewijs ondersteunt LM Studio-ontwikkeling; het voldoet niet aan AWS vLLM MVP-afsluiting.',
        'E-mailnormalisatie en prompt-compactie zijn gedeeltelijk getest; representatieve normalized-input artifact review ontbreekt nog.',
        'Het opslagcontract is lokaal bewezen met filesystem artifacts en DynamoDB projection JSON; AWS encrypted S3/DynamoDB resources en echt writer proof ontbreken.',
        'Deterministische preflight en validatiecontract zijn lokaal geoefend; AWS-routebewijs, audit sampling en bredere negatieve fixtures ontbreken nog.',
      ],
      missing: [
        'Gekozen AWS compute primitive en GPU-kostenhouding.',
        'Deployed AWS vLLM endpoint met health/model-check artifact.',
        'Devops-dashboard Terraform PR, GitHub Actions plan, reviewbewijs en trusted apply path.',
        'AWS queued extraction run artifact dat source reference, endpoint, extraction-result/v1, validation route, metrics en cost estimate verbindt.',
        'Agentic auditrunner, audit-finding/v1 records, route-preservation tests en held-email dashboard/API surface.',
        'Parser-isolatiereview over echte Gemma-code en Terraform-diff.',
      ],
      invalid: [
        'Lokale LM Studio-smoke is geen AWS-bewijs.',
        'Kostenmodel-CSV en bestaande docs zijn geen gemeten AWS-runtime/kostenbewijs.',
        'Bekende parsergrenzen zijn geen parser-isolatieacceptatie zonder Gemma-diffreview.',
        'Lokale filesystem artifacts zijn geen Gemma-eigen encrypted AWS S3/DynamoDB bewijs.',
      ],
    },
    finishLabel: 'AWS-backed vLLM-run, gevalideerde extraction-result/v1 records, Gemma-eigen S3-artifacts, DynamoDB-geïndexeerde resultaten, opslagbewijs, auditbewijs, kosten/metricsbewijs en parser-isolatiebewijs.',
    finishCheck: 'Het gevraagde finishantwoord is onverenigbaar met de huidige definitie van done in het living doc tenzij de vereiste bewijs-poorten zijn afgerond of expliciet zijn verwijderd met benoemd risico.',
    managerSummary: `${gates.length} poorten blijven over in het verantwoordingspad, en ${gates.filter((gate) => gate.types.some((type) => type !== 'implementation work' && type !== 'proof/evidence work')).length} zijn niet alleen van implementatie afhankelijk. De blokkerende poorten zijn AWS compute selection, Terraform delivery, AWS vLLM smoke, AWS storage/DynamoDB proof, agentic audit en parser isolation review. Afsluiting vereist bewijsartifacts en eigenaarschapsbesluiten, geen datumgok.`,
  };
}

function renderHtml(model) {
  const labels = ui(model.locale || 'en');
  const locale = model.locale || 'en';
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
      <p><strong>"${esc(modelFinishWord(model, locale))}" ${esc(labels.currentlyMeans)}:</strong> ${esc(model.finishLabel)}</p>
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
          <div class="chips">${chip(statusLabel(gate.state, locale), stateClass(gate.state))}${typeHtml(gate.types)}${gate.owner.toLowerCase().includes(locale === 'nl' ? 'eigenaar vereist' : 'owner required') ? chip(locale === 'nl' ? 'Eigenaar vereist' : 'Owner required', 'owner-required') : ''}</div>
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
    const isGemmaDoc = doc.docId === 'gemma-inference-extraction-mvp' || doc.title === 'Gemma Inference Extraction MVP';
    model = isGemmaDoc ? buildGemmaModel(doc, sourcePath) : buildGenericModel(doc, sourcePath);
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
