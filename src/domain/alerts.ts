/**
 * Alert rules the user defines ("remind me 1 hour before a night shift") turned into concrete,
 * timestamped messages for the next few days. Pure and deterministic: the same inputs always give
 * the same alert ids, so the sender can tell which ones it has already delivered.
 */
import { CODE_LABEL, MODE_LABEL, isOfficeDay, isWorkShift, newId } from './defaults';
import type { FatigueResult } from './fatigue';
import type { RosterLookup } from './planner';
import { leaveTime, shiftWindow } from './schedule';
import { addDays, atMinutes, dayName, fmtTime, parseISODate, toISODate, weekday } from './time';
import type { Activity, DayPlan, ISODate, PlanBlock, Settings, TimeLog, WorkShift } from './types';

export const ALERT_TRIGGERS = [
  'shiftStart',
  'leaveHome',
  'shiftEnd',
  'clockOutMissed',
  'wake',
  'bedtime',
  'activityStart',
  'dailyBrief',
  'riskWarning',
  'custom',
] as const;
export type AlertTrigger = (typeof ALERT_TRIGGERS)[number];

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AlertTrigger;
  /** Minutes relative to the trigger's moment. Negative = before. */
  offsetMin: number;
  /** For "custom": minute of the day. */
  time: number;
  /** For "custom": weekdays (0 = Sunday). Empty = every day. */
  weekdays: number[];
  /** For shift triggers: which shifts. Empty = all. */
  shifts: WorkShift[];
  /** For "activityStart": one activity, or empty for any. */
  activityId: string;
  /** For "riskWarning": send when the fatigue score is at least this. */
  minScore: number;
  /** Message with {placeholders}. */
  message: string;
}

export interface Alert {
  id: string;
  ruleId: string;
  at: number;
  text: string;
}

export const TRIGGER_INFO: Record<AlertTrigger, { label: string; help: string; relative: string | null }> = {
  shiftStart: { label: 'Shift starts', help: 'Before or after each shift begins.', relative: 'shift start' },
  leaveHome: { label: 'Time to leave (office days)', help: 'Relative to when you must leave for an office shift.', relative: 'leaving time' },
  shiftEnd: { label: 'Shift ends', help: 'Relative to the scheduled end of each shift.', relative: 'shift end' },
  clockOutMissed: { label: 'Forgot to clock out', help: 'Only while you are clocked in, after the scheduled end.', relative: 'scheduled end' },
  wake: { label: 'Wake-up', help: "Relative to the day's planned wake-up time.", relative: 'wake-up' },
  bedtime: { label: 'Bedtime', help: 'Relative to the planned bedtime. Use a negative offset for a wind-down nudge.', relative: 'bedtime' },
  activityStart: { label: 'Activity starts', help: 'When a planned activity block begins.', relative: 'activity start' },
  dailyBrief: { label: 'Daily brief', help: "Today's plan, sent relative to your wake-up.", relative: 'wake-up' },
  riskWarning: { label: 'Fatigue or rest warning', help: 'Only on days with high fatigue or a tight shift changeover.', relative: 'wake-up' },
  custom: { label: 'Custom reminder', help: 'Your own message at a fixed time on chosen days.', relative: null },
};

export const PLACEHOLDERS: { key: string; meaning: string }[] = [
  { key: 'shift', meaning: 'Shift or day type (Night, Off…)' },
  { key: 'start', meaning: 'Shift start time' },
  { key: 'end', meaning: 'Shift end time' },
  { key: 'mode', meaning: 'Home / Office / Monitoring' },
  { key: 'leave', meaning: 'Time to leave on office days' },
  { key: 'activity', meaning: 'Activity name' },
  { key: 'time', meaning: 'Time of the event' },
  { key: 'wake', meaning: 'Planned wake-up' },
  { key: 'bed', meaning: 'Planned bedtime' },
  { key: 'tomorrow', meaning: "Tomorrow's shift" },
  { key: 'score', meaning: 'Fatigue score 0–100' },
  { key: 'level', meaning: 'Fatigue level' },
  { key: 'sleep', meaning: 'Hours of sleep before the day' },
  { key: 'plan', meaning: "The day's plan as a list" },
  { key: 'warnings', meaning: "The day's warnings" },
  { key: 'day', meaning: 'Weekday' },
  { key: 'date', meaning: 'Date' },
];

export function blankRule(trigger: AlertTrigger = 'custom'): AlertRule {
  return {
    id: newId(),
    name: TRIGGER_INFO[trigger].label,
    enabled: true,
    trigger,
    offsetMin: 0,
    time: 9 * 60,
    weekdays: [],
    shifts: [],
    activityId: '',
    minScore: 50,
    message: DEFAULT_MESSAGES[trigger],
  };
}

