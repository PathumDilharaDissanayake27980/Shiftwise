import { isWorkShift } from './defaults';
import { shiftWindow } from './schedule';
import { MIN_PER_DAY, minutesSince, overlap } from './time';
import type { DayCode, DayPlan, ISODate, Settings, TimeLog } from './types';

/**
 * A transparent fatigue-risk score (0–100) built from factors used in shift-work fatigue research:
 * acute sleep loss, accumulated sleep debt, work in the circadian low (00:00–06:00), consecutive night
 * shifts, short rest between shifts and total workload. It is a planning aid, not a medical assessment.
 */

export interface FatigueDayInput {
  date: ISODate;
  code: DayCode;
  /** Sleep that finished on this date (main sleep + naps). */
  sleepMin: number;
  /** Work intervals in minutes relative to this date's midnight. */
  work: { start: number; end: number }[];
}

export type FatigueLevel = 'low' | 'moderate' | 'high' | 'severe';

export interface FatigueDriver {
  key: 'acute' | 'debt' | 'night' | 'nightRun' | 'quickReturn' | 'workload' | 'workRun';
  label: string;
  points: number;
  detail: string;
}

export interface FatigueResult {
  date: ISODate;
  score: number;
  level: FatigueLevel;
  drivers: FatigueDriver[];
  recommendations: string[];
}

export function levelFor(score: number): FatigueLevel {
  if (score < 30) return 'low';
  if (score < 50) return 'moderate';
  if (score < 70) return 'high';
  return 'severe';
}

const RECS: Record<FatigueDriver['key'], string> = {
  acute: 'Take a 20–30 minute nap before 3 PM and skip hard workouts today.',
  debt: 'Pay back sleep gradually: 30–60 extra minutes over the next few nights, and no more than 2 hours of lie-in on an off day.',
  night: 'On night work, get bright light early in the shift and avoid it on the way home. Keep the bedroom dark and cool.',
  nightRun: 'After this run of nights, take a short sleep (3–4 hours) in the morning, then go to bed at a normal time to reset.',
  quickReturn: 'You are getting under 11 hours between shifts. Ask your lead whether the roster can respect the 11-hour rest rule.',
  workload: 'Your work hours are high this week. Pause low-priority side work and keep only your top goal.',
  workRun: 'Six or more work days in a row. Protect your next off day for rest, not catch-up work.',
};

const isNightType = (c: DayCode) => c === 'N' || c === 'G';

function workMinutes(d: FatigueDayInput): number {
  return d.work.reduce((t, w) => t + w.end - w.start, 0);
}

