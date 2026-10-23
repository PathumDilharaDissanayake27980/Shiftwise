import type { ISODate } from './types';

export const MIN_PER_DAY = 1440;
export const MS_PER_MIN = 60_000;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value: string): boolean {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return toISODate(d) === value;
}

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local midnight of the date. */
export function parseISODate(iso: ISODate): Date {
  const m = ISO_RE.exec(iso);
  if (!m) throw new RangeError(`Invalid date: ${iso}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function diffDays(a: ISODate, b: ISODate): number {
  const ms = parseISODate(a).getTime() - parseISODate(b).getTime();
  return Math.round(ms / 86_400_000);
}

export function weekday(iso: ISODate): number {
  return parseISODate(iso).getDay();
}

export function weekStart(iso: ISODate, startsOn: 0 | 1 = 1): ISODate {
  const wd = weekday(iso);
  const back = (wd - startsOn + 7) % 7;
  return addDays(iso, -back);
}

export function datesFrom(start: ISODate, count: number): ISODate[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/** Epoch ms of a time of day on a date (minutes may exceed 1440). */
export function atMinutes(iso: ISODate, minutes: number): number {
  const d = parseISODate(iso);
  return d.getTime() + minutes * MS_PER_MIN;
}

/** Minutes from the date's local midnight to the timestamp (may be negative or > 1440). */
export function minutesSince(iso: ISODate, epochMs: number): number {
  return Math.round((epochMs - parseISODate(iso).getTime()) / MS_PER_MIN);
}

export function nowMinutes(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

export function fmtTime(minutes: number, hour12 = true): string {
  const m = ((Math.round(minutes) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  if (!hour12) return `${String(h).padStart(2, '0')}:${mm}`;
  const ap = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${mm} ${ap}`;
}

export function fmtDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const m = Math.abs(Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${sign}${r}m`;
  return r === 0 ? `${sign}${h}h` : `${sign}${h}h ${r}m`;
}

export function fmtHours(minutes: number, digits = 1): string {
  return `${(minutes / 60).toFixed(digits)}h`;
}

/** Parses "6:30 pm", "6pm", "18:30", "0630" into minutes from midnight. */
export function parseClock(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap.startsWith('p') && h !== 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function dayName(iso: ISODate, short = false): string {
  const n = DAY_NAMES[weekday(iso)] ?? '';
  return short ? n.slice(0, 3) : n;
}

export function fmtDate(iso: ISODate): string {
  const d = parseISODate(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
