import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildHandoff, lessonIn, type Report } from '../domain/ascend';
import { buildAlerts, blankRule } from '../domain/alerts';
import { DEFAULT_SETTINGS, balancedActivities } from '../domain/defaults';
import { planDays, type RosterLookup } from '../domain/planner';
import { atMinutes, datesFrom } from '../domain/time';
import type { DayCode, RosterDay } from '../domain/types';
import { seal } from './crypto';
import { GitHubClient, newAlertsKey } from './github';
import { WIRING_ASCEND, WIRING_FORMAT, WIRING_SHIFTWISE, linkPayload, pullAscend, pushPlan } from './wiring';

const MON = '2026-10-26';
const codes: DayCode[] = ['N', 'N', 'OFF', 'G', 'M', 'D', 'OFF'];
const dates = datesFrom(MON, 7);
const roster: RosterLookup = (d) => ({ date: d, code: codes[dates.indexOf(d)] ?? 'OFF', mode: 'H' }) as RosterDay;
const activities = balancedActivities(0);
const plans = planDays(dates, roster, DEFAULT_SETTINGS, activities);
const cfg = { repo: 'me/Shiftwise', branch: 'alerts', key: newAlertsKey(), token: 'github_pat_' + 'x'.repeat(40) };

function fakeRepo() {
  const files = new Map<string, string>();
  const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(input)).pathname.replace('/repos/me/Shiftwise/contents/', ''));
    if ((init?.method ?? 'GET') === 'GET') {
      const f = files.get(path);
      return f ? new Response(JSON.stringify({ sha: 'a', content: Buffer.from(f).toString('base64') })) : new Response('{}', { status: 404 });
    }
    files.set(path, Buffer.from(JSON.parse(String(init?.body)).content, 'base64').toString());
    return new Response('{}', { status: 200 });
  };
  return { files, client: new GitHubClient(cfg, handler as typeof fetch) };
}

afterEach(() => vi.unstubAllGlobals());

describe('wiring', () => {
  it('tells Ascend about each day: shift, wake, bed and fatigue', () => {
    const h = buildHandoff(plans, activities, MON, 1, { settings: DEFAULT_SETTINGS, roster, fatigue: [{ date: MON, score: 55, level: 'high', drivers: [], advice: [] } as never] });
    expect(h.days[0]).toMatchObject({ c: 'N', s: [1110, 1590], f: 55, fl: 'high' });
    expect(h.days[0]?.w).toBeTypeOf('number');
    expect(h.days[3]).toMatchObject({ c: 'G', s: [90, 510] });
  });

  it('round-trips both files through the encrypted branch', async () => {
    const { files, client } = fakeRepo();
    const h = buildHandoff(plans, activities, MON, 5);
    await pushPlan(h, cfg, client);
    const stored = files.get(WIRING_SHIFTWISE) ?? '';
    expect(stored).toContain(WIRING_FORMAT);
    expect(stored).not.toContain('learn');
    expect(await pullAscend(cfg, client)).toBeNull();

    const report: Report = { v: 1, app: 'ascend', at: Date.now(), items: [], up: [[MON, 960, 45, 'Python: type hints', 'Add a pytest test']] };
    files.set(WIRING_ASCEND, JSON.stringify({ format: WIRING_FORMAT, version: 1, updatedAt: 9, sealed: await seal(JSON.stringify(report), cfg.key, 100_000) }));
    expect(await pullAscend(cfg, client)).toEqual(report);
    expect(linkPayload({ ...cfg })).toMatchObject({ app: 'shiftwise-link', repo: 'me/Shiftwise' });
  }, 30_000);

  it('puts the Ascend lesson and its task into alerts and the daily plan', () => {
    const study = plans.flatMap((p) => p.blocks.map((b) => ({ p, b }))).find(({ b }) => b.activityId === activities[0]?.id);
    expect(study).toBeDefined();
    const { p, b } = study!;
    const report: Pick<Report, 'up'> = { up: [[p.date, b.start, b.end - b.start, 'Python: type hints', 'Add a pytest test']] };
    expect(lessonIn(report, p.date, b.start, b.end)?.title).toBe('Python: type hints');
    const rule = { ...blankRule('activityStart'), message: '{activity} | {task}' };
    const brief = { ...blankRule('dailyBrief'), message: '{plan}' };
    const alerts = buildAlerts({
      now: atMinutes(MON, 0), plans, roster, settings: DEFAULT_SETTINGS, activities, fatigue: [], running: [], rules: [rule, brief],
      lessonFor: (d, st, en) => lessonIn(report, d, st, en),
    });
    expect(alerts.some((a) => a.text === 'Learn (Ascend lessons): Python: type hints | Add a pytest test')).toBe(true);
    expect(alerts.some((a) => a.text.includes('Learn (Ascend lessons): Python: type hints'))).toBe(true);
  });
});
