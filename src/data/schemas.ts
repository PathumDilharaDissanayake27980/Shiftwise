import { z } from 'zod';
import { isISODate } from '../domain/time';
import { ACTIVITY_COLORS, ACTIVITY_KINDS, DAY_CODES, LOG_CATEGORIES, TIME_PREFS, WORK_MODES, WORK_SHIFTS } from '../domain/types';

/**
 * Every write to storage and every imported backup passes through these schemas.
 * They are the single source of truth for what valid data looks like.
 */

const minuteOfDay = z.number().int().min(0).max(1440);
const isoDate = z.string().refine(isISODate, 'Expected a date in YYYY-MM-DD format');
const text = (max: number) => z.string().trim().max(max);
const epoch = z.number().int().min(946_684_800_000).max(4_102_444_800_000); // 2000–2100

export const rosterDaySchema = z.object({
  date: isoDate,
  code: z.enum(DAY_CODES),
  mode: z.enum(WORK_MODES),
  note: text(200).optional(),
});

export const fixedSlotSchema = z
  .object({ weekday: z.number().int().min(0).max(6), start: minuteOfDay, end: minuteOfDay })
  .refine((s) => s.end > s.start, 'A slot must end after it starts');

export const activitySchema = z
  .object({
    id: z.string().uuid(),
    name: text(60).min(1, 'Give the activity a name'),
    kind: z.enum(ACTIVITY_KINDS),
    color: z.enum(ACTIVITY_COLORS),
    weeklyTargetMin: z.number().int().min(0).max(80 * 60),
    minBlockMin: z.number().int().min(15).max(480),
    maxBlockMin: z.number().int().min(15).max(480),
    preferred: z.enum(TIME_PREFS),
    priority: z.number().int().min(1).max(5),
    active: z.boolean(),
    fixed: z.array(fixedSlotSchema).max(14),
    createdAt: epoch,
  })
  .refine((a) => a.maxBlockMin >= a.minBlockMin, { message: 'Longest block must be at least the shortest block', path: ['maxBlockMin'] });

export const timeLogSchema = z
  .object({
    id: z.string().uuid(),
    category: z.enum(LOG_CATEGORIES),
    start: epoch,
    end: epoch.nullable(),
    activityId: z.string().uuid().optional(),
    shiftDate: isoDate.optional(),
    note: text(500).optional(),
    createdAt: epoch,
  })
  .refine((l) => l.end === null || l.end > l.start, { message: 'End must be after start', path: ['end'] })
  .refine((l) => l.end === null || l.end - l.start <= 24 * 3_600_000, { message: 'A single entry cannot be longer than 24 hours', path: ['end'] })
  .refine((l) => l.category !== 'activity' || !!l.activityId, { message: 'Pick an activity', path: ['activityId'] });

const shiftDefSchema = z.object({
  code: z.enum(WORK_SHIFTS),
  name: text(30).min(1),
  start: minuteOfDay.max(1439),
  duration: z.number().int().min(60).max(16 * 60),
});

export const settingsSchema = z.object({
  shifts: z.object({ M: shiftDefSchema, D: shiftDefSchema, N: shiftDefSchema, G: shiftDefSchema }),
  commuteMin: z.number().int().min(0).max(240),
  monitoringAtOffice: z.boolean(),
  sleepTargetMin: z.number().int().min(240).max(720),
  prepMin: z.number().int().min(5).max(180),
  wake: z.object({ M: minuteOfDay, D: minuteOfDay, N: minuteOfDay, G: minuteOfDay, OFF: minuteOfDay }),
  bedtime: z.object({ M: minuteOfDay, D: minuteOfDay, N: minuteOfDay, OFF: minuteOfDay }),
  windDownMin: z.number().int().min(0).max(120),
  mealMin: z.number().int().min(10).max(120),
  lateCutoff: minuteOfDay,
  graveyardPreSleepMin: z.number().int().min(120).max(600),
  graveyardRecoveryUntil: minuteOfDay,
  preNightNap: z.boolean(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  hour12: z.boolean(),
});

export const BACKUP_FORMAT = 'shiftwise-backup';
export const BACKUP_VERSION = 1;

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: epoch,
  data: z.object({
    settings: settingsSchema,
    roster: z.array(rosterDaySchema).max(5000),
    activities: z.array(activitySchema).max(200),
    logs: z.array(timeLogSchema).max(50_000),
  }),
});

export type Backup = z.infer<typeof backupSchema>;

/** Turns a Zod error into one readable sentence for the UI. */
export function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return 'Invalid data';
  const path = i.path.length ? `${i.path.join('.')}: ` : '';
  return `${path}${i.message}`;
}
