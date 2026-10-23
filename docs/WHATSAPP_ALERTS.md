# WhatsApp alerts

ShiftWise can send your reminders to WhatsApp, even when the app is closed. No paid services are needed.

## How it works

```
ShiftWise app ──(encrypted schedule)──▶ "alerts" branch of your GitHub repo
                                                │
          GitHub Actions, every 10 minutes ◀────┘
                    │  decrypts with ALERTS_KEY, finds what is due
                    ▼
            CallMeBot ──▶ your WhatsApp
```

1. You define alert rules in the app (**Alerts** page). The app turns them into concrete messages for the next 7 days.
2. When something changes, the app encrypts that schedule (AES-256-GCM) and saves it as `alerts.enc.json` on a separate `alerts` branch. Your site is not redeployed by this.
3. The **WhatsApp alerts** workflow runs every 10 minutes, decrypts the schedule, and sends anything due through CallMeBot. It records what it sent in `sent.json` as salted hashes, so nothing is sent twice.

## One-time setup (about 10 minutes)

The **Alerts → Set up WhatsApp alerts** panel in the app walks you through these steps and generates your encryption key.

1. **CallMeBot key.** Save `+34 611 01 16 37` as a contact. Send it, in WhatsApp: `I allow callmebot to send me messages`. It replies with your API key. If that number stops working, check callmebot.com for the current one.
2. **Repository secrets.** In GitHub, open your repo, then **Settings → Secrets and variables → Actions → New repository secret**, and add:
   - `CALLMEBOT_PHONE`: your number with country code, e.g. `+94771234567`
   - `CALLMEBOT_APIKEY`: the key from step 1
   - `ALERTS_KEY`: the key shown in the app's setup panel
3. **Token for the app.** Go to github.com/settings/personal-access-tokens/new and create a fine-grained token:
   - Repository access: **Only select repositories** → your ShiftWise repo
   - Permissions: **Contents: Read and write**, **Actions: Read and write**
   - Expiry: 90 days is a sensible choice. When it expires, create a new one and paste it in the app.
4. Paste the token in the app and press **Connect & upload alerts**, then **Send a test message**.

## Your own alerts

Each alert has a trigger, a timing and a message. You can add as many as you like, turn them off, or restore the defaults.

| Trigger | Fires |
|---|---|
| Shift starts / Shift ends | Before or after each shift. Can be limited to some shift types. |
| Time to leave | Relative to when you must leave on office days. |
| Forgot to clock out | Only while you're clocked in, after the scheduled end. |
| Wake-up / Bedtime | Relative to the day's planned wake-up or bedtime. |
| Activity starts | When a planned activity begins, for one activity or any. |
| Daily brief | Today's plan, relative to wake-up. |
| Fatigue or rest warning | Only on days with fatigue at or above your threshold, or a tight changeover. |
| Custom reminder | Your own text at a fixed time on chosen weekdays. |

Messages can use placeholders such as `{shift}`, `{start}`, `{leave}`, `{activity}`, `{bed}`, `{tomorrow}`, `{score}` and `{plan}`. Tap a placeholder in the editor to insert it. The editor shows the next message exactly as it will arrive.

## Things to know

- **Timing.** GitHub starts scheduled runs every 10 minutes, but at busy times it can be 5–15 minutes late. Alerts are sent up to 45 minutes late, and are skipped if they are later than that. Don't rely on it as an alarm clock.
- **Keep the schedule fresh.** The app uploads the next 7 days. Open ShiftWise at least once a week, and after roster changes. "Forgot to clock out" only works if the app synced after you clocked in, which it does automatically when you are online.
- **GitHub may pause the schedule** in a repository with no activity for 60 days. If alerts stop, open **Actions → WhatsApp alerts** and click **Enable workflow**.
- **Privacy.** Your repository is public, so everything on the `alerts` branch is visible. That's why the schedule is encrypted. Workflow logs show only counts, never message text. Your token stays on your device and is not included in backups.
- **CallMeBot** is a free hobby service with no guarantees. For a product you sell, switch the sender to Meta's WhatsApp Business Cloud API. Only `sendWhatsApp()` in `scripts/send-alerts.mjs` needs to change.

## Troubleshooting

| Symptom | Fix |
|---|---|
| App says "GitHub rejected the token" | The token is wrong or expired. Create a new one (step 3). |
| App says "missing a permission" | The token needs Contents **and** Actions set to Read and write. |
| Test message never arrives | Open **Actions → WhatsApp alerts → latest run**. A "Missing CALLMEBOT_…" error means a secret is missing or misspelled. |
| Run says "Could not decrypt" | `ALERTS_KEY` in GitHub doesn't match the app. Copy it again from **Alerts → Connection settings**. |
