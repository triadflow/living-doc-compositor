import { storage } from './storage';

export type RegisteredDoc = {
  id: string;
  url: string;
  title: string;
  source?: string;
  addedAt: number;
};

const KEY = 'registered_docs_v1';

function uuid(): string {
  // RFC 4122 v4-ish ID; no crypto requirement.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function loadDocs(): Promise<RegisteredDoc[]> {
  const raw = await storage.get(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RegisteredDoc[]) : [];
  } catch {
    return [];
  }
}

export async function saveDocs(docs: RegisteredDoc[]): Promise<void> {
  await storage.set(KEY, JSON.stringify(docs));
}

export async function addDoc(input: { url: string; title: string; source?: string }): Promise<RegisteredDoc> {
  const docs = await loadDocs();
  const existing = docs.find((d) => d.url === input.url);
  if (existing) return existing;
  const doc: RegisteredDoc = {
    id: uuid(),
    url: input.url,
    title: input.title,
    source: input.source,
    addedAt: Date.now(),
  };
  docs.unshift(doc);
  await saveDocs(docs);
  return doc;
}

export async function removeDoc(id: string): Promise<void> {
  const docs = await loadDocs();
  await saveDocs(docs.filter((d) => d.id !== id));
}

// Best-effort metadata fetch. Returns the <title> of the page if reachable, plus a
// human-friendly source label (e.g. "triadflow.github.io") derived from the URL.
export async function probeUrl(rawUrl: string): Promise<{ title: string; source: string }> {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('URL must start with http:// or https://');

  let host = '';
  try { host = new URL(url).host; } catch { throw new Error('That URL is not valid.'); }

  const fallbackTitle = prettyFromUrl(url);
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return { title: fallbackTitle, source: host };
    const text = await res.text();
    const m = text.match(/<title>([\s\S]*?)<\/title>/i);
    const title = m?.[1]?.trim() || fallbackTitle;
    return { title: decodeEntities(title), source: host };
  } catch {
    return { title: fallbackTitle, source: host };
  }
}

function prettyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop() ?? u.host;
    return seg.replace(/\.html?$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return url;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
