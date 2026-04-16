import { storage } from './storage';

export type ConnectionMode = 'real' | 'preview';

type StoredConnection = {
  mode: ConnectionMode;
  updatedAt: string;
};

const CONNECTION_MODES_KEY = 'repo_connection_modes_v1';

async function readConnections(): Promise<Record<string, StoredConnection>> {
  const raw = await storage.get(CONNECTION_MODES_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeConnections(connections: Record<string, StoredConnection>): Promise<void> {
  await storage.set(CONNECTION_MODES_KEY, JSON.stringify(connections));
}

export async function getRepoConnectionModes(): Promise<Record<string, ConnectionMode>> {
  const connections = await readConnections();
  return Object.fromEntries(
    Object.entries(connections)
      .filter(([, value]) =>
        value && typeof value === 'object' && (value.mode === 'real' || value.mode === 'preview')
      )
      .map(([fullName, value]) => [fullName, value.mode as ConnectionMode])
  );
}

export async function setRepoConnectionMode(
  fullName: string,
  mode: ConnectionMode
): Promise<void> {
  const connections = await readConnections();
  connections[fullName] = { mode, updatedAt: new Date().toISOString() };
  await writeConnections(connections);
}

export async function removeRepoConnectionMode(fullName: string): Promise<void> {
  const connections = await readConnections();
  if (!(fullName in connections)) return;
  delete connections[fullName];
  await writeConnections(connections);
}
