# Architecture

## Layers

```
ui/       React 19 screens  ──reads──▶  ui/data.tsx (live queries + derived plans)
                               │
data/     Repo (validated writes, backup, lock) ──▶ Dexie / IndexedDB
                               │
domain/   pure functions: planner · schedule · fatigue · analytics · assistant
```

- **domain/** has no dependency on the browser, storage or React. Everything is deterministic and unit-tested, so it can be reused by a server, a React Native app or a worker without changes.
- **data/** is the only code that touches IndexedDB. Every write and every imported backup passes through a Zod schema (`schemas.ts`). The UI calls `repo.*` and never Dexie directly.
- **ui/** derives everything else (plans, fatigue, reports) from four live queries: settings, roster rows, activities and logs. When any of them changes, the screens update.

## Planner

`planDays(dates, roster, settings, activities)` plans consecutive days in two passes per day.

1. **Fixed pass** (`buildFixed`): carried-over night shift and post-shift sleep, or the normal night's sleep → morning routine → commute → shift → commute home → graveyard breakfast and recovery sleep → tonight's wind-down and sleep (bedtime depends on *tomorrow's* shift) → fixed activity slots → lunch and dinner if a free window exists → changeover warnings.
2. **Allocation pass** (`allocate`): walks the free gaps in time order and, for each position, picks the activity with the best score:

   `priority × (0.4 + remaining/target) × time-of-day fit × first-block bonus × repeat penalty`

   Focus and fitness work stop at the "no heavy work after" time. Fitness is limited to once a day. On short sleep (under 6 hours) the day gets one focus block and no workout. What is left becomes free time.

Weekly targets are shared across the 7 days, and three limits keep the week balanced (`dayLoad`, `allocate`):

- **Focus budget** per kind of day (`settings.focusBudget`: Morning, Day, Night, Graveyard, Off). Leave and holidays count as Off.
- **Pacing.** Each goal's share today is `remaining × today's budget ÷ budget left this week` (×1.3 slack, at least one block). The week fills evenly instead of piling onto the first free evenings.
- **Free-time floor.** At most `MAX_PLANNED_SHARE` (60%) of a day's open time is planned. The second day off in a row is a recharge day with no focus work (`settings.restDay`).

## Ascend link

`domain/ascend.ts` builds the handoff: for the next 14 days, each block of an activity with `link: 'learn' | 'build' | 'cert'` becomes `[start, minutes, kind]`. It is base64url JSON in the URL fragment (`…/ascend/#sw=…`), or `intent://import?sw=…` on Android so the installed app opens, falling back to the web version. Ascend sends completed sessions back as `#ascend=…`. `ascendReportSchema` validates them, and `AscendImport` shows a confirm dialog before `repo.importSessions` writes them. Overlapping entries are skipped, so a repeated link adds nothing.

## Fatigue model

`fatigue.ts` adds points for factors used in shift-work fatigue research and caps the total at 100:

| Driver | Points |
|---|---|
| Sleep before today < 7h / 6h / 5h | 7 / 15 / 25 |
| Sleep debt over 7 days | 4 per hour, max 30 |
| Work between 00:00 and 06:00 in the last 2 days | 2.5 per hour, max 20 |
| Consecutive night or graveyard shifts | 5 per extra night, max 15 |
| Changeovers under 11 hours in 7 days | 5 each, max 15 |
| Work hours over 45 in 7 days | 2 per hour, max 10 |
| More than 5 work days in a row | 5 per extra day, max 10 |

Levels are low (under 30), moderate (under 50), high (under 70) and severe. Logged sleep and logged shift times override the plan where they exist. The weights are a transparent heuristic, not a validated clinical model, and the UI says so.

## Assistant

`respond(text, context)` is a pure function that returns `{ text, actions, suggestions }`. Actions are proposals (set roster, clock in, log time, add activity) that the UI shows with an **Apply** button. Nothing changes until the user confirms.

To add an LLM later, keep this interface. Call the model from a server you control (never ship an API key in the app), give it the same context object, and validate its proposed actions with the same Zod schemas before showing them.

## Offline and updates

`vite-plugin-pwa` generates a Workbox service worker that precaches the whole app, including fonts, which are self-hosted. Updates use the "prompt" strategy: the app shows an **Update** button instead of reloading under the user.

## Testing

`npm test` runs the Vitest suites in `src/domain` and `src/data`. The data tests use `fake-indexeddb`, so they exercise the real Dexie schema.
