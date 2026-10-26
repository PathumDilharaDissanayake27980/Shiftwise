/**
 * The built-in assistant: a deterministic, offline rules engine. It understands short commands
 * ("set monday night office", "clock in", "log 2h study") and questions ("how tired am I?",
 * "when can I study?"). It never changes data itself: it returns actions that the UI asks the user
 * to confirm. Because it is pure, it can be swapped for an LLM-backed implementation with the same
 * interface later.
 */
import { CODE_LABEL, MODE_LABEL, isWorkShift } from './defaults';
import type { WeekReport } from './analytics';
import type { FatigueResult } from './fatigue';
import type { RosterLookup } from './planner';
import { shiftWindow } from './schedule';
import { MIN_PER_DAY, addDays, atMinutes, dayName, fmtDuration, fmtTime, isISODate, minutesSince, nowMinutes, weekStart } from './time';
import type { Activity, ActivityKind, AscendLink, DayCode, DayPlan, ISODate, RosterDay, Settings, TimeLog, TimePref, WorkMode } from './types';

export type AssistantAction =
  | { type: 'setRoster'; days: RosterDay[] }
  | { type: 'clockIn'; shiftDate: ISODate }
  | { type: 'clockOut' }
  | { type: 'startActivity'; activityId: string }
  | { type: 'stopTimers' }
  | { type: 'addActivity'; activity: Omit<Activity, 'id' | 'createdAt'> }
  | { type: 'logActivity'; activityId: string; start: number; end: number }
  | { type: 'logSleep'; start: number; end: number };

export interface AssistantReply {
  text: string;
  actions: AssistantAction[];
  suggestions: string[];
}

export interface AssistantContext {
  today: ISODate;
  now: Date;
  settings: Settings;
  activities: Activity[];
  roster: RosterLookup;
  weekPlans: DayPlan[];
  fatigue: FatigueResult[];
  report: WeekReport | null;
  running: TimeLog[];
}

const SHIFT_WORDS: Record<string, DayCode> = {
  morning: 'M', m: 'M', day: 'D', d: 'D', night: 'N', n: 'N', graveyard: 'G', grave: 'G', g: 'G',
  off: 'OFF', leave: 'LEAVE', sick: 'SICK', holiday: 'HOLIDAY',
};
const MODE_WORDS: Record<string, WorkMode> = {
  office: 'O', o: 'O', wfo: 'O', home: 'H', h: 'H', wfh: 'H', monitoring: 'MON', mon: 'MON',
};
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const DEFAULT_SUGGESTIONS = ['What should I do today?', 'How tired am I?', 'How much free time do I have?', 'When can I study?'];

