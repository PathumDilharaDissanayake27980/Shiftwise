import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { ASCEND_PACKAGE, ASCEND_RELEASES, ASCEND_URL, ascendAppLink, ascendWebLink, buildHandoff, decodePayload, encodePayload, lessonIn, reportToLogs, type Handoff, type Report, type ReportLog } from '../domain/ascend';
import { addDays, fmtDate, fmtDuration, fmtTime, toISODate } from '../domain/time';
import type { AscendLink } from '../domain/types';
import { repo } from '../data/repo';
import { ascendReportSchema } from '../data/schemas';
import { linkPayload } from '../data/wiring';
import { Icon, useToast } from './components/common';
import { useAppData } from './data';
import { errorMessage } from './util';

export const LINK_LABEL: Record<AscendLink, string> = { learn: 'Lessons', build: 'Project', cert: 'Exam prep', review: 'Review' };

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** The next two weeks of study blocks, ready to hand to Ascend. */
export function useAscendHandoff(): Handoff {
  const { week, currentWeek, activities, today, settings, roster } = useAppData();
  return useMemo(() => {
    const a = week(currentWeek);
    const b = week(addDays(currentWeek, 7));
    return buildHandoff([...a.plans, ...b.plans], activities, today, Date.now(), { settings, roster, fatigue: [...a.fatigue, ...b.fatigue] });
  }, [week, currentWeek, activities, today, settings, roster]);
}

/** Opens the Ascend Android app when installed (Chrome on Android), otherwise its web version. */
export function useAscendLink(): string {
  const h = useAscendHandoff();
  return useMemo(() => (isAndroid() ? ascendAppLink(h) : ascendWebLink(h)), [h]);
}

