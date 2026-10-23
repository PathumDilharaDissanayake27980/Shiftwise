# Roadmap to a sellable product

The current version is a complete single-user app with no running costs. These are the steps to turn it into something you can sell, roughly in order.

## 1. Before charging anyone

- **Choose a licence and terms.** Write a privacy policy (simple, because no data leaves the device) and terms of use. Add a health disclaimer to the fatigue feature, which the UI already does.
- **Brand and domain.** Check that "ShiftWise" is free to use in your markets before you invest in it, or rename it. Point a custom domain at Cloudflare Pages.
- **Accessibility pass.** Test with a screen reader and keyboard only.
- **End-to-end tests.** Add Playwright tests for the main flows: roster entry, clock in and out, backup and restore.

## 2. Ways to charge with no backend

- **One-time licence key.** Sell through Lemon Squeezy or Gumroad, and unlock premium features (for example the assistant and insights) when the user enters a signed key. Verify the signature in the app with a public key. This stops casual sharing, not determined copying.
- **App stores.** Wrap the PWA with Capacitor for Google Play and the App Store. Google Play also accepts PWAs directly through a Trusted Web Activity (Bubblewrap). Store listings handle payment.

## 3. Team and enterprise version (needs a backend)

This is where the money is: support teams like GTN EU run rosters for many people.

- **Accounts and sync.** Supabase or Firebase (both have free tiers), or Cloudflare Workers + D1. Add end-to-end encryption so the server only holds ciphertext.
- **Team rosters.** A lead publishes the roster once and everyone's app updates. Import from the Excel sheet the team already uses (parse cell colours for shift type and letters for H/O/M).
- **Manager dashboard.** Coverage per shift, fatigue alerts across the team (anonymised and opt-in), changeover rule violations, overtime reports.
- **Enterprise requirements.** SSO (SAML/OIDC), role-based access, audit logs, data residency, a published security policy, and later SOC 2.

## 4. AI upgrade

Keep the `respond()` interface and add an LLM behind your own server endpoint for free-form questions and weekly coaching. Rate-limit it per user, never send more personal data than the question needs, and validate every proposed action with the existing schemas.
