#!/usr/bin/env node
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAN_CONVERGENCE_TYPE = 'objective-closure-plan';

function stableNormalize(value) {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableNormalize(entry)]),
  );
}

function stableStringify(value) {
  return JSON.stringify(stableNormalize(value));
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function refId(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  return String(value.id ?? value.sectionId ?? value.cardId ?? value.value ?? value.text ?? '').trim();
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map(refId).filter(Boolean))];
}

function cardKey(card) {
  return String(card?.id ?? card?.name ?? card?.title ?? '').trim();
}

function isPlanSection(section) {
  return section?.convergenceType === PLAN_CONVERGENCE_TYPE;
}

function findSections(doc, sectionIds) {
  const sectionsById = new Map(asArray(doc.sections).map((section) => [section.id, section]));
  return sectionIds.map((sectionId) => sectionsById.get(sectionId)).filter(Boolean);
}

function collectPlanCards(doc) {
  return asArray(doc.sections)
    .filter(isPlanSection)
    .flatMap((section) => asArray(section.data).map((card) => ({ section, card })));
}

function watchedSectionIds(doc, planCard) {
  const explicitSectionIds = uniqueNonEmpty([
    ...asArray(planCard.watchedSections),
    ...asArray(planCard.sectionIds),
  ]);

  if (explicitSectionIds.length > 0) return explicitSectionIds;

  return asArray(doc.sections)
    .filter((section) => !isPlanSection(section))
    .map((section) => section.id)
    .filter(Boolean);
}

function watchedCardIds(planCard) {
  return uniqueNonEmpty(asArray(planCard.watchedCards));
}

function cloneWatchedSection(section) {
  const clone = stableNormalize(section);
  delete clone.dataAi;
  delete clone.ai;
  return clone;
}

function collectFocusedCards(doc, cardIds) {
  if (cardIds.length === 0) return [];

  const matches = [];
  for (const section of asArray(doc.sections)) {
    if (isPlanSection(section)) continue;
    for (const card of asArray(section.data)) {
      if (cardIds.includes(cardKey(card))) {
        matches.push({
          sectionId: section.id,
          card: stableNormalize(card),
        });
      }
    }
  }
  return matches;
}

export function buildObjectiveClosurePlanBasis(doc, planCard) {
  const sectionIds = watchedSectionIds(doc, planCard);
  const cardIds = watchedCardIds(planCard);
  const sections = findSections(doc, sectionIds);
  const focusedCards = collectFocusedCards(doc, cardIds);

  return stableNormalize({
    schema: 'objective-closure-plan-basis/v1',
    objective: doc.objective ?? '',
    successCondition: doc.successCondition ?? '',
    watchedSections: sections.map(cloneWatchedSection),
    watchedCards: focusedCards,
  });
}

export function computeObjectiveClosurePlanFingerprint(doc, planCard) {
  return sha256(stableStringify(buildObjectiveClosurePlanBasis(doc, planCard)));
}

function storedFingerprint(planCard) {
  if (typeof planCard?.basisFingerprint === 'string') return planCard.basisFingerprint;
  if (typeof planCard?.check?.basisFingerprint === 'string') return planCard.check.basisFingerprint;

  const checkItems = asArray(planCard?.check);
  const checkItem = checkItems.find((item) => typeof item?.basisFingerprint === 'string');
  return checkItem?.basisFingerprint ?? '';
}

function missingRefs(doc, planCard) {
  const sectionIds = watchedSectionIds(doc, planCard);
  const existingSectionIds = new Set(asArray(doc.sections).map((section) => section.id));
  const missingSections = sectionIds.filter((sectionId) => !existingSectionIds.has(sectionId));

  const cardIds = watchedCardIds(planCard);
  const existingCardIds = new Set(
    asArray(doc.sections)
      .filter((section) => !isPlanSection(section))
      .flatMap((section) => asArray(section.data).map(cardKey).filter(Boolean)),
  );
  const missingCards = cardIds.filter((cardId) => !existingCardIds.has(cardId));

  return { missingSections, missingCards };
}

export function checkObjectiveClosurePlan(doc, planCard) {
  const basisFingerprint = storedFingerprint(planCard);
  const currentFingerprint = computeObjectiveClosurePlanFingerprint(doc, planCard);
  const { missingSections, missingCards } = missingRefs(doc, planCard);
  const driftReasons = [];

  for (const sectionId of missingSections) {
    driftReasons.push(`watched section not found: ${sectionId}`);
  }
  for (const cardId of missingCards) {
    driftReasons.push(`watched card not found: ${cardId}`);
  }

  let status = 'current';
  if (!basisFingerprint) {
    status = 'unknown';
    driftReasons.push('stored basis fingerprint missing');
  } else if (basisFingerprint !== currentFingerprint) {
    status = 'stale';
    driftReasons.push('stored basis fingerprint does not match watched living-doc content');
  }

  if (missingSections.length > 0 || missingCards.length > 0) {
    status = status === 'unknown' ? 'unknown' : 'stale';
  }

  return {
    id: planCard.id ?? planCard.name ?? '(unnamed plan)',
    status,
    basisFingerprint,
    currentFingerprint,
    driftReasons,
    watchedSections: watchedSectionIds(doc, planCard),
    watchedCards: watchedCardIds(planCard),
  };
}

export function checkObjectiveClosurePlans(doc) {
  const plans = collectPlanCards(doc).map(({ card }) => checkObjectiveClosurePlan(doc, card));
  return {
    schema: 'objective-closure-plan-check/v1',
    status: plans.length > 0 && plans.every((plan) => plan.status === 'current') ? 'current' : 'stale',
    plans,
  };
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function renderCliSummary(result, filePath) {
  const lines = [`objective closure plan check for ${filePath}: ${result.status}`];
  if (result.plans.length === 0) {
    lines.push('- no objective-closure-plan cards found');
  }

  for (const plan of result.plans) {
    lines.push(`- ${plan.id}: ${plan.status}`);
    lines.push(`  stored: ${plan.basisFingerprint || '(missing)'}`);
    lines.push(`  current: ${plan.currentFingerprint}`);
    for (const reason of plan.driftReasons) {
      lines.push(`  reason: ${reason}`);
    }
  }
  return lines.join('\n');
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/check-objective-closure-plan.mjs <living-doc.json>');
    process.exit(2);
  }

  try {
    const doc = await loadJson(filePath);
    const result = checkObjectiveClosurePlans(doc);
    console.log(renderCliSummary(result, filePath));
    process.exit(result.status === 'current' ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
