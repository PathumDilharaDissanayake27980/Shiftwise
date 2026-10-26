import { describe, expect, it } from 'vitest';
import { ascendAppLink, ascendWebLink, buildHandoff, decodePayload, encodePayload, reportToLogs, type Report } from './ascend';
import { DEFAULT_SETTINGS, balancedActivities } from './defaults';
import { dayLoad, planDays, type RosterLookup } from './planner';
import { atMinutes, datesFrom } from './time';
import type { DayCode, RosterDay } from './types';
import { ascendReportSchema } from '../data/schemas';

const MON = '2026-10-26';
const S = DEFAULT_SETTINGS;
const rosterOf = (codes: DayCode[]): RosterLookup => {
  const dates = datesFrom(MON, codes.length);
  return (d) => ({ date: d, code: codes[dates.indexOf(d)] ?? 'OFF', mode: 'H' }) as RosterDay;
};

describe('balanced week', () => {
  const activities = balancedActivities(0);
  const roster = rosterOf(['M', 'M', 'D', 'D', 'OFF', 'OFF', 'N']);
  const plans = planDays(datesFrom(MON, 7), roster, S, activities);

  it('meets every weekly goal in a normal rotation week', () => {
    for (const a of activities) {
      const planned = plans.flatMap((p) => p.blocks).filter((b) => b.activityId === a.id).reduce((t, b) => t + b.end - b.start, 0);
      expect(planned, a.name).toBeGreaterThanOrEqual(a.weeklyTargetMin - 15);
    }
  });

  it('keeps focus work inside each day’s budget and leaves free time every day', () => {
    const focusIds = new Set(activities.filter((a) => a.kind === 'focus').map((a) => a.id));
    for (const p of plans) {
      const focus = p.blocks.filter((b) => b.activityId && focusIds.has(b.activityId)).reduce((t, b) => t + b.end - b.start, 0);
      expect(focus).toBeLessThanOrEqual(dayLoad(p.date, roster, S).focus);
      expect(p.freeMin, p.date).toBeGreaterThanOrEqual(60);
    }
  });

  it('plans study during long breaks and rests on Sundays only', () => {
    const allOff: RosterLookup = (d) => ({ date: d, code: 'OFF', mode: 'H' });
    const loads = datesFrom(MON, 7).map((d) => dayLoad(d, allOff, S).rest);
    expect(loads).toEqual([false, false, false, false, false, false, true]);
  });

  it('makes the second day off in a row a recharge day', () => {
    expect(dayLoad('2026-10-30', roster, S).rest).toBe(false);
    expect(dayLoad('2026-10-31', roster, S).rest).toBe(true);
    const sat = plans[5]!;
    expect(sat.blocks.some((b) => b.activityId && activities.find((a) => a.id === b.activityId)?.kind === 'focus')).toBe(false);
    expect(sat.notes.some((n) => n.title === 'Recharge day')).toBe(true);
  });
});

describe('Ascend link', () => {
  const activities = balancedActivities(0);
  const roster = rosterOf(['M', 'D', 'N', 'N', 'OFF', 'OFF', 'G']);
  const plans = planDays(datesFrom(MON, 7), roster, S, activities);

  it('sends only linked blocks, for every day from today', () => {
    const h = buildHandoff(plans, activities, '2026-10-27', 1);
    expect(h.days.map((d) => d.d)[0]).toBe('2026-10-27');
    expect(h.days).toHaveLength(6);
    expect(h.week).toEqual({ learn: 240, build: 240, cert: 90 });
    const kinds = new Set(h.days.flatMap((d) => d.b.map((b) => b[2])));
    expect([...kinds].every((k) => ['learn', 'build', 'cert'].includes(k))).toBe(true);
    expect(h.days.some((d) => d.b.length > 0)).toBe(true);
  });

  it('round-trips through the URL and builds app and web links', () => {
    const h = buildHandoff(plans, activities, MON, 1);
    expect(decodePayload(encodePayload(h))).toEqual(h);
    expect(decodePayload('not base64 !')).toBeNull();
    expect(ascendWebLink(h)).toMatch(/^https:\/\/.+\/ascend\/#sw=[A-Za-z0-9_-]+$/);
    expect(ascendAppLink(h)).toMatch(/^intent:\/\/import\?sw=[A-Za-z0-9_-]+#Intent;scheme=ascend;package=com\.eliteswe\.roadmap;S\.browser_fallback_url=https%3A/);
    expect(encodePayload({ t: 'Café — ✓' })).not.toMatch(/[+/=]/);
    expect(decodePayload(encodePayload({ t: 'Café — ✓' }))).toEqual({ t: 'Café — ✓' });
  });

  it('turns completed Ascend sessions into log entries', () => {
    const report: Report = { v: 1, app: 'ascend', at: Date.now(), items: [{ d: MON, st: 16 * 60, m: 45, k: 'learn', t: 'Python: type hints' }, { d: MON, st: 17 * 60, m: 60, k: 'build', t: 'F-1 scaffold' }] };
    expect(ascendReportSchema.safeParse(report).success).toBe(true);
    const r = reportToLogs(report, activities);
    expect(r.unmatched).toBe(0);
    expect(r.logs[0]).toMatchObject({ category: 'activity', start: atMinutes(MON, 960), end: atMinutes(MON, 1005), note: 'Ascend: Python: type hints' });
    expect(reportToLogs(report, activities.filter((a) => a.link !== 'build')).unmatched).toBe(1);
    expect(ascendReportSchema.safeParse({ ...report, items: [{ ...report.items[0], k: 'hack' }] }).success).toBe(false);
  });
});
