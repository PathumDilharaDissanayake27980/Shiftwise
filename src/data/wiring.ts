import type { Handoff, Report } from '../domain/ascend';
import { open, seal, type Sealed } from './crypto';
import { GitHubClient } from './github';
import type { AlertConfig } from './repo';
import { ascendReportSchema } from './schemas';

/**
 * Cloud wiring between ShiftWise and Ascend through the user's own GitHub repository, for devices
 * that cannot share browser storage (the Ascend Android app, a second phone or laptop).
 *
 * Each app owns one file on the alerts branch and only reads the other's:
 *   wiring/shiftwise.enc.json  the 14-day plan (study blocks, shifts, wake, bed, fatigue)
 *   wiring/ascend.enc.json     progress, completed sessions and upcoming lessons
 * Both are sealed with the same AES-256-GCM key as the alert schedule, so the public branch shows nothing.
 */

export const WIRING_SHIFTWISE = 'wiring/shiftwise.enc.json';
export const WIRING_ASCEND = 'wiring/ascend.enc.json';
export const WIRING_FORMAT = 'shiftwise-wiring';

/** Same-origin storage keys: both web apps live on the same github.io origin and read each other directly. */
export const LOCAL_SHIFTWISE = 'wiring:shiftwise';
export const LOCAL_ASCEND = 'wiring:ascend';

type Cfg = Pick<AlertConfig, 'repo' | 'token' | 'branch' | 'key'>;

export async function pushPlan(h: Handoff, cfg: Cfg, client = new GitHubClient(cfg)): Promise<void> {
  const sealed = await seal(JSON.stringify(h), cfg.key);
  await client.putFile(WIRING_SHIFTWISE, JSON.stringify({ format: WIRING_FORMAT, version: 1, updatedAt: h.at, sealed }), 'Sync ShiftWise plan');
}

export async function pullAscend(cfg: Cfg, client = new GitHubClient(cfg)): Promise<Report | null> {
  const text = await client.getFile(WIRING_ASCEND);
  if (!text) return null;
  const doc = JSON.parse(text) as { format?: string; sealed?: Sealed };
  if (doc.format !== WIRING_FORMAT || !doc.sealed) return null;
  const r = ascendReportSchema.safeParse(JSON.parse(await open(doc.sealed, cfg.key)));
  return r.success ? (r.data as Report) : null;
}

/** Everything Ascend needs to join the cloud wiring. Handed over inside a link fragment, never a server. */
export interface LinkPayload {
  v: 1;
  app: 'shiftwise-link';
  repo: string;
  branch: string;
  key: string;
  token: string;
}

export function linkPayload(cfg: Cfg): LinkPayload {
  return { v: 1, app: 'shiftwise-link', repo: cfg.repo, branch: cfg.branch, key: cfg.key, token: cfg.token };
}
