# 0010: Multi-basket shopping, one payment and gift links (migration 013)

Date: 2026-10-16. Status: accepted.

## Decision
- **Opt-in.** Every member has a General basket. Switching multi-basket on adds up to four personal baskets, each with a size profile (adult or child), budget, style notes, one wrapping paper, a wrap-everything default, gift message, hide-prices, deliver-by date, gift receipt and an optional UK address. Switching off hides the personal baskets without deleting them.
- **Each item is in exactly one basket.** The single view is General, and it always shows everything, each item tagged with its person and with a menu to retag it. It has filters, group-by-person, budget bars and size warnings. Size matching is done in the browser (`lib/domain/baskets.ts`) and only ever warns or filters; it never blocks.
- **One payment.** `start_basket_checkout` makes one ordinary order per item, using the same pricing, hold and custody as buying one thing, all grouped under a `checkout_group`. The Stripe PaymentIntent carries `group_id`, and the webhook confirms every order through `confirm_group_payment`; the amount must match the group total. The buyer chooses either to send everything to themselves or to send each personal basket to its person. Items from different sellers are always separate parcels.
- **Wrapping** is a flat fee per wrapped item (staff setting), shown as its own line. Who does the wrapping is undecided, so `wrapping_live` is off: choices are saved and shown as "arrives soon", and nothing is charged.
- **Gift links.** Each personal basket's order gets a private token. The recipient signs in and claims it, then does the buyer's unboxing steps. They see no prices, and the order row itself stays unreadable to them. The buyer still decides disputes.
- **Shared baskets** are read-only links showing name, sizes, notes and items, never the budget, address or owner.

## Next
Variants for business sellers: colour and size variants with stock. Each unit sold becomes its own protected order. Tablets show the side rail in landscape and a dock in portrait.
