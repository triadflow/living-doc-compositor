import { encryptForSecret, utf8ToBase64, base64ToUtf8 } from './sealed-box';
import {
  DELIVERY_FEED_BRANCH,
  DELIVERY_FEED_DIR,
  DELIVERY_FEED_PER_REPO_LIMIT,
  type DeliveryFeedEvent,
} from './delivery-feed';
import { recordDeliveryEvent } from './delivery-ingest';
import { getRepoConnectionModes } from './repo-connection-store';
import { WORKFLOW_TEMPLATE, WORKFLOW_PATH } from './workflow-template';

const API = 'https://api.github.com';
const PUSH_TOKEN_SECRET_NAME = 'EXPO_PUSH_TOKEN';

type Json = Record<string, any>;
type ContentsEntry = {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
};

function headers(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// ─── Repos ──────────────────────────────────────────────────────────────────

export type AdminRepo = {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  updatedAt: string;
};

export async function listAdminRepos(token: string): Promise<AdminRepo[]> {
  // Pulls up to 200 most-recently-updated repos across two pages. Plenty for
  // an MVP; we can paginate lazily if users have more than that.
  const out: AdminRepo[] = [];
  for (const page of [1, 2]) {
    const res = await fetch(
      `${API}/user/repos?per_page=100&sort=updated&page=${page}`,
      { headers: headers(token) }
    );
    if (!res.ok) throw new Error(`List repos failed: ${res.status}`);
    const batch: Json[] = await res.json();
    if (batch.length === 0) break;
    for (const r of batch) {
      if (r.permissions?.admin === true) {
        out.push({
          id: r.id,
          fullName: r.full_name,
          owner: r.owner.login,
          name: r.name,
          description: r.description,
          isPrivate: r.private,
          defaultBranch: r.default_branch,
          updatedAt: r.updated_at,
        });
      }
    }
    if (batch.length < 100) break;
  }
  return out;
}

// ─── Secrets ────────────────────────────────────────────────────────────────

type PublicKey = { keyId: string; key: string };
type WorkflowSummary = { path: string };

async function getRepoPublicKey(token: string, owner: string, repo: string): Promise<PublicKey> {
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/actions/secrets/public-key`,
    { headers: headers(token) }
  );
  if (!res.ok) throw new Error(`Fetch public key failed: ${res.status}`);
  const d = await res.json();
  return { keyId: d.key_id, key: d.key };
}

async function putRepoSecret(
  token: string, owner: string, repo: string, name: string, plaintext: string
): Promise<void> {
  const pk = await getRepoPublicKey(token, owner, repo);
  const encrypted = await encryptForSecret(pk.key, plaintext);
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/actions/secrets/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted_value: encrypted, key_id: pk.keyId }),
    }
  );
  if (res.status !== 201 && res.status !== 204) {
    throw new Error(`Write secret failed: ${res.status}`);
  }
}

export async function deleteRepoSecret(
  token: string, owner: string, repo: string, name = PUSH_TOKEN_SECRET_NAME
): Promise<void> {
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/actions/secrets/${encodeURIComponent(name)}`,
    {
      method: 'DELETE',
      headers: headers(token),
    }
  );
  if (res.status !== 204 && res.status !== 404) {
    throw new Error(`Delete secret failed: ${res.status}`);
  }
}

// Lists all secrets in a repo and checks for the one we care about. We use the
// list endpoint (not the per-name GET) so missing secrets don't pollute the
// browser console with 404 errors.
async function checkSecretExists(token: string, owner: string, repo: string, name: string): Promise<boolean> {
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/actions/secrets?per_page=100`,
    { headers: headers(token) }
  );
  if (!res.ok) return false;
  const data = await res.json();
  const secrets: Array<{ name: string }> = data.secrets ?? [];
  return secrets.some((s) => s.name === name);
}

// ─── File contents ──────────────────────────────────────────────────────────

type FileMeta = { content: string; sha: string };

async function getFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  opts: { ref?: string } = {}
): Promise<FileMeta | null> {
  const query = opts.ref ? `?ref=${encodeURIComponent(opts.ref)}` : '';
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${query}`,
    { headers: headers(token) }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Fetch file failed: ${res.status}`);
  const d = await res.json();
  if (Array.isArray(d)) throw new Error(`Path is a directory: ${path}`);
  const raw = (d.content ?? '').replace(/\n/g, '');
  const content = await base64ToUtf8(raw);
  return { content, sha: d.sha };
}

async function listDirectory(
  token: string,
  owner: string,
  repo: string,
  path: string,
  opts: { ref?: string } = {}
): Promise<ContentsEntry[] | null> {
  const query = opts.ref ? `?ref=${encodeURIComponent(opts.ref)}` : '';
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${query}`,
    { headers: headers(token) }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`List directory failed: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Path is a file: ${path}`);
  return data.map((entry) => ({
    name: entry.name,
    path: entry.path,
    type: entry.type,
  }));
}

