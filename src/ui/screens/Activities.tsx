import { useState, type FormEvent } from 'react';
import { growthSuggestions } from '../../domain/growth';
import { GROWTH_LEVELS, LEVELS, type GrowthLevel } from '../../domain/defaults';
import { addDays, atMinutes, fmtDuration, fmtTime } from '../../domain/time';
import { ACTIVITY_COLORS, ACTIVITY_KINDS, ASCEND_LINKS, TIME_PREFS, type Activity, type ActivityKind, type AscendLink, type FixedSlot, type TimePref } from '../../domain/types';
import { repo } from '../../data/repo';
import { Empty, Icon, Meter, Section, useToast } from '../components/common';
import { LINK_LABEL } from '../ascend';
import { useAppData } from '../data';
import { cx, errorMessage, fromTimeInput, toTimeInput } from '../util';

const KIND_LABEL: Record<ActivityKind, string> = { focus: 'Focus work', light: 'Light', fitness: 'Fitness', personal: 'Personal' };
const PREF_LABEL: Record<TimePref, string> = { morning: 'Mornings', afternoon: 'Afternoons', evening: 'Evenings', any: 'Any time' };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Draft = Omit<Activity, 'id' | 'createdAt'> & { id?: string; createdAt?: number };

const blank = (): Draft => ({ name: '', kind: 'focus', color: 'green', weeklyTargetMin: 180, minBlockMin: 60, maxBlockMin: 120, preferred: 'any', priority: 3, active: true, fixed: [] });

