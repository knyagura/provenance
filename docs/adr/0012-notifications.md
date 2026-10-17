# 0012: Notifications (in-app and email)

Date: 2026-10-17. Status: accepted. Email starts once `RESEND_API_KEY` is set.

## Decision
- **Channels:** an in-app Updates list for everyone, plus email through Resend. No SMS or push for now. Push can reuse the same table later.
- **Events:** four groups, each of which can be switched off for email (the in-app list always shows everything):
  - your turn in a handover (only when the turn passes to you, not on each of your own steps);
  - messages;
  - offers: new, counter, accepted, about to end (6 hours before);
  - sales and problems: sold, payment released, problem reported, staff decision.
- **Made by the database.** Triggers on `orders`, `order_messages` and `offers` write the notifications, so every path is covered: the website, the API, staff actions and scheduled jobs. Nobody can write or read another person's notifications. The in-app text never includes tracking numbers, seal codes or one-time codes.
- **Email outbox.** Each notification records its email state. The `send-notifications` Edge Function runs every minute (pg_cron + pg_net). It claims due rows with `for update skip locked`, sends them, and marks each one sent, or retries it up to 3 times. It uses a Resend idempotency key per notification, so a retry never sends twice. Rows read before sending are skipped. Rows older than 2 days are dropped.
- **Message debounce.** One unread message notification per order, updated with the latest message and a count. Its email waits 2 minutes, then goes at most once every 15 minutes per order.
- **Gifts.** Turn notifications for the unboxing go to the gift's recipient once they have claimed it. Otherwise they go to the buyer.
- The function checks its own caller instead of a JWT. Migration 017 makes a random token inside the database and keeps it in Supabase Vault, so nobody types or sees it. pg_cron sends that token, and the function asks the database whether it matches. Any other caller gets 403.

## Setup (done by the owner; the key goes only into Supabase, never into code or chat)
1. Create a Resend account and an API key with "Sending access".
2. Supabase → Edge Functions → Secrets: add `RESEND_API_KEY`.
3. Until a domain is verified in Resend, emails come from `onboarding@resend.dev` and only reach the Resend account's own address. Once the custom domain is bought, verify it in Resend (DNS records), then add `RESEND_FROM`, for example `NuTuYu <hello@your-domain>`, and `SITE_URL` if the site moves.

## Consequences
- Example mode keeps notifications in the browser (`pv-example-notifications`) and sends no email.
- Tests: `tests/notification_checks.mjs` (database), `web/tests/unit/notifications.test.ts`, and the offers journey in the browser tests.
