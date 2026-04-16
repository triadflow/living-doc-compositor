import * as SQLite from 'expo-sqlite';

export type InboxItem = {
  id: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  receivedAt: number;
  read: boolean;
};

type InboxRow = {
  id: string;
  title: string | null;
  body: string | null;
  data_json: string | null;
  received_at: number;
  read: number;
};

const DB_NAME = 'living-docs-inbox.db';
const DEFAULT_LIMIT = 100;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
const listeners = new Set<() => void>();

async function database(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          title TEXT,
          body TEXT,
          data_json TEXT,
          received_at INTEGER NOT NULL,
          read INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_received_at
          ON notifications (received_at DESC);
      `);
      return db;
    });
  }
  return dbPromise;
}

function emitChange() {
  for (const listener of listeners) listener();
}

function parseData(raw: string | null): Record<string, any> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function fromRow(row: InboxRow): InboxItem {
  return {
    id: row.id,
    title: row.title ?? 'Notification',
    body: row.body ?? '',
    data: parseData(row.data_json),
    receivedAt: row.received_at,
    read: row.read === 1,
  };
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function insert(n: Omit<InboxItem, 'read'>): Promise<void> {
  const db = await database();
  const dataJson = n.data ? JSON.stringify(n.data) : null;

  await db.runAsync(
    `INSERT OR IGNORE INTO notifications (id, title, body, data_json, received_at, read)
     VALUES (?, ?, ?, ?, ?, 0)`,
    n.id,
    n.title,
    n.body,
    dataJson,
    n.receivedAt
  );
  await db.runAsync(
    `UPDATE notifications
     SET title = ?, body = ?, data_json = ?
     WHERE id = ?`,
    n.title,
    n.body,
    dataJson,
    n.id
  );
  emitChange();
}

export async function list(limit = DEFAULT_LIMIT): Promise<InboxItem[]> {
  const db = await database();
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));
  const rows = await db.getAllAsync<InboxRow>(
    `SELECT id, title, body, data_json, received_at, read
     FROM notifications
     ORDER BY received_at DESC
     LIMIT ?`,
    safeLimit
  );
  return rows.map(fromRow);
}

export async function markRead(id: string): Promise<void> {
  const db = await database();
  await db.runAsync('UPDATE notifications SET read = 1 WHERE id = ?', id);
  emitChange();
}

export async function remove(id: string): Promise<void> {
  const db = await database();
  await db.runAsync('DELETE FROM notifications WHERE id = ?', id);
  emitChange();
}

export async function clear(): Promise<void> {
  const db = await database();
  await db.runAsync('DELETE FROM notifications');
  emitChange();
}