const DEFAULT_MESSAGES: Record<AlertTrigger, string> = {
  shiftStart: '⏰ {shift} shift starts at {start} ({mode}).',
  leaveHome: '🚌 Leave by {leave} for your {shift} shift at {start}.',
  shiftEnd: '✅ {shift} shift ends at {end}. Remember to clock out.',
  clockOutMissed: '⚠️ You are still clocked in. Your {shift} shift ended at {end}. Open ShiftWise to clock out.',
  wake: '☀️ Wake up. Today: {shift} {start}.',
  bedtime: '🌙 Start winding down. Bed at {bed}. Tomorrow: {tomorrow}.',
  activityStart: '▶️ {activity} starts at {time}.',
  dailyBrief: '📋 {day}: {shift} {start}\n{plan}\nSleep last night: {sleep}h · Fatigue {score}/100',
  riskWarning: '🛑 Take it easy today. Fatigue {score}/100 ({level}).\n{warnings}',
  custom: '🔔 Reminder',
};

/** Starter rules covering shift reminders, sleep, clock-out, the daily brief and risk warnings. */
export function defaultAlertRules(): AlertRule[] {
  return [
    { ...blankRule('shiftStart'), name: 'Shift starts in 1 hour', offsetMin: -60 },
    { ...blankRule('leaveHome'), name: 'Time to leave', offsetMin: -10, message: '🚌 Leave in 10 minutes for your {shift} shift at {start}.' },
    { ...blankRule('clockOutMissed'), name: 'Forgot to clock out', offsetMin: 30 },
    { ...blankRule('wake'), name: 'Wake-up', offsetMin: 0, enabled: false },
    { ...blankRule('bedtime'), name: 'Wind-down', offsetMin: -30 },
    { ...blankRule('dailyBrief'), name: 'Daily brief', offsetMin: 20 },
    { ...blankRule('riskWarning'), name: 'Fatigue or rest warning', offsetMin: 25, minScore: 50 },
  ];
}

export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? (vars[k] as string) : m)).slice(0, 1000);
}

/** End of the first sleep block of the day (the main wake-up). */
export function wakeOf(plan: DayPlan): number | null {
  const s = plan.blocks.find((b) => b.type === 'sleep' && b.end < 1440);
  return s ? s.end : null;
}

/** Start of the evening sleep, if the day has one. */
export function bedOf(plan: DayPlan): number | null {
  const s = [...plan.blocks].reverse().find((b) => b.type === 'sleep' && b.start >= 720);
  return s ? s.start : null;
}

const PLAN_TYPES = new Set<PlanBlock['type']>(['shift', 'activity', 'nap', 'commute']);

export interface AlertInput {
  now: number;
  plans: DayPlan[];
  roster: RosterLookup;
  settings: Settings;
  activities: Activity[];
  fatigue: FatigueResult[];
  running: TimeLog[];
  rules: AlertRule[];
  horizonDays?: number;
}

