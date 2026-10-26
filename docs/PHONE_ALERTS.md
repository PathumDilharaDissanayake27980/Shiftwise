# Phone alerts

ShiftWise can send your reminders to your phone even when the app is closed. Everything used here is free.

## How it works

```
ShiftWise app ──(encrypted schedule)──▶ "alerts" branch of your GitHub repo
                                                │
          GitHub Actions, every 10 minutes ◀────┘
                    │  decrypts with ALERTS_KEY, finds what is due
                    ▼
        ntfy app · Telegram · WhatsApp (CallMeBot)   ← every channel you set up
```

1. You define alert rules on the app's **Alerts** page. The app turns them into concrete messages for the next 7 days.
2. When something changes, the app encrypts that schedule (AES-256-GCM) and saves it as `alerts.enc.json` on a separate `alerts` branch. Your site is not redeployed.
3. The **Phone alerts** workflow (`.github/workflows/phone-alerts.yml`) runs every 10 minutes, decrypts the schedule, and sends whatever is due to each configured channel. It records what it sent in `sent.json` as salted hashes, so nothing is sent twice. If one channel fails, the others still deliver.
4. If no channel is set up yet, the run ends quietly with a notice instead of failing.

## Choosing a channel

| Channel | Secrets | Notes |
|---|---|---|
| **ntfy** (recommended) | `NTFY_TOPIC` (optional: `NTFY_SERVER`, `NTFY_TOKEN`) | Free app for Android and iPhone, no account or phone number needed, delivers in seconds. The topic name works like a password. |
| **Telegram** | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Free and reliable. Create a bot with @BotFather, send it any message, then get your chat id from `https://api.telegram.org/bot<token>/getUpdates`. |
| WhatsApp via CallMeBot | `CALLMEBOT_PHONE`, `CALLMEBOT_APIKEY` | A free hobby service that often stops responding. Keep it only as an extra channel. |

## One-time setup with ntfy (about 5 minutes)

The **Alerts → Set up phone alerts** panel in the app walks you through this and generates both values.

1. **Install ntfy** from the Play Store or App Store. Tap **+** and subscribe to the private topic the app shows you, such as `shiftwise-k3x9…`.
2. **Add repository secrets.** In GitHub, open the repo, then **Settings → Secrets and variables → Actions → New repository secret**:
   - `NTFY_TOPIC`: the topic from step 1
   - `ALERTS_KEY`: the key shown in the app's setup panel
3. **Create a token for the app.** Go to github.com/settings/personal-access-tokens/new and create a fine-grained token:
   - Repository access: **Only select repositories** → your ShiftWise repo
   - Permissions: **Contents: Read and write**, **Actions: Read and write**
   - Expiry: 90 days. When it expires, create a new one and paste it in the app.
4. Paste the token in the app, press **Connect & upload alerts**, then **Send a test message**.

## Your own alerts

| Trigger | Fires |
|---|---|
| Shift starts / Shift ends | Before or after each shift. Can be limited to some shift types. |
| Time to leave | Relative to when you must leave on office days. |
| Forgot to clock out | Only while you're clocked in, after the scheduled end. |
| Wake-up / Bedtime | Relative to the day's planned wake-up or bedtime. |
| Activity starts | When a planned activity begins, for one activity (such as *Learn (Ascend lessons)*) or any. |
| Daily brief | Today's plan, relative to wake-up. |
| Fatigue or rest warning | Only on days with fatigue at or above your threshold, or a tight changeover. |
| Custom reminder | Your own text at a fixed time on chosen weekdays. |

Messages can use placeholders such as `{shift}`, `{start}`, `{leave}`, `{activity}`, `{bed}`, `{tomorrow}`, `{score}` and `{plan}`.

The Ascend Android app already reminds you before each study block, so you don't need an *Activity starts* alert for those.

## Things to know

- **Timing.** GitHub starts scheduled runs every 10 minutes, but at busy times a run can be 5–15 minutes late. Alerts are sent up to 45 minutes late, and skipped if later than that. Don't rely on it as an alarm clock.
- **Keep the schedule fresh.** The app uploads the next 7 days. Open ShiftWise at least once a week, and after roster changes.
- **GitHub may pause the schedule** if the repository has no activity for 60 days. If alerts stop, open **Actions → Phone alerts** and click **Enable workflow**.
- **Privacy.** The repository is public, so the schedule is encrypted and workflow logs show only counts. Your token stays on your device and is not included in backups.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Run says "No alert channel is set up yet" | Add `NTFY_TOPIC` (or the Telegram secrets) as described above. |
| Run says "ALERTS_KEY is not set yet" | Copy the key from **Alerts → Connection settings** into a secret named `ALERTS_KEY`. |
| Test message never arrives on ntfy | The topic in the app's subscription must match `NTFY_TOPIC` exactly. |
| Run says "Could not decrypt" | `ALERTS_KEY` in GitHub doesn't match the app. Copy it again. |
| App says "GitHub rejected the token" | The token is wrong or expired. Create a new one. |
| WhatsApp only: "CallMeBot did not accept the message" | CallMeBot is down or the key is wrong. Use ntfy or Telegram instead. |
