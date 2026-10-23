import { CODE_LABEL, isWorkShift } from './defaults';
import type { FatigueResult } from './fatigue';
import { shiftWindow } from './schedule';
import { dayName, fmtTime, overlap } from './time';
import type { Activity, BlockType, DayPlan, ISODate, PlanNote, Settings, TimeLog } from './types';

const DISCRETIONARY: BlockType[] = ['activity', 'free', 'break', 'buffer'];

export interface Stretch {
  date: ISODate;
  start: number;
  end: number;
}

export interface ActivityStat {
  activity: Activity;
  targetMin: number;
  plannedMin: number;
  loggedMin: number;
}

export interface DayStat {
  date: ISODate;
  code: DayPlan['code'];
  workMin: number;
  sleepMin: number;
  activityMin: number;
  freeMin: number;
  longestStretchMin: number;
  fatigue: number | null;
}

export interface WeekReport {
  scheduledWorkMin: number;
  loggedWorkMin: number;
  overtimeMin: number;
  shiftsScheduled: number;
  shiftsLogged: number;
  avgPlannedSleepMin: number;
  avgLoggedSleepMin: number | null;
  discretionaryMin: number;
  activityMin: number;
  freeMin: number;
  /** Discretionary time that sits in unbroken stretches of 90 minutes or more. */
  deepWorkMin: number;
  byTimeOfDay: { morning: number; afternoon: number; evening: number; night: number };
  topStretches: Stretch[];
  days: DayStat[];
  activities: ActivityStat[];
  fatigueAvg: number | null;
  fatiguePeak: FatigueResult | null;
  insights: PlanNote[];
}

/** Merges adjacent discretionary blocks into continuous stretches. */
export function stretches(plan: DayPlan): Stretch[] {
  const out: Stretch[] = [];
  for (const b of plan.blocks) {
    if (!DISCRETIONARY.includes(b.type) || b.fixed) continue;
    const last = out.at(-1);
    if (last && last.end === b.start) last.end = b.end;
    else out.push({ date: plan.date, start: b.start, end: b.end });
  }
  return out;
}

function dur(l: TimeLog): number {
  return l.end === null ? 0 : (l.end - l.start) / 60_000;
}

export function weekReport(
  plans: DayPlan[],
  logs: TimeLog[],
  activities: Activity[],
  s: Settings,
  fatigue: FatigueResult[] = [],
): WeekReport {
  const dates = new Set(plans.map((p) => p.date));
  const first = plans[0]?.date;
  const last = plans.at(-1)?.date;
  const inRange = (l: TimeLog) => {
    if (!first || !last) return false;
    const d = new Date(l.start);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return iso >= first && iso <= last;
  };

  let scheduledWorkMin = 0;
  let loggedWorkMin = 0;
  let overtimeMin = 0;
  let shiftsScheduled = 0;
  let shiftsLogged = 0;
  const byTimeOfDay = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  const allStretches: Stretch[] = [];
  const fatigueByDate = new Map(fatigue.map((f) => [f.date, f]));

  const days: DayStat[] = plans.map((p) => {
    let workMin = 0;
    if (isWorkShift(p.code)) {
      const w = shiftWindow(p.code as 'M', s);
      workMin = w.end - w.start;
      scheduledWorkMin += workMin;
      shiftsScheduled++;
      const logged = logs.filter((l) => l.category === 'shift' && l.shiftDate === p.date).reduce((t, l) => t + dur(l), 0);
      if (logged > 0) {
        shiftsLogged++;
        loggedWorkMin += logged;
        overtimeMin += Math.max(0, logged - workMin);
      }
    }
    for (const b of p.blocks) {
      if (!DISCRETIONARY.includes(b.type)) continue;
      byTimeOfDay.night += overlap(b.start, b.end, 0, 360) + overlap(b.start, b.end, 1320, 1440);
      byTimeOfDay.morning += overlap(b.start, b.end, 360, 720);
      byTimeOfDay.afternoon += overlap(b.start, b.end, 720, 1020);
      byTimeOfDay.evening += overlap(b.start, b.end, 1020, 1320);
    }
    const st = stretches(p);
    allStretches.push(...st);
    return {
      date: p.date,
      code: p.code,
      workMin,
      sleepMin: p.sleepBeforeMin,
      activityMin: p.activityMin,
      freeMin: p.freeMin,
      longestStretchMin: Math.max(0, ...st.map((x) => x.end - x.start)),
      fatigue: fatigueByDate.get(p.date)?.score ?? null,
    };
  });

  const activityMin = plans.reduce((t, p) => t + p.activityMin, 0);
  const freeMin = plans.reduce((t, p) => t + p.freeMin, 0);
  const deepWorkMin = allStretches.filter((x) => x.end - x.start >= 90).reduce((t, x) => t + x.end - x.start, 0);
  const topStretches = [...allStretches].sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, 5);

  const weekLogs = logs.filter(inRange);
  const activityStats: ActivityStat[] = activities
    .filter((a) => a.active)
    .map((a) => ({
      activity: a,
      targetMin: a.weeklyTargetMin,
      plannedMin: plans.reduce((t, p) => t + p.blocks.filter((b) => b.activityId === a.id).reduce((x, b) => x + b.end - b.start, 0), 0),
      loggedMin: weekLogs.filter((l) => l.category === 'activity' && l.activityId === a.id).reduce((t, l) => t + dur(l), 0),
    }));

  const sleepLogs = weekLogs.filter((l) => l.category === 'sleep');
  const avgLoggedSleepMin = sleepLogs.length ? sleepLogs.reduce((t, l) => t + dur(l), 0) / Math.max(1, dates.size) : null;
  const avgPlannedSleepMin = plans.length ? plans.reduce((t, p) => t + p.sleepBeforeMin, 0) / plans.length : 0;

  const weekFatigue = fatigue.filter((f) => dates.has(f.date));
  const fatigueAvg = weekFatigue.length ? weekFatigue.reduce((t, f) => t + f.score, 0) / weekFatigue.length : null;
  const fatiguePeak = weekFatigue.reduce<FatigueResult | null>((m, f) => (!m || f.score > m.score ? f : m), null);

  const report: WeekReport = {
    scheduledWorkMin,
    loggedWorkMin,
    overtimeMin,
    shiftsScheduled,
    shiftsLogged,
    avgPlannedSleepMin,
    avgLoggedSleepMin,
    discretionaryMin: activityMin + freeMin,
    activityMin,
    freeMin,
    deepWorkMin,
    byTimeOfDay,
    topStretches,
    days,
    activities: activityStats,
    fatigueAvg,
    fatiguePeak,
    insights: [],
  };
  report.insights = buildInsights(report, s);
  return report;
}

