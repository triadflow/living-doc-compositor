export const WORKFLOW_GROUNDED_EVENTS_SCRIPT = String.raw`import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [manifestPath, changedPathFile, beforeSha, afterSha, repo] = process.argv.slice(2);
const SCHEMA_VERSION = '2026-04-19';
const ZERO_SHA = '0000000000000000000000000000000000000000';

main();

function main() {
  const manifest = readJsonFile(manifestPath);
  const changedPaths = readLines(changedPathFile);
  const artifact = readCommitArtifact(afterSha);
  const entries = normalizeManifestEntries(manifest);
  const events = [];

  for (const entry of entries) {
    const trackedPaths = normalizeTrackedPaths(entry.trackedPaths);
    const matchedPaths = trackedPaths.filter((trackedPath) => changedPaths.includes(trackedPath));
    if (!matchedPaths.length) continue;

    const artifactEvents = extractArtifactEvents(artifact, entry, repo, matchedPaths, afterSha);
    if (artifactEvents.length) {
      events.push(...artifactEvents);
      continue;
    }

    events.push(buildHeuristicEvent(entry, trackedPaths, matchedPaths, repo, beforeSha, afterSha));
  }

  process.stdout.write(JSON.stringify(events, null, 2));
}

function readLines(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readGitJson(revision, filePath) {
  if (!revision || revision === ZERO_SHA) return null;
  try {
    const raw = execFileSync('git', ['show', revision + ':' + filePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readCommitArtifact(sha) {
  const shortSha = shortCommit(sha);
  const candidates = [
    '.living-doc/commits/' + sha + '.json',
    '.living-docs/commits/' + sha + '.json',
    '.living-doc/commits/' + shortSha + '.json',
    '.living-docs/commits/' + shortSha + '.json',
  ];
  for (const candidate of candidates) {
    const artifact = readJsonFile(candidate);
    if (artifact) return artifact;
  }
  return null;
}

function normalizeManifestEntries(manifest) {
  const entries = Array.isArray(manifest && manifest.docs)
    ? manifest.docs
    : Array.isArray(manifest && manifest.entries)
      ? manifest.entries
      : [];
  return entries.filter((entry) =>
    entry
    && typeof entry === 'object'
    && readString(entry.docId)
    && readString(entry.title)
    && readString(entry.publicUrl)
  );
}

function normalizeTrackedPaths(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

function extractArtifactEvents(artifact, entry, repo, matchedPaths, sha) {
  const candidates = normalizeArtifactEvents(artifact);
  return candidates
    .filter((candidate) => {
      const candidateDocId = readString(candidate.docId);
      return !candidateDocId || candidateDocId === entry.docId;
    })
    .map((candidate) => normalizeArtifactEvent(candidate, entry, repo, matchedPaths, sha))
    .filter(Boolean);
}

function normalizeArtifactEvents(artifact) {
  if (!artifact) return [];
  if (Array.isArray(artifact)) return artifact.filter(isObject);
  if (!isObject(artifact)) return [];
  if (Array.isArray(artifact.events)) return artifact.events.filter(isObject);
  if (isObject(artifact.event)) return [artifact.event];
  if (readString(artifact.title) || Array.isArray(artifact.blocks)) return [artifact];
  return [];
}

function normalizeArtifactEvent(candidate, entry, repo, matchedPaths, sha) {
  const title = readString(candidate.title) || entry.title + ' updated';
  const body = readString(candidate.body) || ('Structured event loaded from commit artifact for ' + entry.title + '.');
  const evidence = normalizeEvidence(candidate.evidence);
  const defaultEvidence = buildTopLevelEvidence(repo, sha, matchedPaths, entry);
  return {
    ...candidate,
    schemaVersion: readString(candidate.schemaVersion) || SCHEMA_VERSION,
    kind: readString(candidate.kind) || 'grounded-claim',
    docId: readString(candidate.docId) || entry.docId,
    docTitle: readString(candidate.docTitle) || entry.title,
    title,
    body,
    url: readString(candidate.url) || entry.publicUrl,
    status: readString(candidate.status) || undefined,
    audience: readString(candidate.audience) || undefined,
    repo: readString(candidate.repo) || repo,
    source: readString(candidate.source) || repo,
    transition: normalizeTransition(candidate.transition),
    intent: normalizeIntent(candidate.intent),
    grounding: normalizeGrounding(candidate.grounding),
    openQuestions: normalizeStringList(candidate.openQuestions),
    evidence: evidence.length ? evidence : defaultEvidence,
    blocks: normalizeBlocks(candidate.blocks),
  };
}

function buildHeuristicEvent(entry, trackedPaths, matchedPaths, repo, beforeSha, afterSha) {
  const jsonPath = trackedPaths.find((trackedPath) => trackedPath.endsWith('.json')) || null;
  const beforeDoc = jsonPath ? readGitJson(beforeSha, jsonPath) : null;
  const afterDoc = jsonPath ? readJsonFile(jsonPath) : null;
  const blocks = buildBlocks(entry, matchedPaths, jsonPath, beforeDoc, afterDoc, afterSha);
  const firstBlock = blocks[0];
  const shortShaValue = shortCommit(afterSha);
  const title = firstBlock
    ? blocks.length === 1
      ? firstBlock.blockTitle + ' updated'
      : entry.title + ' updated (' + blocks.length + ' blocks)'
    : entry.title + ' updated';
  const body = firstBlock
    ? blocks.length === 1
      ? firstBlock.summary
      : 'Commit ' + shortShaValue + ' changed ' + blocks.length + ' blocks in ' + entry.title + '.'
    : 'Commit ' + shortShaValue + ' updated ' + entry.title + ' in ' + repo + '.';

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'living-doc-diff',
    docId: entry.docId,
    docTitle: entry.title,
    title,
    body,
    url: entry.publicUrl,
    status: firstBlock && firstBlock.honestStatus ? firstBlock.honestStatus : 'updated',
    audience: firstBlock && firstBlock.audience ? firstBlock.audience : undefined,
    repo,
    source: repo,
    transition: firstBlock && firstBlock.transition
      ? firstBlock.transition
      : { label: 'Updated', to: 'updated', tone: 'accent' },
    evidence: buildTopLevelEvidence(repo, afterSha, matchedPaths, entry),
    grounding: {
      status: 'warning',
      summary: 'Derived from living-doc JSON diff in GitHub Actions; session intent is unavailable.',
    },
    blocks,
  };
}

function buildBlocks(entry, matchedPaths, jsonPath, beforeDoc, afterDoc, sha) {
  if (beforeDoc && afterDoc) {
    const sectionBlocks = diffSections(beforeDoc, afterDoc, jsonPath, sha);
    if (sectionBlocks.length) return sectionBlocks.slice(0, 4);
    const rootBlock = buildRootBlock(beforeDoc, afterDoc, entry, matchedPaths, sha, jsonPath);
    if (rootBlock) return [rootBlock];
  }

  if (!beforeDoc && afterDoc) {
    return [buildDocLifecycleBlock('added', entry, matchedPaths, sha, jsonPath)];
  }

  if (beforeDoc && !afterDoc) {
    return [buildDocLifecycleBlock('removed', entry, matchedPaths, sha, jsonPath)];
  }

  return [buildFallbackBlock(entry, matchedPaths, sha, jsonPath)];
}

function diffSections(beforeDoc, afterDoc, jsonPath, sha) {
  const beforeSections = Array.isArray(beforeDoc.sections) ? beforeDoc.sections.filter(isObject) : [];
  const afterSections = Array.isArray(afterDoc.sections) ? afterDoc.sections.filter(isObject) : [];
  const beforeMap = new Map(beforeSections.map((section) => [readString(section.id), section]).filter(([id]) => id));
  const afterMap = new Map(afterSections.map((section) => [readString(section.id), section]).filter(([id]) => id));
  const orderedIds = unique([
    ...afterSections.map((section) => readString(section.id)).filter(Boolean),
    ...beforeSections.map((section) => readString(section.id)).filter(Boolean),
  ]);

  const blocks = [];
  for (const sectionId of orderedIds) {
    const beforeSection = beforeMap.get(sectionId) || null;
    const afterSection = afterMap.get(sectionId) || null;

    if (beforeSection && afterSection && stableJson(beforeSection) === stableJson(afterSection)) {
      continue;
    }

    if (!beforeSection || !afterSection) {
      blocks.push(buildSectionLifecycleBlock(sectionId, beforeSection, afterSection, jsonPath, sha));
      continue;
    }

    const cardBlocks = diffCards(sectionId, beforeSection, afterSection, jsonPath, sha);
    if (cardBlocks.length) {
      blocks.push(...cardBlocks.slice(0, Math.max(1, 4 - blocks.length)));
      if (blocks.length >= 4) break;
      continue;
    }

    const sectionBlock = buildSectionUpdateBlock(sectionId, beforeSection, afterSection, jsonPath, sha);
    if (!sectionBlock) continue;

    blocks.push(sectionBlock);
    if (blocks.length >= 4) break;
  }

  return blocks;
}

function diffCards(sectionId, beforeSection, afterSection, jsonPath, sha) {
  const beforeCards = identifiableCards(beforeSection.data);
  const afterCards = identifiableCards(afterSection.data);
  if (!beforeCards.length && !afterCards.length) return [];

  const beforeMap = new Map(beforeCards.map((card) => [readString(card.id), card]));
  const afterMap = new Map(afterCards.map((card) => [readString(card.id), card]));
  const orderedIds = unique([
    ...afterCards.map((card) => readString(card.id)).filter(Boolean),
    ...beforeCards.map((card) => readString(card.id)).filter(Boolean),
  ]);

  const blocks = [];
  for (const cardId of orderedIds) {
    const beforeCard = beforeMap.get(cardId) || null;
    const afterCard = afterMap.get(cardId) || null;

    if (beforeCard && afterCard && stableJson(beforeCard) === stableJson(afterCard)) {
      continue;
    }

    if (beforeCard && afterCard && !hasMeaningfulFieldChanges(beforeCard, afterCard)) {
      continue;
    }

    blocks.push(buildCardBlock(sectionId, titleForSection(afterSection || beforeSection, sectionId), cardId, beforeCard, afterCard, jsonPath, sha));
    if (blocks.length >= 3) break;
  }

  return blocks;
}

function buildCardBlock(sectionId, sectionTitle, cardId, beforeCard, afterCard, jsonPath, sha) {
  const currentCard = afterCard || beforeCard || {};
  const blockTitle = cardTitle(currentCard, cardId);
  const summary = summarizeCardChange(sectionTitle, beforeCard, afterCard);
  const transition = transitionForChange(beforeCard, afterCard);
  const honestStatus = readString(afterCard && afterCard.status) || readString(beforeCard && beforeCard.status) || transition.to || 'updated';

  return {
    blockId: sectionId + ':' + cardId,
    blockTitle,
    audience: sectionTitle,
    summary,
    before: describeEntity(beforeCard),
    after: describeEntity(afterCard),
    honestStatus,
    transition,
    evidence: buildBlockEvidence(sectionTitle, jsonPath, sha, blockTitle),
    groundingWarning: 'Derived from living-doc JSON diff only; no session-memory intent artifact was attached.',
  };
}

function buildSectionLifecycleBlock(sectionId, beforeSection, afterSection, jsonPath, sha) {
  const section = afterSection || beforeSection || {};
  const sectionTitle = titleForSection(section, sectionId);
  const isAdded = Boolean(afterSection && !beforeSection);
  const tone = isAdded ? 'accent' : 'warning';
  const to = isAdded ? 'added' : 'removed';
  return {
    blockId: 'section:' + sectionId,
    blockTitle: sectionTitle,
    audience: readString(section.convergenceType) || 'section',
    summary: isAdded
      ? 'Section added with ' + itemCount(afterSection) + ' cards.'
      : 'Section removed from the document.',
    before: describeSection(beforeSection),
    after: describeSection(afterSection),
    honestStatus: to,
    transition: {
      label: isAdded ? 'Added' : 'Removed',
      to,
      tone,
    },
    evidence: buildBlockEvidence(sectionTitle, jsonPath, sha, sectionTitle),
    groundingWarning: 'Derived from section-level living-doc JSON diff only; no session-memory intent artifact was attached.',
  };
}

function buildSectionUpdateBlock(sectionId, beforeSection, afterSection, jsonPath, sha) {
  if (!hasMeaningfulFieldChanges(beforeSection, afterSection)) return null;

  const sectionTitle = titleForSection(afterSection, sectionId);
  const changedFields = summarizeChangedFields(beforeSection, afterSection).slice(0, 3);
  const summary = changedFields.length
    ? changedFields.join('; ') + '.'
    : 'Section content changed.';
  return {
    blockId: 'section:' + sectionId,
    blockTitle: sectionTitle,
    audience: readString(afterSection.convergenceType) || 'section',
    summary,
    before: describeSection(beforeSection),
    after: describeSection(afterSection),
    honestStatus: 'updated',
    transition: {
      label: 'Updated',
      to: 'updated',
      tone: 'accent',
    },
    evidence: buildBlockEvidence(sectionTitle, jsonPath, sha, sectionTitle),
    groundingWarning: 'Derived from section-level living-doc JSON diff only; no session-memory intent artifact was attached.',
  };
}

function buildRootBlock(beforeDoc, afterDoc, entry, matchedPaths, sha, jsonPath) {
  const changedFields = summarizeChangedFields(beforeDoc, afterDoc).filter((field) => !field.startsWith('updated '));
  if (!changedFields.length) return null;

  return {
    blockId: 'doc:' + entry.docId,
    blockTitle: entry.title,
    audience: 'Document metadata',
    summary: changedFields.slice(0, 3).join('; ') + '.',
    before: describeDoc(beforeDoc),
    after: describeDoc(afterDoc),
    honestStatus: 'updated',
    transition: {
      label: 'Updated',
      to: 'updated',
      tone: 'accent',
    },
    evidence: buildBlockEvidence(entry.title, jsonPath, sha, matchedPaths.join(', ')),
    groundingWarning: 'Derived from document-level JSON diff only; no section or card delta was identifiable.',
  };
}

function buildDocLifecycleBlock(kind, entry, matchedPaths, sha, jsonPath) {
  const added = kind === 'added';
  return {
    blockId: 'doc:' + entry.docId,
    blockTitle: entry.title,
    audience: 'Document',
    summary: added
      ? 'Tracked living doc was added to the repo.'
      : 'Tracked living doc was removed from the repo.',
    before: added ? '' : 'Document present before this commit.',
    after: added ? 'Document present after this commit.' : '',
    honestStatus: kind,
    transition: {
      label: added ? 'Added' : 'Removed',
      to: kind,
      tone: added ? 'accent' : 'warning',
    },
    evidence: buildBlockEvidence(entry.title, jsonPath, sha, matchedPaths.join(', ')),
    groundingWarning: 'Derived from tracked-file lifecycle only; no structured block artifact was attached.',
  };
}

function buildFallbackBlock(entry, matchedPaths, sha, jsonPath) {
  return {
    blockId: 'doc:' + entry.docId,
    blockTitle: entry.title,
    audience: 'Document',
    summary: 'Tracked living-doc files changed in this commit.',
    before: '',
    after: '',
    honestStatus: 'updated',
    transition: {
      label: 'Updated',
      to: 'updated',
      tone: 'accent',
    },
    evidence: buildBlockEvidence(entry.title, jsonPath, sha, matchedPaths.join(', ')),
    groundingWarning: 'Derived from tracked-file changes only; no parseable living-doc JSON diff was available.',
  };
}

function buildTopLevelEvidence(repo, sha, matchedPaths, entry) {
  const evidence = [
    {
      kind: 'commit',
      label: shortCommit(sha),
      detail: 'Generated from living-doc changes in ' + repo + '.',
    },
  ];

  if (matchedPaths.length) {
    evidence.push({
      kind: 'tracked-paths',
      label: String(matchedPaths.length) + ' path' + (matchedPaths.length === 1 ? '' : 's'),
      detail: matchedPaths.join(', '),
    });
  }

  evidence.push({
    kind: 'doc',
    label: entry.title,
    detail: entry.docId,
  });

  return evidence;
}

function buildBlockEvidence(sectionTitle, jsonPath, sha, detail) {
  const evidence = [
    {
      kind: 'commit',
      label: shortCommit(sha),
      detail: 'Detected from commit-time living-doc diff.',
    },
  ];
  if (jsonPath) {
    evidence.push({
      kind: 'json-path',
      label: path.basename(jsonPath),
      detail: detail || jsonPath,
    });
  }
  if (sectionTitle) {
    evidence.push({
      kind: 'section',
      label: sectionTitle,
    });
  }
  return evidence;
}

function summarizeCardChange(sectionTitle, beforeCard, afterCard) {
  if (!beforeCard && afterCard) return 'Added in ' + sectionTitle + '.';
  if (beforeCard && !afterCard) return 'Removed from ' + sectionTitle + '.';

  const changes = summarizeChangedFields(beforeCard, afterCard);
  if (!changes.length) return 'Updated in ' + sectionTitle + '.';
  return changes.slice(0, 3).join('; ') + '.';
}

function summarizeChangedFields(beforeValue, afterValue) {
  const fields = diffKeys(beforeValue, afterValue);
  const summaries = [];

  const beforeStatus = readString(beforeValue && beforeValue.status);
  const afterStatus = readString(afterValue && afterValue.status);
  if (beforeStatus !== afterStatus) {
    if (!beforeStatus && afterStatus) summaries.push('status set to ' + afterStatus);
    else if (beforeStatus && !afterStatus) summaries.push('status cleared from ' + beforeStatus);
    else summaries.push('status ' + beforeStatus + ' -> ' + afterStatus);
  }

  const beforeName = displayLabel(beforeValue);
  const afterName = displayLabel(afterValue);
  if (beforeName && afterName && beforeName !== afterName) {
    summaries.push('renamed to ' + afterName);
  }

  if (fields.includes('notes')) summaries.push('notes updated');
  if (fields.includes('updated')) summaries.push('updated timestamp changed');
  if (fields.includes('codePaths')) summaries.push('code references changed');
  if (fields.includes('ticketIds')) summaries.push('linked tickets changed');
  if (fields.includes('stats')) summaries.push('snapshot stats changed');
  if (fields.includes('callout')) summaries.push('callout content changed');

  for (const field of fields) {
    if (field === 'status' || field === 'name' || field === 'title' || field === 'notes' || field === 'updated' || field === 'codePaths' || field === 'ticketIds' || field === 'stats' || field === 'callout' || field === 'id') {
      continue;
    }
    summaries.push(fieldLabel(field) + ' changed');
    if (summaries.length >= 4) break;
  }

  return unique(summaries);
}

function diffKeys(beforeValue, afterValue) {
  const beforeKeys = isObject(beforeValue) ? Object.keys(beforeValue) : [];
  const afterKeys = isObject(afterValue) ? Object.keys(afterValue) : [];
  return unique(beforeKeys.concat(afterKeys)).filter((key) =>
    stableJson(beforeValue && beforeValue[key]) !== stableJson(afterValue && afterValue[key])
  );
}

function hasMeaningfulFieldChanges(beforeValue, afterValue) {
  return diffKeys(beforeValue, afterValue).some((key) => key !== 'updated');
}

function transitionForChange(beforeValue, afterValue) {
  const beforeStatus = readString(beforeValue && beforeValue.status);
  const afterStatus = readString(afterValue && afterValue.status);

  if (!beforeValue && afterValue) {
    return { label: 'Added', to: afterStatus || 'added', tone: toneForStatus(afterStatus || 'added') };
  }

  if (beforeValue && !afterValue) {
    return { label: 'Removed', from: beforeStatus || 'present', to: 'removed', tone: 'warning' };
  }

  if (beforeStatus && afterStatus && beforeStatus !== afterStatus) {
    return {
      label: beforeStatus + ' -> ' + afterStatus,
      from: beforeStatus,
      to: afterStatus,
      tone: toneForStatus(afterStatus),
    };
  }

  return {
    label: 'Updated',
    to: afterStatus || beforeStatus || 'updated',
    tone: toneForStatus(afterStatus || beforeStatus || 'updated'),
  };
}

function toneForStatus(status) {
  const normalized = readString(status).toLowerCase();
  if (/(ready|built|grounded|done|resolved|green|success|ok)/.test(normalized)) return 'success';
  if (/(blocked|error|fail|broken|red|removed)/.test(normalized)) return 'danger';
  if (/(warning|partial|preview|review|needs|stale|question)/.test(normalized)) return 'warning';
  return 'accent';
}

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((entry) => ({
    kind: readString(entry.kind) || 'evidence',
    label: readString(entry.label) || 'detail',
    ...(readString(entry.detail) ? { detail: readString(entry.detail) } : {}),
    ...(readString(entry.href) ? { href: readString(entry.href) } : {}),
  }));
}

function normalizeBlocks(value) {
  if (!Array.isArray(value)) return undefined;
  const blocks = value.filter(isObject).map((entry) => ({
    ...(readString(entry.blockId) ? { blockId: readString(entry.blockId) } : {}),
    blockTitle: readString(entry.blockTitle) || 'Block',
    ...(readString(entry.audience) ? { audience: readString(entry.audience) } : {}),
    ...(readString(entry.summary) ? { summary: readString(entry.summary) } : {}),
    ...(readString(entry.before) ? { before: readString(entry.before) } : {}),
    ...(readString(entry.after) ? { after: readString(entry.after) } : {}),
    ...(readString(entry.honestStatus) ? { honestStatus: readString(entry.honestStatus) } : {}),
    ...(normalizeTransition(entry.transition) ? { transition: normalizeTransition(entry.transition) } : {}),
    ...(normalizeIntent(entry.intent) ? { intent: normalizeIntent(entry.intent) } : {}),
    ...(normalizeEvidence(entry.evidence).length ? { evidence: normalizeEvidence(entry.evidence) } : {}),
    ...(normalizeStringList(entry.openQuestions)?.length ? { openQuestions: normalizeStringList(entry.openQuestions) } : {}),
    ...(readString(entry.groundingWarning) ? { groundingWarning: readString(entry.groundingWarning) } : {}),
  }));
  return blocks.length ? blocks : undefined;
}

function normalizeTransition(value) {
  if (!isObject(value)) return undefined;
  const label = readString(value.label);
  const from = readString(value.from);
  const to = readString(value.to);
  const tone = readString(value.tone);
  if (!label && !from && !to && !tone) return undefined;
  return {
    ...(label ? { label } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(tone ? { tone } : {}),
  };
}

function normalizeIntent(value) {
  if (!isObject(value)) return undefined;
  const summary = readString(value.summary);
  if (!summary) return undefined;
  const source = readString(value.source);
  return source ? { summary, source } : { summary };
}

function normalizeGrounding(value) {
  if (!isObject(value)) return undefined;
  const status = readString(value.status);
  const summary = readString(value.summary);
  if (!status && !summary) return undefined;
  return {
    ...(status ? { status } : {}),
    ...(summary ? { summary } : {}),
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(readString).filter(Boolean);
  return items.length ? items : undefined;
}

function identifiableCards(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isObject(entry) && readString(entry.id));
}

function titleForSection(section, fallbackId) {
  return readString(section && section.title) || readString(section && section.name) || fallbackId;
}

function cardTitle(card, fallbackId) {
  return readString(card && card.name) || readString(card && card.title) || fallbackId;
}

function describeEntity(value) {
  if (!isObject(value)) return '';
  const parts = [];
  const label = displayLabel(value);
  const status = readString(value.status);
  const updated = readString(value.updated);
  if (label) parts.push(label);
  if (status) parts.push('status ' + status);
  if (updated) parts.push('updated ' + updated);
  return parts.join(' · ');
}

function describeSection(value) {
  if (!isObject(value)) return '';
  const parts = [titleForSection(value, readString(value.id) || 'section')];
  const count = itemCount(value);
  if (count) parts.push(String(count) + ' cards');
  if (readString(value.convergenceType)) parts.push(readString(value.convergenceType));
  return parts.join(' · ');
}

function describeDoc(value) {
  if (!isObject(value)) return '';
  const parts = [];
  if (readString(value.title)) parts.push(readString(value.title));
  const count = Array.isArray(value.sections) ? value.sections.length : 0;
  if (count) parts.push(String(count) + ' sections');
  if (readString(value.updated)) parts.push('updated ' + readString(value.updated));
  return parts.join(' · ');
}

function itemCount(section) {
  return Array.isArray(section && section.data) ? section.data.length : 0;
}

function displayLabel(value) {
  if (!isObject(value)) return '';
  return readString(value.name) || readString(value.title) || '';
}

function fieldLabel(value) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
}

function shortCommit(sha) {
  return readString(sha).slice(0, 7);
}

function stableJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
`;
