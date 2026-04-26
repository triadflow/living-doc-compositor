export const DELIVERY_FEED_BRANCH = 'living-docs-feed';
export const DELIVERY_FEED_DIR = '.living-docs/feed';
export const DELIVERY_FEED_PER_REPO_LIMIT = 20;

export type DeliveryFeedTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export type DeliveryFeedTransition = {
  label?: string;
  from?: string;
  to?: string;
  tone?: DeliveryFeedTone;
};

export type DeliveryFeedIntent = {
  summary: string;
  source?: string;
};

export type DeliveryFeedEvidence = {
  kind: string;
  label: string;
  detail?: string;
  href?: string;
};

export type DeliveryFeedGrounding = {
  status?: string;
  summary?: string;
};

export type DeliveryFeedBlock = {
  blockId?: string;
  blockTitle: string;
  audience?: string;
  summary?: string;
  before?: string;
  after?: string;
  honestStatus?: string;
  transition?: DeliveryFeedTransition;
  evidence?: DeliveryFeedEvidence[];
  intent?: DeliveryFeedIntent;
  openQuestions?: string[];
  groundingWarning?: string;
};

export type DeliveryFeedEvent = {
  id: string;
  title: string;
  body: string;
  schemaVersion?: string;
  kind?: string;
  docId?: string;
  docTitle?: string;
  audience?: string;
  transition?: DeliveryFeedTransition;
  intent?: DeliveryFeedIntent;
  evidence?: DeliveryFeedEvidence[];
  grounding?: DeliveryFeedGrounding;
  openQuestions?: string[];
  blocks?: DeliveryFeedBlock[];
  url?: string;
  status?: string;
  source?: string;
  createdAt: string;
  repo: string;
};

export function deliveryFeedFileName(createdAt: string, id: string): string {
  const stamp = createdAt.replace(/:/g, '-');
  return `${stamp}--${id}.json`;
}

export function parseDeliveryFeedEvent(
  content: string,
  fallbackRepo: string
): DeliveryFeedEvent | null {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const id = readString(parsed.id);
    const title = readString(parsed.title);
    const body = readString(parsed.body);
    const createdAt = readString(parsed.createdAt);
    if (!id || !title || !body || !createdAt) return null;

    return {
      id,
      title,
      body,
      createdAt,
      repo: readString(parsed.repo) || fallbackRepo,
      url: readString(parsed.url) || undefined,
      status: readString(parsed.status) || undefined,
      source: readString(parsed.source) || undefined,
      schemaVersion: readString(parsed.schemaVersion) || undefined,
      kind: readString(parsed.kind) || undefined,
      docId: readString(parsed.docId) || undefined,
      docTitle: readString(parsed.docTitle) || undefined,
      audience: readString(parsed.audience) || undefined,
      transition: parseTransition(parsed.transition),
      intent: parseIntent(parsed.intent),
      evidence: parseEvidenceList(parsed.evidence),
      grounding: parseGrounding(parsed.grounding),
      openQuestions: parseStringList(parsed.openQuestions),
      blocks: parseBlocks(parsed.blocks),
    };
  } catch {
    return null;
  }
}

