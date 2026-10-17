# 0013: Variants and stock for business sellers

Date: 2026-10-17. Status: accepted.

## Decision
- **Who:** only business sellers (`profiles.is_pro`, set by staff in the console under *Couriers and hubs → Business sellers*) can sell more than one of an item, or offer colours and sizes. Private sellers keep one-of-a-kind listings.
- **Each colour/size is its own listing.** Variants share a `variant_group` and the original's reference photos. Each one has its own price (optional), stock, basket entry, checkout and protected orders. Everything built for single items (checkout holds, baskets, custody, notifications, passport) works unchanged.
- **Stock:** `listings.stock` is how many the seller has, sold ones included. The listing's status follows the stock:
  - `active` while units are left;
  - `reserved` when the rest are held by people paying;
  - `sold` when all are paid for.

  A database trigger recounts orders whenever a status change is requested. Payments that would oversell go to review for a refund, as before.
- **Every unit sold is its own order,** with its own custody record and its own protection.
- **Fixed prices:** stocked and variant listings don't take offers.
- **Search** shows one card per group (`browse_visible`): the oldest variant that can be bought. The item page shows every colour and size with what's left ("2 left", "Sold out").
- **Drag and drop:** with multi-basket shopping on, each size on the item page can be dragged onto a person's basket, like a card in search.
- Items that need a serial number (electronics) are always listed one by one.

## Consequences
- Migration 018. Redefines `release_expired_checkouts`, `confirm_payment`, `staff_resolve_payment` and `listing_media_rules` (variants may show their group's photos). New functions: `listing_variants`, `set_listing_stock`, `add_variant`, `staff_set_business`.
- Tests: `tests/variant_checks.mjs`, `web/tests/unit/variants.test.ts`, and the variants journey in the browser tests (example seller `knit_house`).
