#!/usr/bin/env node
/**
 * Sends due ShiftWise alerts to your phone. Runs on a schedule in GitHub Actions.
 *
 * Channels (configure any; every configured one receives each message):
 *  - ntfy      NTFY_TOPIC (+ optional NTFY_SERVER, NTFY_TOKEN). Free push app, no account. Recommended.
 *  - Telegram  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID. Free bot.
 *  - WhatsApp  CALLMEBOT_PHONE + CALLMEBOT_APIKEY through CallMeBot (unreliable free hobby service).
 *
 * Reads the encrypted schedule the app uploaded to the alerts branch, decrypts it with ALERTS_KEY,
 * sends anything due in the last ALERT_WINDOW_MIN minutes that has not been sent, and records what
 * it sent (as salted hashes, so the public branch reveals nothing) in sent.json.
 *
 * Logs never contain message text or phone numbers: Actions logs are public on public repositories.
 * No dependencies; needs Node 20+.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ALERTS_FILE = 'alerts.enc.json';
const SENT_FILE = 'sent.json';

// ---- crypto (must match src/data/crypto.ts) ------------------------------------------------------
export async function openSealed(sealed, passphrase) {
  if (!sealed || sealed.alg !== 'AES-256-GCM' || sealed.kdf !== 'PBKDF2-SHA256') throw new Error('Unknown schedule format');
  if (sealed.iterations < 100_000 || sealed.iterations > 5_000_000) throw new Error('Bad key settings');
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(sealed.salt, 'base64'), iterations: sealed.iterations },
    base,
    256,
  );
  const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(sealed.iv, 'base64') }, key, Buffer.from(sealed.ciphertext, 'base64'));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('Could not decrypt the schedule. ALERTS_KEY does not match the key in the app.');
  }
}

// ---- pure logic (tested) ------------------------------------------------------------------------
export function hashId(id, salt) {
  return createHash('sha256').update(`${salt}:${id}`).digest('hex').slice(0, 32);
}

export function dueAlerts(alerts, sent, now, windowMs) {
  return alerts
    .filter((a) => typeof a.at === 'number' && typeof a.text === 'string' && typeof a.id === 'string')
    .filter((a) => a.at <= now && a.at > now - windowMs)
    .filter((a) => !(a._h in sent))
    .sort((a, b) => a.at - b.at);
}

/** Joins messages into as few phone messages as possible, each under maxLen characters. */
export function chunk(texts, maxLen = 1500) {
  const out = [];
  let cur = '';
  for (const t of texts) {
    const piece = t.slice(0, maxLen);
    if (cur && cur.length + 2 + piece.length > maxLen) {
      out.push(cur);
      cur = piece;
    } else {
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function pruneSent(sent, now, keepMs = 3 * 86_400_000) {
  return Object.fromEntries(Object.entries(sent).filter(([, at]) => typeof at === 'number' && at > now - keepMs));
}

// ---- I/O ----------------------------------------------------------------------------------------
function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Add it under Settings → Secrets and variables → Actions.`);
  return v;
}

function makeGitHub({ api, repo, token, branch }) {
  async function call(path, init = {}) {
    const res = await fetch(`${api}/repos/${repo}${path}`, {
      ...init,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, body };
  }
  return {
    async read(path) {
      const r = await call(`/contents/${path}?ref=${encodeURIComponent(branch)}`);
      if (r.status === 404) return null;
      if (r.status !== 200) throw new Error(`Could not read ${path} (HTTP ${r.status})`);
      return { sha: r.body.sha, text: Buffer.from(r.body.content, 'base64').toString('utf8') };
    },
    async write(path, text, sha, message) {
      const r = await call(`/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify({ message, content: Buffer.from(text, 'utf8').toString('base64'), branch, ...(sha ? { sha } : {}) }),
      });
      if (r.status !== 200 && r.status !== 201) throw new Error(`Could not save ${path} (HTTP ${r.status})`);
    },
  };
}

async function retry(label, fn) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fn().catch(() => null);
    const body = res ? await res.text().catch(() => '') : '';
    if (res && res.ok && !/APIKey is invalid/i.test(body.slice(0, 4000))) return;
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * Number(process.env.ALERT_RETRY_MS || 4000)));
    else throw new Error(`${label} did not accept the message (HTTP ${res ? res.status : 'no response'}).`);
  }
}

