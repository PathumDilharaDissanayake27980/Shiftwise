import type { ActivityColor, BlockType, PlanBlock, WorkShift } from '../domain/types';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** "HH:MM" for <input type="time">. */
export function toTimeInput(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function fromTimeInput(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Local "YYYY-MM-DDTHH:MM" for <input type="datetime-local">. */
export function toDateTimeInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromDateTimeInput(value: string): number | null {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export function blockClass(b: Pick<PlanBlock, 'type' | 'shift'>, color?: ActivityColor): string {
  if (b.type === 'shift' && b.shift) return `blk-shift-${b.shift}`;
  if (b.type === 'activity' && color) return `blk-act-${color}`;
  return `blk-${b.type as BlockType}`;
}

export const SHIFT_CLASS: Record<WorkShift, string> = { M: 'blk-shift-M', D: 'blk-shift-D', N: 'blk-shift-N', G: 'blk-shift-G' };

/** Saves text as a file. Works in browsers and installed PWAs. */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Try again.';
}