export function scoreFatigue(days: FatigueDayInput[], index: number, sleepTargetMin: number): FatigueResult {
  const day = days[index];
  if (!day) throw new RangeError('index out of range');
  const windowStart = Math.max(0, index - 6);
  const win = days.slice(windowStart, index + 1);
  const drivers: FatigueDriver[] = [];

  // Acute sleep.
  const acute = day.sleepMin < 300 ? 25 : day.sleepMin < 360 ? 15 : day.sleepMin < 420 ? 7 : 0;
  if (acute) drivers.push({ key: 'acute', label: 'Short sleep last night', points: acute, detail: `${(day.sleepMin / 60).toFixed(1)}h of sleep` });

  // Sleep debt over up to 7 days.
  const debtMin = win.reduce((t, d) => t + Math.max(0, sleepTargetMin - d.sleepMin), 0);
  const debt = Math.min(30, Math.round((debtMin / 60) * 4));
  if (debt) drivers.push({ key: 'debt', label: 'Sleep debt', points: debt, detail: `${(debtMin / 60).toFixed(1)}h below target over ${win.length} days` });

  // Work in the circadian low (00:00–06:00) during the last two days, including yesterday's carry-over.
  let nightMin = 0;
  for (let k = Math.max(0, index - 1); k <= index; k++) {
    const d = days[k];
    if (!d) continue;
    for (const w of d.work) nightMin += overlap(w.start, w.end, 0, 360) + overlap(w.start, w.end, MIN_PER_DAY, MIN_PER_DAY + 360);
  }
  const night = Math.min(20, Math.round((nightMin / 60) * 2.5));
  if (night) drivers.push({ key: 'night', label: 'Work between midnight and 6 AM', points: night, detail: `${(nightMin / 60).toFixed(1)}h in the last 2 days` });

  // Consecutive night-type shifts.
  let run = 0;
  for (let k = index; k >= 0 && isNightType((days[k] as FatigueDayInput).code); k--) run++;
  const nightRun = Math.min(15, Math.max(0, run - 1) * 5);
  if (nightRun) drivers.push({ key: 'nightRun', label: 'Nights in a row', points: nightRun, detail: `${run} consecutive night or graveyard shifts` });

  // Quick returns (< 11h between consecutive shifts).
  let quick = 0;
  for (let k = windowStart + 1; k <= index; k++) {
    const a = days[k - 1];
    const b = days[k];
    if (!a || !b || a.work.length === 0 || b.work.length === 0) continue;
    const aEnd = Math.max(...a.work.map((w) => w.end)) - MIN_PER_DAY;
    const bStart = Math.min(...b.work.map((w) => w.start));
    if (bStart - aEnd < 660) quick++;
  }
  const qr = Math.min(15, quick * 5);
  if (qr) drivers.push({ key: 'quickReturn', label: 'Short rest between shifts', points: qr, detail: `${quick} changeover${quick > 1 ? 's' : ''} under 11 hours this week` });

  // Workload over 7 days.
  const workH = win.reduce((t, d) => t + workMinutes(d), 0) / 60;
  const workload = Math.min(10, Math.max(0, Math.round((workH - 45) * 2)));
  if (workload) drivers.push({ key: 'workload', label: 'High work hours', points: workload, detail: `${workH.toFixed(1)}h worked in ${win.length} days` });

  // Consecutive work days.
  let streak = 0;
  for (let k = index; k >= 0 && isWorkShift((days[k] as FatigueDayInput).code); k--) streak++;
  const workRun = Math.min(10, Math.max(0, streak - 5) * 5);
  if (workRun) drivers.push({ key: 'workRun', label: 'Work days in a row', points: workRun, detail: `${streak} days without a day off` });

  const score = Math.min(100, drivers.reduce((t, d) => t + d.points, 0));
  drivers.sort((a, b) => b.points - a.points);
  const level = levelFor(score);
  const recommendations = drivers.slice(0, 3).map((d) => RECS[d.key]);
  if (level === 'high' || level === 'severe') recommendations.unshift('Cut today to one focus block and move the rest to an off day.');
  if (level === 'severe') recommendations.unshift('Do not drive or ride long distances when this tired. Use transport or rest first.');
  return { date: day.date, score, level, drivers, recommendations };
}

export function fatigueSeries(days: FatigueDayInput[], sleepTargetMin: number): FatigueResult[] {
  return days.map((_, i) => scoreFatigue(days, i, sleepTargetMin));
}

/** Combines plans with actual logs: logged sleep and shift times win over the plan where they exist. */
export function fatigueInputs(plans: DayPlan[], logs: TimeLog[], s: Settings): FatigueDayInput[] {
  return plans.map((p) => {
    const sleepLogs = logs.filter((l) => l.category === 'sleep' && l.end !== null && endsOn(l.end, p.date));
    const sleepMin = sleepLogs.length
      ? sleepLogs.reduce((t, l) => t + ((l.end as number) - l.start) / 60_000, 0)
      : p.sleepBeforeMin;
    const shiftLogs = logs.filter((l) => l.category === 'shift' && l.shiftDate === p.date && l.end !== null);
    let work: { start: number; end: number }[];
    if (shiftLogs.length) {
      work = shiftLogs.map((l) => ({ start: minutesSince(p.date, l.start), end: minutesSince(p.date, l.end as number) }));
    } else if (isWorkShift(p.code)) {
      work = [shiftWindow(p.code as 'M', s)];
    } else {
      work = [];
    }
    return { date: p.date, code: p.code, sleepMin: Math.round(sleepMin), work };
  });
}

function endsOn(epochMs: number, iso: ISODate): boolean {
  const m = minutesSince(iso, epochMs);
  return m >= 0 && m < MIN_PER_DAY;
}