export function resolveDay(token: string, today: ISODate, weekStartsOn: 0 | 1): ISODate | null {
  const t = token.toLowerCase();
  if (t === 'today' || t === 'tonight') return today;
  if (t === 'tomorrow' || t === 'tmrw' || t === 'tmr') return addDays(today, 1);
  if (t === 'yesterday') return addDays(today, -1);
  if (isISODate(t)) return t;
  const dm = /^(\d{1,2})[/.](\d{1,2})$/.exec(t);
  if (dm) {
    const iso = `${today.slice(0, 4)}-${String(dm[2]).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
    return isISODate(iso) ? iso : null;
  }
  const idx = WEEKDAYS.findIndex((w) => w === t || (t.length >= 3 && w.startsWith(t)));
  if (idx >= 0) {
    const start = weekStart(today, weekStartsOn);
    const offset = (idx - weekStartsOn + 7) % 7;
    return addDays(start, offset);
  }
  return null;
}

function findActivity(name: string, activities: Activity[]): Activity | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return (
    activities.find((a) => a.name.toLowerCase() === n) ??
    activities.find((a) => a.name.toLowerCase().startsWith(n)) ??
    activities.find((a) => a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase())) ??
    activities.find((a) => a.link && LINK_ALIASES[a.link].test(n)) ??
    null
  );
}

/** Everyday words for the activities that feed Ascend ("log 2h study" finds "Learn (Ascend lessons)"). */
const LINK_ALIASES: Record<AscendLink, RegExp> = {
  learn: /^(study|studying|learn|learning|lessons?|ascend|course)$/,
  build: /^(build|building|project|projects|portfolio|coding)$/,
  cert: /^(cert|certs|certification|exam|exam prep)$/,
};

function inferKind(name: string): ActivityKind {
  if (/gym|run|workout|yoga|swim|walk|cycl|sport|cricket|football|exercise/.test(name)) return 'fitness';
  if (/read|music|guitar|family|friends|game|movie|relax|cook/.test(name)) return 'light';
  return 'focus';
}

function parseDayCode(token: string): { code: DayCode; mode: WorkMode | null } | null {
  const [c, m] = token.toLowerCase().split(/[/-]/);
  const code = c ? SHIFT_WORDS[c] : undefined;
  if (!code) return null;
  const mode = m ? MODE_WORDS[m] : undefined;
  if (m && !mode) return null;
  return { code, mode: mode ?? null };
}

function blockLine(b: DayPlan['blocks'][number], s: Settings): string {
  return `${fmtTime(b.start, s.hour12)}–${fmtTime(b.end, s.hour12)}  ${b.label}`;
}

function describeDay(date: ISODate, ctx: AssistantContext): string {
  const day = ctx.roster(date);
  const mode = isWorkShift(day.code) ? ` (${MODE_LABEL[day.mode]})` : '';
  return `${dayName(date)}: ${CODE_LABEL[day.code]}${mode}`;
}

export function respond(input: string, ctx: AssistantContext): AssistantReply {
  const raw = input.trim();
  const q = raw.toLowerCase().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ');
  const s = ctx.settings;
  const reply = (text: string, actions: AssistantAction[] = [], suggestions: string[] = DEFAULT_SUGGESTIONS): AssistantReply => ({ text, actions, suggestions });

  if (!q) return reply('Ask me about your day, your energy, or tell me a shift change.');

  // --- Commands -------------------------------------------------------------------------------

  // Whole week: "week m/h d/o n/h n off off d" or "next week ..."
  const wk = /^(next )?(?:week|roster)[:\s]+(.+)$/.exec(q);
  if (wk) {
    const tokens = (wk[2] ?? '').split(/[\s,]+/).filter(Boolean);
    const parsed = tokens.map(parseDayCode).filter((x): x is NonNullable<typeof x> => x !== null);
    if (tokens.length === 7 && parsed.length === 7) {
      const start = addDays(weekStart(ctx.today, s.weekStartsOn), wk[1] ? 7 : 0);
      const days = parsed.map((p, i) => {
        const date = addDays(start, i);
        return { date, code: p.code, mode: p.mode ?? ctx.roster(date).mode } satisfies RosterDay;
      });
      const lines = days.map((d) => `${dayName(d.date, true)} ${CODE_LABEL[d.code]}${isWorkShift(d.code) ? ` · ${MODE_LABEL[d.mode]}` : ''}`);
      return reply(`I'll set ${wk[1] ? 'next' : 'this'} week to:\n${lines.join('\n')}`, [{ type: 'setRoster', days }]);
    }
    return reply('Give me 7 codes, one per day, like: week m/h d/o n/h n/h off off g/h\nM = morning, D = day, N = night, G = graveyard, off. Add /o for office or /h for home.');
  }

  // Clock in / out.
  if (/\b(clock|punch|log)\s*in\b|\bstart (my )?(shift|work)\b/.test(q)) {
    if (ctx.running.some((l) => l.category === 'shift')) return reply('You are already clocked in.');
    const yesterday = addDays(ctx.today, -1);
    const y = ctx.roster(yesterday);
    const nowMin = nowMinutes(ctx.now);
    let shiftDate = ctx.today;
    if (isWorkShift(y.code)) {
      const w = shiftWindow(y.code as 'M', s);
      if (w.end > MIN_PER_DAY && nowMin < w.end - MIN_PER_DAY) shiftDate = yesterday;
    }
    const d = ctx.roster(shiftDate);
    const label = isWorkShift(d.code) ? `${CODE_LABEL[d.code]} shift` : 'an unscheduled shift';
    return reply(`Clocking you in now for ${label} on ${dayName(shiftDate)}.`, [{ type: 'clockIn', shiftDate }]);
  }
  if (/\b(clock|punch|log)\s*out\b|\b(end|finish|stop) (my )?(shift|work)\b/.test(q)) {
    const running = ctx.running.find((l) => l.category === 'shift');
    if (!running) return reply('You are not clocked in.');
    const mins = (ctx.now.getTime() - running.start) / 60_000;
    return reply(`Clocking you out after ${fmtDuration(mins)}.`, [{ type: 'clockOut' }]);
  }

  // Timers.
  const start = /^(?:start|begin)\s+(.+)$/.exec(q);
  if (start) {
    const a = findActivity(start[1] ?? '', ctx.activities);
    if (!a) return reply(`I don't have an activity called "${start[1]}". Add it on the Activities page, or say: add ${start[1]} 3h per week`);
    return reply(`Starting a timer for ${a.name}.`, [{ type: 'startActivity', activityId: a.id }]);
  }
  if (/^(stop|pause|end)( timer| timers| it| activity)?$/.test(q)) {
    const running = ctx.running.filter((l) => l.category !== 'shift');
    if (!running.length) return reply('No activity timer is running.');
    return reply('Stopping your running timer.', [{ type: 'stopTimers' }]);
  }

  // Manual log: "log 2h study", "log 45m gym yesterday", "log 7h sleep"
  const log = /^log\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|mins?|minutes?)\s+(?:of\s+)?(.+?)(?:\s+(yesterday|today))?$/.exec(q);
  if (log) {
    const amount = Number(log[1]);
    const minutes = Math.round(/^h/.test(log[2] ?? '') ? amount * 60 : amount);
    if (!(minutes > 0 && minutes <= 16 * 60)) return reply('That duration looks wrong. Use something between 1 minute and 16 hours.');
    const when = log[4] === 'yesterday' ? addDays(ctx.today, -1) : ctx.today;
    const what = (log[3] ?? '').trim();
    if (/^sleep|^slept|^nap/.test(what)) {
      const end = when === ctx.today ? ctx.now.getTime() : atMinutes(when, 8 * 60);
      return reply(`Logging ${fmtDuration(minutes)} of sleep.`, [{ type: 'logSleep', start: end - minutes * 60_000, end }]);
    }
    const a = findActivity(what, ctx.activities);
    if (!a) return reply(`I couldn't find "${what}". Your activities: ${ctx.activities.map((x) => x.name).join(', ') || 'none yet'}.`);
    const end = when === ctx.today ? ctx.now.getTime() : atMinutes(when, 21 * 60);
    return reply(`Logging ${fmtDuration(minutes)} of ${a.name}${when === ctx.today ? '' : ' yesterday'}.`, [{ type: 'logActivity', activityId: a.id, start: end - minutes * 60_000, end }]);
  }

  // Add an activity: "add guitar 3h per week evening"
  const addAct = /^add(?: activity)?\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)\s*(?:a|per|\/|each|every)?\s*week(?:\s+(?:in the\s+)?(mornings?|afternoons?|evenings?))?$/.exec(q);
  if (addAct) {
    const name = (addAct[1] ?? '').replace(/\b\w/g, (c) => c.toUpperCase());
    const hours = Number(addAct[2]);
    if (!(hours > 0 && hours <= 60)) return reply('Pick a weekly target between 0.5 and 60 hours.');
    if (findActivity(name, ctx.activities)?.name.toLowerCase() === name.toLowerCase()) return reply(`${name} already exists. Edit it on the Activities page.`);
    const kind = inferKind(name.toLowerCase());
    const preferred = ((addAct[3] ?? 'any').replace(/s$/, '') as TimePref);
    const activity: Omit<Activity, 'id' | 'createdAt'> = {
      name, kind, color: kind === 'fitness' ? 'coral' : kind === 'light' ? 'amber' : 'green',
      weeklyTargetMin: Math.round(hours * 60), minBlockMin: kind === 'fitness' ? 60 : 45, maxBlockMin: kind === 'fitness' ? 90 : 120,
      preferred, priority: 3, active: true, fixed: [],
    };
    return reply(`Adding ${name}: ${hours}h a week, ${kind}, ${preferred === 'any' ? 'any time' : `${preferred}s`}.`, [{ type: 'addActivity', activity }]);
  }

  // Single-day roster change: "set monday night office", "tomorrow off", "I'm on day shift friday"
  const words = q.replace(/\bshift\b/g, ' ').split(/[\s,]+/).filter(Boolean);
  const dayTok = words.map((w) => resolveDay(w, ctx.today, s.weekStartsOn)).find(Boolean) ?? null;
  const verb = /^(set|put|change|make|i'?m on|i am on|i have|mark)\b/.test(q);
  const codeTok = words.filter((w) => w.length > 1 || verb).map((w) => SHIFT_WORDS[w]).find(Boolean);
  const modeTok = words.filter((w) => w.length > 1 || verb).map((w) => MODE_WORDS[w]).find(Boolean);
  if (dayTok && codeTok && (verb || words.length <= 4)) {
    const existing = ctx.roster(dayTok);
    const day: RosterDay = { date: dayTok, code: codeTok, mode: modeTok ?? existing.mode };
    return reply(
      `Set ${dayName(dayTok)} to ${CODE_LABEL[codeTok]}${isWorkShift(codeTok) ? ` from ${MODE_LABEL[day.mode].toLowerCase()}` : ''}? Your plan will update around it.`,
      [{ type: 'setRoster', days: [day] }],
    );
  }

  // --- Questions -------------------------------------------------------------------------------

  if (/tired|fatigue|exhaust|burn ?out|sleepy|energy|overwork|\brested\b/.test(q)) {
    const f = ctx.fatigue.find((x) => x.date === ctx.today);
    if (!f) return reply('I need your roster for the last week to estimate fatigue.');
    const drivers = f.drivers.length ? f.drivers.slice(0, 3).map((d) => `• ${d.label}: ${d.detail} (+${d.points})`).join('\n') : '• Nothing stands out. Sleep and rest look on track.';
    const next = ctx.fatigue.filter((x) => x.date > ctx.today).sort((a, b) => b.score - a.score)[0];
    const ahead = next && next.score >= 50 ? `\n\nHeads up: ${dayName(next.date)} looks harder (${next.score}/100).` : '';
    return reply(
      `Fatigue today: ${f.score}/100 (${f.level}).\n${drivers}\n\nWhat to do:\n${f.recommendations.slice(0, 3).map((r) => `• ${r}`).join('\n') || '• Keep your current rhythm.'}${ahead}\n\nThis is a planning estimate, not medical advice.`,
      [],
      ['When can I study?', 'What should I do today?', 'How much free time do I have?'],
    );
  }

  if (/free time|spare time|how much time|available time|time do i have|report|summary/.test(q)) {
    const r = ctx.report;
    if (!r) return reply('No plan for this week yet. Set your shifts first.');
    const tod = r.byTimeOfDay;
    const best = r.topStretches[0];
    return reply(
      `This week, outside work and sleep: ${fmtDuration(r.discretionaryMin)}.\n• Planned for your goals: ${fmtDuration(r.activityMin)}\n• Unplanned free time: ${fmtDuration(r.freeMin)}\n• In 90+ minute stretches: ${fmtDuration(r.deepWorkMin)}\n• Mornings ${fmtDuration(tod.morning)}, afternoons ${fmtDuration(tod.afternoon)}, evenings ${fmtDuration(tod.evening)}${best ? `\n\nBiggest block: ${dayName(best.date)} ${fmtTime(best.start, s.hour12)}–${fmtTime(best.end, s.hour12)}.` : ''}`,
    );
  }

  const when = /(?:when (?:can|should|could) i|best time (?:to|for)|slots? for|time for)\s+(.+)$/.exec(q);
  if (when) {
    const what = (when[1] ?? '').replace(/^(do|go to|go|work on|the)\s+/, '');
    const a = findActivity(what, ctx.activities);
    const upcoming = ctx.weekPlans.filter((p) => p.date >= ctx.today);
    const nowMin = nowMinutes(ctx.now);
    const slots = upcoming.flatMap((p) =>
      p.blocks
        .filter((b) => (a ? b.activityId === a.id : b.type === 'free' && b.end - b.start >= 60))
        .filter((b) => p.date > ctx.today || b.end > nowMin)
        .map((b) => `• ${dayName(p.date, true)} ${blockLine(b, s).replace(/ {2}.+$/, '')} (${fmtDuration(b.end - b.start)})`),
    );
    if (!slots.length) {
      return reply(a ? `No ${a.name} time is left in this week's plan. Raise its priority or lower other targets.` : `I don't see free blocks of an hour or more for the rest of this week.`);
    }
    return reply(`${a ? `${a.name} slots` : 'Free blocks of 1h+'} for the rest of this week:\n${slots.slice(0, 8).join('\n')}`);
  }

  if (/tomorrow/.test(q)) {
    const date = addDays(ctx.today, 1);
    const p = ctx.weekPlans.find((x) => x.date === date);
    if (!p) return reply(describeDay(date, ctx));
    const lines = p.blocks.filter((b) => b.type !== 'buffer' && b.type !== 'break').map((b) => blockLine(b, s));
    return reply(`${describeDay(date, ctx)}\n${lines.join('\n')}`);
  }

  if (/\btoday\b|what'?s next|\bnow\b|schedule|plan|what should i do|agenda/.test(q)) {
    const p = ctx.weekPlans.find((x) => x.date === ctx.today);
    if (!p) return reply(describeDay(ctx.today, ctx));
    const nowMin = nowMinutes(ctx.now);
    const rest = p.blocks.filter((b) => b.end > nowMin && b.type !== 'buffer' && b.type !== 'break');
    const current = rest.find((b) => b.start <= nowMin);
    const head = current ? `Now: ${current.label} until ${fmtTime(current.end, s.hour12)}.` : 'Nothing scheduled right now.';
    const upcoming = rest.filter((b) => b !== current).slice(0, 6).map((b) => blockLine(b, s));
    const warn = p.notes.filter((n) => n.level === 'bad' || n.level === 'warn').map((n) => `⚠ ${n.title}. ${n.text}`);
    return reply([describeDay(ctx.today, ctx), head, upcoming.length ? `Next:\n${upcoming.join('\n')}` : 'That is everything for today.', ...warn].join('\n\n'));
  }

  if (/^(help|commands|\?|what can you do)/.test(q)) {
    return reply(
      'Things you can say:\n• set friday night office\n• tomorrow off\n• week m/h d/o n/h n/h off off g/h\n• clock in / clock out\n• start study / stop\n• log 2h freelance · log 7h sleep\n• add guitar 3h per week evening\n• how tired am I?\n• how much free time do I have?\n• when can I study?\n• what should I do today?',
    );
  }

  // Shift time question: "when is my next shift"
  if (/next shift|when do i work|work next/.test(q)) {
    for (let i = 0; i < 14; i++) {
      const date = addDays(ctx.today, i);
      const d = ctx.roster(date);
      if (!isWorkShift(d.code)) continue;
      const w = shiftWindow(d.code as 'M', s);
      const startMs = atMinutes(date, w.start);
      if (startMs <= ctx.now.getTime()) continue;
      const until = minutesSince(ctx.today, startMs) - nowMinutes(ctx.now);
      return reply(`Next: ${CODE_LABEL[d.code]} shift on ${dayName(date)} at ${fmtTime(w.start, s.hour12)} (${MODE_LABEL[d.mode]}), in ${fmtDuration(until)}.`);
    }
    return reply('No shifts in your roster for the next two weeks.');
  }

  return reply("I didn't catch that. Try one of these, or type help.");
}