async function putFile(
  token: string, owner: string, repo: string, path: string,
  message: string, content: string, sha?: string
): Promise<void> {
  const body: Json = {
    message,
    content: await utf8ToBase64(content),
  };
  if (sha) body.sha = sha;
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
    {
      method: 'PUT',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (res.status !== 200 && res.status !== 201) {
    if (res.status === 404 && path === WORKFLOW_PATH) {
      throw new Error(
        'Write workflow failed: 404. GitHub tokens need workflow scope to create or update files in .github/workflows.'
      );
    }
    throw new Error(`Write file failed: ${res.status}`);
  }
}

async function deleteFile(
  token: string, owner: string, repo: string, path: string,
  message: string, sha: string
): Promise<void> {
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
    {
      method: 'DELETE',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sha }),
    }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Delete file failed: ${res.status}`);
  }
}

export async function deleteWorkflowFile(
  token: string, owner: string, repo: string
): Promise<void> {
  const existing = await getFile(token, owner, repo, WORKFLOW_PATH);
  if (!existing) return;
  await deleteFile(
    token,
    owner,
    repo,
    WORKFLOW_PATH,
    'Remove Living Docs notify workflow',
    existing.sha
  );
}

// ─── High-level: connect / status ───────────────────────────────────────────

export type ConnectionStatus = {
  secret: boolean;
  workflow: boolean;
  workflowOutdated: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function checkWorkflowExistsFromActions(
  token: string,
  owner: string,
  repo: string,
  path: string
): Promise<boolean | null> {
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/actions/workflows?per_page=100`,
    { headers: headers(token) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const workflows: WorkflowSummary[] = Array.isArray(data.workflows) ? data.workflows : [];
  return workflows.some((workflow) => workflow.path === path);
}

export async function getConnectionStatus(
  token: string,
  owner: string,
  repo: string,
  opts: { preferContents?: boolean } = {}
): Promise<ConnectionStatus> {
  const [secret, workflowExistsFromActions] = await Promise.all([
    checkSecretExists(token, owner, repo, PUSH_TOKEN_SECRET_NAME),
    opts.preferContents
      ? Promise.resolve(null)
      : checkWorkflowExistsFromActions(token, owner, repo, WORKFLOW_PATH),
  ]);

  if (workflowExistsFromActions === false) {
    return { secret, workflow: false, workflowOutdated: false };
  }

  const workflowFile = await getFile(token, owner, repo, WORKFLOW_PATH).catch(() => null);
  const workflowOutdated =
    workflowFile !== null && workflowFile.content.trim() !== WORKFLOW_TEMPLATE.trim();
  return { secret, workflow: workflowFile !== null, workflowOutdated };
}

export async function getConnectionStatusWithRetry(
  token: string,
  owner: string,
  repo: string,
  isExpected: (status: ConnectionStatus) => boolean,
  opts: { attempts?: number; delayMs?: number } = {}
): Promise<ConnectionStatus> {
  const attempts = Math.max(1, opts.attempts ?? 4);
  const delayMs = opts.delayMs ?? 700;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await getConnectionStatus(token, owner, repo, { preferContents: true });
    if (isExpected(status) || attempt === attempts - 1) return status;
    await sleep(delayMs);
  }

  return getConnectionStatus(token, owner, repo, { preferContents: true });
}

export async function connectRepo(
  token: string, owner: string, repo: string, pushToken: string
): Promise<void> {
  // 1. Write (or overwrite) the EXPO_PUSH_TOKEN secret.
  await putRepoSecret(token, owner, repo, PUSH_TOKEN_SECRET_NAME, pushToken);

  // 2. Create or update the workflow file. If an existing copy is identical,
  //    skip to avoid an empty commit.
  const existing = await getFile(token, owner, repo, WORKFLOW_PATH);
  if (existing && existing.content.trim() === WORKFLOW_TEMPLATE.trim()) return;

  await putFile(
    token, owner, repo, WORKFLOW_PATH,
    existing ? 'Update Living Docs notify workflow' : 'Add Living Docs notify workflow',
    WORKFLOW_TEMPLATE,
    existing?.sha
  );
}

