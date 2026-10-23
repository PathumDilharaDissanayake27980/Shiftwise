import { describe, expect, it } from 'vitest';
import { respond, resolveDay, type AssistantContext } from './assistant';
import { weekReport } from './analytics';
import { DEFAULT_SETTINGS, defaultRosterDay, starterActivities } from './defaults';
import { fatigueInputs, fatigueSeries, levelFor } from './fatigue';
import { gapsOf, planDays, type RosterLookup } from './planner';
import { changeover, plannedWake } from './schedule';
import { addDays, datesFrom, fmtDuration, fmtTime, isISODate, parseClock, weekStart } from './time';
import type { DayCode, RosterDay, WorkMode } from './types';

const S = DEFAULT_SETTINGS;
const MON = '2026-10-26';

function rosterOf(week: [DayCode, WorkMode][], start = MON): RosterLookup {
  const map = new Map<string, RosterDay>();
  week.forEach(([code, mode], i) => map.set(addDays(start, i), { date: addDays(start, i), code, mode }));
  return (d) => map.get(d) ?? defaultRosterDay(d);
}

const day = (code: DayCode, mode: WorkMode = 'H'): RosterDay => ({ date: MON, code, mode });

describe('time utils', () => {
  it('formats and parses clock times', () => {
    expect(fmtTime(330)).toBe('5:30 AM');
    expect(fmtTime(1590)).toBe('2:30 AM');
    expect(fmtTime(0, false)).toBe('00:00');
    expect(parseClock('6:30 pm')).toBe(1110);
    expect(parseClock('18:30')).toBe(1110);
    expect(parseClock('12am')).toBe(0);
    expect(parseClock('25:00')).toBeNull();
    expect(fmtDuration(135)).toBe('2h 15m');
  });
  it('handles dates', () => {
    expect(isISODate('2026-02-30')).toBe(false);
    expect(weekStart('2026-10-29', 1)).toBe(MON);
    expect(datesFrom(MON, 7).at(-1)).toBe('2026-11-01');
  });
});

describe('schedule', () => {
  it('wakes 5:30 for a home morning shift and earlier at the office', () => {
    expect(plannedWake(day('M'), S)).toBe(330);
    expect(plannedWake(day('M', 'O'), S)).toBe(285);
    expect(plannedWake(day('D'), S)).toBe(420);
  });
  it('flags dangerous changeovers', () => {
    expect(changeover(day('N'), day('M'), S).verdict).toBe('bad');
    expect(changeover(day('N'), day('G'), S).verdict).toBe('bad');
    expect(changeover(day('D'), day('M'), S).verdict).toBe('tight');
    expect(changeover(day('M'), day('D'), S).verdict).toBe('easy');
    expect(changeover(day('N'), day('N'), S).verdict).toBe('ok');
    expect(changeover(day('OFF'), day('G'), S).advice).toMatch(/6:00 PM/);
  });
});

describe('planner', () => {
  const roster = rosterOf([['M', 'H'], ['D', 'O'], ['N', 'H'], ['N', 'H'], ['D', 'H'], ['OFF', 'H'], ['G', 'H']]);
  const activities = starterActivities(0);
  const plans = planDays(datesFrom(MON, 7), roster, S, activities);

  it('produces non-overlapping blocks covering the whole day', () => {
    for (const p of plans) {
      const sorted = [...p.blocks].sort((a, b) => a.start - b.start);
      let cursor = 0;
      for (const b of sorted) {
        expect(b.start).toBeGreaterThanOrEqual(cursor);
        expect(b.end).toBeGreaterThan(b.start);
        cursor = b.end;
      }
      expect(gapsOf(p.blocks)).toHaveLength(0);
    }
  });

  it('places the shift and commute at the right times', () => {
    const tue = plans[1]!;
    expect(tue.blocks.find((b) => b.type === 'shift')).toMatchObject({ start: 600, end: 1140 });
    expect(tue.blocks.filter((b) => b.type === 'commute')).toHaveLength(2);
    const mon = plans[0]!;
    expect(mon.blocks.some((b) => b.type === 'commute')).toBe(false);
  });

  it('carries a night shift into the next morning and sleeps after it', () => {
    const thu = plans[3]!;
    expect(thu.blocks[0]).toMatchObject({ type: 'shift', start: 0, end: 150 });
    const sleep = thu.blocks.find((b) => b.type === 'sleep');
    expect(sleep?.start).toBe(170);
  });

  it('respects weekly targets and the late cutoff', () => {
    for (const a of activities) {
      const planned = plans.reduce((t, p) => t + p.blocks.filter((b) => b.activityId === a.id).reduce((x, b) => x + b.end - b.start, 0), 0);
      expect(planned).toBeLessThanOrEqual(a.weeklyTargetMin);
    }
    for (const p of plans) {
      for (const b of p.blocks) {
        const a = activities.find((x) => x.id === b.activityId);
        if (a && (a.kind === 'focus' || a.kind === 'fitness')) expect(b.end).toBeLessThanOrEqual(S.lateCutoff);
      }
    }
  });

  it('plans graveyard sleep the evening before', () => {
    const sat = plans[5]!;
    expect(sat.blocks.at(-1)).toMatchObject({ type: 'sleep', start: 1080 });
  });

  it('places fixed commitments and warns on clashes', () => {
    const lecture = { ...activities[0]!, fixed: [{ weekday: 2, start: 450, end: 510 }, { weekday: 1, start: 600, end: 660 }] };
    const p = planDays([MON, addDays(MON, 1)], roster, S, [lecture]);
    expect(p[1]!.blocks.some((b) => b.fixed && b.start === 450)).toBe(true);
    expect(p[0]!.notes.some((n) => n.title.includes('clashes'))).toBe(true);
  });
});

