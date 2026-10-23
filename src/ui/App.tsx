import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { starterActivities } from '../domain/defaults';
import { repo } from '../data/repo';
import { Icon, ToastProvider } from './components/common';
import { AppDataProvider, useAppData } from './data';
import { AlertAutoSync } from './alerts';
import { ActivitiesScreen } from './screens/Activities';
import { AlertsScreen } from './screens/Alerts';
import { AssistantScreen } from './screens/Assistant';
import { InsightsScreen } from './screens/Insights';
import { LogScreen } from './screens/Log';
import { SettingsScreen } from './screens/Settings';
import { TodayScreen } from './screens/Today';
import { WeekScreen } from './screens/Week';
import { cx } from './util';

const ROUTES = [
  { id: 'today', label: 'Today', icon: 'today', mobile: true },
  { id: 'week', label: 'Week', icon: 'week', mobile: true },
  { id: 'log', label: 'Log', icon: 'log', mobile: true },
  { id: 'insights', label: 'Insights', icon: 'insights', mobile: true },
  { id: 'assistant', label: 'Assistant', icon: 'assistant', mobile: true },
  { id: 'activities', label: 'Activities', icon: 'activities', mobile: false },
  { id: 'alerts', label: 'Alerts', icon: 'bell', mobile: false },
  { id: 'settings', label: 'Settings', icon: 'settings', mobile: false },
] as const;
type Route = (typeof ROUTES)[number]['id'];

const LOCK_AFTER_MS = 5 * 60_000;

function readRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (ROUTES.find((r) => r.id === h)?.id ?? 'today') as Route;
}

function useRoute(): [Route, (r: string) => void] {
  const [route, setRoute] = useState<Route>(readRoute);
  useEffect(() => {
    const on = () => {
      setRoute(readRoute());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r: string) => {
    window.location.hash = r;
  }, []);
  return [route, go];
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await repo.unlock(pin);
    setBusy(false);
    setPin('');
    if (r.ok) onUnlock();
    else setMsg(r.waitSec > 0 ? `Too many tries. Wait ${r.waitSec} seconds.` : 'Wrong PIN. Try again.');
  };
  return (
    <main className="lock">
      <form onSubmit={submit} className="lock-card">
        <Icon name="lock" size={28} />
        <h1>ShiftWise is locked</h1>
        <label htmlFor="unlock">Enter your PIN</label>
        <input id="unlock" type="password" inputMode="numeric" autoComplete="current-password" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
        <button type="submit" className="btn btn-primary" disabled={busy || pin.length < 4}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <p className="lock-msg" role="alert">
          {msg}
        </p>
      </form>
    </main>
  );
}

function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="update" role="status">
      <span>{needRefresh ? 'A new version of ShiftWise is ready.' : 'ShiftWise now works offline.'}</span>
      {needRefresh ? (
        <button type="button" className="btn btn-primary btn-small" onClick={() => void updateServiceWorker(true)}>
          Update
        </button>
      ) : null}
      <button type="button" className="btn btn-small" onClick={() => { setNeedRefresh(false); setOfflineReady(false); }}>
        Close
      </button>
    </div>
  );
}

function Shell({ route, go, viewWeek, setViewWeek }: { route: Route; go: (r: string) => void; viewWeek: string | null; setViewWeek: (d: string | null) => void }) {
  const { currentWeek, running } = useAppData();
  const week = viewWeek ?? currentWeek;
  const clocked = running.some((l) => l.category === 'shift');
  return (
    <div className="shell">
      <a href="#main" className="skip">
        Skip to content
      </a>
      <nav className="side" aria-label="Main">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          ShiftWise
        </div>
        {ROUTES.map((r) => (
          <a key={r.id} href={`#${r.id}`} className={cx('nav-item', route === r.id && 'is-on')} aria-current={route === r.id ? 'page' : undefined}>
            <Icon name={r.icon} />
            <span>{r.label}</span>
            {r.id === 'today' && clocked ? <i className="live" aria-label="Clocked in" /> : null}
          </a>
        ))}
        <p className="side-foot">Your data stays on this device.</p>
      </nav>
      <div className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          ShiftWise
        </span>
        <span className="topbar-actions">
          <a href="#activities" className={cx('btn btn-icon btn-ghost', route === 'activities' && 'is-on')} aria-label="Activities">
            <Icon name="activities" />
          </a>
          <a href="#alerts" className={cx('btn btn-icon btn-ghost', route === 'alerts' && 'is-on')} aria-label="Alerts">
            <Icon name="bell" />
          </a>
          <a href="#settings" className={cx('btn btn-icon btn-ghost', route === 'settings' && 'is-on')} aria-label="Settings">
            <Icon name="settings" />
          </a>
        </span>
      </div>
      <main id="main" className="main" tabIndex={-1}>
        {route === 'today' && <TodayScreen go={go} />}
        {route === 'week' && <WeekScreen key={week} weekStartDate={week} setWeek={setViewWeek} />}
        {route === 'log' && <LogScreen />}
        {route === 'insights' && <InsightsScreen weekStartDate={week} setWeek={setViewWeek} />}
        {route === 'assistant' && <AssistantScreen />}
        {route === 'activities' && <ActivitiesScreen />}
        {route === 'alerts' && <AlertsScreen />}
        {route === 'settings' && <SettingsScreen />}
      </main>
      <nav className="tabs" aria-label="Main">
        {ROUTES.filter((r) => r.mobile).map((r) => (
          <a key={r.id} href={`#${r.id}`} className={cx('tab', route === r.id && 'is-on')} aria-current={route === r.id ? 'page' : undefined}>
            <Icon name={r.icon} size={22} />
            <span>{r.label}</span>
            {r.id === 'today' && clocked ? <i className="live" /> : null}
          </a>
        ))}
      </nav>
      {import.meta.env.VITE_DEMO ? null : <UpdateBanner />}
      <AlertAutoSync />
    </div>
  );
}

export function App() {
  const [route, go] = useRoute();
  const [locked, setLocked] = useState<boolean | null>(null);
  const [viewWeek, setViewWeek] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        if (!(await repo.getFlag('seeded'))) {
          for (const a of starterActivities()) await repo.saveActivity(a);
          await repo.setFlag('seeded', true);
        }
      } catch (e) {
        console.error('Could not add starter activities', e);
      }
      setLocked(!!(await repo.getLock().catch(() => null)));
    })();
  }, []);

  useEffect(() => {
    let hiddenAt = 0;
    const on = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) void repo.getLock().then((l) => l && setLocked(true));
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  if (locked === null) return <div className="boot" aria-busy="true" />;
  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />;
  return (
    <ToastProvider>
      <AppDataProvider viewWeek={viewWeek} fallback={<div className="boot" aria-busy="true" />}>
        <Shell route={route} go={go} viewWeek={viewWeek} setViewWeek={setViewWeek} />
      </AppDataProvider>
    </ToastProvider>
  );
}
