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
    if (today.code === 'M' || today.code === 'D') add(win.end + commute, win.end + commute + 30, 'break', 'Unwind after work');
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

export interface AllocationState {
  /** Minutes planned so far this week per activity. */
  progress: Map<string, number>;
  /** First start time of each activity per kind of day ("id|M"), so later days repeat it: routine. */
  anchors: Map<string, number>;
}

/** How much goal work a day can carry. */
export interface DayLoad {
  /** Most focus minutes to plan today. */
  focus: number;
  /** A recharge day: no focus work at all. */
  rest: boolean;
  /** The first day off after night shifts: light load while the body clock resets. */
  recovery?: boolean;
  /** Focus budget from today to the end of the planned stretch, today included. Used for pacing. */
  focusAhead: number;
  /** Days from today to the end of the planned stretch, today included. */
  daysAhead: number;
}

const OPEN_LOAD: DayLoad = { focus: Infinity, rest: false, focusAhead: 0, daysAhead: 1 };

function isOff(day: RosterDay): boolean {
  return !isWorkShift(day.code);
}

/** Today's focus budget, and whether it is a recharge day (every second day off in a row). */
export function dayLoad(date: ISODate, roster: RosterLookup, s: Settings): Pick<DayLoad, 'focus' | 'rest' | 'recovery'> {
  const day = roster(date);
  if (day.code === 'SICK') return { focus: 0, rest: true };
  if (isWorkShift(day.code)) return { focus: s.focusBudget[day.code], rest: false };
  let run = 1;
  while (run <= 14 && isOff(roster(addDays(date, -run)))) run += 1;
  // A long break with no shifts (leave, or a roster not filled in yet) rests on Sundays only.
  const rest = s.restDay && (run > 14 ? weekday(date) === 0 : run % 2 === 0);
  const prev = roster(addDays(date, -1)).code;
  // A night shift runs into this morning; a graveyard shift ended yesterday morning and a full night's sleep followed.
  if (!rest && prev === 'N') return { focus: Math.round(s.focusBudget.OFF / 3 / 15) * 15, rest: false, recovery: true };
  return { focus: rest ? 0 : s.focusBudget.OFF, rest };
}

const roundUp15 = (m: number) => Math.ceil(m / 15) * 15;

/** Share of a day's open time that may be planned. The rest always stays free time. */
export const MAX_PLANNED_SHARE = 0.6;

/** Fills the free gaps of a day with goal-driven activity blocks; whatever is left becomes free time. */
/**
 * How alert a typical shift worker is at minute m of this day, about 0.2–1.4. Built from the day's own
 * sleep and shift blocks: sleep inertia after waking, the 1–5 hour peak, the post-shift slump, the
 * early-afternoon dip and the last hours before bed. A transparent heuristic, like the fatigue score.
 */
export function alertness(m: number, fixed: PlanBlock[]): number {
  const wokeAt = Math.max(-1, ...fixed.filter((b) => SLEEPY.includes(b.type) && b.end <= m).map((b) => b.end));
  const since = wokeAt < 0 ? 600 : m - wokeAt;
  let a = 1;
  if (since < 45) a *= 0.35;
  else if (since <= 300) a *= 1.35;
  else if (since > 13 * 60) a *= 0.65;
  const shiftEnd = Math.max(-1, ...fixed.filter((b) => (b.type === 'shift' || b.type === 'commute') && b.end <= m && b.end < MIN_PER_DAY).map((b) => b.end));
  const afterShift = fixed.some((b) => b.type === 'shift' && b.end <= m && b.start > 0);
  if (afterShift && shiftEnd >= 0 && m - shiftEnd < 60) a *= 0.55;
  const nextSleep = Math.min(Infinity, ...fixed.filter((b) => b.type === 'sleep' && b.start >= m).map((b) => b.start));
  if (nextSleep - m < 120) a *= 0.6;
  const h = (m % MIN_PER_DAY) / 60;
  if (h >= 13.5 && h < 15.5) a *= 0.85;
  return a;
}

/** How well a block of this kind fits [start, end). Deep work wants alertness; light things do not mind. */
function timeFit(a: Activity, start: number, end: number, fixed: PlanBlock[]): number {
  const al = (alertness(start, fixed) + alertness(Math.max(start, end - 15), fixed)) / 2;
  const pref = a.preferred === 'any' ? 1 : a.preferred === timeOfDay(start) ? 1.3 : 0.8;
  if (a.kind === 'focus') return al * al * pref;
  if (a.kind === 'fitness') return Math.min(1.2, 0.6 + al / 2) * pref;
  return pref;
}

/**
 * Places goal blocks where they fit best, not just first. Every possible start (15-minute grid) is
 * scored by priority, what is left of the weekly goal, how alert you will be, and routine: the same
 * activity at the same time on the same kind of day scores higher, so habits form. Best goes first,
 * then the next, until the day's budgets are used: deep work first, then exercise, then light and
 * personal time around them. Whatever is left becomes free time.
 */
