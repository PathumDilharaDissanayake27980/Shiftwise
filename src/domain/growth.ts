import type { ActivityStat } from './analytics';
import type { Activity } from './types';

/**
 * Weekly growth check: compares what you did last week with what was planned and suggests the next
 * week's goal. Progressive overload for habits: a goal you keep hitting goes up a step; a goal you keep
 * missing comes down to one you can hit, because consistency compounds and failure discourages.
 * Suggestions only: nothing changes until you tap Apply.
 */
export interface GrowthSuggestion {
  activity: Activity;
  from: number;
  to: number;
  /** Logged minutes as a share of planned minutes last week. */
  rate: number;
  kind: 'up' | 'down';
  reason: string;
}

const round15 = (m: number) => Math.round(m / 15) * 15;

/**
 * @param weekStartMs start of the week being judged. Activities created after it are skipped, and a
 * week with nothing logged at all is not judged: no data is not the same as failing.
 */
export function growthSuggestions(lastWeek: ActivityStat[], weekStartMs = 0): GrowthSuggestion[] {
  const out: GrowthSuggestion[] = [];
  if (lastWeek.reduce((t, st) => t + st.loggedMin, 0) < 30) return out;
  for (const st of lastWeek) {
    const a = st.activity;
    if (!a.active || st.targetMin <= 0 || st.plannedMin < 60 || a.createdAt > weekStartMs) continue;
    const rate = st.loggedMin / st.plannedMin;
    const pct = Math.round(rate * 100);
    if (rate < 0.5) {
      const to = Math.max(a.minBlockMin, round15(st.targetMin * 0.8));
      if (to < st.targetMin) out.push({ activity: a, from: st.targetMin, to, rate, kind: 'down', reason: `You did ${pct}% of the planned ${a.name}. A goal you hit beats one you miss, so step down for a week and rebuild the streak.` });
    } else if (rate >= 0.9 && st.loggedMin >= st.targetMin * 0.85) {
      const to = Math.min(80 * 60, st.targetMin + Math.max(15, Math.min(60, round15(st.targetMin * 0.15))));
      out.push({ activity: a, from: st.targetMin, to, rate, kind: 'up', reason: `You did ${pct}% of the planned ${a.name}. You're ready for a little more: level up.` });
    }
  }
  return out.sort((x, y) => (x.kind === y.kind ? y.activity.priority - x.activity.priority : x.kind === 'up' ? -1 : 1));
}
