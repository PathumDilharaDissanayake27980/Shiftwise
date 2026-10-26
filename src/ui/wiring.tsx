import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef } from 'react';
import { reportToLogs, type Report } from '../domain/ascend';
import type { Activity } from '../domain/types';
import { repo } from '../data/repo';
import { ascendReportSchema } from '../data/schemas';
import { LOCAL_ASCEND, LOCAL_SHIFTWISE, pullAscend, pushPlan } from '../data/wiring';
import { useAscendHandoff } from './ascend';
import { useToast } from './components/common';
import { useAppData } from './data';

/** The latest report from Ascend, live. */
export function useAscendReport(): Report | null | undefined {
  return useLiveQuery(() => repo.getAscendReport(), []);
}

/** Stores a report and logs any sessions not logged yet. Used for trusted channels: same-origin storage and the encrypted cloud file. */
async function ingest(report: Report, activities: Activity[], toast: (m: string) => void): Promise<void> {
  await repo.saveAscendReport(report);
  const fresh = await repo.newSessions(reportToLogs(report, activities).logs);
  if (!fresh.length) return;
  const r = await repo.importSessions(fresh);
  if (r.added) toast(`${r.added} study session${r.added === 1 ? '' : 's'} from Ascend added to your log.`);
}

function parseReport(raw: string | null): Report | null {
  if (!raw) return null;
  try {
    const r = ascendReportSchema.safeParse(JSON.parse(raw));
    return r.success ? (r.data as Report) : null;
  } catch {
    return null;
  }
}

let lastPushed = '';

/**
 * Invisible: keeps ShiftWise and Ascend wired together while the app is open.
 *  - Same browser: publishes the plan to shared storage and picks up Ascend's changes the moment they happen.
 *  - Other devices and the Android app: pushes the plan to, and pulls progress from, the encrypted files on GitHub.
 */
export function Wiring() {
  const { activities } = useAppData();
  const toast = useToast();
  const handoff = useAscendHandoff();
  const config = useLiveQuery(() => repo.getAlertConfig(), []);
  const content = useMemo(() => JSON.stringify({ ...handoff, at: 0 }), [handoff]);
  const latest = useRef({ handoff, activities, toast });
  latest.current = { handoff, activities, toast };

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_SHIFTWISE, JSON.stringify(latest.current.handoff));
    } catch {
      // storage blocked (private mode): the links and cloud wiring still work
    }
  }, [content]);

  useEffect(() => {
    const read = (raw: string | null) => {
      const r = parseReport(raw);
      if (r) void ingest(r, latest.current.activities, latest.current.toast).catch(() => undefined);
    };
    try {
      read(localStorage.getItem(LOCAL_ASCEND));
    } catch {
      // storage blocked
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCAL_ASCEND) read(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const cloudKey = config ? `${config.repo}|${config.branch}|${config.key}|${config.token}` : '';
  useEffect(() => {
    if (!config) return;
    const run = async () => {
      if (!navigator.onLine) return;
      try {
        const body = JSON.stringify({ ...latest.current.handoff, at: 0 });
        if (body !== lastPushed) {
          await pushPlan(latest.current.handoff, config);
          lastPushed = body;
        }
        const r = await pullAscend(config);
        if (r) await ingest(r, latest.current.activities, latest.current.toast);
      } catch {
        // offline or token expired: the Alerts page shows token problems
      }
    };
    const t = window.setTimeout(run, 5000);
    const iv = window.setInterval(run, 10 * 60_000);
    const onVisible = () => document.visibilityState === 'visible' && void run();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // re-run when the plan or the connection changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudKey, content]);

  return null;
}
