/**
 * Core domain types. Everything in src/domain is pure TypeScript with no browser or storage
 * dependencies, so it can be unit-tested and reused by any front end (web, native, server).
 *
 * Conventions
 *  - Calendar dates are local ISO strings: "YYYY-MM-DD".
 *  - Times of day are minutes from local midnight (0–1439). Values above 1440 mean "the next day".
 *  - Timestamps on logs are epoch milliseconds.
 */

export type ISODate = string;

export const WORK_SHIFTS = ['M', 'D', 'N', 'G'] as const;
export type WorkShift = (typeof WORK_SHIFTS)[number];

export const NON_WORK_CODES = ['OFF', 'LEAVE', 'SICK', 'HOLIDAY'] as const;
export type NonWorkCode = (typeof NON_WORK_CODES)[number];

export const DAY_CODES = [...WORK_SHIFTS, ...NON_WORK_CODES] as const;
export type DayCode = WorkShift | NonWorkCode;

/** H = work from home, O = office, MON = monitoring (location set in settings). */
export const WORK_MODES = ['H', 'O', 'MON'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export interface RosterDay {
  date: ISODate;
  code: DayCode;
  mode: WorkMode;
  note?: string;
}

export interface ShiftDef {
  code: WorkShift;
  name: string;
  /** Start, in minutes from midnight of the rostered date. */
  start: number;
  /** Length in minutes. start + duration may exceed 1440 (shift ends the next day). */
  duration: number;
}

export interface Settings {
  shifts: Record<WorkShift, ShiftDef>;
  /** One-way commute on office days, minutes. */
  commuteMin: number;
  monitoringAtOffice: boolean;
  sleepTargetMin: number;
  /** Time needed between waking and starting work (or leaving for the office). */
  prepMin: number;
  /** Preferred wake-up time on a normal night, by the day's code. */
  wake: { M: number; D: number; N: number; G: number; OFF: number };
  /** Latest preferred bedtime the night before each kind of day. */
  bedtime: { M: number; D: number; N: number; OFF: number };
  windDownMin: number;
  mealMin: number;
  /** After this time only light activities and free time are planned. */
  lateCutoff: number;
  /** Sleep taken in the evening before a graveyard shift. */
  graveyardPreSleepMin: number;
  /** Wake-up time after the recovery sleep following a graveyard shift. */
  graveyardRecoveryUntil: number;
  preNightNap: boolean;
  weekStartsOn: 0 | 1;
  hour12: boolean;
}

export const ACTIVITY_KINDS = ['focus', 'light', 'fitness', 'personal'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const TIME_PREFS = ['morning', 'afternoon', 'evening', 'any'] as const;
export type TimePref = (typeof TIME_PREFS)[number];

export const ACTIVITY_COLORS = ['teal', 'blue', 'violet', 'coral', 'amber', 'green', 'rose', 'slate'] as const;
export type ActivityColor = (typeof ACTIVITY_COLORS)[number];

/** A recurring, fixed-time commitment (class, lecture, client call). weekday: 0 = Sunday. */
export interface FixedSlot {
  weekday: number;
  start: number;
  end: number;
}

export interface Activity {
  id: string;
  name: string;
  kind: ActivityKind;
  color: ActivityColor;
  weeklyTargetMin: number;
  minBlockMin: number;
  maxBlockMin: number;
  preferred: TimePref;
  /** 1 (low) – 5 (high). */
  priority: number;
  active: boolean;
  fixed: FixedSlot[];
  createdAt: number;
}

export type BlockType =
  | 'sleep'
  | 'nap'
  | 'routine'
  | 'commute'
  | 'shift'
  | 'meal'
  | 'activity'
  | 'break'
  | 'free'
  | 'buffer';

export interface PlanBlock {
  start: number;
  end: number;
  type: BlockType;
  label: string;
  shift?: WorkShift;
  activityId?: string;
  fixed?: boolean;
}

export type NoteLevel = 'info' | 'good' | 'warn' | 'bad';

export interface PlanNote {
  level: NoteLevel;
  title: string;
  text: string;
}

export interface DayPlan {
  date: ISODate;
  code: DayCode;
  mode: WorkMode;
  blocks: PlanBlock[];
  notes: PlanNote[];
  /** Sleep finishing on this date: the previous evening's sleep plus this day's morning sleep and naps. */
  sleepBeforeMin: number;
  /** Planned activity minutes. */
  activityMin: number;
  /** Unscheduled discretionary minutes. */
  freeMin: number;
}

export const LOG_CATEGORIES = ['shift', 'sleep', 'activity', 'break'] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

export interface TimeLog {
  id: string;
  category: LogCategory;
  start: number;
  /** null while the timer is running. */
  end: number | null;
  activityId?: string;
  /** The rostered date a shift log belongs to (a night shift crosses midnight). */
  shiftDate?: ISODate;
  note?: string;
  createdAt: number;
}