export function AscendCard() {
  const { settings, today } = useAppData();
  const h = useAscendHandoff();
  const progress = useLiveQuery(() => repo.getAscendProgress(), []);
  const report = useLiveQuery(() => repo.getAscendReport(), []);
  const config = useLiveQuery(() => repo.getAlertConfig(), []);
  const toast = useToast();
  const connectHref = useMemo(() => {
    if (!config) return null;
    const p = encodePayload(linkPayload(config));
    const web = `${ASCEND_URL}#link=${p}`;
    return isAndroid() ? `intent://import?link=${p}#Intent;scheme=ascend;package=${ASCEND_PACKAGE};S.browser_fallback_url=${encodeURIComponent(web)};end` : web;
  }, [config]);
  const href = useAscendLink();
  const todayBlocks = h.days[0]?.b ?? [];
  const total = h.days.slice(0, 7).reduce((t, d) => t + d.b.reduce((s, b) => s + b[1], 0), 0);
  const nothingLinked = h.days.every((d) => d.b.length === 0);
  return (
    <div className="card ascend-card">
      <h3>
        <span className="ascend-mark" aria-hidden="true" /> Career growth in Ascend
      </h3>
      {nothingLinked ? (
        <div className="note note-warn">
          <strong>Nothing is going to Ascend yet</strong>
          <span>
            No study activity is linked to Ascend. Open <a href="#activities">Activities</a> and tap <b>Balanced week</b>, or edit your study activity and set <b>Sends to Ascend as</b>.
          </span>
        </div>
      ) : todayBlocks.length ? (
        <div className="ascend-blocks" aria-label="Today's study blocks">
          {todayBlocks.map(([st, m, k]) => {
            const lesson = lessonIn(report, today, st, st + m);
            return (
              <span key={st} title={lesson?.task}>
                {fmtTime(st, settings.hour12)} · {lesson ? lesson.title : LINK_LABEL[k]} · {fmtDuration(m)}
              </span>
            );
          })}
        </div>
      ) : (
        <p className="muted">No study today. The time is yours: rest, people, hobbies.</p>
      )}
      {progress ? (
        <div className="ascend-progress">
          <div className="ascend-stats">
            <span><b>{Math.floor(progress.month)}</b> guide month</span>
            <span><b>{progress.done}</b>/{progress.total} lessons</span>
            <span><b>{progress.streak}</b> day streak</span>
            <span><b>{progress.hours}</b>h studied</span>
          </div>
          <p className="hint">
            Focus: <b>{progress.phase}</b>
            {progress.next.length ? <> · next: {progress.next.map(([d, st, t]) => `${d === today ? '' : `${fmtDate(d)} `}${fmtTime(st, settings.hour12)} ${t}`).join(' · ')}</> : null}
          </p>
          <p className="hint">Progress from Ascend, updated {fmtDate(toISODate(new Date(progress.at)))}.</p>
        </div>
      ) : (
        <p className="hint">Your lesson progress appears here after you jump back from Ascend once.</p>
      )}
      <p className="hint">
        {fmtDuration(total)} of lessons, projects and exam prep fitted around your shifts this week. In this browser the two apps stay wired automatically.{' '}
        {config ? 'Connect Ascend app once to wire the Android app and your other devices through your GitHub repo (encrypted).' : 'To wire the Android app too, set up Alerts first: it uses the same GitHub connection.'}
      </p>
      <div className="row">
        <a className="btn btn-primary" href={href}>
          <Icon name="ascend" size={16} /> Open in Ascend
        </a>
        {connectHref ? (
          <a className="btn" href={connectHref} onClick={() => toast('Ascend is now wired to ShiftWise through your GitHub repo, encrypted.')}>
            Connect Ascend app
          </a>
        ) : null}
        {isAndroid() ? (
          <>
            <a className="btn btn-ghost" href={ascendWebLink(h)}>
              Web version
            </a>
            <a className="btn btn-ghost" href={ASCEND_RELEASES} target="_blank" rel="noreferrer noopener">
              Get the app
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Handles "#ascend=…" links: sessions completed in Ascend, offered for the log. Nothing is saved until confirmed. */
export function AscendImport() {
  const { activities } = useAppData();
  const toast = useToast();
  const [pending, setPending] = useState<{ logs: ReportLog[]; unmatched: number } | null>(null);
  const [payload, setPayload] = useState<string | null>(null);

  useEffect(() => {
    const m = /^#ascend=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
    if (!m) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#today`);
    setPayload(m[1] ?? '');
  }, []);

  useEffect(() => {
    if (payload === null) return;
    setPayload(null);
    const parsed = ascendReportSchema.safeParse(decodePayload(payload));
    if (!parsed.success) {
      toast('That Ascend link could not be read.', 'error');
      return;
    }
    const report = parsed.data as Report;
    void (async () => {
      try {
        await repo.saveAscendReport(report);
        const { logs, unmatched } = reportToLogs(report, activities);
        const fresh = await repo.newSessions(logs);
        if (fresh.length) setPending({ logs: fresh, unmatched });
        else if (report.p) toast('Ascend progress updated.');
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    })();
  }, [payload, activities, toast]);

  if (!pending) return null;
  const { logs, unmatched } = pending;
  const minutes = logs.reduce((t, l) => t + ((l.end ?? l.start) - l.start) / 60_000, 0);
  const save = async () => {
    try {
      const r = await repo.importSessions(logs);
      toast(`Added ${r.added} Ascend session${r.added === 1 ? '' : 's'} to your log${r.skipped ? ` (${r.skipped} already there)` : ''}.`);
      setPending(null);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <div className="dialog-scrim" role="dialog" aria-modal="true" aria-labelledby="asc-title">
      <div className="dialog">
        <h2 id="asc-title">
          <span className="ascend-mark" aria-hidden="true" /> From Ascend
        </h2>
        <p>
          {logs.length} new completed session{logs.length === 1 ? '' : 's'} ({fmtDuration(minutes)}). Add {logs.length === 1 ? 'it' : 'them'} to your log so {logs.length === 1 ? 'it counts' : 'they count'} in your insights?
        </p>
        {unmatched ? <p className="hint">{unmatched} could not be matched. Use Activities → Balanced week, or set "Sends to Ascend as" on an activity.</p> : null}
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={save}>
            Add to log
          </button>
          <button type="button" className="btn" onClick={() => setPending(null)}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
