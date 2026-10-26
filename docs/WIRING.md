# ShiftWise ↔ Ascend wiring

Two apps, one system:

| | ShiftWise | Ascend |
|---|---|---|
| Role | **Scheduler and manager**: decides *when* | **Timetable and progress tracker**: decides *what* |
| Owns | Roster, sleep, meals, balance, fatigue, time log, phone alerts | Curriculum (six-track guide + original tracks), lessons, hands-on tasks, ticks, streaks |
| Sends | Study blocks for 14 days, each day's shift, wake, bedtime and fatigue | Completed sessions, a progress snapshot, upcoming lessons with their tasks |
| Shows from the other | Lesson titles and tasks inside its plan, Ascend progress on Today, lessons in phone alerts | Shift, wake, bed and fatigue for each day; times exactly in ShiftWise's free blocks |

## How they connect

Each app owns one record and only reads the other's. They travel three ways, and both apps use whichever is available:

1. **Live, same browser.** Both web apps are served from `pathumdilharadissanayake27980.github.io`, so they share storage. ShiftWise writes `localStorage["wiring:shiftwise"]` and Ascend writes `localStorage["wiring:ascend"]`. Each reacts to the other's `storage` event the moment it changes, even with both open side by side. No buttons are involved.
2. **Cloud, any device (including the Android app).** Encrypted files on the `alerts` branch of the ShiftWise repo: `wiring/shiftwise.enc.json` and `wiring/ascend.enc.json`. They are sealed with AES-256-GCM using the same key as the alert schedule (`ALERTS_KEY`), so the public branch shows nothing. Each app pushes when its data changes and pulls on open, every 10 minutes, and when it comes back to the screen. To set this up, tap **Connect Ascend app** on ShiftWise's Today card once. Alerts must be connected, because it uses the same GitHub token.
3. **Links (fallback).** `…/ascend/#sw=` (or `ascend://import?sw=` on Android) carries the plan, and `…/Shiftwise/#ascend=` carries progress. Sessions arriving by link are logged only after you confirm.

## Rules

- **ShiftWise decides the times.** Ascend never schedules study outside the blocks ShiftWise sent. Days ShiftWise hasn't planned yet use a ~10h fallback week with nothing after 9:30 PM.
- **Fatigue-aware.** On a day with fatigue 50 or more, Ascend swaps new lessons for review in the same slots.
- **No double counting.** ShiftWise logs a completed session only if no activity entry already overlaps it.
- **Newest wins.** Each record carries a timestamp, so an older record never overwrites a newer one.
- **Privacy.** Nothing goes to any server except your own GitHub repo, and that copy is encrypted. Ascend's backups and "Save copy" never include the GitHub token.

## Formats (v1)

```ts
// wiring:shiftwise / wiring/shiftwise.enc.json
{ v: 1, app: 'shiftwise', at: epochMs, week: { learn, build, cert },     // weekly goal minutes
  days: [{ d: 'YYYY-MM-DD', c: 'M'|'D'|'N'|'G'|'OFF'|…,
           b: [[startMin, minutes, 'learn'|'build'|'cert'], …],
           s?: [shiftStart, shiftEnd], w?: wakeMin, z?: bedMin, f?: fatigue0to100, fl?: level }] }

// wiring:ascend / wiring/ascend.enc.json
{ v: 1, app: 'ascend', at: epochMs,
  items: [{ d, st, m, k: 'learn'|'build'|'cert', t: title }],              // done, last 14 days
  p:  { month, phase, done, total, streak, hours, next: [[d, st, title]] },
  up: [[d, st, minutes, title, task]] }                                    // upcoming lessons
```

Code: `src/domain/ascend.ts` (formats and pure logic), `src/data/wiring.ts` (cloud), and `src/ui/wiring.tsx` (live). In Ascend, see the "live wiring" section of `index.html`.
