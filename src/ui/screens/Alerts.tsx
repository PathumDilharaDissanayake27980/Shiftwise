import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ALERT_TRIGGERS, PLACEHOLDERS, TRIGGER_INFO, blankRule, buildAlerts, defaultAlertRules, type AlertRule, type AlertTrigger } from '../../domain/alerts';
import { addDays, fmtDuration, fmtTime, toISODate } from '../../domain/time';
import { WORK_SHIFTS, type WorkShift } from '../../domain/types';
import { GitHubClient, newAlertsKey } from '../../data/github';
import { repo, type AlertConfig } from '../../data/repo';
import { Empty, Icon, Section, useToast } from '../components/common';
import { runSync, sendTest, useAlerts } from '../alerts';
import { useAppData } from '../data';
import { cx, errorMessage, fromTimeInput, toTimeInput } from '../util';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHIFT_TRIGGERS: AlertTrigger[] = ['shiftStart', 'shiftEnd', 'leaveHome', 'clockOutMissed'];

function guessRepo(): string {
  const m = /^([^.]+)\.github\.io$/.exec(window.location.hostname);
  const path = window.location.pathname.split('/').filter(Boolean)[0];
  return m && path ? `${m[1]}/${path}` : '';
}

function whenText(r: AlertRule, activityName: (id: string) => string): string {
  if (r.trigger === 'custom') {
    const days = r.weekdays.length === 0 || r.weekdays.length === 7 ? 'Every day' : r.weekdays.map((d) => WEEKDAYS[d]).join(', ');
    return `${days} at ${fmtTime(r.time)}`;
  }
  const rel = TRIGGER_INFO[r.trigger].relative ?? '';
  const offset = r.offsetMin === 0 ? `At ${rel}` : `${fmtDuration(Math.abs(r.offsetMin))} ${r.offsetMin < 0 ? 'before' : 'after'} ${rel}`;
  const extra = [
    SHIFT_TRIGGERS.includes(r.trigger) && r.shifts.length ? r.shifts.join(', ') + ' shifts' : '',
    r.trigger === 'activityStart' ? (r.activityId ? activityName(r.activityId) : 'any activity') : '',
    r.trigger === 'riskWarning' ? `fatigue ≥ ${r.minScore} or a tight changeover` : '',
  ].filter(Boolean);
  return [offset, ...extra].join(' · ');
}

