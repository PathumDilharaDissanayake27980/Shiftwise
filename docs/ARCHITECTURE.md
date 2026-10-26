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
2. **Allocation pass** (`allocate`): places goal blocks where they fit best, not just first. Every start time on a 15-minute grid is scored:

   `priority × (0.4 + remaining/target) × time fit × routine × repeat penalty`

   - **Time fit** uses `alertness(minute, fixed blocks)`, a transparent shift-work heuristic. It drops in the first 45 minutes after waking (sleep inertia), peaks 1–5 hours after waking, drops in the hour after a shift, in the 13:30–15:30 dip, in the 2 hours before sleep and after 13 hours awake. Focus work uses alertness squared; fitness prefers moderate alertness; light and personal time doesn't mind.
   - **Routine:** the first start time of each activity on each kind of day (for example "Learn on Day shifts") becomes its anchor. Later days score 1.25× within 30 minutes of the anchor, so the same things happen at the same times and become habits.
   - Activities keep 15 minutes from each other. Focus and fitness end by "no heavy work after". Fitness is once a day, at most twice per activity. On under 6 hours of sleep there's one focus block and no workout.
   - The best candidate is placed, then the next, until budgets run out. Gaps of 30 minutes or less between blocks become breaks; the rest is free time.

Three limits keep the week balanced (`dayLoad`, `allocate`):

- **Focus budget** per kind of day (`settings.focusBudget`). Leave and holidays count as Off. The first day off after night shifts is a **recovery day** with at most 90 minutes of focus work.
- **Pacing.** Each goal's share today is `remaining × today's budget ÷ budget left this week` (×1.3 slack, at least one block).
- **Free-time floor.** At most `MAX_PLANNED_SHARE` (60%) of a day's open time is planned. The second day off in a row is a recharge day with no focus work (`settings.restDay`).

**Daily review.** The balanced week includes 20 minutes of spaced recall every day (kind `light`, linked to Ascend as `review`), so it fits even on Graveyard and recharge days. Ascend fills it with a lesson you finished 1, 3, 7, 14 or 30 days ago.

**Weekly growth check** (`domain/growth.ts`, on the Activities screen) compares last week's logged minutes with planned minutes. At 90% or more it suggests a goal 15% higher (15–60 minutes); under 50% it suggests 20% lower. Nothing changes until you tap Apply.

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