export function ActivitiesScreen() {
  const { activities, week, currentWeek, settings } = useAppData();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pickLevel, setPickLevel] = useState<GrowthLevel | null>(null);
  const stats = week(currentWeek).report.activities;
  const growth = growthSuggestions(week(addDays(currentWeek, -7)).report.activities, atMinutes(addDays(currentWeek, -7), 0));
  const [applied, setApplied] = useState<string[]>([]);

  const applyGrowth = async (a: Activity, to: number) => {
    try {
      await repo.saveActivity({ ...a, weeklyTargetMin: to });
      setApplied((x) => [...x, a.id]);
      toast(`${a.name}: ${fmtDuration(to)} a week from now on.`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    try {
      const { id, createdAt, ...rest } = draft;
      await repo.saveActivity({ ...rest, ...(id ? { id } : {}), ...(createdAt ? { createdAt } : {}) });
      toast(id ? 'Activity updated' : 'Activity added');
      setDraft(null);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const toggle = async (a: Activity) => {
    try {
      await repo.saveActivity({ ...a, active: !a.active });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const chooseLevel = async (level: GrowthLevel) => {
    try {
      const r = await repo.applyBalancedPlan(Date.now(), level);
      toast(`${LEVELS[level].label} week on: ${r.added} added, ${r.updated} updated${r.paused ? `, ${r.paused} paused (not deleted)` : ''}. Ascend updates by itself.`);
      setPickLevel(null);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const remove = async (id: string) => {
    await repo.deleteActivity(id);
    setConfirmDelete(null);
    setDraft(null);
    toast('Activity deleted. Its past log entries are kept.');
  };

  const setSlot = (i: number, patch: Partial<FixedSlot>) => setDraft((d) => (d ? { ...d, fixed: d.fixed.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d));

  return (
    <div className="screen">
      <header className="page-head">
        <div>
          <p className="eyebrow">Your other work</p>
          <h1>Activities & weekly goals</h1>
        </div>
        <span className="row">
          <button type="button" className="btn btn-primary" onClick={() => setDraft(blank())}>
            <Icon name="plus" size={16} /> Add activity
          </button>
        </span>
      </header>
      <p className="lede">The planner spreads each weekly goal across the free stretches your shifts leave, within each day's focus budget, and always keeps part of every day free. Fixed slots, like a class, are placed before anything else.</p>


      <div className="card levels">
        <h3>Learning intensity</h3>
        <p className="muted">Sets your weekly goals and how much focus work each kind of shift day can carry. Every level keeps sleep, exercise, people, a daily review and a recharge day.</p>
        <div className="level-grid">
          {GROWTH_LEVELS.map((lv) => {
            const L = LEVELS[lv];
            const growth = L.learn + L.build + L.cert + 140;
            return (
              <button key={lv} type="button" className={cx('level', settings.growthLevel === lv && 'is-on', pickLevel === lv && 'is-picked')} onClick={() => setPickLevel(lv)}>
                <b>{L.label}</b>
                <span className="level-h">{Math.round(growth / 60)}h / week</span>
                <span className="hint">
                  {fmtDuration(L.learn)} lessons · {fmtDuration(L.build)} project · {fmtDuration(L.cert)} exam prep · daily review
                </span>
                <span className="hint">{L.summary}</span>
                {settings.growthLevel === lv ? <em className="tag tag-now">current</em> : null}
              </button>
            );
          })}
        </div>
        {pickLevel ? (
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => chooseLevel(pickLevel)}>
              Use {LEVELS[pickLevel].label}
            </button>
            <button type="button" className="btn" onClick={() => setPickLevel(null)}>
              Cancel
            </button>
            <span className="hint">Activities with the same names are updated; others are paused, never deleted.</span>
          </div>
        ) : null}
      </div>

      {growth.some((g) => !applied.includes(g.activity.id)) ? (
        <div className="card growth">
          <h3>Weekly growth check</h3>
          <p className="muted">Based on what you logged last week (Ascend sessions count automatically).</p>
          {growth
            .filter((g) => !applied.includes(g.activity.id))
            .map((g) => (
              <div key={g.activity.id} className={cx('growth-row', `growth-${g.kind}`)}>
                <div>
                  <b>
                    {g.kind === 'up' ? '▲' : '▼'} {g.activity.name}: {fmtDuration(g.from)} → {fmtDuration(g.to)}
                  </b>
                  <p className="hint">{g.reason}</p>
                </div>
                <button type="button" className={cx('btn btn-small', g.kind === 'up' && 'btn-primary')} onClick={() => applyGrowth(g.activity, g.to)}>
                  Apply
                </button>
              </div>
            ))}
        </div>
      ) : null}

      {draft ? (
        <Section title={draft.id ? `Edit ${draft.name || 'activity'}` : 'New activity'}>
          <form className="form-grid" onSubmit={save}>
            <div className="field field-wide">
              <label htmlFor="ac-name">Name</label>
              <input id="ac-name" value={draft.name} maxLength={60} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. AWS certification" />
            </div>
            <div className="field">
              <label htmlFor="ac-kind">Kind</label>
              <select id="ac-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ActivityKind })}>
                {ACTIVITY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ac-target">Hours per week</label>
              <input id="ac-target" type="number" min={0} max={80} step={0.5} value={draft.weeklyTargetMin / 60} onChange={(e) => setDraft({ ...draft, weeklyTargetMin: Math.round(Number(e.target.value) * 60) })} />
            </div>
            <div className="field">
              <label htmlFor="ac-min">Shortest block (min)</label>
              <input id="ac-min" type="number" min={15} max={480} step={15} value={draft.minBlockMin} onChange={(e) => setDraft({ ...draft, minBlockMin: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label htmlFor="ac-max">Longest block (min)</label>
              <input id="ac-max" type="number" min={15} max={480} step={15} value={draft.maxBlockMin} onChange={(e) => setDraft({ ...draft, maxBlockMin: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label htmlFor="ac-pref">Best time</label>
              <select id="ac-pref" value={draft.preferred} onChange={(e) => setDraft({ ...draft, preferred: e.target.value as TimePref })}>
                {TIME_PREFS.map((p) => (
                  <option key={p} value={p}>
                    {PREF_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ac-link">Sends to Ascend as</label>
              <select
                id="ac-link"
                value={draft.link ?? ''}
                onChange={(e) => {
                  const next: Draft = { ...draft };
                  delete next.link;
                  setDraft(e.target.value ? { ...next, link: e.target.value as AscendLink } : next);
                }}
              >
                <option value="">Not sent</option>
                {ASCEND_LINKS.map((l) => (
                  <option key={l} value={l}>
                    {LINK_LABEL[l]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ac-pri">Priority: {draft.priority}</label>
              <input id="ac-pri" type="range" min={1} max={5} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} />
            </div>
            <fieldset className="field field-wide colors">
              <legend>Colour</legend>
              {ACTIVITY_COLORS.map((c) => (
                <label key={c} className={cx('swatch', `chip-${c}`, draft.color === c && 'is-on')}>
                  <input type="radio" name="color" value={c} checked={draft.color === c} onChange={() => setDraft({ ...draft, color: c })} />
                  <span className="sr-only">{c}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="field field-wide">
              <legend>Fixed weekly slots (optional)</legend>
              {draft.fixed.map((s, i) => (
                <div key={i} className="slot-row">
                  <select aria-label="Day" value={s.weekday} onChange={(e) => setSlot(i, { weekday: Number(e.target.value) })}>
                    {WEEKDAYS.map((d, j) => (
                      <option key={d} value={j}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input aria-label="Starts" type="time" value={toTimeInput(s.start)} onChange={(e) => setSlot(i, { start: fromTimeInput(e.target.value) ?? s.start })} />
                  <input aria-label="Ends" type="time" value={toTimeInput(s.end)} onChange={(e) => setSlot(i, { end: fromTimeInput(e.target.value) ?? s.end })} />
                  <button type="button" className="btn btn-icon btn-ghost" aria-label="Remove slot" onClick={() => setDraft({ ...draft, fixed: draft.fixed.filter((_, j) => j !== i) })}>
                    <Icon name="x" size={16} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-small" onClick={() => setDraft({ ...draft, fixed: [...draft.fixed, { weekday: 6, start: 9 * 60, end: 11 * 60 }] })}>
                <Icon name="plus" size={14} /> Add a fixed slot
              </button>
            </fieldset>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                {draft.id ? 'Save' : 'Add activity'}
              </button>
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              {draft.id ? (
                confirmDelete === draft.id ? (
                  <button type="button" className="btn btn-danger" onClick={() => remove(draft.id as string)}>
                    Confirm delete
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(draft.id ?? null)}>
                    Delete
                  </button>
                )
              ) : null}
            </div>
          </form>
        </Section>
      ) : null}

      {activities.length === 0 ? (
        <Empty title="No activities yet">Add the things you want to fit around your shifts: study, freelance work, gym, projects.</Empty>
      ) : (
        <div className="act-list">
          {activities.map((a) => {
            const st = stats.find((s) => s.activity.id === a.id);
            return (
              <article key={a.id} className={cx('act', !a.active && 'is-off')}>
                <span className={cx('act-sw', `chip-${a.color}`)} />
                <div className="act-main">
                  <h3>{a.name}</h3>
                  <p className="muted">
                    {KIND_LABEL[a.kind]}{a.link ? ` → Ascend ${LINK_LABEL[a.link].toLowerCase()}` : ''} · {(a.weeklyTargetMin / 60).toFixed(1)}h a week · {PREF_LABEL[a.preferred]} · priority {a.priority}
                    {a.fixed.length ? ` · fixed ${a.fixed.map((s) => `${WEEKDAYS[s.weekday]} ${fmtTime(s.start, settings.hour12)}`).join(', ')}` : ''}
                  </p>
                  {st && a.active ? (
                    <div className="act-progress">
                      <Meter value={st.plannedMin} max={st.targetMin} label={`${a.name} planned versus goal`} />
                      <span className="hint">
                        {(st.plannedMin / 60).toFixed(1)}h planned · {(st.loggedMin / 60).toFixed(1)}h logged this week
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="act-side">
                  <label className="switch">
                    <input type="checkbox" checked={a.active} onChange={() => toggle(a)} />
                    <span>{a.active ? 'On' : 'Paused'}</span>
                  </label>
                  <button type="button" className="btn btn-icon btn-ghost" aria-label={`Edit ${a.name}`} onClick={() => setDraft({ ...a })}>
                    <Icon name="edit" size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
