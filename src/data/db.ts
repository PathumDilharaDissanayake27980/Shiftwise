import Dexie, { type EntityTable } from 'dexie';
import type { Activity, RosterDay, TimeLog } from '../domain/types';

export interface KVRecord {
  key: string;
  value: unknown;
}

/**
 * Local IndexedDB database. Schema changes must add a new version() with an upgrade function;
 * never edit an existing version, or users' stored data will fail to open.
 */
export class ShiftWiseDB extends Dexie {
  roster!: EntityTable<RosterDay, 'date'>;
  activities!: EntityTable<Activity, 'id'>;
  logs!: EntityTable<TimeLog, 'id'>;
  kv!: EntityTable<KVRecord, 'key'>;

  constructor(name = 'shiftwise') {
    super(name);
    this.version(1).stores({
      roster: '&date',
      activities: '&id, createdAt',
      logs: '&id, start, category, shiftDate, activityId',
      kv: '&key',
    });
  }
}

export const db = new ShiftWiseDB();
