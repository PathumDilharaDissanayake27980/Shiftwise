import { useEffect, useMemo, useState } from 'react';
import { ASCEND_RELEASES, ascendAppLink, ascendWebLink, buildHandoff, decodePayload, reportToLogs, type Handoff, type Report } from '../domain/ascend';
import { addDays, fmtDuration, fmtTime } from '../domain/time';
import type { AscendLink } from '../domain/types';
import { repo } from '../data/repo';
import { ascendReportSchema } from '../data/schemas';
import { Icon, useToast } from './components/common';
import { useAppData } from './data';
import { errorMessage } from './util';

export const LINK_LABEL: Record<AscendLink, string> = { learn: 'Lessons', build: 'Project', cert: 'Exam prep' };

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** The next two weeks of study blocks, ready to hand to Ascend. */
export function useAscendHandoff(): Handoff {
  const { week, currentWeek, activities, today } = useAppData();
  return useMemo(() => {
    const plans = [...week(currentWeek).plans, ...week(addDays(currentWeek, 7)).plans];
    return buildHandoff(plans, activities, today, Date.now());
  }, [week, currentWeek, activities, today]);
}

/** Opens the Ascend Android app when installed (Chrome on Android), otherwise its web version. */
export function useAscendLink(): string {
  const h = useAscendHandoff();
  return useMemo(() => (isAndroid() ? ascendAppLink(h) : ascendWebLink(h)), [h]);
}

export function AscendCard() {
  const { settings } = useAppData();
  const h = useAscendHandoff();
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
          {todayBlocks.map(([st, m, k]) => (
            <span key={st}>
              {fmtTime(st, settings.hour12)} · {LINK_LABEL[k]} · {fmtDuration(m)}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted">No study today. The time is yours: rest, people, hobbies.</p>
      )}
      <p className="hint">
        {fmtDuration(total)} of lessons, projects and exam prep fitted around your shifts this week. Opening Ascend sends it these exact times, so it only schedules lessons when you're free.
      </p>
      <div className="row">
        <a className="btn btn-primary" href={href}>
          <Icon name="ascend" size={16} /> Open in Ascend
        </a>
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
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    const m = /^#ascend=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
    if (!m) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#today`);
    const parsed = ascendReportSchema.safeParse(decodePayload(m[1] ?? ''));
    if (parsed.success) setReport(parsed.data as Report);
    else toast('That Ascend link could not be read.', 'error');
  }, [toast]);

  if (!report) return null;
  const { logs, unmatched } = reportToLogs(report, activities);
  const minutes = report.items.reduce((t, i) => t + i.m, 0);
  const save = async () => {
    try {
      const r = await repo.importSessions(logs);
      toast(`Added ${r.added} Ascend session${r.added === 1 ? '' : 's'} to your log${r.skipped ? ` (${r.skipped} already there)` : ''}.`);
      setReport(null);
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
          {report.items.length} completed session{report.items.length === 1 ? '' : 's'} ({fmtDuration(minutes)}). Add {logs.length === report.items.length ? 'them' : `the ${logs.length} that match your activities`} to your log so they count in your insights?
        </p>
        {unmatched ? <p className="hint">{unmatched} could not be matched. Use Activities → Balanced week, or set "Sends to Ascend as" on an activity.</p> : null}
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={!logs.length} onClick={save}>
            Add to log
          </button>
          <button type="button" className="btn" onClick={() => setReport(null)}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