function h(min: number): string {
  return `${(min / 60).toFixed(1)}h`;
}

export function buildInsights(r: WeekReport, s: Settings): PlanNote[] {
  const notes: PlanNote[] = [];
  if (r.discretionaryMin > 0) {
    const share = Math.round((r.deepWorkMin / r.discretionaryMin) * 100);
    notes.push({
      level: share >= 50 ? 'good' : 'info',
      title: `${h(r.discretionaryMin)} of time outside work and sleep`,
      text: `${share}% of it (${h(r.deepWorkMin)}) comes in stretches of 90 minutes or more, which suit study and freelance work.`,
    });
  }
  const best = r.topStretches[0];
  if (best) {
    const day = r.days.find((d) => d.date === best.date);
    notes.push({
      level: 'info',
      title: `Longest free stretch: ${dayName(best.date)}`,
      text: `${fmtTime(best.start, s.hour12)} – ${fmtTime(best.end, s.hour12)} (${h(best.end - best.start)})${day ? ` on a ${CODE_LABEL[day.code]} day` : ''}. Put your hardest task there.`,
    });
  }
  for (const a of r.activities) {
    if (a.targetMin > 0 && a.plannedMin < a.targetMin * 0.8) {
      notes.push({
        level: 'warn',
        title: `${a.activity.name} is short of its goal`,
        text: `Only ${h(a.plannedMin)} of ${h(a.targetMin)} fits around this week's shifts. Lower the target, widen its preferred time, or raise its priority.`,
      });
    }
    if (a.loggedMin > 0 && a.plannedMin > 0) {
      const pct = Math.round((a.loggedMin / a.plannedMin) * 100);
      if (pct < 60) notes.push({ level: 'info', title: `${a.activity.name}: ${pct}% done so far`, text: `Logged ${h(a.loggedMin)} of ${h(a.plannedMin)} planned.` });
    }
  }
  if (r.overtimeMin >= 30) {
    notes.push({ level: 'warn', title: `${h(r.overtimeMin)} of overtime logged`, text: 'Extra hours come out of your sleep and goals. Record the reason so you can raise it with your lead.' });
  }
  if (r.avgPlannedSleepMin < s.sleepTargetMin - 30) {
    notes.push({ level: 'warn', title: 'Sleep below target', text: `This roster allows about ${h(r.avgPlannedSleepMin)} of sleep a day against your ${h(s.sleepTargetMin)} target.` });
  }
  if (r.fatiguePeak && (r.fatiguePeak.level === 'high' || r.fatiguePeak.level === 'severe')) {
    notes.push({
      level: 'bad',
      title: `Fatigue peaks on ${dayName(r.fatiguePeak.date)} (${r.fatiguePeak.score}/100)`,
      text: r.fatiguePeak.recommendations[0] ?? 'Plan a lighter day.',
    });
  }
  return notes;
}
