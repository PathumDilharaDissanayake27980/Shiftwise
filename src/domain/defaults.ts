import type { Activity, DayCode, RosterDay, Settings, WorkMode, WorkShift } from './types';
import { WORK_SHIFTS } from './types';

/** Defaults match the GTN EU support roster (Sri Lanka time). Users can edit all of them. */
export const DEFAULT_SETTINGS: Settings = {
  shifts: {
    M: { code: 'M', name: 'Morning', start: 6 * 60, duration: 9 * 60 },
    D: { code: 'D', name: 'Day', start: 10 * 60, duration: 9 * 60 },
    N: { code: 'N', name: 'Night', start: 18 * 60 + 30, duration: 8 * 60 },
    G: { code: 'G', name: 'Graveyard', start: 90, duration: 7 * 60 },
  },
  commuteMin: 45,
  monitoringAtOffice: false,
  sleepTargetMin: 450,
  prepMin: 30,
  wake: { M: 5 * 60 + 30, D: 7 * 60, N: 7 * 60 + 30, G: 60, OFF: 8 * 60 },
  bedtime: { M: 21 * 60 + 30, D: 23 * 60, N: 23 * 60 + 30, OFF: 23 * 60 + 30 },
  windDownMin: 30,
  mealMin: 45,
  lateCutoff: 20 * 60 + 30,
  graveyardPreSleepMin: 420,
  graveyardRecoveryUntil: 13 * 60,
  preNightNap: true,
  focusBudget: { M: 150, D: 120, N: 240, G: 45, OFF: 360 },
  restDay: true,
  maxPlannedShare: 0.65,
  growthLevel: 'focused',
  weekStartsOn: 1,
  hour12: true,
};

export const CODE_LABEL: Record<DayCode, string> = {
  M: 'Morning',
  D: 'Day',
  N: 'Night',
  G: 'Graveyard',
  OFF: 'Off',
  LEAVE: 'Leave',
  SICK: 'Sick leave',
  HOLIDAY: 'Holiday',
};

export const MODE_LABEL: Record<WorkMode, string> = { H: 'Home', O: 'Office', MON: 'Monitoring' };

export function isWorkShift(code: DayCode): code is WorkShift {
  return (WORK_SHIFTS as readonly string[]).includes(code);
}

export function defaultRosterDay(date: string): RosterDay {
  return { date, code: 'OFF', mode: 'H' };
}

export function isOfficeDay(day: RosterDay, settings: Settings): boolean {
  if (!isWorkShift(day.code)) return false;
  if (day.mode === 'O') return true;
  return day.mode === 'MON' && settings.monitoringAtOffice;
}

/** RFC 4122 v4 UUID. Falls back to getRandomValues where randomUUID is unavailable (older browsers, http). */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * How hard to push career growth. Each level sets the weekly goals and the daily focus budgets together,
 * and every level keeps sleep, exercise, people, a daily review and the recharge day.
 */
export const GROWTH_LEVELS = ['balanced', 'focused', 'sprint'] as const;
export type GrowthLevel = (typeof GROWTH_LEVELS)[number];

interface LevelSpec {
  label: string;
  summary: string;
  /** Weekly minutes: lessons, project, exam prep, freelance, gym, reading, people. */
  learn: number;
  build: number;
  cert: number;
  freelance: number;
  gym: number;
  reading: number;
  people: number;
  focusBudget: Settings['focusBudget'];
  share: number;
}

export const LEVELS: Record<GrowthLevel, LevelSpec> = {
  balanced: {
    label: 'Balanced', summary: 'The lighter option, for busy or heavy-roster weeks.',
    learn: 4 * 60, build: 4 * 60, cert: 90, freelance: 3 * 60, gym: 3 * 60, reading: 90, people: 3 * 60,
    focusBudget: { M: 120, D: 105, N: 150, G: 0, OFF: 270 },
    share: 0.6,
  },
  focused: {
    label: 'Focused', summary: 'Almost twice the lessons of Balanced, with sleep, gym and people intact.',
    learn: 7 * 60, build: 4 * 60, cert: 2 * 60, freelance: 2 * 60, gym: 3 * 60, reading: 60, people: 3 * 60,
    focusBudget: { M: 150, D: 120, N: 240, G: 45, OFF: 360 },
    share: 0.65,
  },
  sprint: {
    label: 'Sprint', summary: 'For an exam or a stage push. Use it for 2–4 weeks at a time.',
    learn: 10 * 60, build: 5 * 60, cert: 3 * 60, freelance: 0, gym: 150, reading: 0, people: 2 * 60,
    focusBudget: { M: 180, D: 135, N: 270, G: 60, OFF: 420 },
    share: 0.75,
  },
};

/** The weekly activities for a growth level. Activities a level does not use come back paused. */
export function balancedActivities(now = Date.now(), level: GrowthLevel = 'focused'): Activity[] {
  const L = LEVELS[level];
  const base = { active: true, fixed: [], createdAt: now };
  const list: Activity[] = [
    { ...base, id: newId(), name: 'Learn (Ascend lessons)', kind: 'focus', color: 'teal', weeklyTargetMin: L.learn, minBlockMin: 45, maxBlockMin: 90, preferred: 'any', priority: 5, link: 'learn' },
    { ...base, id: newId(), name: 'Build portfolio project', kind: 'focus', color: 'violet', weeklyTargetMin: L.build, minBlockMin: 60, maxBlockMin: 120, preferred: 'any', priority: 4, link: 'build' },
    { ...base, id: newId(), name: 'Certification prep', kind: 'focus', color: 'blue', weeklyTargetMin: L.cert, minBlockMin: 45, maxBlockMin: 60, preferred: 'afternoon', priority: 4, link: 'cert' },
    { ...base, id: newId(), name: 'Freelance work', kind: 'focus', color: 'amber', weeklyTargetMin: L.freelance, minBlockMin: 60, maxBlockMin: 120, preferred: 'any', priority: 3 },
    { ...base, id: newId(), name: 'Gym', kind: 'fitness', color: 'coral', weeklyTargetMin: L.gym, minBlockMin: 50, maxBlockMin: 60, preferred: 'afternoon', priority: 4 },
    { ...base, id: newId(), name: 'Daily review (spaced recall)', kind: 'light', color: 'slate', weeklyTargetMin: 7 * 20, minBlockMin: 20, maxBlockMin: 20, preferred: 'evening', priority: 4, link: 'review' },
    { ...base, id: newId(), name: 'Reading', kind: 'light', color: 'green', weeklyTargetMin: L.reading, minBlockMin: 30, maxBlockMin: 45, preferred: 'evening', priority: 2 },
    { ...base, id: newId(), name: 'Family & friends', kind: 'personal', color: 'rose', weeklyTargetMin: L.people, minBlockMin: 60, maxBlockMin: 120, preferred: 'evening', priority: 3 },
  ];
  return list.map((a) => (a.weeklyTargetMin > 0 ? a : { ...a, active: false }));
}

/** Starter activities for a new install. */
export function starterActivities(now = Date.now()): Activity[] {
  return balancedActivities(now);
}
