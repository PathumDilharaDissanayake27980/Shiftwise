/**
 * Two-way link with Ascend, the study-roadmap app.
 *
 *  ShiftWise → Ascend: the study, project and exam-prep blocks the planner fitted around your shifts,
 *  so Ascend schedules lessons only when you are actually free ("#sw=" on the Ascend URL).
 *  Ascend → ShiftWise: the sessions you completed there, so they count in your log and insights
 *  ("#ascend=" on the ShiftWise URL).
 *
 * Both travel inside the link itself (base64url JSON in the URL fragment), so nothing goes through a
 * server and fragments are never sent over the network.
 */
import { bedOf, wakeOf } from './alerts';
import { isWorkShift } from './defaults';
import type { FatigueResult } from './fatigue';
import type { RosterLookup } from './planner';
import { shiftWindow } from './schedule';
import { atMinutes } from './time';
import type { Activity, AscendLink, DayCode, DayPlan, ISODate, Settings, TimeLog, WorkShift } from './types';

export const ASCEND_URL = 'https://pathumdilharadissanayake27980.github.io/ascend/';
export const ASCEND_PACKAGE = 'com.eliteswe.roadmap';
export const ASCEND_RELEASES = 'https://github.com/PathumDilharaDissanayake27980/ascend/releases/latest';

/** Days of plan sent to Ascend. */
export const HANDOFF_DAYS = 14;

export interface HandoffDay {
  d: ISODate;
  c: DayCode;
  /** [start minute, length in minutes, kind] for each block Ascend should fill. */
  b: [number, number, AscendLink][];
  /** The day around those blocks, so Ascend can show it: shift [start, end], wake, bedtime, fatigue. */
  s?: [number, number];
  w?: number;
  z?: number;
  f?: number;
  fl?: string;
}

/** What ShiftWise knows about each day besides the plan. */
export interface HandoffContext {
  settings: Settings;
  roster: RosterLookup;
  fatigue?: FatigueResult[];
}

export interface Handoff {
  v: 1;
  app: 'shiftwise';
  at: number;
  /** Weekly goal minutes for each kind, so Ascend can set its pace. */
  week: Record<AscendLink, number>;
  days: HandoffDay[];
}

export interface ReportItem {
  d: ISODate;
  st: number;
  m: number;
  k: AscendLink;
  t: string;
}

/** Where you are in the study plan, as Ascend sees it. Shown on ShiftWise's Today screen. */
export interface AscendProgress {
  month: number;
  phase: string;
  done: number;
  total: number;
  streak: number;
  hours: number;
  /** Next few lessons: [date, start minute, title]. */
  next: [ISODate, number, string][];
}

export interface Report {
  v: 1;
  app: 'ascend';
  at: number;
  items: ReportItem[];
  p?: AscendProgress;
  /** Upcoming lessons Ascend has placed in the blocks: [date, start, minutes, title, hands-on task]. */
  up?: [ISODate, number, number, string, string][];
}

/** The Ascend lesson planned in a ShiftWise block, if Ascend has told us. */
export function lessonIn(report: Pick<Report, 'up'> | null | undefined, date: ISODate, start: number, end: number): { title: string; task: string } | null {
  const hit = report?.up?.find(([d, st]) => d === date && st >= start - 5 && st < end);
  return hit ? { title: hit[3], task: hit[4] } : null;
}

/** Guesses the Ascend part from an activity's name, for activities made before links existed. */
export function inferLink(a: Activity): AscendLink | null {
  if (a.kind !== 'focus') return null;
  const n = a.name.toLowerCase();
  if (/cert|exam|aws|azure|comptia|security\+|gh-?\d/.test(n)) return 'cert';
  if (/project|portfolio|build|side ?hustle|\bapps?\b/.test(n)) return 'build';
  if (/stud|learn|course|lesson|roadmap|ascend|tutorial|class/.test(n)) return 'learn';
  return null;
}

