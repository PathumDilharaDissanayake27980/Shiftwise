import type { Alert } from '../domain/alerts';
import { fromBase64, randomBytes, seal, toBase64 } from './crypto';
import type { AlertConfig } from './repo';

/**
 * Publishes the encrypted alert schedule to a branch of the user's GitHub repository, where the
 * scheduled "Phone alerts" workflow reads it. Only alert times and texts leave the device, and
 * they are encrypted with a key that also lives in the repository's Actions secrets.
 */

export const ALERTS_FILE = 'alerts.enc.json';
export const ALERTS_WORKFLOW = 'phone-alerts.yml';
export const ALERTS_FORMAT = 'shiftwise-alerts';

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GitHubError';
  }
}

export function newAlertsKey(): string {
  return toBase64(randomBytes(24)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8ToBase64(text: string): string {
  return toBase64(new TextEncoder().encode(text));
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Cfg = Pick<AlertConfig, 'repo' | 'token' | 'branch'>;

export class GitHubClient {
  constructor(private readonly cfg: Cfg, private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`https://api.github.com/repos/${this.cfg.repo}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.cfg.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (res.status === 204) return undefined as T;
    const body = (await res.json().catch(() => ({}))) as { message?: string } & T;
    if (!res.ok) {
      const msg =
        res.status === 401
          ? 'GitHub rejected the token. It may be wrong or expired.'
          : res.status === 403
            ? 'The token is missing a permission. It needs Contents and Actions: Read and write on this repository.'
            : res.status === 404
              ? 'Repository or file not found. Check the repository name and that the token can access it.'
              : `GitHub error ${res.status}: ${body.message ?? 'unknown'}`;
      throw new GitHubError(msg, res.status);
    }
    return body;
  }

  async checkAccess(): Promise<void> {
    const repo = await this.api<{ permissions?: { push?: boolean } }>('');
    if (repo.permissions && repo.permissions.push === false) throw new GitHubError('The token cannot write to this repository.', 403);
  }

  async ensureBranch(): Promise<void> {
    try {
      await this.api(`/git/ref/heads/${encodeURIComponent(this.cfg.branch)}`);
      return;
    } catch (e) {
      if (!(e instanceof GitHubError) || e.status !== 404) throw e;
    }
    const repo = await this.api<{ default_branch: string }>('');
    const head = await this.api<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(repo.default_branch)}`);
    await this.api('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${this.cfg.branch}`, sha: head.object.sha }) });
  }

  /** A text file from the branch, or null when it does not exist yet. */
  async getFile(path: string): Promise<string | null> {
    try {
      const f = await this.api<{ content: string }>(`/contents/${path}?ref=${encodeURIComponent(this.cfg.branch)}`);
      return new TextDecoder().decode(fromBase64(f.content.replace(/\s/g, '')));
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  async putFile(path: string, content: string, message: string): Promise<void> {
    let sha: string | undefined;
    try {
      const existing = await this.api<{ sha: string }>(`/contents/${path}?ref=${encodeURIComponent(this.cfg.branch)}`);
      sha = existing.sha;
    } catch (e) {
      if (!(e instanceof GitHubError) || e.status !== 404) throw e;
    }
    await this.api(`/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message, content: utf8ToBase64(content), branch: this.cfg.branch, ...(sha ? { sha } : {}) }),
    });
  }

  async runWorkflow(inputs: Record<string, string>): Promise<void> {
    const repo = await this.api<{ default_branch: string }>('');
    await this.api(`/actions/workflows/${ALERTS_WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: repo.default_branch, inputs }) });
  }
}

export interface SyncResult {
  skipped: boolean;
  hash: string;
  count: number;
}

/** Encrypts and uploads the schedule. Skips the upload when nothing changed since the last sync. */
export async function syncAlerts(alerts: Alert[], cfg: AlertConfig, opts: { force?: boolean; client?: GitHubClient } = {}): Promise<SyncResult> {
  const payload = JSON.stringify({ alerts: alerts.map(({ id, at, text }) => ({ id, at, text })) });
  const hash = await sha256(payload + cfg.repo);
  if (!opts.force && hash === cfg.lastHash) return { skipped: true, hash, count: alerts.length };
  const sealed = await seal(payload, cfg.key);
  const file = JSON.stringify({ format: ALERTS_FORMAT, version: 1, updatedAt: Date.now(), sealed });
  const client = opts.client ?? new GitHubClient(cfg);
  await client.ensureBranch();
  await client.putFile(ALERTS_FILE, file, `Update alert schedule (${alerts.length} alerts)`);
  return { skipped: false, hash, count: alerts.length };
}
