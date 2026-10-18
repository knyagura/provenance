# 0025: Identity checks with Stripe Identity

Date: 2026-10-18. Status: accepted. Off until the owner adds Stripe keys and turns on Identity.

## Decision
- *Account → Identity check → Check my identity* opens Stripe Identity. The member photographs a photo ID and takes a matching selfie on Stripe's pages.
- NuTuYu never receives the images or document details. Stripe reports the outcome to `stripe-webhook` (`identity.verification_session.*`).
- A pass sets "Identity checked" (`profiles.kyc_verified`). That shows on the profile and items, and counts towards the Trusted seller badge (ADR 0019).
- A failed check tells the member why (for example, the document expired) and lets them try again. The limit is 3 tries a day, because each check costs money. A later event can't undo a pass.
- Staff can still set it by hand for exceptions.

## To switch it on
In Stripe, activate **Identity**. Add `identity.verification_session.*` events to the existing webhook endpoint. `STRIPE_SECRET_KEY` is already used for checkout.

## Consequences
- Migration 033 adds the `identity_checks` table and the functions `my_identity`, `identity_can_start`, `identity_session_started` and `identity_updated`. The service-role ones are for the Edge Functions.
- New Edge Function `identity`, with sign-in check. `stripe-webhook` handles identity events.
- Example mode passes straight away.
- Tests: `tests/privacy_checks.mjs`, plus unit tests for the function and the webhook.
