import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { FatigueLevel } from '../../domain/fatigue';
import type { PlanNote } from '../../domain/types';
import { cx } from '../util';

// ---- Icons (inline, no icon font or network) ----------------------------------------------------
const PATHS: Record<string, string> = {
  today: 'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  week: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M9 13h2M13 13h2M9 16h2',
  log: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  insights: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  assistant: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
  activities: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14.4H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  chevL: 'M15 5l-7 7 7 7',
  chevR: 'M9 5l7 7-7 7',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 1 1 8 0v4',
  send: 'M4 12l16-8-6 16-2-6z',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18',
  ascend: 'M3 20l6-9 4 5 3-4 5 8zM15 4h5v5M20 4l-6 6',
};

export function Icon({ name, size = 20, label }: { name: keyof typeof PATHS | string; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

// ---- Layout pieces ------------------------------------------------------------------------------
export function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section-head">
        <h2 id={id}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Notes({ notes }: { notes: PlanNote[] }) {
  if (!notes.length) return null;
  return (
    <div className="notes">
      {notes.map((n, i) => (
        <div key={i} className={cx('note', `note-${n.level}`)} role={n.level === 'bad' ? 'alert' : undefined}>
          <strong>{n.title}</strong>
          <span>{n.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Stat({ value, label, sub }: { value: ReactNode; label: string; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-v">{value}</div>
      <div className="stat-k">{label}</div>
      {sub ? <div className="stat-s">{sub}</div> : null}
    </div>
  );
}

const LEVEL_TEXT: Record<FatigueLevel, string> = { low: 'Low', moderate: 'Moderate', high: 'High', severe: 'Severe' };

export function FatigueGauge({ score, level, size = 120 }: { score: number; level: FatigueLevel; size?: number }) {
  const r = 46;
  const c = Math.PI * r;
  const filled = (Math.min(100, Math.max(0, score)) / 100) * c;
  return (
    <div className={cx('gauge', `lvl-${level}`)} style={{ width: size }}>
      <svg viewBox="0 0 120 70" width={size} height={(size * 70) / 120} role="img" aria-label={`Fatigue ${score} out of 100, ${LEVEL_TEXT[level]}`}>
        <path d="M14 62a46 46 0 0 1 92 0" className="gauge-track" />
        <path d="M14 62a46 46 0 0 1 92 0" className="gauge-fill" strokeDasharray={`${filled} ${c}`} />
      </svg>
      <div className="gauge-label">
        <b>{score}</b>
        <span>{LEVEL_TEXT[level]}</span>
      </div>
    </div>
  );
}

export function Meter({ value, max, label, tone }: { value: number; max: number; label?: string | undefined; tone?: string | undefined }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="meter" role="meter" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={Math.round(max)} aria-label={label}>
      <div className={cx('meter-fill', tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

// ---- Toasts -------------------------------------------------------------------------------------
type Toast = { id: number; text: string; tone: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('toast', t.tone === 'error' && 'toast-error')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
