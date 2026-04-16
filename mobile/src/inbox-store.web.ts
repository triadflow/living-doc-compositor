import { storage } from './storage';

export type InboxItem = {
  id: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  receivedAt: number;
  read: boolean;
};

const STORAGE_KEY = 'living_docs_inbox_v1';
const DEFAULT_LIMIT = 100;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function normalizeItems(value: unknown): InboxItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const row = item as Record<string, unknown>;
      const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? row.data as Record<string, any>
        : undefined;
      return {
        id: typeof row.id === 'string' ? row.id : '',
        title: typeof row.title === 'string' ? row.title : 'Notification',
        body: typeof row.body === 'string' ? row.body : '',
        data,
        receivedAt: typeof row.receivedAt === 'number' ? row.receivedAt : 0,
        read: row.read === true,
      };
    })
    .filter((item) => item.id)
    .sort((a, b) => b.receivedAt - a.receivedAt);
}

async function readItems(): Promise<InboxItem[]> {
  const raw = await storage.get(STORAGE_KEY);
  if (!raw) return [];
  try {
    return normalizeItems(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeItems(items: InboxItem[]): Promise<void> {
  await storage.set(STORAGE_KEY, JSON.stringify(items));
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function insert(n: Omit<InboxItem, 'read'>): Promise<void> {
  const items = await readItems();
  const existing = items.findIndex((item) => item.id === n.id);
  const next: InboxItem = { ...n, read: false };

  if (existing >= 0) {
    items[existing] = {
      ...items[existing],
      id: n.id,
      title: n.title,
      body: n.body,
      data: n.data,
      receivedAt: n.receivedAt,
    };
  } else {
    items.unshift(next);
  }

  items.sort((a, b) => b.receivedAt - a.receivedAt);
  await writeItems(items);
  emitChange();
}

export async function list(limit = DEFAULT_LIMIT): Promise<InboxItem[]> {
  const items = await readItems();
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));
  return items.slice(0, safeLimit);
}

export async function markRead(id: string): Promise<void> {
  const items = await readItems();
  const next = items.map((item) => (item.id === id ? { ...item, read: true } : item));
  await writeItems(next);
  emitChange();
}

export async function remove(id: string): Promise<void> {
  const items = await readItems();
  await writeItems(items.filter((item) => item.id !== id));
  emitChange();
}

export async function clear(): Promise<void> {
  await writeItems([]);
  emitChange();
}