export function allocate(
  fixed: PlanBlock[],
  day: RosterDay,
  s: Settings,
  activities: Activity[],
  state: AllocationState,
  sleepBeforeMin: number,
  load: DayLoad = OPEN_LOAD,
): { blocks: PlanBlock[]; notes: PlanNote[] } {
  const notes: PlanNote[] = [];
  const tired = sleepBeforeMin < 360 || day.code === 'SICK';
  if (tired && day.code !== 'SICK') {
    notes.push({ level: 'warn', title: 'Running on low sleep', text: `About ${(sleepBeforeMin / 60).toFixed(1)}h of sleep before today, so the plan has one focus block and no workout.` });
  }
  if (load.rest && day.code !== 'SICK') {
    notes.push({ level: 'good', title: 'Recharge day', text: 'Second day off in a row: no study or work goals today. Exercise, people, hobbies and a short review only.' });
  }
  if (load.recovery) {
    notes.push({ level: 'info', title: 'Recovery after nights', text: 'Your body clock is still on nights, so today has a light load. Get daylight in the afternoon and go to bed on time.' });
  }
  let focusLeft = load.focus;
  const openMin = gapsOf(fixed).reduce((t, g) => t + g.end - g.start, 0);
  let plannedLeft = Math.floor((openMin * (s.maxPlannedShare ?? MAX_PLANNED_SHARE)) / 15) * 15;
  const todayCap = new Map<string, number>();
  for (const a of activities) {
    const remaining = a.weeklyTargetMin - (state.progress.get(a.id) ?? 0);
    if (remaining <= 0) continue;
    let share: number;
    if (a.kind === 'focus') share = load.focusAhead > 0 && Number.isFinite(load.focus) ? (remaining * load.focus) / load.focusAhead : remaining;
    else share = remaining / Math.max(1, load.daysAhead);
    todayCap.set(a.id, Math.max(a.minBlockMin, roundUp15(share * 1.3)));
  }
  const placed: PlanBlock[] = [];
  const perDayMin = new Map<string, number>();
  const perDay = new Map<string, number>();
  let focusBlocks = 0;
  let fitnessDone = false;
  // Activities keep 15 minutes from each other, so there is always a breather between them.
  const clear = (st: number, en: number) => placed.every((b) => en + 15 <= b.start || st >= b.end + 15);

  // Hardest to place goes first: deep work needs your alert hours, exercise needs daytime, while a short
  // review or time with people fits almost anywhere. Without this, easy things took the best slots.
  const habit = (a: Activity) => a.maxBlockMin <= 30;
  const phases: ((a: Activity) => boolean)[] = [(a) => a.kind === 'focus', (a) => a.kind === 'fitness', (a) => habit(a) && a.kind !== 'focus' && a.kind !== 'fitness', (a) => !habit(a) && (a.kind === 'light' || a.kind === 'personal')];
  // ...but keep room for short daily habits (the 20-minute review) so deep work cannot crowd them out.
  const habitReserve = activities
    .filter((a) => a.active && habit(a) && a.weeklyTargetMin - (state.progress.get(a.id) ?? 0) >= a.minBlockMin)
    .reduce((t, a) => t + a.maxBlockMin + 15, 0);
  for (let guard = 0, phase = 0; guard < 40 && phase < phases.length; guard++) {
    const gaps = gapsOf([...fixed, ...placed]);
    let best: { a: Activity; st: number; len: number; score: number } | null = null;
    for (const a of activities) {
      if (!(phases[phase] as (a: Activity) => boolean)(a)) continue;
      if (!a.active || a.weeklyTargetMin <= 0) continue;
      const remaining = a.weeklyTargetMin - (state.progress.get(a.id) ?? 0);
      if (remaining < Math.min(30, a.minBlockMin)) continue;
      // short daily habits (a 20-minute review) happen once a day; bigger goals at most twice
      if ((perDay.get(a.id) ?? 0) >= (a.maxBlockMin <= 30 ? 1 : 2)) continue;
      const capLeft = (todayCap.get(a.id) ?? 0) - (perDayMin.get(a.id) ?? 0);
      if (capLeft < 15) continue;
      const heavy = a.kind === 'focus' || a.kind === 'fitness';
      if (a.kind === 'focus' && (load.rest || focusLeft < 15 || (tired && focusBlocks >= 1))) continue;
      if (day.code === 'SICK' && heavy) continue;
      if (a.kind === 'fitness' && (fitnessDone || tired)) continue;
      const room = a.maxBlockMin <= 30 ? plannedLeft : plannedLeft - (phase < 2 ? habitReserve : 0);
      let len = Math.min(a.maxBlockMin, remaining, capLeft, room, a.kind === 'focus' ? focusLeft : Infinity);
      len = Math.floor(len / 5) * 5;
      const need = Math.min(a.minBlockMin, remaining, room, a.kind === 'focus' ? focusLeft : Infinity);
      // never shrink a block below its useful minimum just to use up a budget: no 30-minute project scraps
      const minLen = Math.max(a.minBlockMin < 30 ? 15 : 30, need, Math.min(a.minBlockMin, remaining));
      if (len < minLen) continue;
      const anchor = state.anchors.get(`${a.id}|${day.code}`);
      const base = a.priority * (0.4 + remaining / a.weeklyTargetMin) * ((perDay.get(a.id) ?? 0) > 0 ? 0.5 : 1);
      for (const g of gaps) {
        // exercise ends at least two hours before sleep, so it does not keep you awake
        const sleepAfter = Math.min(MIN_PER_DAY, ...fixed.filter((b) => b.type === 'sleep' && b.start >= g.start).map((b) => b.start));
        const hi = a.kind === 'fitness' ? Math.min(g.end, s.lateCutoff, sleepAfter - 120) : heavy ? Math.min(g.end, s.lateCutoff) : g.end;
        const lo = a.kind === 'fitness' ? Math.max(g.start, 6 * 60) : g.start;
        for (let st = Math.ceil(lo / 15) * 15; st + minLen <= hi; st += 15) {
          const l = Math.min(len, Math.floor((hi - st) / 5) * 5);
          if (l < minLen || !clear(st, st + l)) continue;
          const routine = anchor === undefined ? 1 : Math.abs(anchor - st) <= 30 ? 1.25 : 0.9;
          const score = base * timeFit(a, st, st + l, fixed) * routine * (0.85 + (0.15 * l) / len);
          if (!best || score > best.score) best = { a, st, len: l, score };
        }
      }
    }
    if (!best) {
      phase += 1;
      continue;
    }
    const { a, st, len } = best;
    placed.push({ start: st, end: st + len, type: 'activity', label: a.name, activityId: a.id });
    state.progress.set(a.id, (state.progress.get(a.id) ?? 0) + len);
    if (!state.anchors.has(`${a.id}|${day.code}`)) state.anchors.set(`${a.id}|${day.code}`, st);
    perDay.set(a.id, (perDay.get(a.id) ?? 0) + 1);
    perDayMin.set(a.id, (perDayMin.get(a.id) ?? 0) + len);
    plannedLeft -= len;
    if (a.kind === 'focus') {
      focusBlocks += 1;
      focusLeft -= len;
    }
    if (a.kind === 'fitness') fitnessDone = true;
  }

  const blocks = [...fixed, ...placed];
  for (const g of gapsOf(blocks)) {
    const len = g.end - g.start;
    const between = placed.some((b) => b.end === g.start) && placed.some((b) => b.start === g.end);
    if (len < 15) blocks.push({ start: g.start, end: g.end, type: 'buffer', label: 'Buffer' });
    else if (between && len <= 30) blocks.push({ start: g.start, end: g.end, type: 'break', label: 'Break' });
    else blocks.push({ start: g.start, end: g.end, type: 'free', label: g.start >= s.lateCutoff ? 'Free time (light)' : 'Free time' });
  }
  return { blocks: sortBlocks(blocks), notes };
}

