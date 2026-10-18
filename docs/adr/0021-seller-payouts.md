# 0021: Seller payouts with Stripe Connect

Date: 2026-10-18. Status: accepted. Off until the owner adds Stripe keys and turns on Connect.

## Decision
- **Stripe Connect Express.**
  - Sellers tap *Set up payouts* (Account, or Your sales) and finish on Stripe's own pages.
  - Stripe collects their bank details and checks who they are. NuTuYu keeps only the Stripe account id, in a private table.
  - *Payout details and bank account* opens the seller's Stripe dashboard.
- **When money moves.**
  - When an order's payment is released (the buyer confirms, it auto-confirms, or staff release a dispute), a payout is queued for the seller's share. Any live shipping label is taken off.
  - If the seller hasn't set up payouts, the payout waits, and they're told how much is waiting.
- **Sending.**
  - The `send-payouts` Edge Function runs every 10 minutes (migration 028b, with a token kept in Vault).
  - Each payout becomes a Stripe transfer, linked to the buyer's charge, so it waits for that money to clear.
  - An idempotency key per payout stops double payments.
  - A failed transfer is retried up to 5 times, then waits for staff.
- **Staff** (the *Payouts* tab) see every payout by status, and can hold, release or retry. Each action needs a note, recorded with their name.
- **Refunds and suspensions hold payouts.** A refund after release, or a suspended seller (ADR 0022), puts payouts on hold.

## To switch it on
1. In Stripe, turn on **Connect** with Express accounts for the UK, and set the platform's branding.
2. Add the Supabase function secrets `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` (already needed for checkout).
3. In Stripe → Webhooks, add a **Connect** endpoint to the same `stripe-webhook` URL for `account.updated`. Add its signing secret as `STRIPE_CONNECT_WEBHOOK_SECRET`.
4. Keep enough balance for refunds. Payouts go from the payments themselves (`source_transaction`), so they don't need extra balance.

## Consequences
- Migration 028 adds:
  - the `payout_accounts` and `payouts` tables, which members can't read directly;
  - `my_payouts`, plus staff functions;
  - service-role functions for the Edge Functions;
  - triggers that queue a payout on release and hold it on refund.
- Migration 028b adds the schedule.
- Edge Functions: `connect` (with sign-in check) and `send-payouts` (worker token). `stripe-webhook` now also handles `account.updated`.
- Example mode connects straight away, and released payments show as sent.
- Tests: `tests/payout_checks.mjs`, `web/tests/unit/payouts.test.ts`, and a browser check on *Your sales*.