export function buildAlerts(input: AlertInput): Alert[] {
  const { now, plans, roster, settings: s, activities, fatigue, running, rules } = input;
  const horizon = now + (input.horizonDays ?? 7) * 86_400_000;
  const out = new Map<string, Alert>();
  const t = (m: number) => fmtTime(m, s.hour12);
  const fatigueOf = (d: ISODate) => fatigue.find((f) => f.date === d);

  const varsFor = (p: DayPlan): Record<string, string> => {
    const day = roster(p.date);
    const work = isWorkShift(day.code);
    const w = work ? shiftWindow(day.code as WorkShift, s) : null;
    const next = roster(addDays(p.date, 1));
    const nw = isWorkShift(next.code) ? shiftWindow(next.code as WorkShift, s) : null;
    const f = fatigueOf(p.date);
    const wake = wakeOf(p);
    const bed = bedOf(p);
    const leave = leaveTime(day, s);
    return {
      day: dayName(p.date),
      date: parseISODate(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      shift: work ? s.shifts[day.code as WorkShift].name : CODE_LABEL[day.code],
      start: w ? t(w.start) : '',
      end: w ? t(w.end) : '',
      mode: work ? MODE_LABEL[day.mode] : '',
      leave: leave !== null ? t(leave) : '',
      wake: wake !== null ? t(wake) : '',
      bed: bed !== null ? t(bed) : '',
      tomorrow: nw ? `${s.shifts[next.code as WorkShift].name} ${t(nw.start)}` : CODE_LABEL[next.code],
      score: f ? String(f.score) : '–',
      level: f ? f.level : '–',
      sleep: (p.sleepBeforeMin / 60).toFixed(1),
      plan: p.blocks
        .filter((b) => PLAN_TYPES.has(b.type) && !(b.type === 'shift' && b.start === 0 && b.label.includes('yesterday')))
        .map((b) => `• ${t(b.start)} ${b.label}`)
        .join('\n'),
      warnings: p.notes.filter((n) => n.level === 'bad' || n.level === 'warn').map((n) => `• ${n.title}: ${n.text}`).join('\n'),
    };
  };

  const push = (rule: AlertRule, key: string, at: number, vars: Record<string, string>) => {
    if (at < now - 30 * 60_000 || at > horizon) return;
    const id = `${rule.id}|${key}`;
    const text = render(rule.message, vars).trim();
    if (text) out.set(id, { id, ruleId: rule.id, at, text });
  };

  const shiftOk = (rule: AlertRule, code: string) => rule.shifts.length === 0 || (rule.shifts as string[]).includes(code);

  for (const rule of rules) {
    if (!rule.enabled) continue;

    if (rule.trigger === 'clockOutMissed') {
      for (const log of running) {
        if (log.category !== 'shift' || log.end !== null) continue;
        const date = log.shiftDate ?? toISODate(new Date(log.start));
        const day = roster(date);
        let endAt: number;
        let vars: Record<string, string>;
        if (isWorkShift(day.code)) {
          if (!shiftOk(rule, day.code)) continue;
          const w = shiftWindow(day.code as WorkShift, s);
          endAt = atMinutes(date, w.end);
          vars = { shift: s.shifts[day.code as WorkShift].name, end: t(w.end), start: t(w.start), time: t(w.end), day: dayName(date) };
        } else {
          endAt = log.start + 9 * 3_600_000;
          vars = { shift: 'Extra', end: '', start: '', time: '', day: dayName(date) };
        }
        push(rule, `${log.id}`, endAt + rule.offsetMin * 60_000, vars);
      }
      continue;
    }

    for (const p of plans) {
      const day = roster(p.date);
      const vars = varsFor(p);
      const work = isWorkShift(day.code);
      const w = work ? shiftWindow(day.code as WorkShift, s) : null;
      const off = rule.offsetMin;
      switch (rule.trigger) {
        case 'shiftStart':
          if (w && shiftOk(rule, day.code)) push(rule, p.date, atMinutes(p.date, w.start + off), { ...vars, time: vars.start ?? '' });
          break;
        case 'shiftEnd':
          if (w && shiftOk(rule, day.code)) push(rule, p.date, atMinutes(p.date, w.end + off), { ...vars, time: vars.end ?? '' });
          break;
        case 'leaveHome': {
          const leave = leaveTime(day, s);
          if (w && leave !== null && isOfficeDay(day, s) && shiftOk(rule, day.code)) push(rule, p.date, atMinutes(p.date, leave + off), { ...vars, time: t(leave) });
          break;
        }
        case 'wake': {
          const wake = wakeOf(p);
          if (wake !== null) push(rule, p.date, atMinutes(p.date, wake + off), { ...vars, time: t(wake) });
          break;
        }
        case 'bedtime': {
          const bed = bedOf(p);
          if (bed !== null) push(rule, p.date, atMinutes(p.date, bed + off), { ...vars, time: t(bed) });
          break;
        }
        case 'dailyBrief': {
          const wake = wakeOf(p);
          if (wake !== null) push(rule, p.date, atMinutes(p.date, wake + off), { ...vars, time: t(wake) });
          break;
        }
        case 'riskWarning': {
          const f = fatigueOf(p.date);
          const risky = (f && f.score >= rule.minScore) || p.notes.some((n) => n.level === 'bad' || n.level === 'warn');
          const wake = wakeOf(p);
          if (risky && wake !== null) push(rule, p.date, atMinutes(p.date, wake + off), { ...vars, time: t(wake) });
          break;
        }
        case 'activityStart':
          for (const b of p.blocks) {
            if (b.type !== 'activity' || !b.activityId) continue;
            if (rule.activityId && b.activityId !== rule.activityId) continue;
            const name = activities.find((a) => a.id === b.activityId)?.name ?? b.label;
            push(rule, `${p.date}|${b.start}|${b.activityId}`, atMinutes(p.date, b.start + off), { ...vars, activity: name, time: t(b.start) });
          }
          break;
        case 'custom':
          if (rule.weekdays.length === 0 || rule.weekdays.includes(weekday(p.date))) push(rule, p.date, atMinutes(p.date, rule.time), { ...vars, time: t(rule.time) });
          break;
      }
    }
  }
  return [...out.values()].sort((a, b) => a.at - b.at).slice(0, 400);
}
