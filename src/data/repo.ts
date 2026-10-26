import type { ZodError } from 'zod';
import { type AlertRule, defaultAlertRules } from '../domain/alerts';
import type { ReportLog } from '../domain/ascend';
import { DEFAULT_SETTINGS, balancedActivities, defaultRosterDay, newId } from '../domain/defaults';
import type { Activity, ISODate, RosterDay, Settings, TimeLog } from '../domain/types';
import { type Backup, BACKUP_FORMAT, BACKUP_VERSION, activitySchema, alertConfigSchema, alertRulesSchema, backupSchema, firstIssue, rosterDaySchema, settingsSchema, timeLogSchema } from './schemas';
import { type PinRecord, type Sealed, hashPin, open, seal, verifyPin } from './crypto';
import { type ShiftWiseDB, db as defaultDb } from './db';

export interface AlertConfig {
  repo: string;
  token: string;
  key: string;
  branch: string;
  autoSync: boolean;
  lastSyncAt: number | null;
  lastHash: string | null;
  lastCount: number | null;
  lastError: string | null;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function check<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: ZodError } }, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError(firstIssue(r.error));
  return r.data;
}

/** All persistence goes through this class so the UI never touches IndexedDB directly. */
export class Repo {
  constructor(private readonly db: ShiftWiseDB = defaultDb) {}

  // ---- settings --------------------------------------------------------------------------------
  async getSettings(): Promise<Settings> {
    const rec = await this.db.kv.get('settings');
    const parsed = settingsSchema.safeParse(rec?.value);
    return parsed.success ? (parsed.data as Settings) : DEFAULT_SETTINGS;
  }

  async saveSettings(s: Settings): Promise<void> {
    await this.db.kv.put({ key: 'settings', value: check(settingsSchema, s) });
  }

  async getFlag(key: string): Promise<boolean> {
    return (await this.db.kv.get(`flag:${key}`))?.value === true;
  }

  async setFlag(key: string, value: boolean): Promise<void> {
    await this.db.kv.put({ key: `flag:${key}`, value });
  }

  // ---- roster ----------------------------------------------------------------------------------
  async rosterRange(from: ISODate, to: ISODate): Promise<RosterDay[]> {
    return this.db.roster.where('date').between(from, to, true, true).toArray();
  }

  async setRosterDays(days: RosterDay[]): Promise<void> {
    const valid = days.map((d) => check(rosterDaySchema, d) as RosterDay);
    await this.db.transaction('rw', this.db.roster, async () => {
      for (const d of valid) {
        const isDefault = d.code === 'OFF' && d.mode === 'H' && !d.note;
        if (isDefault) await this.db.roster.delete(d.date);
        else await this.db.roster.put(d);
      }
    });
  }

  lookupFrom(rows: RosterDay[]): (date: ISODate) => RosterDay {
    const map = new Map(rows.map((r) => [r.date, r]));
    return (date) => map.get(date) ?? defaultRosterDay(date);
  }

  // ---- activities ------------------------------------------------------------------------------
  async listActivities(): Promise<Activity[]> {
    return this.db.activities.orderBy('createdAt').toArray();
  }

  async saveActivity(a: Omit<Activity, 'id' | 'createdAt'> & Partial<Pick<Activity, 'id' | 'createdAt'>>): Promise<Activity> {
    const full = check(activitySchema, { ...a, id: a.id ?? newId(), createdAt: a.createdAt ?? Date.now() }) as Activity;
    const dup = await this.db.activities.filter((x) => x.id !== full.id && x.name.toLowerCase() === full.name.toLowerCase()).first();
    if (dup) throw new ValidationError(`You already have an activity called ${full.name}.`);
    await this.db.activities.put(full);
    return full;
  }

  /**
   * Switches to the balanced week: preset activities are added (or updated in place when one with the
   * same name exists) and every other activity is paused, never deleted, so its history is kept.
   */
  async applyBalancedPlan(now = Date.now()): Promise<{ added: number; updated: number; paused: number }> {
    const preset = balancedActivities(now).map((a) => check(activitySchema, a) as Activity);
    const r = { added: 0, updated: 0, paused: 0 };
    await this.db.transaction('rw', this.db.activities, async () => {
      const existing = await this.db.activities.toArray();
      const byName = new Map(existing.map((a) => [a.name.toLowerCase(), a]));
      const keep = new Set<string>();
      for (const p of preset) {
        const old = byName.get(p.name.toLowerCase());
        if (old) {
          await this.db.activities.put({ ...p, id: old.id, createdAt: old.createdAt, fixed: old.fixed });
          keep.add(old.id);
          r.updated += 1;
        } else {
          await this.db.activities.put(p);
          keep.add(p.id);
          r.added += 1;
        }
      }
      for (const a of existing) {
        if (keep.has(a.id) || !a.active) continue;
        await this.db.activities.put({ ...a, active: false });
        r.paused += 1;
      }
    });
    return r;
  }

