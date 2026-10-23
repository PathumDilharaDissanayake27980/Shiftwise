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

/** Starter activities that match "a mix" of study, freelance, gym and personal projects. */
export function starterActivities(now = Date.now()): Activity[] {
  const base = { active: true, fixed: [], createdAt: now };
  return [
    { ...base, id: newId(), name: 'Study', kind: 'focus', color: 'teal', weeklyTargetMin: 8 * 60, minBlockMin: 60, maxBlockMin: 120, preferred: 'morning', priority: 5 },
    { ...base, id: newId(), name: 'Freelance work', kind: 'focus', color: 'blue', weeklyTargetMin: 8 * 60, minBlockMin: 60, maxBlockMin: 150, preferred: 'any', priority: 4 },
    { ...base, id: newId(), name: 'Gym', kind: 'fitness', color: 'coral', weeklyTargetMin: 4 * 75, minBlockMin: 75, maxBlockMin: 75, preferred: 'afternoon', priority: 4 },
    { ...base, id: newId(), name: 'Personal project', kind: 'focus', color: 'violet', weeklyTargetMin: 4 * 60, minBlockMin: 45, maxBlockMin: 120, preferred: 'any', priority: 3 },
    { ...base, id: newId(), name: 'Reading', kind: 'light', color: 'amber', weeklyTargetMin: 3 * 60, minBlockMin: 30, maxBlockMin: 60, preferred: 'evening', priority: 2 },
  ];
}