function fmtAt(ms: number, hour12: boolean): string {
  const d = new Date(ms);
  const iso = toISODate(d);
  const day = iso === toISODate(new Date()) ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} ${fmtTime(d.getHours() * 60 + d.getMinutes(), hour12)}`;
}

export function AlertsScreen() {
  const data = useAppData();
  const { settings, activities } = data;
  const { rules, config, alerts, syncNow } = useAlerts();
  const toast = useToast();
  const [draft, setDraft] = useState<AlertRule | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const upcoming = alerts.filter((a) => a.at > Date.now()).slice(0, 12);
  const activityName = (id: string) => activities.find((a) => a.id === id)?.name ?? 'Deleted activity';

  const preview = useMemo(() => {
    if (!draft) return null;
    const a = data.week(data.currentWeek);
    const b = data.week(addDays(data.currentWeek, 7));
    const list = buildAlerts({ now: Date.now(), plans: [...a.plans, ...b.plans], roster: data.roster, settings, activities, fatigue: [...a.fatigue, ...b.fatigue], running: data.running, rules: [{ ...draft, enabled: true }] });
    return list[0] ?? null;
  }, [draft, data, settings, activities]);

  if (!rules || config === undefined) return null;

  const saveRules = async (next: AlertRule[], msg?: string) => {
    try {
      await repo.saveAlertRules(next);
      if (msg) toast(msg);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const onSaveRule = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const exists = rules.some((r) => r.id === draft.id);
    await saveRules(exists ? rules.map((r) => (r.id === draft.id ? draft : r)) : [...rules, draft], exists ? 'Alert updated' : 'Alert added');
    setDraft(null);
  };

  const insert = (key: string) => {
    if (!draft) return;
    const el = msgRef.current;
    const token = `{${key}}`;
    const pos = el ? el.selectionStart : draft.message.length;
    const next = draft.message.slice(0, pos) + token + draft.message.slice(el ? el.selectionEnd : pos);
    setDraft({ ...draft, message: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + token.length, pos + token.length);
    });
  };

  const doSync = async () => {
    setBusy('sync');
    try {
      await syncNow(true);
      toast(`Schedule synced: ${alerts.length} alerts`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const doTest = async () => {
    if (!config) return;
    setBusy('test');
    try {
      await sendTest(config);
      toast('Test started. The message should reach your phone within a minute or two.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const rel = draft ? TRIGGER_INFO[draft.trigger].relative : null;

  return (
    <div className="screen">
      <header className="page-head">
        <div>
          <p className="eyebrow">Phone alerts</p>
          <h1>Reminders on your phone</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setDraft(blankRule('custom'))}>
          <Icon name="plus" size={16} /> Add alert
        </button>
      </header>

      <div className={cx('card', 'alert-status', config?.lastError ? 'is-error' : config ? 'is-ok' : '')}>
        {config ? (
          <>
            <h3>{config.lastError ? 'Sync problem' : 'Connected to your phone via GitHub'}</h3>
            <p className="muted">
              {config.lastError
                ? config.lastError
                : config.lastSyncAt
                  ? `Last synced ${fmtAt(config.lastSyncAt, settings.hour12)} · ${config.lastCount ?? 0} alerts scheduled for the next 7 days.`
                  : 'Not synced yet.'}{' '}
              {config.autoSync ? 'Changes sync automatically while the app is open.' : ''}
            </p>
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={doSync}>
                {busy === 'sync' ? 'Syncing…' : 'Sync now'}
              </button>
              <button type="button" className="btn" disabled={busy !== null} onClick={doTest}>
                {busy === 'test' ? 'Starting…' : 'Send a test message'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setSetupOpen((v) => !v)}>
                {setupOpen ? 'Hide setup' : 'Connection settings'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>Not connected yet</h3>
            <p className="muted">Your alerts are ready below. Connect your phone once (about 5 minutes, free) and they start arriving.</p>
            <button type="button" className="btn btn-primary" onClick={() => setSetupOpen(true)}>
              Set up phone alerts
            </button>
          </>
        )}
      </div>

      {setupOpen ? <Setup config={config} onDone={() => setSetupOpen(false)} alertsCount={alerts.length} onConnected={() => runSync(alerts, true)} /> : null}

      {draft ? (
        <Section title={rules.some((r) => r.id === draft.id) ? `Edit: ${draft.name}` : 'New alert'}>
          <form className="form-grid" onSubmit={onSaveRule}>
            <div className="field">
              <label htmlFor="al-trigger">When</label>
              <select
                id="al-trigger"
                value={draft.trigger}
                onChange={(e) => {
                  const t = e.target.value as AlertTrigger;
                  const fresh = blankRule(t);
                  setDraft({ ...draft, trigger: t, message: fresh.message, name: draft.name === TRIGGER_INFO[draft.trigger].label ? fresh.name : draft.name });
                }}
              >
                {ALERT_TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_INFO[t].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="al-name">Name</label>
              <input id="al-name" value={draft.name} maxLength={60} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <p className="hint field-wide">{TRIGGER_INFO[draft.trigger].help}</p>

            {rel ? (
              <div className="field field-wide">
                <label htmlFor="al-off">Timing</label>
                <div className="row">
                  <input id="al-off" type="number" min={0} max={1440} step={5} style={{ maxWidth: 110 }} value={Math.abs(draft.offsetMin)} onChange={(e) => setDraft({ ...draft, offsetMin: Math.sign(draft.offsetMin || -1) * Math.min(1440, Math.abs(Number(e.target.value))) })} />
                  <span>minutes</span>
                  <select aria-label="Before or after" style={{ maxWidth: 140 }} value={draft.offsetMin < 0 ? 'before' : 'after'} onChange={(e) => setDraft({ ...draft, offsetMin: (e.target.value === 'before' ? -1 : 1) * Math.abs(draft.offsetMin) })}>
                    <option value="before">before</option>
                    <option value="after">after</option>
                  </select>
                  <span>{rel}</span>
                </div>
              </div>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="al-time">Time</label>
                  <input id="al-time" type="time" value={toTimeInput(draft.time)} onChange={(e) => setDraft({ ...draft, time: fromTimeInput(e.target.value) ?? draft.time })} />
                </div>
                <fieldset className="field field-wide">
                  <legend>Days (none ticked = every day)</legend>
                  <div className="chips">
                    {WEEKDAYS.map((d, i) => (
                      <label key={d} className={cx('chip-btn', draft.weekdays.includes(i) && 'is-picked')}>
                        <input type="checkbox" className="sr-only" checked={draft.weekdays.includes(i)} onChange={(e) => setDraft({ ...draft, weekdays: e.target.checked ? [...draft.weekdays, i].sort() : draft.weekdays.filter((x) => x !== i) })} />
                        {d}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </>
            )}

            {SHIFT_TRIGGERS.includes(draft.trigger) ? (
              <fieldset className="field field-wide">
                <legend>Shifts (none ticked = all)</legend>
                <div className="chips">
                  {WORK_SHIFTS.map((c) => (
                    <label key={c} className={cx('chip-btn', draft.shifts.includes(c) && 'is-picked')}>
                      <input type="checkbox" className="sr-only" checked={draft.shifts.includes(c)} onChange={(e) => setDraft({ ...draft, shifts: e.target.checked ? [...draft.shifts, c] : draft.shifts.filter((x) => x !== c) as WorkShift[] })} />
                      {settings.shifts[c].name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {draft.trigger === 'activityStart' ? (
              <div className="field">
                <label htmlFor="al-act">Activity</label>
                <select id="al-act" value={draft.activityId} onChange={(e) => setDraft({ ...draft, activityId: e.target.value })}>
                  <option value="">Any activity</option>
                  {activities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {draft.trigger === 'riskWarning' ? (
              <div className="field">
                <label htmlFor="al-score">Send when fatigue is at least: {draft.minScore}</label>
                <input id="al-score" type="range" min={20} max={90} step={5} value={draft.minScore} onChange={(e) => setDraft({ ...draft, minScore: Number(e.target.value) })} />
              </div>
            ) : null}

            <div className="field field-wide">
              <label htmlFor="al-msg">Message</label>
              <textarea id="al-msg" ref={msgRef} rows={4} maxLength={1000} value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} required />
              <div className="chips placeholder-chips" aria-label="Insert a placeholder">
                {PLACEHOLDERS.map((p) => (
                  <button key={p.key} type="button" className="chip-btn chip-mini" title={p.meaning} onClick={() => insert(p.key)}>
                    {`{${p.key}}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="field field-wide">
              <span className="field-label">Next message</span>
              <div className="wa-preview">
                {preview ? (
                  <>
                    <span className="wa-time">{fmtAt(preview.at, settings.hour12)}</span>
                    <p>{preview.text}</p>
                  </>
                ) : (
                  <p className="muted">Nothing due this week with your current roster.</p>
                )}
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Save alert
              </button>
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              {rules.some((r) => r.id === draft.id) ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    await saveRules(rules.filter((r) => r.id !== draft.id), 'Alert deleted');
                    setDraft(null);
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </form>
        </Section>
      ) : null}

      <Section title="Your alerts" aside={<button type="button" className="link" onClick={() => saveRules(defaultAlertRules(), 'Default alerts restored')}>Restore defaults</button>}>
        {rules.length === 0 ? (
          <Empty title="No alerts">Add one, or restore the defaults.</Empty>
        ) : (
          <div className="act-list">
            {rules.map((r) => (
              <article key={r.id} className={cx('act', !r.enabled && 'is-off')}>
                <span className="act-sw chip-teal" />
                <div className="act-main">
                  <h3>{r.name}</h3>
                  <p className="muted">{whenText(r, activityName)}</p>
                  <p className="alert-msg">{r.message}</p>
                </div>
                <div className="act-side">
                  <label className="switch">
                    <input type="checkbox" checked={r.enabled} onChange={() => saveRules(rules.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)))} />
                    <span>{r.enabled ? 'On' : 'Off'}</span>
                  </label>
                  <button type="button" className="btn btn-icon btn-ghost" aria-label={`Edit ${r.name}`} onClick={() => setDraft({ ...r })}>
                    <Icon name="edit" size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section title="Coming up">
        {upcoming.length === 0 ? (
          <Empty title="Nothing scheduled">Set your shifts on the Week page, or turn on some alerts.</Empty>
        ) : (
          <ol className="daylist">
            {upcoming.map((a) => (
              <li key={a.id} className="dl-row upcoming-row">
                <span className="dl-time">{fmtAt(a.at, settings.hour12)}</span>
                <span className="dl-sw blk-free" />
                <span className="dl-label alert-msg">{a.text}</span>
                <span />
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function Setup({ config, onDone, onConnected, alertsCount }: { config: AlertConfig | null; onDone: () => void; onConnected: () => Promise<void>; alertsCount: number }) {
  const toast = useToast();
  const [repoName, setRepoName] = useState(config?.repo ?? guessRepo());
  const [token, setToken] = useState('');
  const [key] = useState(config?.key ?? newAlertsKey());
  const [topic] = useState(() => `shiftwise-${newAlertsKey().replace(/[^A-Za-z0-9]/g, '').slice(0, 18).toLowerCase()}`);
  const [autoSync, setAutoSync] = useState(config?.autoSync ?? true);
  const [busy, setBusy] = useState(false);
  const secretsUrl = repoName.includes('/') ? `https://github.com/${repoName}/settings/secrets/actions` : 'https://github.com';

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch {
      toast('Copy failed. Select the text and copy it.', 'error');
    }
  };

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const cfg: AlertConfig = {
        repo: repoName.trim(),
        token: token.trim() || config?.token || '',
        key,
        branch: 'alerts',
        autoSync,
        lastSyncAt: config?.lastSyncAt ?? null,
        lastHash: null,
        lastCount: config?.lastCount ?? null,
        lastError: null,
      };
      await repo.saveAlertConfig(cfg);
      await new GitHubClient(cfg).checkAccess();
      await onConnected();
      toast(`Connected. ${alertsCount} alerts uploaded.`);
      setToken('');
      onDone();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Connect your phone">
      <ol className="steps">
        <li>
          <h3>Install ntfy and subscribe to your private topic</h3>
          <p>
            Install the free <b>ntfy</b> app (<a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noreferrer noopener">Android</a>, <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noreferrer noopener">iPhone</a>). No account is needed. Tap <b>+</b> and subscribe to this topic. Treat it like a password: anyone who knows it can read your alerts.
          </p>
          <span className="keybox">
            <span className="mono">{topic}</span>
            <button type="button" className="btn btn-small" onClick={() => copy(topic)}>Copy</button>
          </span>
          <p className="hint">Prefer Telegram? Create a bot with @BotFather and add <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code> instead. WhatsApp through CallMeBot (<code>CALLMEBOT_PHONE</code>, <code>CALLMEBOT_APIKEY</code>) still works as an extra channel, but it is often unreliable.</p>
        </li>
        <li>
          <h3>Add two secrets to your GitHub repository</h3>
          <p>
            Open <a href={secretsUrl} target="_blank" rel="noreferrer noopener">Settings → Secrets and variables → Actions</a> and add each with <b>New repository secret</b>:
          </p>
          <ul className="secret-list">
            <li><code>NTFY_TOPIC</code> the topic above</li>
            <li>
              <code>ALERTS_KEY</code> this encryption key:
              <span className="keybox">
                <span className="mono">{key}</span>
                <button type="button" className="btn btn-small" onClick={() => copy(key)}>Copy</button>
              </span>
            </li>
          </ul>
        </li>
        <li>
          <h3>Create a token so this app can upload your schedule</h3>
          <p>
            Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer noopener">GitHub → Fine-grained tokens → Generate new token</a>. Repository access: <b>Only select repositories</b> → your ShiftWise repo. Permissions: <b>Contents: Read and write</b> and <b>Actions: Read and write</b>. Set an expiry (90 days is sensible), generate, and paste it below.
          </p>
        </li>
      </ol>
      <form className="form-grid" onSubmit={connect}>
        <div className="field">
          <label htmlFor="gh-repo">Repository (owner/name)</label>
          <input id="gh-repo" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="PathumDilharaDissanayake27980/Shiftwise" required autoComplete="off" spellCheck={false} />
        </div>
        <div className="field">
          <label htmlFor="gh-token">GitHub token {config ? '(leave blank to keep the current one)' : ''}</label>
          <input id="gh-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" required={!config} autoComplete="off" spellCheck={false} />
        </div>
        <div className="field">
          <label className="switch">
            <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />
            <span>Sync changes automatically</span>
          </label>
        </div>
        <p className="hint field-wide">The token is stored only on this device. Only alert times and texts are uploaded, encrypted with ALERTS_KEY. Action logs never contain your messages.</p>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Connecting…' : config ? 'Save & sync' : 'Connect & upload alerts'}
          </button>
          {config ? (
            <button type="button" className="btn btn-ghost" onClick={async () => { await repo.clearAlertConfig(); toast('Disconnected. The token was removed from this device.'); onDone(); }}>
              Disconnect
            </button>
          ) : null}
        </div>
      </form>
    </Section>
  );
}