  /** Saves sessions completed in Ascend, skipping any that overlap entries already in the log. */
  async importSessions(logs: ReportLog[]): Promise<{ added: number; skipped: number }> {
    let added = 0;
    let skipped = 0;
    for (const l of logs) {
      try {
        await this.saveLog(l);
        added += 1;
      } catch (e) {
        if (!(e instanceof ValidationError)) throw e;
        skipped += 1;
      }
    }
    return { added, skipped };
  }

  async deleteActivity(id: string): Promise<void> {
    await this.db.activities.delete(id);
  }

  // ---- time logs -------------------------------------------------------------------------------
  async logsBetween(fromMs: number, toMs: number): Promise<TimeLog[]> {
    return this.db.logs.where('start').between(fromMs, toMs, true, false).toArray();
  }

  async runningLogs(): Promise<TimeLog[]> {
    return this.db.logs.filter((l) => l.end === null).toArray();
  }

  async saveLog(l: Omit<TimeLog, 'id' | 'createdAt'> & Partial<Pick<TimeLog, 'id' | 'createdAt'>>): Promise<TimeLog> {
    const full = check(timeLogSchema, { ...l, id: l.id ?? newId(), createdAt: l.createdAt ?? Date.now() }) as TimeLog;
    if (full.end !== null) {
      const clash = await this.db.logs
        .where('start')
        .below(full.end)
        .filter((x) => x.id !== full.id && x.category === full.category && (x.end ?? Date.now()) > full.start)
        .first();
      if (clash) throw new ValidationError('This overlaps another entry of the same kind.');
    }
    await this.db.logs.put(full);
    return full;
  }

  async deleteLog(id: string): Promise<void> {
    await this.db.logs.delete(id);
  }

  async clockIn(shiftDate: ISODate, now = Date.now()): Promise<TimeLog> {
    const running = await this.runningLogs();
    if (running.some((l) => l.category === 'shift')) throw new ValidationError('You are already clocked in.');
    return this.saveLog({ category: 'shift', start: now, end: null, shiftDate });
  }

  async clockOut(now = Date.now()): Promise<TimeLog | null> {
    const running = (await this.runningLogs()).find((l) => l.category === 'shift');
    if (!running) return null;
    return this.saveLog({ ...running, end: Math.max(now, running.start + 60_000) });
  }

  async startTimer(category: 'activity' | 'sleep' | 'break', activityId?: string, now = Date.now()): Promise<TimeLog> {
    await this.stopTimers(now);
    return this.saveLog({ category, start: now, end: null, ...(activityId ? { activityId } : {}) });
  }

  /** Stops every running timer except the shift clock. */
  async stopTimers(now = Date.now()): Promise<void> {
    for (const l of await this.runningLogs()) {
      if (l.category === 'shift') continue;
      if (now - l.start < 60_000) await this.db.logs.delete(l.id);
      else await this.saveLog({ ...l, end: now });
    }
  }

  // ---- alerts --------------------------------------------------------------------------------
  async getAlertRules(): Promise<AlertRule[]> {
    const rec = await this.db.kv.get('alertRules');
    if (!rec) return defaultAlertRules();
    const r = alertRulesSchema.safeParse(rec.value);
    return r.success ? (r.data as AlertRule[]) : defaultAlertRules();
  }

  async saveAlertRules(rules: AlertRule[]): Promise<void> {
    await this.db.kv.put({ key: 'alertRules', value: check(alertRulesSchema, rules) });
  }

  async getAlertConfig(): Promise<AlertConfig | null> {
    const r = alertConfigSchema.safeParse((await this.db.kv.get('alertConfig'))?.value);
    return r.success ? (r.data as AlertConfig) : null;
  }

  async saveAlertConfig(c: AlertConfig): Promise<void> {
    await this.db.kv.put({ key: 'alertConfig', value: check(alertConfigSchema, c) });
  }

  async clearAlertConfig(): Promise<void> {
    await this.db.kv.delete('alertConfig');
  }

