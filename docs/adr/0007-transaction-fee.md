# ADR 0007: A 3–8% transaction fee and £0.80 on every item, paid by the buyer

Date: 2026-10-11 · Status: accepted · Decided by Kudzai · Replaces the 5% buyer protection in ADR 0005's version 1

## Context

Kudzai's intended model is that every item on sale carries a configurable transaction fee of 3% to 8% plus a £0.80 processing fee. Fee settings version 1 did not do that: it charged 5% buyer protection on every item, and the 3–8% range applied only to boosted listings (the seller's commission).

## Decisions

1. **Every item carries a transaction fee and £0.80.** The buyer pays both, on top of the item price and postage, and sees each on its own line ("Transaction fee (8%)", which includes buyer protection, and "Processing").
2. **The rate is set by price band.** 8% under £75, 6% from £75, 4% from £500, 3% from £1,500. The bands are the existing listing tiers (enhanced, verified, luxury, ultra luxury), so the rate falls as evidence requirements rise.
3. **The range is a setting.** `transaction_min_bp` (300) and `transaction_max_bp` (800) clamp every band's rate, so a band can never be set outside 3–8% by mistake. The per-band rates, the processing fee and the minimum and maximum fee in pence are settings too.
4. **This is fee settings version 2.** It starts on 2026-10-11. Version 1 stays in the table, and orders already priced on it keep their version. Nothing edits a version in place.
5. **Boosts, promotions and the seller-pays option are unchanged.** A boost is still the seller's 3–8% commission, taken from their payout; it is separate from the buyer's transaction fee.

## Consequences

- Cheaper items cost buyers more than under version 1 (8% instead of 5%); items from £500 cost less (4% or 3%). A £40 item with £3.99 postage now totals £47.99.
- Both fee engines (database and website) and the shared test baskets were updated together: 27 baskets, 13 of them for version 2, all matching in the website, the local database copy and the live database.
- The API quote gains `transaction_rate_bp`; `protection_pence` is now the transaction fee. No field was renamed.
- Database: migration 010.
