import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { buildAlerts, type Alert, type AlertRule } from '../domain/alerts';
import { addDays, atMinutes } from '../domain/time';
import { GitHubClient, syncAlerts } from '../data/github';
import { repo, type AlertConfig } from '../data/repo';
import { useAppData } from './data';
import { errorMessage } from './util';

let inFlight: Promise<void> | null = null;

/** Runs one sync at a time and records the outcome on the stored config. */
export async function runSync(alerts: Alert[], force: boolean): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const cfg = await repo.getAlertConfig();
    if (!cfg) return;
    try {
      const r = await syncAlerts(alerts, cfg, { force });
      if (!r.skipped || cfg.lastError) {
        await repo.saveAlertConfig({ ...cfg, lastSyncAt: Date.now(), lastHash: r.hash, lastCount: r.count, lastError: null });
      }
    } catch (e) {
      await repo.saveAlertConfig({ ...cfg, lastError: errorMessage(e).slice(0, 500) });
      throw e;
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function sendTest(cfg: AlertConfig): Promise<void> {
  await new GitHubClient(cfg).runWorkflow({ test: 'true' });
}

export interface AlertsState {
  rules: AlertRule[] | undefined;
  config: AlertConfig | null | undefined;
  alerts: Alert[];
  syncNow: (force?: boolean) => Promise<void>;
}

/** Builds the upcoming alert schedule (rest of this week and all of next). */
export function useAlerts(): AlertsState {
  const data = useAppData();
  const rules = useLiveQuery(() => repo.getAlertRules(), []);
  const config = useLiveQuery(() => repo.getAlertConfig(), []);
  const { week, currentWeek, roster, settings, activities, running, today } = data;

  const alerts = useMemo(() => {
    if (!rules) return [];
    const a = week(currentWeek);
    const b = week(addDays(currentWeek, 7));
    // Anchor at the start of today so the schedule only changes when the data does, not every minute.
    return buildAlerts({
      now: atMinutes(today, 0),
      plans: [...a.plans, ...b.plans],
      roster,
      settings,
      activities,
      fatigue: [...a.fatigue, ...b.fatigue],
      running,
      rules,
    });
  }, [rules, week, currentWeek, roster, settings, activities, running, today]);

  const syncNow = useCallback((force = true) => runSync(alerts, force), [alerts]);
  return { rules, config, alerts, syncNow };
}

/** Invisible component: keeps the uploaded schedule in step with the app while it is open. */
export function AlertAutoSync() {
  const { config, alerts } = useAlerts();
  const timer = useRef<number | undefined>(undefined);
  const enabled = !!config?.autoSync;
  const key = useMemo(() => JSON.stringify(alerts.map((a) => [a.id, a.at, a.text])), [alerts]);

  useEffect(() => {
    if (!enabled || !navigator.onLine) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      runSync(alerts, false).catch(() => undefined);
    }, 4000);
    return () => window.clearTimeout(timer.current);
    // Re-run only when the schedule content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  return null;
}
