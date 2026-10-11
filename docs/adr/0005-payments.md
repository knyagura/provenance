# ADR 0005: Prices on the server, payments through Stripe from Supabase Edge Functions

Date: 2026-10-11 · Status: accepted · Build step 5

## Context

Step 5 adds buying. Three things must hold: the buyer can never set the price; an item can't be sold twice; and no secret key (Stripe's, or Supabase's service role) ever reaches the website or this repository.

## Decisions

1. **One fee engine, written twice, tested once.** The database's `compute_fees()` decides real orders; the website's `lib/domain/fees.ts` shows the breakdown. Both use whole pence and basis points, rounding halves up, and both must produce the 14 agreed test baskets in `backend/fixtures/fee_baskets.json` exactly. The baskets were worked out by hand from the fee model and also checked against the fee model's own formula.
2. **Fees are versioned settings.** `fee_settings` holds numbered versions with a start date; every order records the version it was priced on. Version 1 is the fee model's defaults. The staff console will add versions; nothing edits a version in place.
3. **Checkout holds the item.** `start_checkout()` runs on the server, prices the order and marks the item reserved for 30 minutes (a setting). It is released if the buyer cancels or doesn't pay; a scheduled job (pg_cron, every 5 minutes) catches the rest.
4. **Stripe runs from Supabase Edge Functions.** `checkout` creates a Stripe PaymentIntent for the order total; `stripe-webhook` checks Stripe's signature and then calls `confirm_payment()`, which only the service role may run. The Stripe keys are Supabase function secrets; the service role key is provided by Supabase to its own functions. The website only ever sees Stripe's publishable key, handed over by the function.
5. **Late or wrong payments are never silently accepted.** A wrong amount, or a payment for an item someone else has since bought, puts the order in `review` for a person to refund.
6. **Funds go to the platform account for now.** Paying sellers out (Stripe Connect, released when custody completes) comes with step 6.

## Consequences

- Payments are off until test keys are added as Supabase function secrets: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, and a Stripe webhook pointing at `https://tkjmnivvcrcqkqjywafb.supabase.co/functions/v1/stripe-webhook` for `payment_intent.succeeded`. Until then checkout says so and releases the hold; no money moves.
- The current single-file app still inserts orders directly. Those are marked `legacy`, behave as before, and cannot claim to be paid.
- Boosts and promotions are in the engine and tested, but no listing can be boosted until boosting is built.
