# 0016: Voucher codes, gift cards and a NuTuYu balance

Date: 2026-10-17. Status: accepted (gift cards are bought by card once Stripe is switched on).

## Decision
- **Two kinds of voucher code:**
  - **NuTuYu codes**, made by staff in the console (*Vouchers*). NuTuYu pays: the buyer pays less by card, and the seller still gets their full payout. These are for sign-up offers and campaigns, and can be shown in a popup ([ADR 0015](0015-home-page-and-popups.md)).
  - **Shop codes**, made by sellers on *Your sales*, for their own items only. The seller pays: the item price comes down, and the fees and payout are worked out on the lower price. Up to 50% off.
- **Code rules:**
  - percentage (with an optional cap) or an amount off;
  - minimum spend, uses per person, total uses, end date, and first order only (NuTuYu codes);
  - one code per checkout;
  - on a basket checkout the discount is shared across the items it covers, in proportion to price;
  - card payments keep a 30p minimum, or are nothing at all.
- **Life of a code:** a code is *held* while the checkout waits, *used* when it's paid, and *released* if the checkout ends unpaid. Once made, a code's terms don't change; only on/off, end date, use limit and note can.
- **Gift cards:**
  - £10 to £250, bought by card (Stripe; the webhook confirms them like orders);
  - the code (16 characters, without look-alike letters) is shown only once paid, and emailed to the recipient if the buyer gives an address;
  - the recipient adds it to their **NuTuYu balance**, which lasts 2 years from purchase.
- **Using the balance:** it's offered at checkout and pays for all or part of an order, oldest-expiring first. Like a NuTuYu code it lowers the card total, and the seller is paid in full. With nothing left to pay, the order is paid there and then. A balance used on an order that ends unpaid comes back. If the order is refunded after a dispute, the balance part comes back as a new 2-year credit.
- **One code box at checkout:** a voucher code is applied; a gift card code is added to the balance and used. Codes go on before the balance.
- Checkout totals always come from the server (`checkout_codes`). Stripe is asked for a fresh payment whenever the total changes.

## Consequences
- Migration 022:
  - tables: `vouchers`, `voucher_uses`, `gift_cards`, `balance_lots`, `balance_spends`, `email_outbox`;
  - functions: `apply_code`, `apply_voucher`, `remove_voucher`, `use_balance`, gift card and staff/shop code functions, and a trigger that settles codes and balance on payment, expiry or refund.
- The checkout and webhook functions accept gift cards; `send-notifications` also sends `email_outbox`.
- **Accounting:** NuTuYu-funded discounts and gift card balances are a cost and a liability to track. Unredeemed gift cards stay a liability until they expire.
- Example mode: WELCOME10 (NuTuYu, first order, 10% up to £10) and RESOLE15 (resole_archive's shop).
- Tests: `tests/voucher_checks.mjs`, payment and money unit tests, and the gift-card journey in the browser tests.
