import { useEffect, useRef, useState, type FormEvent } from 'react';
import { respond, type AssistantAction } from '../../domain/assistant';
import { repo } from '../../data/repo';
import { Icon, useToast } from '../components/common';
import { useAppData } from '../data';
import { cx, errorMessage } from '../util';

interface Msg {
  id: number;
  from: 'me' | 'bot';
  text: string;
  actions?: AssistantAction[];
  state?: 'pending' | 'applied' | 'dismissed';
}

const GREETING: Msg = {
  id: 0,
  from: 'bot',
  text: 'Hi! I plan your day around your shifts. Ask how tired you are, when you can study, or tell me a roster change like "set friday night office". Type help for everything I understand.',
};

async function run(action: AssistantAction): Promise<void> {
  switch (action.type) {
    case 'setRoster':
      return repo.setRosterDays(action.days);
    case 'clockIn':
      await repo.clockIn(action.shiftDate);
      return;
    case 'clockOut':
      await repo.clockOut();
      return;
    case 'startActivity':
      await repo.startTimer('activity', action.activityId);
      return;
    case 'stopTimers':
      return repo.stopTimers();
    case 'addActivity':
      await repo.saveActivity(action.activity);
      return;
    case 'logActivity':
      await repo.saveLog({ category: 'activity', activityId: action.activityId, start: action.start, end: action.end });
      return;
    case 'logSleep':
      await repo.saveLog({ category: 'sleep', start: action.start, end: action.end });
      return;
  }
}

export function AssistantScreen() {
  const data = useAppData();
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>(['What should I do today?', 'How tired am I?', 'How much free time do I have?', 'When can I study?']);
  const seq = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs]);

  const ask = (text: string) => {
    const q = text.trim().slice(0, 500);
    if (!q) return;
    const bundle = data.week(data.currentWeek);
    const r = respond(q, {
      today: data.today,
      now: new Date(),
      settings: data.settings,
      activities: data.activities,
      roster: data.roster,
      weekPlans: bundle.plans,
      fatigue: bundle.fatigue,
      report: bundle.report,
      running: data.running,
    });
    const me: Msg = { id: seq.current++, from: 'me', text: q };
    const bot: Msg = { id: seq.current++, from: 'bot', text: r.text, ...(r.actions.length ? { actions: r.actions, state: 'pending' as const } : {}) };
    setMsgs((m) => [...m.slice(-60), me, bot]);
    setSuggestions(r.suggestions);
    setInput('');
  };

  const apply = async (m: Msg) => {
    try {
      for (const a of m.actions ?? []) await run(a);
      setMsgs((all) => all.map((x) => (x.id === m.id ? { ...x, state: 'applied' } : x)));
      toast('Done');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  return (
    <div className="screen chat-screen">
      <header className="page-head">
        <div>
          <p className="eyebrow">Assistant · runs on your device</p>
          <h1>Ask about your week</h1>
        </div>
      </header>
      <div className="chat" aria-live="polite">
        {msgs.map((m) => (
          <div key={m.id} className={cx('msg', m.from === 'me' ? 'msg-me' : 'msg-bot')}>
            <p>{m.text}</p>
            {m.actions && m.state === 'pending' ? (
              <div className="msg-actions">
                <button type="button" className="btn btn-primary btn-small" onClick={() => apply(m)}>
                  <Icon name="check" size={14} /> Apply
                </button>
                <button type="button" className="btn btn-small" onClick={() => setMsgs((all) => all.map((x) => (x.id === m.id ? { ...x, state: 'dismissed' } : x)))}>
                  Dismiss
                </button>
              </div>
            ) : null}
            {m.state === 'applied' ? <p className="msg-state">Applied</p> : null}
            {m.state === 'dismissed' ? <p className="msg-state">Dismissed</p> : null}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="chat-bar">
        <div className="chips">
          {suggestions.map((s) => (
            <button key={s} type="button" className="chip-btn" onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
        <form className="chat-form" onSubmit={onSubmit}>
          <label htmlFor="chat-in" className="sr-only">
            Message
          </label>
          <input id="chat-in" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. set tomorrow day office" autoComplete="off" maxLength={500} />
          <button type="submit" className="btn btn-primary btn-icon" aria-label="Send">
            <Icon name="send" />
          </button>
        </form>
      </div>
    </div>
  );
}
