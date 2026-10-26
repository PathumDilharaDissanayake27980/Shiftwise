import { useState } from 'react';
import { CODE_LABEL, MODE_LABEL, isWorkShift } from '../../domain/defaults';
import { addDays, dayName, fmtDate, nowMinutes, parseISODate } from '../../domain/time';
import { DAY_CODES, WORK_MODES, type DayCode, type RosterDay, type WorkMode } from '../../domain/types';
import { repo } from '../../data/repo';
import { DayList, WeekGrid } from '../components/Timeline';
import { Icon, Notes, Section, Stat, useToast } from '../components/common';
import { useAppData } from '../data';
import { lessonIn } from '../../domain/ascend';
import { useAscendReport } from '../wiring';
import { errorMessage } from '../util';

const QUICK: Record<string, DayCode> = { m: 'M', d: 'D', n: 'N', g: 'G', off: 'OFF', x: 'OFF', l: 'LEAVE', leave: 'LEAVE', s: 'SICK', sick: 'SICK', hol: 'HOLIDAY', holiday: 'HOLIDAY' };
const QMODE: Record<string, WorkMode> = { h: 'H', o: 'O', m: 'MON', mon: 'MON' };

export function parseQuickFill(text: string, start: string): RosterDay[] | string {
  const tokens = text.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 7) return 'Enter 1 to 7 codes, one per day, starting with the first day of the week.';
  const out: RosterDay[] = [];
  for (const [i, t] of tokens.entries()) {
    const [c, m] = t.split(/[/-]/);
    const code = c ? QUICK[c] : undefined;
    const mode = m ? QMODE[m] : 'H';
    if (!code || !mode) return `"${t}" isn't a code I know. Use M, D, N, G or OFF, with /H or /O.`;
    out.push({ date: addDays(start, i), code, mode });
  }
  return out;
}

export function WeekScreen({ weekStartDate, setWeek }: { weekStartDate: string; setWeek: (d: string | null) => void }) {
  const { week, settings, activities, today, now, currentWeek } = useAppData();
  const report = useAscendReport();
  const toast = useToast();
  const bundle = week(weekStartDate);
  const [selected, setSelected] = useState<string>(() => (bundle.plans.some((p) => p.date === today) ? today : weekStartDate));
  const [quick, setQuick] = useState('');
  const selPlan = bundle.plans.find((p) => p.date === selected) ?? bundle.plans[0];

  const save = async (days: RosterDay[], msg?: string) => {
    try {
      await repo.setRosterDays(days);
      if (msg) toast(msg);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const onQuick = async () => {
    const r = parseQuickFill(quick, weekStartDate);
    if (typeof r === 'string') return toast(r, 'error');
    await save(r, `Roster updated for ${r.length} day${r.length > 1 ? 's' : ''}`);
    setQuick('');
  };

  const end = addDays(weekStartDate, 6);
  const rep = bundle.report;

  return (
    <div className="screen">
      <header className="page-head">
        <div>
          <p className="eyebrow">Roster & plan</p>
          <h1>
            {parseISODate(weekStartDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – {parseISODate(end).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </h1>
        </div>
        <div className="seg" role="group" aria-label="Change week">
          <button type="button" className="btn btn-icon" aria-label="Previous week" onClick={() => setWeek(addDays(weekStartDate, -7))}>
            <Icon name="chevL" />
          </button>
          <button type="button" className="btn" disabled={weekStartDate === currentWeek} onClick={() => setWeek(null)}>
            This week
          </button>
          <button type="button" className="btn btn-icon" aria-label="Next week" onClick={() => setWeek(addDays(weekStartDate, 7))}>
            <Icon name="chevR" />
          </button>
        </div>
      </header>

      <Section title="Shifts">
        <div className="day-editors">
          {bundle.plans.map((p) => (
            <div key={p.date} className={p.date === today ? 'day-ed is-today' : 'day-ed'}>
              <label htmlFor={`code-${p.date}`}>
                {dayName(p.date, true)} <small>{parseISODate(p.date).getDate()}</small>
              </label>
              <select id={`code-${p.date}`} value={p.code} onChange={(e) => save([{ date: p.date, code: e.target.value as DayCode, mode: p.mode }])}>
                {DAY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {CODE_LABEL[c]}
                  </option>
                ))}
              </select>
              <select
                id={`mode-${p.date}`}
                aria-label={`${dayName(p.date)} location`}
                value={p.mode}
                disabled={!isWorkShift(p.code)}
                onChange={(e) => save([{ date: p.date, code: p.code, mode: e.target.value as WorkMode }])}
              >
                {WORK_MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <form
          className="quick"
          onSubmit={(e) => {
            e.preventDefault();
            void onQuick();
          }}
        >
          <label htmlFor="quick">Quick fill from your roster row</label>
          <div className="row">
            <input id="quick" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="m/h d/o n/h n/h off off g/h" autoComplete="off" spellCheck={false} maxLength={120} />
            <button type="submit" className="btn btn-primary">
              Apply
            </button>
          </div>
          <p className="hint">One code per day from {dayName(weekStartDate)}: M, D, N, G or OFF. Add /O for office, /H for home, /M for monitoring.</p>
        </form>
      </Section>

      <div className="stats">
        <Stat value={`${(rep.scheduledWorkMin / 60).toFixed(0)}h`} label="Scheduled work" />
        <Stat value={`${(rep.activityMin / 60).toFixed(1)}h`} label="Planned for goals" />
        <Stat value={`${(rep.freeMin / 60).toFixed(1)}h`} label="Free time left" />
        <Stat value={`${(rep.avgPlannedSleepMin / 60).toFixed(1)}h`} label="Sleep a day" />
      </div>

      <Section title="Week timetable" aside={<span className="hint">Tap a day for details</span>}>
        <WeekGrid plans={bundle.plans} activities={activities} settings={settings} today={today} nowMin={nowMinutes(now)} selected={selected} onSelect={setSelected} />
      </Section>

      {selPlan ? (
        <Section title={fmtDate(selPlan.date)}>
          <div className="split">
            <DayList plan={selPlan} activities={activities} settings={settings} lesson={(st, en) => lessonIn(report, selPlan.date, st, en)} {...(selPlan.date === today ? { nowMin: nowMinutes(now) } : {})} />
            <Notes notes={selPlan.notes.length ? selPlan.notes : [{ level: 'good', title: 'No warnings', text: 'Shift changeovers around this day leave enough rest.' }]} />
          </div>
        </Section>
      ) : null}
    </div>
  );
}
