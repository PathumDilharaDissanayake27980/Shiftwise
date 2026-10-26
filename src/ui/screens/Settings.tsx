import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEFAULT_SETTINGS } from '../../domain/defaults';
import { toISODate } from '../../domain/time';
import { WORK_SHIFTS, type Settings, type WorkShift } from '../../domain/types';
import { Repo, repo } from '../../data/repo';
import { Section, useToast } from '../components/common';
import { useAppData } from '../data';
import { downloadText, errorMessage, fromTimeInput, toTimeInput } from '../util';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function TimeField({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (m: number) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="time" value={toTimeInput(value)} onChange={(e) => {
        const m = fromTimeInput(e.target.value);
        if (m !== null) onChange(m);
      }} />
    </div>
  );
}

function NumField({ id, label, value, onChange, min, max, step = 5, suffix = 'min' }: { id: string; label: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <span className="muted">({suffix})</span>
      </label>
      <input id={id} type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function SettingsScreen() {
  const { settings } = useAppData();
  const toast = useToast();
  const [s, setS] = useState<Settings>(settings);
  const [hasLock, setHasLock] = useState(false);
  const [pin, setPin] = useState('');
  const [pass, setPass] = useState('');
  const [importPass, setImportPass] = useState('');
  const [pendingFile, setPendingFile] = useState<string | null>(null);
  const [wipe, setWipe] = useState('');
  const [installEvt, setInstallEvt] = useState<InstallPromptEvent | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setS(settings), [settings]);
  useEffect(() => {
    void repo.getLock().then((l) => setHasLock(!!l));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const setShift = (code: WorkShift, patch: Partial<Settings['shifts'][WorkShift]>) => setS((x) => ({ ...x, shifts: { ...x.shifts, [code]: { ...x.shifts[code], ...patch } } }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await repo.saveSettings(s);
      toast('Settings saved. Your plans have been updated.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const exportData = async () => {
    try {
      const text = await repo.exportBackup(pass || undefined);
      downloadText(`shiftwise-backup-${toISODate(new Date())}${pass ? '-encrypted' : ''}.json`, text);
      toast(pass ? 'Encrypted backup saved' : 'Backup saved. Keep it somewhere private.');
      setPass('');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const doImport = async (text: string, passphrase?: string) => {
    try {
      const r = await repo.importBackup(text, passphrase);
      toast(`Restored ${r.roster} roster days, ${r.activities} activities and ${r.logs} log entries.`);
      setPendingFile(null);
      setImportPass('');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) return toast('That file is too large to be a ShiftWise backup.', 'error');
    const text = await f.text();
    if (fileRef.current) fileRef.current.value = '';
    if (Repo.isEncrypted(text)) setPendingFile(text);
    else await doImport(text);
  };

  return (
    <div className="screen">
      <header className="page-head">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Shifts, sleep & your data</h1>
        </div>
      </header>

      <form onSubmit={save}>
        <Section title="Shift times">
          <div className="shift-defs">
            {WORK_SHIFTS.map((c) => (
              <div key={c} className={`shift-def code-${c}`}>
                <div className="field">
                  <label htmlFor={`sn-${c}`}>Name</label>
                  <input id={`sn-${c}`} value={s.shifts[c].name} maxLength={30} onChange={(e) => setShift(c, { name: e.target.value })} />
                </div>
                <TimeField id={`ss-${c}`} label="Starts" value={s.shifts[c].start} onChange={(m) => setShift(c, { start: m })} />
                <NumField id={`sd-${c}`} label="Length" suffix="hours" value={s.shifts[c].duration / 60} min={1} max={16} step={0.5} onChange={(n) => setShift(c, { duration: Math.round(n * 60) })} />
              </div>
            ))}
          </div>
          <div className="form-grid">
            <NumField id="commute" label="Commute, one way" value={s.commuteMin} min={0} max={240} onChange={(n) => setS({ ...s, commuteMin: n })} />
            <div className="field">
              <label className="switch">
                <input type="checkbox" checked={s.monitoringAtOffice} onChange={(e) => setS({ ...s, monitoringAtOffice: e.target.checked })} />
                <span>Monitoring days are at the office</span>
              </label>
            </div>
          </div>
        </Section>

        <Section title="Sleep & routine">
          <div className="form-grid">
            <NumField id="sleep" label="Sleep target" suffix="hours" value={s.sleepTargetMin / 60} min={4} max={12} step={0.25} onChange={(n) => setS({ ...s, sleepTargetMin: Math.round(n * 60) })} />
            <NumField id="prep" label="Getting ready" value={s.prepMin} min={5} max={180} onChange={(n) => setS({ ...s, prepMin: n })} />
            <TimeField id="w-m" label="Wake before Morning" value={s.wake.M} onChange={(m) => setS({ ...s, wake: { ...s.wake, M: m } })} />
            <TimeField id="w-d" label="Wake before Day" value={s.wake.D} onChange={(m) => setS({ ...s, wake: { ...s.wake, D: m } })} />
            <TimeField id="w-n" label="Wake on a Night day" value={s.wake.N} onChange={(m) => setS({ ...s, wake: { ...s.wake, N: m } })} />
            <TimeField id="w-o" label="Wake on days off" value={s.wake.OFF} onChange={(m) => setS({ ...s, wake: { ...s.wake, OFF: m } })} />
            <TimeField id="b-m" label="Bedtime before Morning" value={s.bedtime.M} onChange={(m) => setS({ ...s, bedtime: { ...s.bedtime, M: m } })} />
            <TimeField id="b-d" label="Bedtime before Day" value={s.bedtime.D} onChange={(m) => setS({ ...s, bedtime: { ...s.bedtime, D: m } })} />
            <TimeField id="b-n" label="Bedtime before Night" value={s.bedtime.N} onChange={(m) => setS({ ...s, bedtime: { ...s.bedtime, N: m } })} />
            <TimeField id="b-o" label="Bedtime before a day off" value={s.bedtime.OFF} onChange={(m) => setS({ ...s, bedtime: { ...s.bedtime, OFF: m } })} />
            <NumField id="gy" label="Sleep before Graveyard" suffix="hours" value={s.graveyardPreSleepMin / 60} min={2} max={10} step={0.5} onChange={(n) => setS({ ...s, graveyardPreSleepMin: Math.round(n * 60) })} />
            <TimeField id="gr" label="Wake after Graveyard" value={s.graveyardRecoveryUntil} onChange={(m) => setS({ ...s, graveyardRecoveryUntil: m })} />
            <TimeField id="late" label="No heavy work after" value={s.lateCutoff} onChange={(m) => setS({ ...s, lateCutoff: m })} />
            <NumField id="wind" label="Wind-down before bed" value={s.windDownMin} min={0} max={120} onChange={(n) => setS({ ...s, windDownMin: n })} />
            <div className="field">
              <label className="switch">
                <input type="checkbox" checked={s.preNightNap} onChange={(e) => setS({ ...s, preNightNap: e.target.checked })} />
                <span>Nap before the first night shift</span>
              </label>
            </div>
            <div className="field">
              <label htmlFor="ws">Week starts on</label>
              <select id="ws" value={s.weekStartsOn} onChange={(e) => setS({ ...s, weekStartsOn: Number(e.target.value) as 0 | 1 })}>
                <option value={1}>Monday</option>
                <option value={0}>Sunday</option>
              </select>
            </div>
            <div className="field">
              <label className="switch">
                <input type="checkbox" checked={s.hour12} onChange={(e) => setS({ ...s, hour12: e.target.checked })} />
                <span>12-hour clock</span>
              </label>
            </div>
          </div>
        </Section>
        <Section title="Balance">
          <p className="hint">Most focus work (study, projects, freelance) planned on each kind of day. Gym, reading and time with people come on top, and at least 40% of every day's free time always stays free.</p>
          <div className="form-grid">
            {(['M', 'D', 'N', 'G', 'OFF'] as const).map((k) => (
              <NumField
                key={k}
                id={`fb-${k}`}
                label={k === 'OFF' ? 'Focus on a day off' : `Focus on a ${s.shifts[k].name} day`}
                suffix="hours"
                value={s.focusBudget[k] / 60}
                min={0}
                max={12}
                step={0.25}
                onChange={(n) => setS({ ...s, focusBudget: { ...s.focusBudget, [k]: Math.round(n * 60) } })}
              />
            ))}
            <div className="field">
              <label className="switch">
                <input type="checkbox" checked={s.restDay} onChange={(e) => setS({ ...s, restDay: e.target.checked })} />
                <span>Second day off in a row is a recharge day</span>
              </label>
            </div>
          </div>
        </Section>
        <div className="form-actions sticky-actions">
          <button type="submit" className="btn btn-primary">
            Save settings
          </button>
          <button type="button" className="btn" onClick={() => setS(DEFAULT_SETTINGS)}>
            Reset to GTN defaults
          </button>
        </div>
      </form>

      <Section title="App lock">
        <p className="lede">A PIN hides your data when the app opens or comes back after 5 minutes. Data stays on this device only.</p>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await repo.setPin(pin);
              setPin('');
              setHasLock(true);
              toast('PIN set');
            } catch (err) {
              toast(errorMessage(err), 'error');
            }
          }}
        >
          <label htmlFor="pin" className="sr-only">
            New PIN
          </label>
          <input id="pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4,8}" placeholder={hasLock ? 'New PIN' : '4–8 digit PIN'} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
          <button type="submit" className="btn btn-primary">
            {hasLock ? 'Change PIN' : 'Set PIN'}
          </button>
          {hasLock ? (
            <button type="button" className="btn" onClick={async () => {
              await repo.clearPin();
              setHasLock(false);
              toast('App lock turned off');
            }}>
              Turn off
            </button>
          ) : null}
        </form>
      </Section>

      <Section title="Backup & restore">
        <p className="lede">Your data lives only in this browser. Back it up to move to another device or keep it safe. Add a passphrase to encrypt the file (AES-256).</p>
        <div className="row">
          <label htmlFor="bk-pass" className="sr-only">
            Backup passphrase
          </label>
          <input id="bk-pass" type="password" autoComplete="new-password" placeholder="Passphrase (optional, 8+ characters)" value={pass} onChange={(e) => setPass(e.target.value)} />
          <button type="button" className="btn btn-primary" onClick={exportData}>
            Download backup
          </button>
        </div>
        <div className="row">
          <label className="btn" htmlFor="bk-file">
            Restore from file…
          </label>
          <input id="bk-file" ref={fileRef} className="sr-only" type="file" accept="application/json,.json" onChange={(e) => onFile(e.target.files?.[0])} />
          <span className="hint">Restoring replaces everything currently in the app.</span>
        </div>
        {pendingFile ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void doImport(pendingFile, importPass);
            }}
          >
            <label htmlFor="im-pass" className="sr-only">
              Backup passphrase
            </label>
            <input id="im-pass" type="password" autoComplete="off" placeholder="This backup's passphrase" value={importPass} onChange={(e) => setImportPass(e.target.value)} autoFocus />
            <button type="submit" className="btn btn-primary">
              Decrypt & restore
            </button>
            <button type="button" className="btn" onClick={() => setPendingFile(null)}>
              Cancel
            </button>
          </form>
        ) : null}
      </Section>

      {installEvt ? (
        <Section title="Install">
          <p className="lede">Install ShiftWise to open it from your home screen or desktop, full screen and offline.</p>
          <button type="button" className="btn btn-primary" onClick={() => void installEvt.prompt().then(() => setInstallEvt(null))}>
            Install app
          </button>
        </Section>
      ) : null}

      <Section title="Delete everything">
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (wipe !== 'DELETE') return;
            await repo.wipeAll();
            setWipe('');
            toast('All data deleted');
            window.location.reload();
          }}
        >
          <label htmlFor="wipe">Type DELETE to remove all roster days, activities, logs and settings from this device.</label>
          <input id="wipe" value={wipe} onChange={(e) => setWipe(e.target.value)} autoComplete="off" />
          <button type="submit" className="btn btn-danger" disabled={wipe !== 'DELETE'}>
            Delete all data
          </button>
        </form>
      </Section>
    </div>
  );
}