/** Every channel that has its secrets set. Pure, so it can be tested. */
export function channelsFrom(env) {
  const out = [];
  if (env.NTFY_TOPIC) {
    const server = (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
    out.push({
      name: 'ntfy',
      send: (text) =>
        retry('ntfy', () =>
          fetch(`${server}/${encodeURIComponent(env.NTFY_TOPIC)}`, {
            method: 'POST',
            body: text,
            headers: { Title: 'ShiftWise', Tags: 'alarm_clock', ...(env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : {}) },
          }),
        ),
    });
  }
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const api = (env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/+$/, '');
    out.push({
      name: 'Telegram',
      send: (text) =>
        retry('Telegram', () =>
          fetch(`${api}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
          }),
        ),
    });
  }
  if (env.CALLMEBOT_PHONE && env.CALLMEBOT_APIKEY) {
    const url = env.CALLMEBOT_URL || 'https://api.callmebot.com/whatsapp.php';
    out.push({
      name: 'WhatsApp',
      send: (text) => retry('CallMeBot', () => fetch(`${url}?${new URLSearchParams({ phone: env.CALLMEBOT_PHONE, text, apikey: env.CALLMEBOT_APIKEY }).toString()}`)),
    });
  }
  return out;
}

/** Sends to every channel. Succeeds if at least one channel delivered. */
async function broadcast(text, channels) {
  const failed = [];
  for (const c of channels) {
    try {
      await c.send(text);
    } catch (e) {
      failed.push(c.name);
      console.log(`::warning::${e.message}`);
    }
  }
  if (failed.length === channels.length) throw new Error(`No channel delivered the message (${failed.join(', ')}). Check the secrets for those channels.`);
}

export async function main(now = Date.now()) {
  const channels = channelsFrom(process.env);
  if (channels.length === 0) {
    console.log('::notice::No alert channel is set up yet, so nothing was sent. Add NTFY_TOPIC (or TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) as a repository secret. See docs/PHONE_ALERTS.md.');
    return;
  }
  console.log(`Channels: ${channels.map((c) => c.name).join(', ')}.`);

  if (process.env.SEND_TEST === 'true') {
    await broadcast('✅ ShiftWise test: phone alerts are working.', channels);
    console.log('Test message sent.');
    return;
  }

  if (!process.env.ALERTS_KEY) {
    console.log('::notice::ALERTS_KEY is not set yet. Copy it from ShiftWise → Alerts → Connection settings.');
    return;
  }
  const key = need('ALERTS_KEY');
  const gh = makeGitHub({
    api: process.env.GITHUB_API_URL || 'https://api.github.com',
    repo: need('GITHUB_REPOSITORY'),
    token: need('GITHUB_TOKEN'),
    branch: process.env.ALERTS_BRANCH || 'alerts',
  });
  const windowMs = Number(process.env.ALERT_WINDOW_MIN || 45) * 60_000;

  const file = await gh.read(ALERTS_FILE);
  if (!file) {
    console.log('No alert schedule yet. Open ShiftWise → Alerts and press Sync.');
    return;
  }
  const doc = JSON.parse(file.text);
  const { alerts } = JSON.parse(await openSealed(doc.sealed, key));
  const sentFile = await gh.read(SENT_FILE);
  const sent = pruneSent(sentFile ? JSON.parse(sentFile.text).sent ?? {} : {}, now);

  const withHash = alerts.map((a) => ({ ...a, _h: hashId(a.id, key) }));
  const due = dueAlerts(withHash, sent, now, windowMs);
  console.log(`Schedule: ${alerts.length} alerts. Due now: ${due.length}.`);
  if (due.length === 0) {
    if (sentFile && Object.keys(sent).length !== Object.keys(JSON.parse(sentFile.text).sent ?? {}).length) {
      await gh.write(SENT_FILE, JSON.stringify({ sent }), sentFile.sha, 'Prune sent alerts');
    }
    return;
  }

  for (const [i, msg] of chunk(due.map((a) => a.text)).entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 3000));
    await broadcast(msg, channels);
  }
  for (const a of due) sent[a._h] = a.at;
  await gh.write(SENT_FILE, JSON.stringify({ sent }), sentFile?.sha, `Sent ${due.length} alert(s)`);
  console.log(`Sent ${due.length} alert(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
