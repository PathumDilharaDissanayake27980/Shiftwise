import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, starterActivities } from '../domain/defaults';
import { DecryptError, open, seal } from './crypto';
import { ShiftWiseDB } from './db';
import { Repo, ValidationError } from './repo';

let repo: Repo;
let n = 0;

beforeEach(() => {
  repo = new Repo(new ShiftWiseDB(`test-${n++}`));
});

describe('crypto', () => {
  it('round-trips and rejects a wrong passphrase', async () => {
    const sealed = await seal('hello', 'correct horse', 100_000);
    expect(await open(sealed, 'correct horse')).toBe('hello');
    await expect(open(sealed, 'wrong')).rejects.toBeInstanceOf(DecryptError);
  });
  it('rejects tampered ciphertext', async () => {
    const sealed = await seal('hello', 'pass phrase', 100_000);
    const bad = { ...sealed, ciphertext: sealed.ciphertext.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) };
    await expect(open(bad, 'pass phrase')).rejects.toBeInstanceOf(DecryptError);
  });
});

describe('repo', () => {
  it('validates settings and roster', async () => {
    await expect(repo.saveSettings({ ...DEFAULT_SETTINGS, commuteMin: -5 })).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.setRosterDays([{ date: '2026-02-31', code: 'M', mode: 'H' }])).rejects.toThrow(/YYYY-MM-DD/);
    await repo.setRosterDays([{ date: '2026-10-26', code: 'N', mode: 'O' }]);
    expect(await repo.rosterRange('2026-10-26', '2026-11-01')).toHaveLength(1);
    await repo.setRosterDays([{ date: '2026-10-26', code: 'OFF', mode: 'H' }]);
    expect(await repo.rosterRange('2026-10-26', '2026-11-01')).toHaveLength(0);
  });

  it('rejects duplicate activity names and bad blocks', async () => {
    const [a] = starterActivities(Date.now());
    await repo.saveActivity(a!);
    await expect(repo.saveActivity({ ...a!, id: crypto.randomUUID() })).rejects.toThrow(/already/);
    await expect(repo.saveActivity({ ...a!, minBlockMin: 120, maxBlockMin: 60 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('clocks in and out once', async () => {
    const t = Date.now();
    await repo.clockIn('2026-10-26', t);
    await expect(repo.clockIn('2026-10-26', t)).rejects.toThrow(/already/);
    const out = await repo.clockOut(t + 3_600_000);
    expect(out?.end).toBe(t + 3_600_000);
    expect(await repo.runningLogs()).toHaveLength(0);
  });

  it('stops the previous timer when another starts and blocks overlaps', async () => {
    const t = Date.now() - 4 * 3_600_000;
    const [a, b] = starterActivities(Date.now());
    await repo.saveActivity(a!);
    await repo.saveActivity(b!);
    await repo.startTimer('activity', a!.id, t);
    await repo.startTimer('activity', b!.id, t + 1_800_000);
    const running = await repo.runningLogs();
    expect(running).toHaveLength(1);
    expect(running[0]?.activityId).toBe(b!.id);
    await expect(repo.saveLog({ category: 'activity', activityId: a!.id, start: t + 600_000, end: t + 900_000 })).rejects.toThrow(/overlaps/);
  });

  it('throttles wrong PIN attempts', async () => {
    await repo.setPin('2468');
    const now = Date.now();
    for (let i = 0; i < 4; i++) expect((await repo.unlock('0000', now)).ok).toBe(false);
    const fifth = await repo.unlock('0000', now);
    expect(fifth.ok === false && fifth.waitSec > 0).toBe(true);
    expect((await repo.unlock('2468', now)).ok).toBe(false);
    expect((await repo.unlock('2468', now + 60_000)).ok).toBe(true);
  }, 30_000);

  it('exports and imports an encrypted backup', async () => {
    const [a] = starterActivities(Date.now());
    await repo.saveActivity(a!);
    await repo.setRosterDays([{ date: '2026-10-26', code: 'D', mode: 'O' }]);
    const file = await repo.exportBackup('long passphrase');
    expect(Repo.isEncrypted(file)).toBe(true);
    expect(file).not.toContain(a!.name);
    const other = new Repo(new ShiftWiseDB(`test-${n++}`));
    await expect(other.importBackup(file, 'nope nope nope')).rejects.toBeInstanceOf(DecryptError);
    const r = await other.importBackup(file, 'long passphrase');
    expect(r).toEqual({ roster: 1, activities: 1, logs: 0 });
  }, 30_000);

  it('rejects malformed backups', async () => {
    await expect(repo.importBackup('{"format":"shiftwise-backup","version":1}')).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.importBackup('not json')).rejects.toThrow(/not a ShiftWise backup/);
  });
});
