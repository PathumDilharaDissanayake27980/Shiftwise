import { CODE_LABEL } from '../../domain/defaults';
import { levelFor } from '../../domain/fatigue';
import { changeover } from '../../domain/schedule';
import { addDays, dayName, fmtDuration, parseISODate } from '../../domain/time';
import type { DayCode, PlanNote } from '../../domain/types';
import { FatigueGauge, Icon, Meter, Notes, Section, Stat } from '../components/common';
import { useAppData } from '../data';
import { cx } from '../util';

const MATRIX_CODES: DayCode[] = ['M', 'D', 'N', 'G', 'OFF'];

export function InsightsScreen({ weekStartDate, setWeek }: { weekStartDate: string; setWeek: (d: string | null) => void }) {
  const { week, today, settings, currentWeek } = useAppData();
  const bundle = week(weekStartDate);
  const prev = week(addDays(weekStartDate, -7));
  const r = bundle.report;
  const trend = [...prev.fatigue, ...bundle.fatigue];
  const focus = bundle.fatigue.find((f) => f.date === today) ?? r.fatiguePeak ?? bundle.fatigue[0];
  const tod = r.byTimeOfDay;
  const todMax = Math.max(1, tod.morning, tod.afternoon, tod.evening, tod.night);

  return (
    <div className="screen">
      <header className="page-head">
        <div>
          <p className="eyebrow">Analysis</p>
          <h1>Energy & free time</h1>
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

      {focus ? (
        <Section title={focus.date === today ? 'Fatigue risk today' : `Fatigue risk, ${dayName(focus.date)}`}>
          <div className="fatigue">
            <FatigueGauge score={focus.score} level={focus.level} size={160} />
            <div className="fatigue-body">
              {focus.drivers.length ? (
                <ul className="drivers">
                  {focus.drivers.map((d) => (
                    <li key={d.key}>
                      <span>
                        <b>{d.label}</b> <span className="muted">{d.detail}</span>
                      </span>
                      <span className="pts">+{d.points}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No fatigue drivers stand out. Sleep and rest look on track.</p>
              )}
              {focus.recommendations.length ? (
                <>
                  <h3>What helps</h3>
                  <ul className="recs">
                    {focus.recommendations.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </div>
          <FatigueTrend points={trend.map((f) => ({ date: f.date, score: f.score }))} today={today} />
          <p className="disclaimer">
            The score is a planning estimate built from sleep, night work, rest between shifts and workload. It is not a medical assessment. If you feel unsafe to work or drive, rest first and talk to your lead or a doctor.
          </p>
        </Section>
      ) : null}

      <div className="stats">
        <Stat value={fmtDuration(r.discretionaryMin)} label="Outside work & sleep" />
        <Stat value={fmtDuration(r.deepWorkMin)} label="In 90+ min stretches" />
        <Stat value={fmtDuration(r.activityMin)} label="Planned for goals" />
        <Stat value={fmtDuration(r.freeMin)} label="Unplanned free time" />
      </div>

      <Notes notes={r.insights} />

      <Section title="How each day is spent">
        <div className="daybars">
          {r.days.map((d) => {
            const sleep = d.sleepMin;
            const total = Math.max(1, d.workMin + sleep + d.activityMin + d.freeMin);
            const other = Math.max(0, 1440 - total);
            const seg = (min: number) => `${(min / 1440) * 100}%`;
            return (
              <div key={d.date} className="daybar">
                <span className="daybar-k">
                  {dayName(d.date, true)} <small>{CODE_LABEL[d.code]}</small>
                </span>
                <div className="daybar-track" role="img" aria-label={`${dayName(d.date)}: work ${fmtDuration(d.workMin)}, sleep ${fmtDuration(sleep)}, goals ${fmtDuration(d.activityMin)}, free ${fmtDuration(d.freeMin)}`}>
                  <span className="ds ds-work" style={{ width: seg(d.workMin) }} />
                  <span className="ds ds-sleep" style={{ width: seg(sleep) }} />
                  <span className="ds ds-goal" style={{ width: seg(d.activityMin) }} />
                  <span className="ds ds-free" style={{ width: seg(d.freeMin) }} />
                  <span className="ds ds-other" style={{ width: seg(other) }} />
                </div>
                <span className="daybar-v">{fmtDuration(d.activityMin + d.freeMin)} free</span>
              </div>
            );
          })}
          <div className="legend-row">
            <span><i className="ds-work" /> Work</span>
            <span><i className="ds-sleep" /> Sleep</span>
            <span><i className="ds-goal" /> Goals</span>
            <span><i className="ds-free" /> Free</span>
            <span><i className="ds-other" /> Meals, travel, routine</span>
          </div>
        </div>
      </Section>

      <div className="cards-2">
        <Section title="When your free time falls">
          <div className="tod">
            {(
              [
                ['Morning', '6 AM – 12 PM', tod.morning],
                ['Afternoon', '12 – 5 PM', tod.afternoon],
                ['Evening', '5 – 10 PM', tod.evening],
                ['Late night', '10 PM – 6 AM', tod.night],
              ] as const
            ).map(([k, sub, v]) => (
              <div key={k} className="tod-row">
                <span>
                  {k} <small className="muted">{sub}</small>
                </span>
                <Meter value={v} max={todMax} label={`${k} free time`} />
                <span className="tod-v">{fmtDuration(v)}</span>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Goals this week">
          <div className="tod">
            {r.activities.map((a) => (
              <div key={a.activity.id} className="tod-row">
                <span>{a.activity.name}</span>
                <Meter value={a.plannedMin} max={a.targetMin} tone={a.plannedMin < a.targetMin * 0.8 ? 'meter-warn' : undefined} label={`${a.activity.name} planned`} />
                <span className="tod-v">
                  {(a.plannedMin / 60).toFixed(1)}/{(a.targetMin / 60).toFixed(1)}h
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Work hours">
        <div className="stats">
          <Stat value={`${(r.scheduledWorkMin / 60).toFixed(0)}h`} label="Scheduled" />
          <Stat value={`${(r.loggedWorkMin / 60).toFixed(1)}h`} label="Logged" sub={`${r.shiftsLogged} of ${r.shiftsScheduled} shifts`} />
          <Stat value={fmtDuration(r.overtimeMin)} label="Overtime" />
          <Stat value={`${(r.avgPlannedSleepMin / 60).toFixed(1)}h`} label="Planned sleep a day" sub={r.avgLoggedSleepMin !== null ? `${(r.avgLoggedSleepMin / 60).toFixed(1)}h logged` : 'log sleep to compare'} />
        </div>
      </Section>

      <Section title="Every shift changeover">
        <p className="hint">Rest between the end of one shift and the start of the next, working from home. Hover or tap a cell for advice.</p>
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th scope="col">Today ↓ / Tomorrow →</th>
                {MATRIX_CODES.map((c) => (
                  <th key={c} scope="col">
                    {CODE_LABEL[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX_CODES.map((a) => (
                <tr key={a}>
                  <th scope="row">{CODE_LABEL[a]}</th>
                  {MATRIX_CODES.map((b) => {
                    const c = changeover({ date: '2000-01-01', code: a, mode: 'H' }, { date: '2000-01-02', code: b, mode: 'H' }, settings);
                    return (
                      <td key={b} className={cx(`v-${c.verdict}`)} title={c.advice} tabIndex={0}>
                        <span className="mx-gap">{c.restMin === null ? '—' : c.restMin <= 0 ? 'overlap' : fmtDuration(c.restMin)}</span>
                        <span className="mx-v">{c.verdict}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Notes
          notes={MATRIX_CODES.flatMap((a) =>
            MATRIX_CODES.map((b) => ({ a, b, c: changeover({ date: '2000-01-01', code: a, mode: 'H' }, { date: '2000-01-02', code: b, mode: 'H' }, settings) })),
          )
            .filter((x) => x.c.verdict === 'tight' || x.c.verdict === 'bad')
            .map((x): PlanNote => ({ level: x.c.verdict === 'bad' ? 'bad' : 'warn', title: `${CODE_LABEL[x.a]} → ${CODE_LABEL[x.b]}`, text: x.c.advice }))}
        />
      </Section>
    </div>
  );
}

function FatigueTrend({ points, today }: { points: { date: string; score: number }[]; today: string }) {
  const w = 640;
  const h = 150;
  const padL = 28;
  const padB = 22;
  const bw = (w - padL) / Math.max(1, points.length);
  const y = (v: number) => (h - padB) * (1 - v / 100);
  return (
    <div className="trend">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Fatigue score over the last two weeks" preserveAspectRatio="none">
        {[0, 30, 50, 70, 100].map((t) => (
          <g key={t}>
            <line x1={padL} x2={w} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 6} y={y(t) + 4} className="axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = padL + i * bw + bw * 0.18;
          return (
            <g key={p.date}>
              <rect x={x} y={y(p.score)} width={bw * 0.64} height={Math.max(1, h - padB - y(p.score))} rx={3} className={cx('bar', `lvl-${levelFor(p.score)}`, p.date === today && 'is-today')}>
                <title>{`${p.date}: ${p.score}`}</title>
              </rect>
              <text x={x + bw * 0.32} y={h - 6} className={cx('axis', p.date === today && 'axis-today')} textAnchor="middle">
                {dayName(p.date, true).slice(0, 2)}
                {parseISODate(p.date).getDate()}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

