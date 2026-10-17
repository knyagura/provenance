# 0019: Trust badges and a public handover tracker

Date: 2026-10-17. Status: accepted.

## Decision
- **Counted, never typed in.** Every figure comes from orders and their custody records. There are no hand-set badges apart from staff's identity check.
- **A seller's record**, shown under their name on item pages and on their member page:
  - protected handovers completed;
  - the dispute rate;
  - the typical time from payment to confirmation.
  - Every order where the buyer reported a problem counts as disputed, whatever the outcome.
  - The rate shows once there are 5 finished orders, and the time once there are 3 completed. Before that, a single order would say too much.
- **Badges:**
  - *Identity checked*: staff have checked the seller's identity (this already existed).
  - *Trusted seller*: identity checked, at least 5 handovers completed, and no more than 1 in 20 disputed.
- **Public tracker** at `/trust` (in the footer):
  - completed handovers in total and in the last 30 days;
  - the site-wide dispute rate and number of refunds;
  - the typical handover time;
  - counts by protection level;
  - the latest 8 completed items, each linking to its passport.
  - It never shows buyers or sellers. Refunded orders don't count as completed.

## Consequences
- Migration 026: `seller_trust(username)` and `trust_stats()`, which anyone can run, plus two indexes.
- Example mode counts only the example orders in that browser, and says so. Example sellers start with no record, rather than a made-up one.
- Tests: `tests/trust_checks.mjs`, plus a browser check that a completed order appears on the tracker and on the seller's page.
