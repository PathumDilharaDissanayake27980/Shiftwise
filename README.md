# ShiftWise

Plan your life around rotating shifts. ShiftWise takes your roster (Morning, Day, Night, Graveyard; home or office) and builds a day-by-day plan around it: sleep, meals, commute, and a balanced week of career growth, exercise, people and free time. It logs the hours you actually work, scores fatigue risk, and reports where your free time really is.

It is wired to **[Ascend](https://pathumdilharadissanayake27980.github.io/ascend/)**, the study timetable and progress tracker. ShiftWise decides *when* you study and Ascend decides *what*. They sync automatically: live in the same browser, and through your GitHub repo (encrypted) for the Android app and other devices. Each app shows the other's data. See [docs/WIRING.md](docs/WIRING.md).

It is one app for phone and desktop: an installable, offline-first Progressive Web App. All data stays on the device.

## Features

| Area | What it does |
|---|---|
| **Roster** | Set each day's shift and location, or paste a whole week (`m/h d/o n/h n/h off off g/h`). Shift times are editable. |
| **Planner** | Places sleep, wind-down, commute, meals and fixed commitments, then fills free stretches with your weekly goals by priority, preferred time of day and remaining target. Handles night shifts that cross midnight and graveyard split sleep. |
| **Balance** | Each kind of day has a focus budget (2h after a Morning shift, 2.5h on a Night day, none on Graveyard days, 4.5h on a day off). Goals are spread by how much room each day has. At most 60% of a day's free time is planned, the second day off in a row is a recharge day, and there's a 30-minute unwind after Morning and Day shifts. **Activities → Balanced week** sets up about 10h of career growth (lessons, portfolio project, exam prep), freelance, gym, reading and time with family and friends. |
| **Ascend link** | **Open in Ascend** sends the next 14 days of study blocks, so lessons land exactly in your free time. Ascend's **Send progress** sends completed sessions back to your log. Opens the Android app directly when it's installed. |
| **Changeover checks** | Flags pairings with too little rest (for example Night → Morning), using the EU 11-hour daily rest rule as a reference. |
| **Time log** | Clock in and out of shifts (a night shift clocks into the right rostered date after midnight), run activity and sleep timers, add or edit entries by hand. Shows late starts and overtime. |
| **Activities** | Your own goals with weekly hours, block lengths, preferred time, priority, colour and fixed weekly slots. |
| **Insights** | Fatigue score 0–100 with its drivers and advice, a two-week trend, how each day is spent, free time by time of day, goal progress, work hours vs. logged, and a matrix of every shift changeover. |
| **Assistant** | An offline rules engine. Ask "how tired am I?", "when can I study?", or say "set friday night office", "log 2h freelance", "add guitar 3h per week evening". Changes are shown first and applied only when you tap Apply. |
| **Phone alerts** | Your own reminder rules (shift start, time to leave, forgot to clock out, bedtime, activity start, daily brief, fatigue warnings, custom), delivered by a free scheduled GitHub Action to the ntfy app (recommended), Telegram, or WhatsApp via CallMeBot. See [docs/PHONE_ALERTS.md](docs/PHONE_ALERTS.md). |
| **Privacy & security** | No accounts and no trackers. Everything stays on the device except the encrypted alert schedule, if you turn alerts on. Optional PIN lock with attempt throttling. Encrypted backups (AES-256-GCM). Strict Content Security Policy. |

## Quick start

```bash
npm ci
npm run dev        # http://localhost:5173
npm run check      # typecheck + lint + tests
npm run build      # production build in dist/
npm run preview    # serve the build locally
```

Requires Node 20 or newer.

## Free hosting

The build is static files, so any static host works. Three free options:

**GitHub Pages (set up already).** Push this folder to a GitHub repository, then in the repo go to Settings → Pages → Source and choose "GitHub Actions". Every push to `main` runs the tests and publishes to `https://<you>.github.io/<repo>/`. The workflow is `.github/workflows/deploy-pages.yml`.

**Cloudflare Pages (recommended for security headers).** Create a Pages project from the repo with build command `npm run build` and output folder `dist`. The `public/_headers` file adds HSTS, CSP, frame blocking and other headers. You also get a free `*.pages.dev` domain and can attach your own.

**Netlify.** Same settings as Cloudflare (`npm run build`, publish `dist`). Netlify also reads `_headers`.

## Install on phone and desktop

Open the hosted URL, then:

- **Android (Chrome):** menu → *Install app*.
- **iPhone (Safari):** Share → *Add to Home Screen*.
- **Windows / macOS (Chrome or Edge):** the install icon in the address bar, or Settings → *Install app* inside ShiftWise.

After the first load it works offline. When a new version is deployed the app offers an **Update** button.

Because data is stored per device, use **Settings → Backup & restore** to move it between your phone and laptop.

## Project layout

```
src/
  domain/      Pure TypeScript business logic, no browser APIs (fully unit-tested)
    planner.ts     day and week planning
    schedule.ts    shift windows, wake/bed times, changeover checks
    fatigue.ts     fatigue-risk model
    analytics.ts   weekly report and insights
    assistant.ts   rules-based assistant (pure function: text in, reply + proposed actions out)
    ascend.ts      the two-way link with Ascend (study blocks out, completed sessions in)
  data/        IndexedDB (Dexie), Zod validation, WebCrypto, backup/restore, app lock
  ui/          React screens and components
docs/          Architecture, security notes, roadmap
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [SECURITY.md](SECURITY.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## Licence

All rights reserved. See `package.json` (`"license": "UNLICENSED"`). Choose a licence before you distribute or sell it.