export function deliveryFeedEventData(event: DeliveryFeedEvent): Record<string, any> {
  const primaryBlock = event.blocks?.[0];
  const data: Record<string, any> = {
    repo: event.repo,
    source: event.source ?? event.repo,
    delivery: 'repo-feed',
    title: event.docTitle ?? event.title,
  };

  if (event.url) data.url = event.url;
  if (event.status) data.status = event.status;
  if (event.docId) data.docId = event.docId;
  if (event.docTitle) data.docTitle = event.docTitle;
  if (event.schemaVersion) data.schemaVersion = event.schemaVersion;
  if (event.kind) data.eventKind = event.kind;
  if (event.audience) data.audience = event.audience;
  if (event.transition) data.transition = event.transition;
  if (event.intent) data.intent = event.intent;
  if (event.evidence?.length) data.evidence = event.evidence;
  if (event.grounding) data.grounding = event.grounding;
  if (event.openQuestions?.length) data.openQuestions = event.openQuestions;
  if (event.blocks?.length) data.blocks = event.blocks;

  if (primaryBlock) {
    if (primaryBlock.blockId) data.blockId = primaryBlock.blockId;
    data.blockTitle = primaryBlock.blockTitle;
    if (primaryBlock.audience && !data.audience) data.audience = primaryBlock.audience;
    if (primaryBlock.summary) data.blockSummary = primaryBlock.summary;
    if (primaryBlock.honestStatus) data.honestStatus = primaryBlock.honestStatus;
    if (primaryBlock.transition && !data.transition) data.transition = primaryBlock.transition;
    if (primaryBlock.intent && !data.intent) data.intent = primaryBlock.intent;
    if (primaryBlock.evidence?.length && !data.evidence) data.evidence = primaryBlock.evidence;
    if (primaryBlock.openQuestions?.length && !data.openQuestions) {
      data.openQuestions = primaryBlock.openQuestions;
    }
    if (primaryBlock.groundingWarning) data.groundingWarning = primaryBlock.groundingWarning;
    if (primaryBlock.before) data.before = primaryBlock.before;
    if (primaryBlock.after) data.after = primaryBlock.after;
  }

  return data;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseTransition(value: unknown): DeliveryFeedTransition | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const parsed: DeliveryFeedTransition = {};
  const label = readString((value as any).label);
  const from = readString((value as any).from);
  const to = readString((value as any).to);
  const tone = readTone((value as any).tone);
  if (label) parsed.label = label;
  if (from) parsed.from = from;
  if (to) parsed.to = to;
  if (tone) parsed.tone = tone;
  return Object.keys(parsed).length ? parsed : undefined;
}

function parseIntent(value: unknown): DeliveryFeedIntent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const summary = readString((value as any).summary);
  if (!summary) return undefined;
  const source = readString((value as any).source);
  return source ? { summary, source } : { summary };
}

function parseEvidenceList(value: unknown): DeliveryFeedEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const kind = readString((entry as any).kind);
      const label = readString((entry as any).label);
      if (!kind || !label) return null;
      const detail = readString((entry as any).detail);
      const href = readString((entry as any).href);
      return {
        kind,
        label,
        ...(detail ? { detail } : {}),
        ...(href ? { href } : {}),
      };
    })
    .filter((entry): entry is DeliveryFeedEvidence => Boolean(entry));
  return parsed.length ? parsed : undefined;
}

function parseGrounding(value: unknown): DeliveryFeedGrounding | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const status = readString((value as any).status);
  const summary = readString((value as any).summary);
  if (!status && !summary) return undefined;
  return {
    ...(status ? { status } : {}),
    ...(summary ? { summary } : {}),
  };
}

function parseBlocks(value: unknown): DeliveryFeedBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const blockTitle = readString((entry as any).blockTitle);
      if (!blockTitle) return null;
      const blockId = readString((entry as any).blockId);
      const audience = readString((entry as any).audience);
      const summary = readString((entry as any).summary);
      const before = readString((entry as any).before);
      const after = readString((entry as any).after);
      const honestStatus = readString((entry as any).honestStatus);
      const groundingWarning = readString((entry as any).groundingWarning);
      const transition = parseTransition((entry as any).transition);
      const intent = parseIntent((entry as any).intent);
      const evidence = parseEvidenceList((entry as any).evidence);
      const openQuestions = parseStringList((entry as any).openQuestions);
      return {
        blockTitle,
        ...(blockId ? { blockId } : {}),
        ...(audience ? { audience } : {}),
        ...(summary ? { summary } : {}),
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
        ...(honestStatus ? { honestStatus } : {}),
        ...(transition ? { transition } : {}),
        ...(intent ? { intent } : {}),
        ...(evidence?.length ? { evidence } : {}),
        ...(openQuestions?.length ? { openQuestions } : {}),
        ...(groundingWarning ? { groundingWarning } : {}),
      };
    })
    .filter((entry): entry is DeliveryFeedBlock => Boolean(entry));
  return parsed.length ? parsed : undefined;
}

function parseStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value.map(readString).filter(Boolean);
  return parsed.length ? parsed : undefined;
}

function readTone(value: unknown): DeliveryFeedTone | undefined {
  if (
    value === 'neutral'
    || value === 'accent'
    || value === 'success'
    || value === 'warning'
    || value === 'danger'
  ) {
    return value;
  }
  return undefined;
}
