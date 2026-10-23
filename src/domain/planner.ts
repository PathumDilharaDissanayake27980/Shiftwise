import { CODE_LABEL, isWorkShift } from './defaults';
import { bedtimeBefore, changeover, commuteFor, leaveTime, plannedWake, shiftWindow } from './schedule';
import { MIN_PER_DAY, addDays, fmtTime, weekday } from './time';
import type { Activity, BlockType, DayPlan, ISODate, PlanBlock, PlanNote, RosterDay, Settings, TimePref } from './types';

export type RosterLookup = (date: ISODate) => RosterDay;

interface FixedResult {
  blocks: PlanBlock[];
  notes: PlanNote[];
  fixedActivityMin: Map<string, number>;
}

const SLEEPY: BlockType[] = ['sleep', 'nap'];

function sortBlocks(blocks: PlanBlock[]): PlanBlock[] {
  return blocks.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function gapsOf(blocks: PlanBlock[], from = 0, to = MIN_PER_DAY): { start: number; end: number }[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = from;
  for (const b of sorted) {
    if (b.end <= cursor) continue;
    if (b.start > cursor) gaps.push({ start: cursor, end: Math.min(b.start, to) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= to) break;
  }
  if (cursor < to) gaps.push({ start: cursor, end: to });
  return gaps.filter((g) => g.end > g.start);
}

function isFree(blocks: PlanBlock[], start: number, end: number): boolean {
  return blocks.every((b) => b.end <= start || b.start >= end);
}

function findFree(blocks: PlanBlock[], lo: number, hi: number, len: number): number | null {
  for (const g of gapsOf(blocks)) {
    const s = Math.max(g.start, lo);
    if (s + len <= Math.min(g.end, hi)) return s;
  }
  return null;
}

/** Places everything that does not depend on weekly goals: sleep, routines, commutes, shifts, meals, fixed commitments. */
export function buildFixed(date: ISODate, roster: RosterLookup, s: Settings, activities: Activity[]): FixedResult {
  const today = roster(date);
  const prev = roster(addDays(date, -1));
  const next = roster(addDays(date, 1));
  const blocks: PlanBlock[] = [];
  const notes: PlanNote[] = [];
  const add = (start: number, end: number, type: BlockType, label: string, extra: Partial<PlanBlock> = {}) => {
    const a = Math.max(0, start);
    const b = Math.min(MIN_PER_DAY, end);
    if (b > a) blocks.push({ start: a, end: b, type, label, ...extra });
  };

  const todayWork = isWorkShift(today.code);
  const win = todayWork ? shiftWindow(today.code as 'M', s) : null;
  const leave = leaveTime(today, s);
  const commute = commuteFor(today, s);

  // 1. Morning: either a shift carried over from yesterday, or the night's sleep.
  let wake: number;
  let dayStart = 0;
  const prevWin = isWorkShift(prev.code) ? shiftWindow(prev.code as 'M', s) : null;
  const carry = prevWin && prevWin.end > MIN_PER_DAY ? prevWin.end - MIN_PER_DAY : 0;
  if (carry > 0 && prevWin) {
    add(0, carry, 'shift', `${CODE_LABEL[prev.code]} shift (from yesterday)`, { shift: prev.code as 'N' });
    let x = carry;
    const c = commuteFor(prev, s);
    if (c) {
      add(x, x + c, 'commute', 'Commute home');
      x += c;
    }
    const wd = Math.min(20, s.windDownMin);
    add(x, x + wd, 'routine', 'Wind down');
    const sleepStart = x + wd;
    const desired = sleepStart + s.sleepTargetMin;
    const latest = leave !== null ? leave - (today.code === 'G' ? Math.min(30, s.prepMin) : s.prepMin) : Infinity;
    wake = Math.min(desired, latest);
    if (wake <= sleepStart) {
      notes.push({ level: 'bad', title: 'No time to sleep', text: `Yesterday's shift runs into today's ${CODE_LABEL[today.code]} shift. Raise this pairing with your lead.` });
      wake = sleepStart;
    } else {
      add(sleepStart, wake, 'sleep', 'Sleep');
    }
    dayStart = wake;
  } else {
    wake = plannedWake(today, s);
    add(0, wake, 'sleep', today.code === 'G' ? 'Sleep (since last evening)' : 'Sleep');
    dayStart = wake;
  }

  // 2. Getting ready and today's shift.
  if (todayWork && win && leave !== null) {
    const start = Math.max(win.start, dayStart);
    const leaveAt = Math.max(dayStart, leave);
    if (today.code === 'M' || today.code === 'G') {
      add(dayStart, leaveAt, 'routine', today.code === 'G' ? 'Wake up, coffee' : 'Get ready');
    } else {
      add(dayStart, Math.min(dayStart + s.prepMin, leaveAt), 'routine', 'Wake up, shower, breakfast');
    }
    if (today.code === 'N') {
      add(leaveAt - 45, leaveAt - 15, 'meal', 'Dinner');
      add(leaveAt - 15, leaveAt, 'routine', 'Get ready');
      const prevWasNight = prevWin !== null && prevWin.end > MIN_PER_DAY;
      if (s.preNightNap && !prevWasNight && isFree(blocks, 900, 975)) add(900, 975, 'nap', 'Pre-shift nap');
    }
    if (commute) add(Math.max(dayStart, start - commute), start, 'commute', 'Commute');
    const label = `${s.shifts[today.code as 'M'].name} shift${win.end > MIN_PER_DAY ? ` (ends ${fmtTime(win.end - MIN_PER_DAY, s.hour12)})` : ''}`;
    add(start, win.end, 'shift', label, { shift: today.code as 'M' });
    if (win.end + commute <= MIN_PER_DAY && commute) add(win.end, win.end + commute, 'commute', 'Commute home');
    if (today.code === 'G') {
      const after = win.end + commute;
      add(after, after + 30, 'meal', 'Light breakfast');
      add(after + 30, Math.max(after + 30, s.graveyardRecoveryUntil), 'sleep', 'Recovery sleep');
    }
  } else {
    add(dayStart, dayStart + 45, 'routine', 'Wake up, shower, breakfast');
    if (today.code === 'SICK') notes.push({ level: 'info', title: 'Sick day', text: 'Only light activities are planned. Rest comes first.' });
  }

  // 3. Tonight's sleep, unless today's shift runs past midnight.
  const runsPastMidnight = win !== null && win.end > MIN_PER_DAY;
  if (!runsPastMidnight) {
    const busyEnd = Math.max(0, ...blocks.filter((b) => !SLEEPY.includes(b.type)).map((b) => b.end));
    const bed = Math.max(bedtimeBefore(next, s), busyEnd + s.windDownMin);
    if (next.code === 'G') add(bed - 30, bed, 'meal', 'Early dinner');
    else add(bed - s.windDownMin, bed, 'routine', 'Wind down, no screens');
    add(bed, MIN_PER_DAY, 'sleep', 'Sleep');
  }

  // 4. Fixed commitments (classes, client calls).
  const fixedActivityMin = new Map<string, number>();
  const wd = weekday(date);
  for (const a of activities) {
    if (!a.active) continue;
    for (const slot of a.fixed) {
      if (slot.weekday !== wd) continue;
      if (isFree(blocks, slot.start, slot.end)) {
        add(slot.start, slot.end, 'activity', a.name, { activityId: a.id, fixed: true });
        fixedActivityMin.set(a.id, (fixedActivityMin.get(a.id) ?? 0) + slot.end - slot.start);
      } else {
        notes.push({ level: 'warn', title: `${a.name} clashes`, text: `Your fixed ${a.name} slot at ${fmtTime(slot.start, s.hour12)} overlaps with work or sleep today.` });
      }
    }
  }

  // 5. Meals on free stretches.
  const hasMeal = (lo: number, hi: number) => blocks.some((b) => b.type === 'meal' && b.start < hi && b.end > lo);
  if (!hasMeal(660, 900)) {
    const l = findFree(blocks, 690, 870, s.mealMin);
    if (l !== null) add(l, l + s.mealMin, 'meal', 'Lunch');
  }
  if (!hasMeal(1020, 1320) && !runsPastMidnight) {
    const d = findFree(blocks, 1110, 1290, s.mealMin);
    if (d !== null) add(d, d + s.mealMin, 'meal', 'Dinner');
  }

  // 6. Changeover warnings.
  for (const [a, b, label] of [
    [prev, today, 'Yesterday → today'],
    [today, next, 'Tonight → tomorrow'],
  ] as const) {
    const c = changeover(a, b, s);
    if (c.verdict === 'tight' || c.verdict === 'bad') {
      notes.push({ level: c.verdict === 'bad' ? 'bad' : 'warn', title: `${label}: ${CODE_LABEL[a.code]} → ${CODE_LABEL[b.code]}`, text: c.advice });
    }
  }

  return { blocks: sortBlocks(blocks), notes, fixedActivityMin };
}

export function trailingSleep(blocks: PlanBlock[]): number {
  return blocks.filter((b) => b.type === 'sleep' && b.start >= 720).reduce((t, b) => t + b.end - b.start, 0);
}

export function morningSleep(blocks: PlanBlock[]): number {
  return blocks
    .filter((b) => (b.type === 'sleep' && b.start < 720) || b.type === 'nap')
    .reduce((t, b) => t + b.end - b.start, 0);
}

function timeOfDay(m: number): Exclude<TimePref, 'any'> {
  if (m < 12 * 60) return 'morning';
  if (m < 17 * 60) return 'afternoon';
  return 'evening';
}

function prefFactor(pref: TimePref, m: number): number {
  if (pref === 'any') return 1;
  return pref === timeOfDay(m) ? 1.5 : 0.6;
}

export interface AllocationState {
  /** Minutes planned so far this week per activity. */
  progress: Map<string, number>;
}

/** Fills the free gaps of a day with goal-driven activity blocks; whatever is left becomes free time. */
export function allocate(
  fixed: PlanBlock[],
  day: RosterDay,
  s: Settings,
  activities: Activity[],
  state: AllocationState,
  sleepBeforeMin: number,
): { blocks: PlanBlock[]; notes: PlanNote[] } {
  const blocks = [...fixed];
  const notes: PlanNote[] = [];
  const tired = sleepBeforeMin < 360 || day.code === 'SICK';
  if (tired && day.code !== 'SICK') {
    notes.push({ level: 'warn', title: 'Running on low sleep', text: `About ${(sleepBeforeMin / 60).toFixed(1)}h of sleep before today, so the plan has one focus block and no workout.` });
  }
  const perDay = new Map<string, number>();
  let focusBlocks = 0;
  let fitnessDone = false;
  let prime = true;

  for (const gap of gapsOf(fixed)) {
    let cursor = gap.start;
    while (gap.end - cursor >= 15) {
      const late = cursor >= s.lateCutoff;
      let best: { a: Activity; len: number; score: number } | null = null;
      for (const a of activities) {
        if (!a.active || a.weeklyTargetMin <= 0) continue;
        const done = state.progress.get(a.id) ?? 0;
        const remaining = a.weeklyTargetMin - done;
        if (remaining < 15) continue;
        if ((perDay.get(a.id) ?? 0) >= 2) continue;
        const heavy = a.kind === 'focus' || a.kind === 'fitness';
        if (late && heavy) continue;
        if (day.code === 'SICK' && heavy) continue;
        if (a.kind === 'fitness' && (fitnessDone || tired || cursor < 6 * 60)) continue;
        if (a.kind === 'focus' && tired && focusBlocks >= 1) continue;
        let room = gap.end - cursor;
        if (heavy) room = Math.min(room, s.lateCutoff - cursor);
        let len = Math.min(a.maxBlockMin, remaining, room);
        len = Math.floor(len / 15) * 15;
        const need = Math.min(a.minBlockMin, remaining);
        if (len < Math.max(15, need)) continue;
        const score =
          a.priority *
          (0.4 + remaining / a.weeklyTargetMin) *
          prefFactor(a.preferred, cursor) *
          (a.kind === 'focus' && prime ? 1.3 : 1) *
          ((perDay.get(a.id) ?? 0) > 0 ? 0.5 : 1);
        if (!best || score > best.score) best = { a, len, score };
      }
      if (!best) break;
      const { a, len } = best;
      blocks.push({ start: cursor, end: cursor + len, type: 'activity', label: a.name, activityId: a.id });
      state.progress.set(a.id, (state.progress.get(a.id) ?? 0) + len);
      perDay.set(a.id, (perDay.get(a.id) ?? 0) + 1);
      if (a.kind === 'focus') focusBlocks += 1;
      if (a.kind === 'fitness') fitnessDone = true;
      prime = false;
      cursor += len;
      if (gap.end - cursor >= 30) {
        blocks.push({ start: cursor, end: cursor + 15, type: 'break', label: 'Break' });
        cursor += 15;
      }
    }
    if (gap.end - cursor >= 15) {
      const late = cursor >= s.lateCutoff;
      blocks.push({ start: cursor, end: gap.end, type: 'free', label: late ? 'Free time (light)' : 'Free time' });
    } else if (gap.end > cursor) {
      blocks.push({ start: cursor, end: gap.end, type: 'buffer', label: 'Buffer' });
    }
  }
  return { blocks: sortBlocks(blocks), notes };
}

function sumType(blocks: PlanBlock[], types: BlockType[]): number {
  return blocks.filter((b) => types.includes(b.type)).reduce((t, b) => t + b.end - b.start, 0);
}

/** Plans consecutive days, sharing weekly activity targets across them. */
export function planDays(dates: ISODate[], roster: RosterLookup, s: Settings, activities: Activity[]): DayPlan[] {
  const state: AllocationState = { progress: new Map() };
  const fixedByDate = dates.map((d) => buildFixed(d, roster, s, activities));
  for (const f of fixedByDate) for (const [id, m] of f.fixedActivityMin) state.progress.set(id, (state.progress.get(id) ?? 0) + m);

  const first = dates[0];
  let prevTrailing = first ? trailingSleep(buildFixed(addDays(first, -1), roster, s, []).blocks) : 0;
  return dates.map((date, i) => {
    const f = fixedByDate[i] as FixedResult;
    const day = roster(date);
    const sleepBeforeMin = prevTrailing + morningSleep(f.blocks);
    const { blocks, notes } = allocate(f.blocks, day, s, activities, state, sleepBeforeMin);
    prevTrailing = trailingSleep(blocks);
    return {
      date,
      code: day.code,
      mode: day.mode,
      blocks,
      notes: [...f.notes, ...notes],
      sleepBeforeMin,
      activityMin: sumType(blocks, ['activity']),
      freeMin: sumType(blocks, ['free', 'break', 'buffer']),
    };
  });
}
