import { isOfficeDay, isWorkShift } from './defaults';
import type { DayCode, RosterDay, Settings, WorkShift } from './types';
import { MIN_PER_DAY, fmtDuration, fmtTime } from './time';

/** Shift interval in minutes relative to the rostered date's midnight. */
export function shiftWindow(code: WorkShift, s: Settings): { start: number; end: number } {
  const def = s.shifts[code];
  return { start: def.start, end: def.start + def.duration };
}

export function commuteFor(day: RosterDay, s: Settings): number {
  return isOfficeDay(day, s) ? s.commuteMin : 0;
}

/** When the person must leave home (or log in) for the day's shift. */
export function leaveTime(day: RosterDay, s: Settings): number | null {
  if (!isWorkShift(day.code)) return null;
  return shiftWindow(day.code, s).start - commuteFor(day, s);
}

/** Wake-up time on a normal night (no shift carried over from the day before). */
export function plannedWake(day: RosterDay, s: Settings): number {
  if (!isWorkShift(day.code)) return s.wake.OFF;
  const leave = leaveTime(day, s) ?? 0;
  if (day.code === 'G') return leave - s.prepMin;
  return Math.min(s.wake[day.code], leave - s.prepMin);
}

/**
 * Bedtime on the evening before `next`, in minutes of that evening's date.
 * Before a graveyard shift this is an early-evening sleep.
 */
export function bedtimeBefore(next: RosterDay, s: Settings): number {
  const wakeNext = plannedWake(next, s) + MIN_PER_DAY;
  if (next.code === 'G') return wakeNext - s.graveyardPreSleepMin;
  const key = isWorkShift(next.code) ? next.code : 'OFF';
  const pref = s.bedtime[key as 'M' | 'D' | 'N' | 'OFF'];
  return Math.min(pref, wakeNext - s.sleepTargetMin);
}

/** End of all work duties (shift + commute home), relative to the rostered date. */
export function dutiesEnd(day: RosterDay, s: Settings): number | null {
  if (!isWorkShift(day.code)) return null;
  return shiftWindow(day.code, s).end + commuteFor(day, s);
}

export type Verdict = 'easy' | 'ok' | 'tight' | 'bad';

export interface Changeover {
  prev: DayCode;
  next: DayCode;
  /** Minutes between the end of one shift and the start of the next. null when either day is not a work day. */
  restMin: number | null;
  /** Longest sleep that fits between the two shifts. */
  sleepMaxMin: number | null;
  verdict: Verdict;
  advice: string;
}

/** EU Working Time Directive minimum daily rest. */
export const MIN_DAILY_REST = 11 * 60;

export function changeover(prev: RosterDay, next: RosterDay, s: Settings): Changeover {
  const base = { prev: prev.code, next: next.code };
  const prevWork = isWorkShift(prev.code);
  const nextWork = isWorkShift(next.code);

  if (!prevWork || !nextWork) {
    if (!nextWork) {
      return { ...base, restMin: null, sleepMaxMin: null, verdict: 'easy', advice: 'No shift the next day. A late evening is fine, but keep your wake-up within two hours of usual.' };
    }
    if (next.code === 'G') {
      return { ...base, restMin: null, sleepMaxMin: null, verdict: 'ok', advice: `Move your sleep early: dinner by ${fmtTime(bedtimeBefore(next, s) - 30, s.hour12)}, sleep ${fmtTime(bedtimeBefore(next, s), s.hour12)} until ${fmtTime(plannedWake(next, s), s.hour12)}.` };
    }
    return { ...base, restMin: null, sleepMaxMin: null, verdict: next.code === 'M' ? 'ok' : 'easy', advice: `Rested going in. Be in bed by ${fmtTime(bedtimeBefore(next, s), s.hour12)}.` };
  }

  const p = shiftWindow(prev.code as WorkShift, s);
  const n = shiftWindow(next.code as WorkShift, s);
  const restMin = n.start + MIN_PER_DAY - p.end;
  const crossesMidnight = p.end > MIN_PER_DAY;
  const freeFrom = p.end + commuteFor(prev, s) + (crossesMidnight ? Math.min(20, s.windDownMin) : s.windDownMin);
  // After a shift that ends past midnight the person sleeps straight away, so they wake when rested
  // or when they must get ready for the next shift, whichever comes first.
  const latestWake = (leaveTime(next, s) ?? 0) + MIN_PER_DAY - (next.code === 'G' ? Math.min(30, s.prepMin) : s.prepMin);
  const wakeNext = crossesMidnight ? Math.min(freeFrom + s.sleepTargetMin, latestWake) : plannedWake(next, s) + MIN_PER_DAY;
  const sleepMaxMin = wakeNext - freeFrom;
  const bed = Math.max(freeFrom, bedtimeBefore(next, s));

  if (restMin <= 0) {
    return { ...base, restMin, sleepMaxMin: null, verdict: 'bad', advice: `These shifts overlap by ${fmtDuration(-restMin)}. This pairing should not be rostered. Raise it with your lead.` };
  }
  if (sleepMaxMin < 300) {
    return { ...base, restMin, sleepMaxMin, verdict: 'bad', advice: `At most ${fmtDuration(Math.max(0, sleepMaxMin))} of sleep fits between these shifts. Ask your lead to avoid this pairing. If it happens, sleep immediately and plan a 20-minute nap in your break.` };
  }
  const bedText = crossesMidnight
    ? `Sleep straight after the shift, from about ${fmtTime(freeFrom, s.hour12)} until ${fmtTime(wakeNext, s.hour12)}.`
    : `Be in bed by ${fmtTime(bed, s.hour12)}${next.code === 'G' ? ` and sleep until ${fmtTime(wakeNext, s.hour12)}` : ''}.`;
  if (sleepMaxMin < 390 || restMin <= MIN_DAILY_REST) {
    const rest = restMin <= MIN_DAILY_REST ? ` Rest is ${fmtDuration(restMin)}, ${restMin < MIN_DAILY_REST ? 'under' : 'right at'} the 11-hour minimum.` : '';
    return { ...base, restMin, sleepMaxMin, verdict: 'tight', advice: `${bedText}${rest} Keep the evening light.` };
  }
  return { ...base, restMin, sleepMaxMin, verdict: restMin >= 18 * 60 ? 'easy' : 'ok', advice: bedText };
}

export function verdictRank(v: Verdict): number {
  return { easy: 0, ok: 1, tight: 2, bad: 3 }[v];
}