/**
 * Which activities feed Ascend. Explicit links win; if no activity has one (data from ShiftWise 1.0/1.1),
 * links are inferred from the names so study still reaches Ascend.
 */
export function ascendLinks(activities: Activity[]): Map<string, AscendLink> {
  const explicit = activities.filter((a) => a.link);
  if (explicit.length) return new Map(explicit.map((a) => [a.id, a.link as AscendLink]));
  const out = new Map<string, AscendLink>();
  for (const a of activities) {
    const k = inferLink(a);
    if (k) out.set(a.id, k);
  }
  return out;
}

export function buildHandoff(plans: DayPlan[], activities: Activity[], from: ISODate, now: number, ctx?: HandoffContext): Handoff {
  const linkOf = ascendLinks(activities);
  const week: Record<AscendLink, number> = { learn: 0, build: 0, cert: 0 };
  for (const a of activities) {
    const k = linkOf.get(a.id);
    if (a.active && k) week[k] += a.weeklyTargetMin;
  }
  const days = plans
    .filter((p) => p.date >= from)
    .slice(0, HANDOFF_DAYS)
    .map((p) => {
      const day: HandoffDay = {
        d: p.date,
        c: p.code,
        b: p.blocks.flatMap((bl) => {
          const k = bl.activityId ? linkOf.get(bl.activityId) : undefined;
          return k ? [[bl.start, bl.end - bl.start, k] as [number, number, AscendLink]] : [];
        }),
      };
      if (ctx) {
        const r = ctx.roster(p.date);
        if (isWorkShift(r.code)) {
          const w = shiftWindow(r.code as WorkShift, ctx.settings);
          day.s = [w.start, w.end];
        }
        const wake = wakeOf(p);
        const bed = bedOf(p);
        if (wake !== null) day.w = wake;
        if (bed !== null) day.z = bed;
        const f = ctx.fatigue?.find((x) => x.date === p.date);
        if (f) {
          day.f = f.score;
          day.fl = f.level;
        }
      }
      return day;
    });
  return { v: 1, app: 'shiftwise', at: now, week, days };
}

export function encodePayload(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Returns the decoded JSON, or null for anything malformed. Validate the result before use. */
export function decodePayload(text: string): unknown {
  if (!/^[A-Za-z0-9_-]{1,60000}$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

export function ascendWebLink(h: Handoff, base = ASCEND_URL): string {
  return `${base}#sw=${encodePayload(h)}`;
}

/**
 * Opens the installed Ascend Android app with the plan; Chrome falls back to the web version when the
 * app is not installed.
 */
export function ascendAppLink(h: Handoff, base = ASCEND_URL): string {
  const payload = encodePayload(h);
  const fallback = encodeURIComponent(ascendWebLink(h, base));
  return `intent://import?sw=${payload}#Intent;scheme=ascend;package=${ASCEND_PACKAGE};S.browser_fallback_url=${fallback};end`;
}

export type ReportLog = Omit<TimeLog, 'id' | 'createdAt'>;

/** Turns completed Ascend sessions into activity log entries for the matching ShiftWise activities. */
export function reportToLogs(report: Report, activities: Activity[]): { logs: ReportLog[]; unmatched: number } {
  const linkOf = ascendLinks(activities);
  const pick = (k: AscendLink) => activities.find((a) => linkOf.get(a.id) === k && a.active) ?? activities.find((a) => linkOf.get(a.id) === k);
  const logs: ReportLog[] = [];
  let unmatched = 0;
  for (const it of report.items) {
    const a = pick(it.k);
    if (!a) {
      unmatched += 1;
      continue;
    }
    const start = atMinutes(it.d, it.st);
    logs.push({ category: 'activity', activityId: a.id, start, end: start + it.m * 60_000, note: `Ascend: ${it.t}`.slice(0, 500) });
  }
  return { logs, unmatched };
}
