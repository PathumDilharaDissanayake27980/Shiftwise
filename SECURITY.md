# Security

## Data model

ShiftWise has no backend. Roster, activities, time logs and settings are stored in the browser's IndexedDB on the user's device. Nothing leaves the device unless you turn on phone alerts (below). Links to and from Ascend carry study times and lesson titles in the URL fragment (after `#`), which browsers never send to a server. Incoming Ascend data is schema-validated and saved only after you confirm. The Content Security Policy only allows network requests to the app itself and to `api.github.com`.

### Phone alerts (optional)

When alerts are switched on, the app sends one thing off the device: the next 7 days of alert times and texts. They go to the `alerts` branch of the user's own GitHub repository, encrypted with AES-256-GCM using `ALERTS_KEY`. That key is also stored as an Actions secret. The scheduled workflow decrypts the schedule and sends due messages over HTTPS to the channels you configured: ntfy (`NTFY_TOPIC`; treat the topic name like a password), Telegram, or CallMeBot.

- The GitHub token is stored only in the app's IndexedDB and is never included in backups. Use a fine-grained token limited to one repository, with Contents and Actions permissions and an expiry.
- `sent.json` stores salted SHA-256 hashes of alert ids, not the alerts themselves.
- Workflow logs print counts only, because logs on public repositories are public.
- CSP `connect-src` allows `https://api.github.com` and nothing else.
- Residual risk: anyone with access to the unlocked device can read the token. Revoke it on GitHub if the device is lost.

## Controls

| Threat | Control |
|---|---|
| Script injection (XSS) | React escapes all text. `dangerouslySetInnerHTML` is banned by lint rule. `eval`, `new Function` and implied eval are lint errors. CSP: `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`. |
| Malicious or corrupt backup file | 25 MB size cap. JSON parse in a try block. The full payload is validated with strict Zod schemas (types, ranges, lengths, date formats, record counts) before anything is written. Import runs in a single transaction. |
| Bad data from the UI or assistant | Every repository write passes the same schemas. Overlapping log entries and duplicate activity names are rejected. |
| Lost or stolen backup file | Optional encryption: PBKDF2-SHA-256 (600,000 iterations) → AES-256-GCM with a random salt and IV. GCM authentication rejects a wrong passphrase or a modified file. |
| Someone picking up an unlocked phone | Optional 4–8 digit PIN, hashed with PBKDF2 and a random salt, compared in constant time. After 5 wrong tries the wait doubles from 30 seconds up to 15 minutes. Locks again after 5 minutes in the background. |
| Clickjacking, sniffing, downgrade | `_headers` (Cloudflare Pages / Netlify): `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, HSTS, `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy`. |
| Supply chain | Exact dependency versions, `npm ci` from the lockfile, `npm audit` in CI. Fonts are bundled, so there are no third-party requests at runtime. |
| Assistant changing data unexpectedly | The assistant only proposes actions. The user must tap Apply. |

## Known limitations

- **The PIN lock is a privacy screen, not encryption at rest.** Data in IndexedDB is readable by anyone with access to the unlocked device profile or its developer tools. A short PIN can also be brute-forced offline by someone who copies the browser profile. Use device encryption and a device passcode. Full at-rest encryption (deriving a key from the PIN and encrypting each record) is on the roadmap.
- **GitHub Pages cannot set HTTP headers.** There the CSP comes from the `<meta>` tag, and `frame-ancestors`/HSTS are not applied. Use Cloudflare Pages or Netlify for the full header set.
- `style-src 'unsafe-inline'` is allowed for styles only. No scripts are inline.
- Browser storage can be cleared by the user or, rarely, by the browser. The app requests persistent storage. Users should keep backups.

## Reporting a vulnerability

Email the maintainer privately with steps to reproduce. Do not open a public issue for security problems.
