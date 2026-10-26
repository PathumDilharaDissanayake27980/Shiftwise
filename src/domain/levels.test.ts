import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, GROWTH_LEVELS, LEVELS, balancedActivities } from './defaults';
import { planDays, type RosterLookup } from './planner';
import { datesFrom } from './time';
import type { DayCode, RosterDay } from './types';

const codes: DayCode[] = ['M', 'M', 'D', 'D', 'OFF', 'OFF', 'N', 'N', 'N', 'OFF', 'G', 'G', 'OFF', 'OFF'];
const dates = datesFrom('2026-10-26', 14);
const roster: RosterLookup = (d) => ({ date: d, code: codes[dates.indexOf(d)] ?? 'OFF', mode: 'H' }) as RosterDay;

/** Hours of each kind in a planned week. */
function hours(level: (typeof GROWTH_LEVELS)[number], week: 0 | 1) {
  const s = { ...DEFAULT_SETTINGS, focusBudget: LEVELS[level].focusBudget, maxPlannedShare: LEVELS[level].share };
  const plans = planDays(dates.slice(week * 7, week * 7 + 7), roster, s, balancedActivities(0, level));
  const sum = (re: RegExp) => plans.flatMap((p) => p.blocks).filter((b) => b.type === 'activity' && re.test(b.label)).reduce((t, b) => t + b.end - b.start, 0) / 60;
  return { lessons: sum(/^Learn/), growth: sum(/^Learn|^Build|^Certification|review/), free: plans.reduce((t, p) => t + p.freeMin, 0) / 7 / 60 };
}

describe('learning intensity', () => {
  it('delivers the promised study time in a normal week and in a night/graveyard week', () => {
    for (const week of [0, 1] as const) {
      const f = hours('focused', week);
      expect(f.lessons, `focused lessons, week ${week + 1}`).toBeGreaterThanOrEqual(6.5);
      expect(f.growth, `focused growth, week ${week + 1}`).toBeGreaterThanOrEqual(14);
      expect(f.free, 'free time per day').toBeGreaterThanOrEqual(3.5);
      expect(hours('sprint', week).growth, `sprint growth, week ${week + 1}`).toBeGreaterThanOrEqual(18.5);
    }
  });

  it('steps up from level to level', () => {
    const g = GROWTH_LEVELS.map((l) => hours(l, 0).growth);
    expect(g[0]).toBeLessThan(g[1] as number);
    expect(g[1]).toBeLessThan(g[2] as number);
  });
});
