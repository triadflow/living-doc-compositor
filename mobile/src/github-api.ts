import { encryptForSecret, utf8ToBase64, base64ToUtf8 } from './sealed-box';
import { WORKFLOW_TEMPLATE, WORKFLOW_PATH } from './workflow-template';

const API = 'https://api.github.com';
const PUSH_TOKEN_SECRET_NAME = 'EXPO_PUSH_TOKEN';

type Json = Record<string, any>;

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
  token: string, owner: string, repo: string, path: string
): Promise<FileMeta | null> {
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
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
    throw new Error(`Write file failed: ${res.status}`);
  }
}

// ─── High-level: connect / status ───────────────────────────────────────────

export type ConnectionStatus = {
  secret: boolean;
  workflow: boolean;
  workflowOutdated: boolean;
};

async function checkWorkflowExists(token: string, owner: string, repo: string, path: string): Promise<boolean> {
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/actions/workflows?per_page=100`,
    { headers: headers(token) }
  );
  if (!res.ok) return false;
  const data = await res.json();
  const workflows: Array<{ path: string }> = data.workflows ?? [];
  return workflows.some((w) => w.path === path);
}

export async function getConnectionStatus(
  token: string, owner: string, repo: string
): Promise<ConnectionStatus> {
  const [secret, workflowExists] = await Promise.all([
    checkSecretExists(token, owner, repo, PUSH_TOKEN_SECRET_NAME),
    checkWorkflowExists(token, owner, repo, WORKFLOW_PATH),
  ]);
  let workflowOutdated = false;
  if (workflowExists) {
    try {
      const file = await getFile(token, owner, repo, WORKFLOW_PATH);
      workflowOutdated = file !== null && file.content.trim() !== WORKFLOW_TEMPLATE.trim();
    } catch {
      // fall through; treat as present but not validated.
    }
  }
  return { secret, workflow: workflowExists, workflowOutdated };
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