  // ---- app lock --------------------------------------------------------------------------------
  async getLock(): Promise<PinRecord | null> {
    const v = (await this.db.kv.get('lock'))?.value as PinRecord | undefined;
    return v && typeof v.hash === 'string' ? v : null;
  }

  async setPin(pin: string): Promise<void> {
    if (!/^\d{4,8}$/.test(pin)) throw new ValidationError('Use 4 to 8 digits.');
    await this.db.kv.put({ key: 'lock', value: await hashPin(pin) });
    await this.db.kv.delete('lockAttempts');
  }

  async clearPin(): Promise<void> {
    await this.db.kv.delete('lock');
    await this.db.kv.delete('lockAttempts');
  }

  /** Returns ok, or how many seconds the user must wait after repeated wrong PINs. */
  async unlock(pin: string, now = Date.now()): Promise<{ ok: true } | { ok: false; waitSec: number }> {
    const rec = await this.getLock();
    if (!rec) return { ok: true };
    const att = ((await this.db.kv.get('lockAttempts'))?.value as { count: number; until: number } | undefined) ?? { count: 0, until: 0 };
    if (att.until > now) return { ok: false, waitSec: Math.ceil((att.until - now) / 1000) };
    if (await verifyPin(pin, rec)) {
      await this.db.kv.delete('lockAttempts');
      return { ok: true };
    }
    const count = att.count + 1;
    const waitMs = count >= 5 ? Math.min(15 * 60_000, 30_000 * 2 ** (count - 5)) : 0;
    await this.db.kv.put({ key: 'lockAttempts', value: { count, until: now + waitMs } });
    return { ok: false, waitSec: Math.ceil(waitMs / 1000) };
  }

  // ---- backup ----------------------------------------------------------------------------------
  async exportBackup(passphrase?: string): Promise<string> {
    const backup: Backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      data: {
        settings: await this.getSettings(),
        roster: await this.db.roster.toArray(),
        activities: await this.db.activities.toArray(),
        logs: (await this.db.logs.toArray()).filter((l) => l.end !== null),
        alertRules: await this.getAlertRules(),
      },
    };
    const json = JSON.stringify(backup);
    if (!passphrase) return json;
    if (passphrase.length < 8) throw new ValidationError('Use a passphrase of at least 8 characters.');
    return JSON.stringify({ format: `${BACKUP_FORMAT}+encrypted`, version: BACKUP_VERSION, sealed: await seal(json, passphrase) });
  }

  /** Whether a backup file needs a passphrase. */
  static isEncrypted(text: string): boolean {
    try {
      return (JSON.parse(text) as { format?: string }).format === `${BACKUP_FORMAT}+encrypted`;
    } catch {
      return false;
    }
  }

  async importBackup(text: string, passphrase?: string): Promise<{ roster: number; activities: number; logs: number }> {
    if (text.length > 25 * 1024 * 1024) throw new ValidationError('That file is too large to be a ShiftWise backup.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ValidationError('That file is not a ShiftWise backup.');
    }
    if (Repo.isEncrypted(text)) {
      if (!passphrase) throw new ValidationError('This backup is encrypted. Enter its passphrase.');
      parsed = JSON.parse(await open((parsed as { sealed: Sealed }).sealed, passphrase));
    }
    const backup = check(backupSchema, parsed) as Backup;
    const { settings, roster, activities, logs, alertRules } = backup.data;
    await this.db.transaction('rw', [this.db.roster, this.db.activities, this.db.logs, this.db.kv], async () => {
      await Promise.all([this.db.roster.clear(), this.db.activities.clear(), this.db.logs.clear()]);
      await this.db.kv.put({ key: 'settings', value: settings });
      await this.db.roster.bulkPut(roster as RosterDay[]);
      await this.db.activities.bulkPut(activities as Activity[]);
      await this.db.logs.bulkPut(logs as TimeLog[]);
      if (alertRules) await this.db.kv.put({ key: 'alertRules', value: alertRules });
    });
    return { roster: roster.length, activities: activities.length, logs: logs.length };
  }

  async wipeAll(): Promise<void> {
    await this.db.transaction('rw', [this.db.roster, this.db.activities, this.db.logs, this.db.kv], async () => {
      await Promise.all([this.db.roster.clear(), this.db.activities.clear(), this.db.logs.clear(), this.db.kv.clear()]);
    });
  }
}

export const repo = new Repo();