describe('fatigue', () => {
  it('scores a run of nights after short sleep higher than a rested week', () => {
    const nights = rosterOf([['N', 'H'], ['N', 'H'], ['N', 'H'], ['N', 'H'], ['M', 'H'], ['D', 'H'], ['D', 'H']]);
    const easy = rosterOf([['D', 'H'], ['D', 'H'], ['OFF', 'H'], ['D', 'H'], ['D', 'H'], ['OFF', 'H'], ['OFF', 'H']]);
    const dates = datesFrom(MON, 7);
    const hard = fatigueSeries(fatigueInputs(planDays(dates, nights, S, []), [], S), S.sleepTargetMin);
    const soft = fatigueSeries(fatigueInputs(planDays(dates, easy, S, []), [], S), S.sleepTargetMin);
    expect(hard[4]!.score).toBeGreaterThan(soft[4]!.score);
    expect(hard[4]!.drivers.map((d) => d.key)).toContain('acute');
    expect(levelFor(hard[4]!.score)).not.toBe('low');
  });
  it('uses logged sleep over planned sleep', () => {
    const r = rosterOf([['D', 'H']]);
    const plan = planDays([MON], r, S, []);
    const end = new Date(2026, 9, 26, 7, 0).getTime();
    const logs = [{ id: '1', category: 'sleep' as const, start: end - 4 * 3600_000, end, createdAt: 0 }];
    expect(fatigueInputs(plan, logs, S)[0]!.sleepMin).toBe(240);
  });
});

describe('analytics', () => {
  it('reports overtime from logs and discretionary time', () => {
    const r = rosterOf([['D', 'H'], ['D', 'H'], ['OFF', 'H'], ['D', 'H'], ['D', 'H'], ['OFF', 'H'], ['OFF', 'H']]);
    const plans = planDays(datesFrom(MON, 7), r, S, starterActivities(0));
    const start = new Date(2026, 9, 26, 10, 0).getTime();
    const logs = [{ id: 'x', category: 'shift' as const, start, end: start + 10 * 3600_000, shiftDate: MON, createdAt: 0 }];
    const rep = weekReport(plans, logs, starterActivities(0), S);
    expect(rep.overtimeMin).toBe(60);
    expect(rep.discretionaryMin).toBeGreaterThan(rep.activityMin);
    expect(rep.insights.length).toBeGreaterThan(0);
  });
});

describe('assistant', () => {
  const roster = rosterOf([['M', 'H'], ['D', 'O'], ['N', 'H'], ['N', 'H'], ['D', 'H'], ['OFF', 'H'], ['G', 'H']]);
  const activities = starterActivities(0);
  const dates = datesFrom(MON, 7);
  const weekPlans = planDays(dates, roster, S, activities);
  const fatigue = fatigueSeries(fatigueInputs(weekPlans, [], S), S.sleepTargetMin);
  const ctx: AssistantContext = {
    today: '2026-10-28', now: new Date(2026, 9, 28, 9, 0), settings: S, activities, roster, weekPlans, fatigue,
    report: weekReport(weekPlans, [], activities, S, fatigue), running: [],
  };

  it('resolves day words', () => {
    expect(resolveDay('fri', '2026-10-28', 1)).toBe('2026-10-30');
    expect(resolveDay('tomorrow', '2026-10-28', 1)).toBe('2026-10-29');
    expect(resolveDay('31/10', '2026-10-28', 1)).toBe('2026-10-31');
  });
  it('turns a roster change into a confirmable action', () => {
    const r = respond('set friday night office', ctx);
    expect(r.actions[0]).toEqual({ type: 'setRoster', days: [{ date: '2026-10-30', code: 'N', mode: 'O' }] });
  });
  it('sets a whole week', () => {
    const r = respond('next week m/h d/o n n off off g/h', ctx);
    const a = r.actions[0];
    expect(a?.type).toBe('setRoster');
    if (a?.type === 'setRoster') expect(a.days).toHaveLength(7);
  });
  it('handles timers, logs and new activities', () => {
    expect(respond('clock in', ctx).actions[0]).toEqual({ type: 'clockIn', shiftDate: '2026-10-28' });
    expect(respond('log 2h study', ctx).actions[0]?.type).toBe('logActivity');
    expect(respond('add guitar 3h per week evening', ctx).actions[0]).toMatchObject({ type: 'addActivity', activity: { name: 'Guitar', weeklyTargetMin: 180, preferred: 'evening', kind: 'light' } });
  });
  it('clocks into last night’s shift after midnight', () => {
    const r = respond('clock in', { ...ctx, today: '2026-10-29', now: new Date(2026, 9, 29, 1, 0) });
    expect(r.actions[0]).toEqual({ type: 'clockIn', shiftDate: '2026-10-28' });
  });
  it('answers questions without actions', () => {
    for (const q of ['how tired am I?', 'how much free time do I have', 'when can I study', 'what should I do today', 'help', 'when is my next shift']) {
      const r = respond(q, ctx);
      expect(r.actions).toHaveLength(0);
      expect(r.text.length).toBeGreaterThan(10);
      expect(r.text).not.toMatch(/didn't catch/);
    }
  });
});

describe('ids', () => {
  it('makes valid v4 UUIDs with and without randomUUID', async () => {
    const { newId } = await import('./defaults');
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(newId()).toMatch(re);
    const orig = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      expect(newId()).toMatch(re);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: orig, configurable: true });
    }
  });
});
