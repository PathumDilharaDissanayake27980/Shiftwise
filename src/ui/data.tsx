import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { weekReport, type WeekReport } from '../domain/analytics';
import { fatigueInputs, fatigueSeries, type FatigueResult } from '../domain/fatigue';
import { planDays, type RosterLookup } from '../domain/planner';
import { addDays, atMinutes, datesFrom, toISODate, weekStart } from '../domain/time';
import type { Activity, DayPlan, ISODate, Settings, TimeLog } from '../domain/types';
import { repo } from '../data/repo';

export interface WeekBundle {
  start: ISODate;
  plans: DayPlan[];
  fatigue: FatigueResult[];
  report: WeekReport;
}

export interface AppData {
  settings: Settings;
  now: Date;
  today: ISODate;
  currentWeek: ISODate;
  roster: RosterLookup;
  activities: Activity[];
  logs: TimeLog[];
  running: TimeLog[];
  week: (start: ISODate) => WeekBundle;
  todayPlan: DayPlan | undefined;
  todayFatigue: FatigueResult | undefined;
}

const Ctx = createContext<AppData | null>(null);

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    const onVis = () => document.visibilityState === 'visible' && setNow(new Date());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [intervalMs]);
  return now;
}

/** Loads everything the screens need from IndexedDB and derives plans, fatigue and reports. */
export function AppDataProvider({ viewWeek, children, fallback }: { viewWeek: ISODate | null; children: ReactNode; fallback: ReactNode }) {
  const now = useNow();
  const today = toISODate(now);
  const settings = useLiveQuery(() => repo.getSettings(), []);
  const startsOn = settings?.weekStartsOn ?? 1;
  const currentWeek = weekStart(today, startsOn);
  const view = viewWeek ? weekStart(viewWeek, startsOn) : currentWeek;
  const from = addDays(view < currentWeek ? view : currentWeek, -9);
  const to = addDays(view > currentWeek ? view : currentWeek, 8);

  const rosterRows = useLiveQuery(() => repo.rosterRange(from, to), [from, to]);
  const activities = useLiveQuery(() => repo.listActivities(), []);
  const logs = useLiveQuery(() => repo.logsBetween(atMinutes(from, -1440), atMinutes(to, 2880)), [from, to]);
  const running = useLiveQuery(() => repo.runningLogs(), []);

  const value = useMemo<AppData | null>(() => {
    if (!settings || !rosterRows || !activities || !logs || !running) return null;
    const roster = repo.lookupFrom(rosterRows);
    const cache = new Map<ISODate, WeekBundle>();
    const planWeek = (start: ISODate) => planDays(datesFrom(start, 7), roster, settings, activities);
    const week = (start: ISODate): WeekBundle => {
      const hit = cache.get(start);
      if (hit) return hit;
      const prev = planWeek(addDays(start, -7));
      const plans = planWeek(start);
      const series = fatigueSeries(fatigueInputs([...prev, ...plans], logs, settings), settings.sleepTargetMin);
      const fatigue = series.slice(7);
      const bundle: WeekBundle = { start, plans, fatigue, report: weekReport(plans, logs, activities, settings, fatigue) };
      cache.set(start, bundle);
      return bundle;
    };
    const cur = week(currentWeek);
    return {
      settings,
      now,
      today,
      currentWeek,
      roster,
      activities,
      logs,
      running,
      week,
      todayPlan: cur.plans.find((p) => p.date === today),
      todayFatigue: cur.fatigue.find((f) => f.date === today),
    };
  }, [settings, rosterRows, activities, logs, running, now, today, currentWeek]);

  if (!value) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData must be used inside AppDataProvider');
  return v;
}
