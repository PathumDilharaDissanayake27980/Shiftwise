import { useMemo, useState, type FormEvent } from 'react';
import { CODE_LABEL, isWorkShift } from '../../domain/defaults';
import { shiftWindow } from '../../domain/schedule';
import { addDays, atMinutes, fmtDate, fmtDuration, fmtTime, minutesSince, toISODate } from '../../domain/time';
import { LOG_CATEGORIES, type LogCategory, type TimeLog } from '../../domain/types';
import { repo } from '../../data/repo';
import { Empty, Icon, Section, Stat, useToast } from '../components/common';
import { useAppData } from '../data';
import { errorMessage, fromDateTimeInput, toDateTimeInput } from '../util';

const CAT_LABEL: Record<LogCategory, string> = { shift: 'Shift', sleep: 'Sleep', activity: 'Activity', break: 'Break' };

interface Draft {
  id?: string;
  category: LogCategory;
  activityId: string;
  shiftDate: string;
  start: string;
  end: string;
  note: string;
}

function emptyDraft(today: string, activityId: string): Draft {
  const end = Date.now();
  return { category: 'activity', activityId, shiftDate: today, start: toDateTimeInput(end - 3_600_000), end: toDateTimeInput(end), note: '' };
}

export function LogScreen() {
  const { logs, activities, settings, today, roster, week, currentWeek } = useAppData();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(today, activities[0]?.id ?? ''));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const from = atMinutes(addDays(today, -13), 0);
  const recent = useMemo(() => [...logs].filter((l) => l.start >= from).sort((a, b) => b.start - a.start), [logs, from]);
  const byDay = useMemo(() => {
    const m = new Map<string, TimeLog[]>();
    for (const l of recent) {
      const d = toISODate(new Date(l.start));
      m.set(d, [...(m.get(d) ?? []), l]);
    }
    return [...m.entries()];
  }, [recent]);

  const rep = week(currentWeek).report;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const start = fromDateTimeInput(draft.start);
    const end = fromDateTimeInput(draft.end);
    if (start === null || end === null) return toast('Enter a start and end time.', 'error');
    try {
      await repo.saveLog({
        ...(draft.id ? { id: draft.id } : {}),
        category: draft.category,
        start,
        end,
        ...(draft.category === 'activity' ? { activityId: draft.activityId } : {}),
        ...(draft.category === 'shift' ? { shiftDate: draft.shiftDate } : {}),
        ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      });
      toast(draft.id ? 'Entry updated' : 'Entry added');
      setDraft(emptyDraft(today, draft.activityId));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const edit = (l: TimeLog) =>
    setDraft({
      id: l.id,
      category: l.category,
      activityId: l.activityId ?? activities[0]?.id ?? '',
      shiftDate: l.shiftDate ?? toISODate(new Date(l.start)),
      start: toDateTimeInput(l.start),
      end: toDateTimeInput(l.end ?? Date.now()),
      note: l.note ?? '',
    });

  const remove = async (id: string) => {
    try {
      await repo.deleteLog(id);
      toast('Entry deleted');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const describe = (l: TimeLog) => {
    if (l.category === 'activity') return activities.find((a) => a.id === l.activityId)?.name ?? 'Deleted activity';
    if (l.category === 'shift' && l.shiftDate) {
      const d = roster(l.shiftDate);
      return isWorkShift(d.code) ? `${CODE_LABEL[d.code]} shift` : 'Extra shift';
    }
    return CAT_LABEL[l.category];
  };

  const variance = (l: TimeLog) => {
    if (l.category !== 'shift' || !l.shiftDate || l.end === null) return null;
    const d = roster(l.shiftDate);
    if (!isWorkShift(d.code)) return null;
    const w = shiftWindow(d.code as 'M', settings);
    const late = minutesSince(l.shiftDate, l.start) - w.start;
    const over = (l.end - l.start) / 60_000 - (w.end - w.start);
    const parts = [];
    if (Math.abs(late) >= 5) parts.push(late > 0 ? `started ${fmtDuration(late)} late` : `started ${fmtDuration(-late)} early`);
    if (over >= 5) parts.push(`${fmtDuration(over)} overtime`);
    return parts.join(' · ') || 'on schedule';
  };

  return (
    <div className="screen">
      <header className="page-head">
        <div>
          <p className="eyebrow">Time log</p>
          <h1>Hours you actually worked</h1>
        </div>
      </header>

      <div className="stats">
        <Stat value={`${(rep.loggedWorkMin / 60).toFixed(1)}h`} label="Logged work this week" sub={`of ${(rep.scheduledWorkMin / 60).toFixed(0)}h scheduled`} />
        <Stat value={fmtDuration(rep.overtimeMin)} label="Overtime" />
        <Stat value={`${rep.shiftsLogged}/${rep.shiftsScheduled}`} label="Shifts logged" />
        <Stat value={`${(rep.activities.reduce((t, a) => t + a.loggedMin, 0) / 60).toFixed(1)}h`} label="Goal time logged" />
      </div>

      <Section title={draft.id ? 'Edit entry' : 'Add an entry'} id="log-form">
        <form className="form-grid" onSubmit={submit}>
          <div className="field">
            <label htmlFor="lg-cat">Type</label>
            <select id="lg-cat" value={draft.category} onChange={(e) => set({ category: e.target.value as LogCategory })}>
              {LOG_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CAT_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          {draft.category === 'activity' ? (
            <div className="field">
              <label htmlFor="lg-act">Activity</label>
              <select id="lg-act" value={draft.activityId} onChange={(e) => set({ activityId: e.target.value })}>
                {activities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {draft.category === 'shift' ? (
            <div className="field">
              <label htmlFor="lg-sd">Rostered date</label>
              <input id="lg-sd" type="date" value={draft.shiftDate} onChange={(e) => set({ shiftDate: e.target.value })} required />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="lg-start">Start</label>
            <input id="lg-start" type="datetime-local" value={draft.start} onChange={(e) => set({ start: e.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="lg-end">End</label>
            <input id="lg-end" type="datetime-local" value={draft.end} onChange={(e) => set({ end: e.target.value })} required />
          </div>
          <div className="field field-wide">
            <label htmlFor="lg-note">Note (optional)</label>
            <input id="lg-note" value={draft.note} maxLength={500} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. stayed late for an incident" />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              {draft.id ? 'Save changes' : 'Add entry'}
            </button>
            {draft.id ? (
              <button type="button" className="btn" onClick={() => setDraft(emptyDraft(today, draft.activityId))}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </Section>

      <Section title="Last 14 days">
        {byDay.length === 0 ? (
          <Empty title="Nothing logged yet">Clock in on the Today page, start an activity timer, or add an entry above.</Empty>
        ) : (
          <div className="log-days">
            {byDay.map(([date, items]) => (
              <div key={date} className="log-day">
                <h3>{fmtDate(date)}</h3>
                <ul>
                  {items.map((l) => (
                    <li key={l.id} className="log-row">
                      <span className={`dot dot-${l.category}`} />
                      <span className="log-what">
                        <b>{describe(l)}</b>
                        <span className="muted">
                          {fmtTime(minutesSince(date, l.start), settings.hour12)} – {l.end === null ? 'running' : fmtTime(minutesSince(date, l.end), settings.hour12)}
                          {variance(l) ? ` · ${variance(l)}` : ''}
                          {l.note ? ` · ${l.note}` : ''}
                        </span>
                      </span>
                      <span className="log-dur">{l.end === null ? '…' : fmtDuration((l.end - l.start) / 60_000)}</span>
                      {l.end !== null ? (
                        <span className="log-actions">
                          <button type="button" className="btn btn-icon btn-ghost" aria-label="Edit entry" onClick={() => edit(l)}>
                            <Icon name="edit" size={16} />
                          </button>
                          <button type="button" className="btn btn-icon btn-ghost" aria-label="Delete entry" onClick={() => remove(l.id)}>
                            <Icon name="trash" size={16} />
                          </button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
