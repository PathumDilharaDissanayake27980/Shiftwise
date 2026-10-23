import { describe, expect, it } from 'vitest';
import { buildAlerts, blankRule, defaultAlertRules, render, type AlertRule } from './alerts';
import { DEFAULT_SETTINGS, defaultRosterDay, starterActivities } from './defaults';
import { fatigueInputs, fatigueSeries } from './fatigue';
import { planDays, type RosterLookup } from './planner';
import { addDays, atMinutes, datesFrom } from './time';
import type { DayCode, RosterDay, WorkMode } from './types';

const S = DEFAULT_SETTINGS;
const MON = '2026-10-26';
const week: [DayCode, WorkMode][] = [['M', 'H'], ['D', 'O'], ['N', 'H'], ['N', 'H'], ['D', 'H'], ['OFF', 'H'], ['G', 'H']];
const map = new Map<string, RosterDay>(week.map(([code, mode], i) => [addDays(MON, i), { date: addDays(MON, i), code, mode }]));
const roster: RosterLookup = (d) => map.get(d) ?? defaultRosterDay(d);
const activities = starterActivities(0);
const plans = planDays(datesFrom(MON, 7), roster, S, activities);
const fatigue = fatigueSeries(fatigueInputs(plans, [], S), S.sleepTargetMin);
const now = atMinutes(MON, 0) - 60_000;
const base = { now, plans, roster, settings: S, activities, fatigue, running: [] };

describe('alerts', () => {
  it('renders placeholders and keeps unknown ones', () => {
    expect(render('{shift} at {start} {nope}', { shift: 'Night', start: '6:30 PM' })).toBe('Night at 6:30 PM {nope}');
  });

  it('creates shift reminders an hour before each shift', () => {
    const rule: AlertRule = { ...blankRule('shiftStart'), offsetMin: -60, message: '{shift} {start}' };
    const a = buildAlerts({ ...base, rules: [rule] });
    expect(a).toHaveLength(6);
    expect(a[0]).toMatchObject({ at: atMinutes(MON, 300), text: 'Morning 6:00 AM' });
    expect(a.find((x) => x.text.startsWith('Graveyard'))?.at).toBe(atMinutes(addDays(MON, 6), 30));
  });

  it('filters by shift type and only warns to leave on office days', () => {
    const nights: AlertRule = { ...blankRule('shiftStart'), shifts: ['N'], message: 'n' };
    expect(buildAlerts({ ...base, rules: [nights] })).toHaveLength(2);
    const leave: AlertRule = { ...blankRule('leaveHome'), offsetMin: -10, message: '{leave}' };
    const l = buildAlerts({ ...base, rules: [leave] });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ at: atMinutes(addDays(MON, 1), 9 * 60 + 5), text: '9:15 AM' });
  });

  it('only reminds to clock out while clocked in', () => {
    const rule: AlertRule = { ...blankRule('clockOutMissed'), offsetMin: 30 };
    expect(buildAlerts({ ...base, rules: [rule] })).toHaveLength(0);
    const running = [{ id: 'log1', category: 'shift' as const, start: atMinutes(MON, 360), end: null, shiftDate: MON, createdAt: 0 }];
    const a = buildAlerts({ ...base, running, rules: [rule] });
    expect(a).toHaveLength(1);
    expect(a[0]?.at).toBe(atMinutes(MON, 930));
    expect(a[0]?.text).toContain('3:00 PM');
  });

  it('builds a daily brief with the plan, and custom reminders on chosen weekdays', () => {
    const brief: AlertRule = { ...blankRule('dailyBrief'), offsetMin: 20 };
    const b = buildAlerts({ ...base, rules: [brief] });
    expect(b[0]?.text).toContain('Morning shift');
    expect(b[0]?.at).toBe(atMinutes(MON, 330 + 20));
    const custom: AlertRule = { ...blankRule('custom'), time: 18 * 60, weekdays: [6], message: 'Pay bills' };
    const c = buildAlerts({ ...base, rules: [custom] });
    expect(c).toHaveLength(1);
    expect(c[0]?.at).toBe(atMinutes(addDays(MON, 5), 1080));
  });

  it('sends risk warnings only on risky days and skips disabled rules', () => {
    const risk: AlertRule = { ...blankRule('riskWarning'), minScore: 101 };
    const r = buildAlerts({ ...base, rules: [risk] });
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThan(7);
    expect(buildAlerts({ ...base, rules: [{ ...risk, enabled: false }] })).toHaveLength(0);
  });

  it('gives stable ids and skips past alerts', () => {
    const rules = defaultAlertRules();
    const a = buildAlerts({ ...base, rules });
    const b = buildAlerts({ ...base, rules });
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    const later = buildAlerts({ ...base, now: atMinutes(addDays(MON, 3), 0), rules });
    expect(later.every((x) => x.at >= atMinutes(addDays(MON, 3), 0) - 30 * 60_000)).toBe(true);
    expect(new Set(a.map((x) => x.id)).size).toBe(a.length);
  });
});
