import { CODE_LABEL, MODE_LABEL, isWorkShift } from '../../domain/defaults';
import { shiftWindow } from '../../domain/schedule';
import { MIN_PER_DAY, addDays, fmtDate, fmtDuration, fmtTime, minutesSince, nowMinutes } from '../../domain/time';
import { repo } from '../../data/repo';
import { DayList } from '../components/Timeline';
import { Empty, FatigueGauge, Icon, Notes, Section, useToast } from '../components/common';
import { AscendCard } from '../ascend';
import { lessonIn } from '../../domain/ascend';
import { useAscendReport } from '../wiring';
import { useAppData } from '../data';
import { cx, errorMessage } from '../util';

export function TodayScreen({ go }: { go: (route: string) => void }) {
  const { today, now, settings, roster, todayPlan, todayFatigue, activities, running } = useAppData();
  const toast = useToast();
  const report = useAscendReport();
  const nowMin = nowMinutes(now);
  const day = roster(today);
  const yesterday = roster(addDays(today, -1));

  // Which shift would a clock-in belong to right now?
  let clockDate = today;
  if (isWorkShift(yesterday.code)) {
    const w = shiftWindow(yesterday.code as 'M', settings);
    if (w.end > MIN_PER_DAY && nowMin < w.end - MIN_PER_DAY + 60) clockDate = addDays(today, -1);
  }
  const clockDay = roster(clockDate);
  const shiftLog = running.find((l) => l.category === 'shift');
  const timer = running.find((l) => l.category !== 'shift');
  const timerActivity = activities.find((a) => a.id === timer?.activityId);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const current = todayPlan?.blocks.find((b) => b.start <= nowMin && b.end > nowMin);
  const next = todayPlan?.blocks.find((b) => b.start > nowMin && b.type !== 'buffer' && b.type !== 'break');
  const shiftPlanned = isWorkShift(clockDay.code) ? shiftWindow(clockDay.code as 'M', settings) : null;

  return (
    <div className="screen">
      <header className="hero">
        <div className="hero-main">
          <p className="eyebrow">{fmtDate(today)}</p>
          <h1>
            {isWorkShift(day.code) ? `${CODE_LABEL[day.code]} shift` : CODE_LABEL[day.code]}
            {isWorkShift(day.code) ? <span className="hero-mode"> · {MODE_LABEL[day.mode]}</span> : null}
          </h1>
          {current ? (
            <p className="hero-now">
              Now: <b>{current.label}</b> until {fmtTime(current.end, settings.hour12)}
              {next ? (
                <>
                  <br />
                  Next: {next.label} at {fmtTime(next.start, settings.hour12)}
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        {todayFatigue ? (
          <button type="button" className="hero-gauge" onClick={() => go('insights')} aria-label="Open fatigue details">
            <FatigueGauge score={todayFatigue.score} level={todayFatigue.level} />
            <span className="hint">Fatigue risk</span>
          </button>
        ) : null}
      </header>

      <div className="cards-2">
        <div className="card">
          <h3>Shift clock</h3>
          {shiftLog ? (
            <>
              <p className="big-timer">{fmtDuration((now.getTime() - shiftLog.start) / 60_000)}</p>
              <p className="muted">
                Clocked in at {fmtTime(minutesSince(today, shiftLog.start), settings.hour12)}
                {shiftPlanned && shiftLog.shiftDate ? ` · scheduled ${fmtTime(shiftPlanned.start, settings.hour12)}–${fmtTime(shiftPlanned.end, settings.hour12)}` : ''}
              </p>
              <button type="button" className="btn btn-primary" onClick={() => act(() => repo.clockOut(), 'Clocked out')}>
                <Icon name="stop" size={16} /> Clock out
              </button>
            </>
          ) : (
            <>
              <p className="muted">
                {isWorkShift(clockDay.code) && shiftPlanned
                  ? `${CODE_LABEL[clockDay.code]} shift ${fmtTime(shiftPlanned.start, settings.hour12)}–${fmtTime(shiftPlanned.end, settings.hour12)}${clockDate !== today ? ' (from yesterday)' : ''}`
                  : 'No shift scheduled. You can still log extra work.'}
              </p>
              <button type="button" className="btn btn-primary" onClick={() => act(() => repo.clockIn(clockDate), 'Clocked in')}>
                <Icon name="play" size={16} /> Clock in
              </button>
            </>
          )}
        </div>

        <div className="card">
          <h3>Activity timer</h3>
          {timer ? (
            <>
              <p className="big-timer">{fmtDuration((now.getTime() - timer.start) / 60_000)}</p>
              <p className="muted">{timer.category === 'activity' ? timerActivity?.name ?? 'Activity' : timer.category === 'sleep' ? 'Sleep' : 'Break'}</p>
              <button type="button" className="btn" onClick={() => act(() => repo.stopTimers(), 'Saved to your log')}>
                <Icon name="stop" size={16} /> Stop
              </button>
            </>
          ) : (
            <div className="chips">
              {activities
                .filter((a) => a.active)
                .map((a) => (
                  <button key={a.id} type="button" className={cx('chip-btn', `chip-${a.color}`)} onClick={() => act(() => repo.startTimer('activity', a.id), `${a.name} started`)}>
                    <Icon name="play" size={12} /> {a.name}
                  </button>
                ))}
              <button type="button" className="chip-btn chip-sleep" onClick={() => act(() => repo.startTimer('sleep'), 'Sleep timer started')}>
                <Icon name="play" size={12} /> Sleep
              </button>
            </div>
          )}
        </div>
      </div>

      <AscendCard />

      {todayPlan ? (
        <>
          <Notes notes={todayPlan.notes} />
          <Section title="Today's plan" aside={<button type="button" className="link" onClick={() => go('week')}>Edit roster</button>}>
            <DayList plan={todayPlan} activities={activities} settings={settings} nowMin={nowMin} lesson={(st, en) => lessonIn(report, today, st, en)} />
          </Section>
        </>
      ) : (
        <Empty title="No plan yet">Set your shifts on the Week page.</Empty>
      )}
    </div>
  );
}
