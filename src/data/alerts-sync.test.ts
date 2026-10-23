import { afterEach, describe, expect, it, vi } from 'vitest';
import { chunk, dueAlerts, hashId, main, openSealed, pruneSent } from '../../scripts/send-alerts.mjs';
import { ALERTS_FILE, GitHubClient, newAlertsKey, syncAlerts } from './github';
import type { AlertConfig } from './repo';

const cfg: AlertConfig = {
  repo: 'me/Shiftwise', token: 'github_pat_' + 'x'.repeat(40), key: newAlertsKey(), branch: 'alerts',
  autoSync: true, lastSyncAt: null, lastHash: null, lastCount: null, lastError: null,
};

/** A tiny in-memory GitHub + CallMeBot used by both the app's sync and the Actions sender. */
function fakeServices() {
  const files = new Map<string, { sha: string; content: string }>();
  const branches = new Set(['main']);
  const sent: string[] = [];
  let n = 0;
  const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status });
  const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.hostname === 'callmebot.test') {
      sent.push(url.searchParams.get('text') ?? '');
      return new Response('Message queued', { status: 200 });
    }
    const path = url.pathname.replace('/repos/me/Shiftwise', '');
    if (path === '') return json(200, { default_branch: 'main', permissions: { push: true } });
    const ref = /^\/git\/ref\/heads\/(.+)$/.exec(path);
    if (ref) return branches.has(decodeURIComponent(ref[1]!)) ? json(200, { object: { sha: 'abc' } }) : json(404, {});
    if (path === '/git/refs' && method === 'POST') {
      branches.add(JSON.parse(String(init?.body)).ref.replace('refs/heads/', ''));
      return json(201, {});
    }
    const file = /^\/contents\/(.+)$/.exec(path);
    if (file) {
      const name = file[1]!;
      if (method === 'GET') {
        const f = files.get(name);
        return f ? json(200, { sha: f.sha, content: f.content }) : json(404, {});
      }
      const body = JSON.parse(String(init?.body));
      if (files.has(name) && body.sha !== files.get(name)!.sha) return json(409, { message: 'sha mismatch' });
      files.set(name, { sha: `s${++n}`, content: body.content });
      return json(200, {});
    }
    return json(404, {});
  };
  return { files, sent, branches, handler };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sender helpers', () => {
  it('finds due, unsent alerts inside the window', () => {
    const now = 1_000_000_000_000;
    const a = [
      { id: 'a', at: now - 60_000, text: 'due', _h: 'h1' },
      { id: 'b', at: now - 2 * 3_600_000, text: 'too old', _h: 'h2' },
      { id: 'c', at: now + 60_000, text: 'future', _h: 'h3' },
      { id: 'd', at: now - 30_000, text: 'already sent', _h: 'h4' },
    ];
    expect(dueAlerts(a, { h4: now }, now, 45 * 60_000).map((x) => x.id)).toEqual(['a']);
    expect(hashId('x', 'k')).toHaveLength(32);
    expect(hashId('x', 'k')).not.toBe(hashId('x', 'other'));
    expect(chunk(['a'.repeat(1000), 'b'.repeat(1000)], 1500)).toHaveLength(2);
    expect(chunk(['a', 'b'])).toEqual(['a\n\nb']);
    expect(pruneSent({ old: 1, fresh: Date.now() }, Date.now())).toEqual({ fresh: expect.any(Number) });
  });
});

describe('app sync → Actions sender (end to end)', () => {
  it('encrypts in the app, decrypts in the sender, sends once', async () => {
    const svc = fakeServices();
    const now = Date.now();
    const alerts = [
      { id: 'r1|2026-10-26', ruleId: 'r1', at: now - 5 * 60_000, text: '⏰ Night shift starts at 6:30 PM' },
      { id: 'r2|2026-10-26', ruleId: 'r2', at: now + 3_600_000, text: 'later' },
    ];
    const client = new GitHubClient(cfg, svc.handler as typeof fetch);
    const r1 = await syncAlerts(alerts, cfg, { client });
    expect(r1.skipped).toBe(false);
    expect(svc.branches.has('alerts')).toBe(true);
    const uploaded = Buffer.from(svc.files.get(ALERTS_FILE)!.content, 'base64').toString();
    expect(uploaded).not.toContain('Night shift');
    expect(await syncAlerts(alerts, { ...cfg, lastHash: r1.hash }, { client })).toMatchObject({ skipped: true });

    const doc = JSON.parse(uploaded);
    expect(JSON.parse(await openSealed(doc.sealed, cfg.key)).alerts).toHaveLength(2);
    await expect(openSealed(doc.sealed, 'wrong key wrong key wrong')).rejects.toThrow(/ALERTS_KEY/);

    vi.stubGlobal('fetch', svc.handler);
    vi.stubEnv('CALLMEBOT_URL', 'https://callmebot.test/whatsapp.php');
    vi.stubEnv('CALLMEBOT_PHONE', '+94770000000');
    vi.stubEnv('CALLMEBOT_APIKEY', '123456');
    vi.stubEnv('ALERTS_KEY', cfg.key);
    vi.stubEnv('GITHUB_TOKEN', 't');
    vi.stubEnv('GITHUB_REPOSITORY', 'me/Shiftwise');
    vi.stubEnv('GITHUB_API_URL', 'https://api.github.test');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await main(now);
    expect(svc.sent).toEqual(['⏰ Night shift starts at 6:30 PM']);
    const sentDoc = Buffer.from(svc.files.get('sent.json')!.content, 'base64').toString();
    expect(sentDoc).not.toContain('r1');
    await main(now + 60_000);
    expect(svc.sent).toHaveLength(1);

    vi.stubEnv('SEND_TEST', 'true');
    await main(now);
    expect(svc.sent.at(-1)).toContain('test');
  }, 30_000);
});
