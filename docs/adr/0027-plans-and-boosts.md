# 0027: Account plans and boosted listings

Date: 2026-10-18. Status: accepted. Paid plans are off until the Stripe keys are added.

## Decision
- **Plans** (`/plans`, in the footer and on the account page), as agreed on 11 Oct:
  - **Standard** (free): buy and sell with full buyer protection.
  - **Premium** (free for now; the price is a setting): the core seller API and a Premium badge.
  - **Premium+** (£17.50 a month): the full API set, the badge, and new perks first.
  - Fee-free orders and free boosts per month are settings, at 0 until they're modelled.
  - Staff change prices and perks in *Settings → Plans*. Standard is always free.
- **Paying.**
  - Paid plans are Stripe subscriptions: the `subscribe` Edge Function opens Stripe Checkout (monthly, in GBP).
  - Members change or cancel in Stripe's billing portal (*Manage billing*).
  - `stripe-webhook` keeps the subscription up to date (`checkout.session.completed`, `customer.subscription.*`).
  - After a failed payment the plan is kept for 7 days past the period end.
- **Badges.** Plans with a badge show it on the member's page.
- **Boosts.**
  - The seller of a live listing priced £25 or more can boost it from the item page.
  - They choose 3–8% and pay that plus 80p only if it sells (the fee engine's existing boost rules, version-controlled with the fees). The buyer's promotion share is a fee setting, 0% for now.
  - Boosted listings come first in browse and search (newest order) and say *Boosted*.
  - A boost ends when the item sells or comes off sale. Members can't set a boost directly.
- The API access level is recorded per plan. Linking API keys to plans waits until the Developers page is reworked, so existing keys keep working.

## Consequences
- Migration 035 adds:
  - the `plans` and `subscriptions` tables, with their functions and staff functions;
  - `listings.boost_bp`, `boosted_at` and the generated column `boosted`;
  - `set_boost` and `boost_rules`;
  - a redefined `order_quote` and `offer_quote`, which now include the boost.
- Basket checkout, bundle and voucher re-pricing still price without a boost, so a boosted item bought in a bundle isn't charged the fee.
- New Edge Function `subscribe`.
- Example mode starts paid plans without Stripe and keeps boosts in the browser. The fixed example catalogue isn't reordered.
- Tests: `tests/growth_checks.mjs`, unit tests for `subscribe` and the webhook, and a browser journey.