function sumType(blocks: PlanBlock[], types: BlockType[]): number {
  return blocks.filter((b) => types.includes(b.type)).reduce((t, b) => t + b.end - b.start, 0);
}

/** Plans consecutive days, sharing weekly activity targets across them. */
export function planDays(dates: ISODate[], roster: RosterLookup, s: Settings, activities: Activity[]): DayPlan[] {
  const state: AllocationState = { progress: new Map(), anchors: new Map() };
  const fixedByDate = dates.map((d) => buildFixed(d, roster, s, activities));
  for (const f of fixedByDate) for (const [id, m] of f.fixedActivityMin) state.progress.set(id, (state.progress.get(id) ?? 0) + m);

  const loads = dates.map((d) => dayLoad(d, roster, s));
  const first = dates[0];
  let prevTrailing = first ? trailingSleep(buildFixed(addDays(first, -1), roster, s, []).blocks) : 0;
  return dates.map((date, i) => {
    const f = fixedByDate[i] as FixedResult;
    const day = roster(date);
    const sleepBeforeMin = prevTrailing + morningSleep(f.blocks);
    const ahead = loads.slice(i);
    const load: DayLoad = { ...(loads[i] as DayLoad), focusAhead: ahead.reduce((t, l) => t + l.focus, 0), daysAhead: ahead.length };
    const { blocks, notes } = allocate(f.blocks, day, s, activities, state, sleepBeforeMin, load);
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
