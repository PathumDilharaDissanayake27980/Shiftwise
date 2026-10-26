import { CODE_LABEL, MODE_LABEL, isWorkShift } from '../../domain/defaults';
import { dayName, fmtDuration, fmtTime, parseISODate } from '../../domain/time';
import type { Activity, DayPlan, Settings } from '../../domain/types';
import { blockClass, cx } from '../util';

function colorOf(activities: Activity[], id?: string) {
  return activities.find((a) => a.id === id)?.color;
}

/** Hour-by-hour list for one day, with a "now" marker when it is today. */
export function DayList({
  plan,
  activities,
  settings,
  nowMin,
  lesson,
}: {
  plan: DayPlan;
  activities: Activity[];
  settings: Settings;
  nowMin?: number;
  /** The Ascend lesson placed in a block, when Ascend has reported it. */
  lesson?: (start: number, end: number) => { title: string; task: string } | null;
}) {
  const blocks = plan.blocks.filter((b) => b.type !== 'buffer');
  return (
    <ol className="daylist">
      {blocks.map((b, i) => {
        const current = nowMin !== undefined && nowMin >= b.start && nowMin < b.end;
        const past = nowMin !== undefined && nowMin >= b.end;
        return (
          <li key={i} className={cx('dl-row', current && 'is-now', past && 'is-past')} aria-current={current ? 'time' : undefined}>
            <span className="dl-time">
              {fmtTime(b.start, settings.hour12)}
              <span className="dl-to"> – {fmtTime(b.end, settings.hour12)}</span>
            </span>
            <span className={cx('dl-sw', blockClass(b, colorOf(activities, b.activityId)))} />
            <span className="dl-label">
              {b.label}
              {b.fixed ? <em className="tag">fixed</em> : null}
              {current ? <em className="tag tag-now">now</em> : null}
              {b.type === 'activity' && lesson ? <LessonLine l={lesson(b.start, b.end)} /> : null}
            </span>
            <span className="dl-dur">{fmtDuration(b.end - b.start)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function LessonLine({ l }: { l: { title: string; task: string } | null }) {
  if (!l) return null;
  return (
    <small className="dl-lesson">
      <b>{l.title}</b>
      {l.task ? <span> · {l.task}</span> : null}
    </small>
  );
}

/** Seven-column, 24-hour grid of a week's plans. */
export function WeekGrid({
  plans,
  activities,
  settings,
  today,
  nowMin,
  selected,
  onSelect,
}: {
  plans: DayPlan[];
  activities: Activity[];
  settings: Settings;
  today: string;
  nowMin: number;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const hours = Array.from({ length: 12 }, (_, i) => i * 2);
  return (
    <div className="wg-scroll">
      <div className="wg" style={{ gridTemplateColumns: `44px repeat(${plans.length}, minmax(96px, 1fr))` }}>
        <div className="wg-head wg-corner" />
        {plans.map((p) => (
          <button
            key={p.date}
            type="button"
            className={cx('wg-head', p.date === selected && 'is-sel', p.date === today && 'is-today')}
            onClick={() => onSelect(p.date)}
            aria-pressed={p.date === selected}
          >
            <span className="wg-day">
              {dayName(p.date, true)} <small>{parseISODate(p.date).getDate()}</small>
            </span>
            <span className={cx('wg-code', isWorkShift(p.code) && `code-${p.code}`)}>
              {CODE_LABEL[p.code]}
              {isWorkShift(p.code) ? ` · ${MODE_LABEL[p.mode]}` : ''}
            </span>
          </button>
        ))}
        <div className="wg-axis" aria-hidden="true">
          {hours.map((h) => (
            <span key={h} style={{ top: `calc(${h} * var(--hr))` }}>
              {settings.hour12 ? (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`) : `${String(h).padStart(2, '0')}`}
            </span>
          ))}
        </div>
        {plans.map((p) => (
          <div
            key={p.date}
            className={cx('wg-col', p.date === selected && 'is-sel')}
            onClick={() => onSelect(p.date)}
            role="presentation"
          >
            {p.blocks
              .filter((b) => b.type !== 'buffer')
              .map((b, i) => {
                const h = (b.end - b.start) / 60;
                return (
                  <div
                    key={i}
                    className={cx('wg-blk', blockClass(b, colorOf(activities, b.activityId)))}
                    style={{ top: `calc(${b.start / 60} * var(--hr))`, height: `calc(${h} * var(--hr) - 2px)` }}
                    title={`${fmtTime(b.start, settings.hour12)} – ${fmtTime(b.end, settings.hour12)} · ${b.label}`}
                  >
                    {h >= 0.75 ? <span className="wg-lbl">{b.label}</span> : null}
                    {h >= 1.5 ? <span className="wg-t">{fmtTime(b.start, settings.hour12)}</span> : null}
                  </div>
                );
              })}
            {p.date === today ? <div className="wg-now" style={{ top: `calc(${nowMin / 60} * var(--hr))` }} aria-hidden="true" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
