# 0023: Card refunds and returns

Date: 2026-10-18. Status: accepted.

## Decision
- **Refunds go back to the card automatically.**
  - Whenever an order ends in a refund, a refund of what the buyer paid by card is queued and sent through Stripe. That covers a staff decision, or a returned item the seller received.
  - The NuTuYu balance part was already put back (ADR 0016).
  - The `send-payouts` worker now moves money both ways: refunds first, then payouts. It runs every 10 minutes, with an idempotency key per refund.
  - Orders paid without a card (example, legacy) are marked *needs doing by hand* for staff.
  - The buyer is told the refund is on its way.
- **Returns.**
  - When the item has arrived and it's the buyer's turn to confirm, they can choose *Return it*: not as described, damaged, or the wrong item.
  - The payment stays held.
  - The seller has 48 hours to accept or decline; if they don't answer, it's accepted for them (hourly job, 031b).
  - Accepting makes a return label to the seller's default address (a test label until Parcel2Go is live, ADR 0018).
  - The buyer marks it posted. When the seller confirms it arrived, the buyer is refunded.
  - A declined return waits for staff, like any dispute.
  - The buyer can cancel before posting, and the order carries on.
  - Each step is recorded on the order's custody chain.
- "Changed my mind" isn't a return reason. Sellers aren't shops, and buyer protection covers items that aren't as described.

## Consequences
- Migration 031 adds:
  - the `refunds` and `returns` tables, which members can't read directly;
  - `shipping_labels.direction` (outbound or return), with one active label each way;
  - redefined `order_shipping`, `create_label` and `cancel_label`, which now ignore return labels;
  - the return functions, `auto_accept_returns`, and the refund worker functions.
- Migration 031b adds the schedule.
- Tests: `tests/returns_checks.mjs`, unit tests for the refund worker, and a browser journey (return accepted, posted, received, refunded).
