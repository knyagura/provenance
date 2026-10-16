# 0009: Marketplace features and the staff console (migration 012)

Date: 2026-10-16. Status: accepted.

## Decision
- **Rename** to NuTuYu with the hand-over-circle logo (two arms passing a sealed parcel). The API header `Provenance-Api-Version` is kept for existing clients.
- **Favourites** are rows members write directly under RLS (own rows, published listings only).
- **Messages** belong to an order and are part of its record: buyer and seller only, paid or in-review orders, never edited or deleted. Read marks drive the Inbox badge.
- **Offers** go through functions only. Minimum 40% of the price; 48 hours to reply; 24 hours to pay once accepted. An accepted offer checks out through `start_offer_checkout`, with the same fees, hold and custody as a normal sale. Only the platform can price an order at an offer. If the listing changes after the offer, the offer can't be used.
- **Reviews** are allowed only after custody confirms, one per side per order, public.
- **Item Passport** is public. It shows photos, protection level, each step's role and date, seal matches, verdicts and whether the hash chain verifies. Names, codes, weights, videos and tracking are never shown.
- **Staff** are ordinary accounts in `staff_members`. Every staff decision is appended to `staff_actions`, which can't be changed. Dispute decisions are also written into the custody chain as role `staff`.

## Consequences
Seal QR codes encode `nutuyu:seal:<code>`; typing the code still works. The PWA caches only the app shell and never Supabase or Stripe responses.