export async function disconnectRepo(
  token: string, owner: string, repo: string, opts: { removeWorkflow: boolean }
): Promise<void> {
  await deleteRepoSecret(token, owner, repo, PUSH_TOKEN_SECRET_NAME);
  if (opts.removeWorkflow) {
    await deleteWorkflowFile(token, owner, repo);
  }
}

export type RepoFeedSyncResult = {
  repos: number;
  events: number;
  repoNames: string[];
};

export async function syncRepoDeliveryFeed(
  token: string,
  opts: { perRepoLimit?: number; discoverWhenEmpty?: boolean } = {}
): Promise<RepoFeedSyncResult> {
  const connections = await getRepoConnectionModes().catch(() => ({}));
  const fullNameSet = new Set(Object.keys(connections));
  if (opts.discoverWhenEmpty !== false) {
    const discovered = await discoverFeedRepos(token);
    for (const fullName of discovered) fullNameSet.add(fullName);
  }
  const fullNames = Array.from(fullNameSet).sort();
  const perRepoLimit = Math.max(1, opts.perRepoLimit ?? DELIVERY_FEED_PER_REPO_LIMIT);
  let repos = 0;
  let events = 0;
  const repoNames: string[] = [];

  for (const fullName of fullNames) {
    const parsed = parseRepoFullName(fullName);
    if (!parsed) continue;
    repos += 1;
    repoNames.push(fullName);

    const entries = await listDirectory(
      token,
      parsed.owner,
      parsed.repo,
      DELIVERY_FEED_DIR,
      { ref: DELIVERY_FEED_BRANCH }
    ).catch(() => null);

    if (!entries) continue;

    const files = entries
      .filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, perRepoLimit);

    for (const file of files) {
      const payload = await getFile(
        token,
        parsed.owner,
        parsed.repo,
        file.path,
        { ref: DELIVERY_FEED_BRANCH }
      ).catch(() => null);
      if (!payload) continue;

      const event = parseDeliveryFeedEvent(payload.content, fullName);
      if (!event) continue;

      await recordDeliveryEvent({
        id: event.id,
        title: event.title,
        body: event.body,
        receivedAt: parseReceivedAt(event.createdAt),
        data: {
          url: event.url,
          title: event.title,
          status: event.status,
          source: event.source ?? event.repo,
          repo: event.repo,
          delivery: 'repo-feed',
        },
      });
      events += 1;
    }
  }

  return { repos, events, repoNames };
}

async function discoverFeedRepos(token: string): Promise<string[]> {
  const repos = await listAdminRepos(token).catch(() => []);
  const discovered: string[] = [];

  await Promise.all(
    repos.map(async (repo) => {
      const status = await getConnectionStatus(token, repo.owner, repo.name, {
        preferContents: true,
      }).catch(() => null);
      if (!status?.workflow || !status?.secret || status.workflowOutdated) return;
      const entries = await listDirectory(
        token,
        repo.owner,
        repo.name,
        DELIVERY_FEED_DIR,
        { ref: DELIVERY_FEED_BRANCH }
      ).catch(() => null);
      const hasFeedFiles = Array.isArray(entries)
        && entries.some((entry) => entry.type === 'file' && entry.name.endsWith('.json'));
      if (!hasFeedFiles) return;
      discovered.push(repo.fullName);
    })
  );

  return discovered.sort();
}

function parseRepoFullName(fullName: string): { owner: string; repo: string } | null {
  const [owner, repo, ...rest] = fullName.split('/');
  if (!owner || !repo || rest.length > 0) return null;
  return { owner, repo };
}

function parseDeliveryFeedEvent(content: string, fallbackRepo: string): DeliveryFeedEvent | null {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const id = typeof parsed.id === 'string' ? parsed.id : '';
    const title = typeof parsed.title === 'string' ? parsed.title : '';
    const body = typeof parsed.body === 'string' ? parsed.body : '';
    const createdAt = typeof parsed.createdAt === 'string' ? parsed.createdAt : '';
    if (!id || !title || !body || !createdAt) return null;

    return {
      id,
      title,
      body,
      createdAt,
      repo: typeof parsed.repo === 'string' && parsed.repo ? parsed.repo : fallbackRepo,
      url: typeof parsed.url === 'string' && parsed.url ? parsed.url : undefined,
      status: typeof parsed.status === 'string' && parsed.status ? parsed.status : undefined,
      source: typeof parsed.source === 'string' && parsed.source ? parsed.source : undefined,
    };
  } catch {
    return null;
  }
}

function parseReceivedAt(createdAt: string): number {
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}
