# ADR 0008: The chain of custody runs on the server

Date: 2026-10-11 · Status: accepted · Build step 6

## Context

The prototype's custody chain (ProofSeal and Item Seal, a hash-chained evidence log, one-time challenge codes, a courier witness and the authentication hub) ran in the browser. Its own threat model said the top fix was that only a server may say a step happened. Step 6 moves orders and custody into the new site, keeping the same mechanisms.

## Decisions

1. **The database decides.** `record_custody_step()` accepts a step only when it is next, only from the person who holds that role on the order, and only with the evidence the step needs. Nobody, buyer or seller, can write custody fields or records directly.
2. **One step list per tier, shared.** The steps live in `backend/fixtures/custody_plans.json`. The database's `custody_plan()` and the website's `lib/domain/custody.ts` are both tested against it.
   - Under £75: the seller photographs the item as it's packed, then posts it with tracking. The buyer confirms.
   - From £75: the seller records the handover. They read a code aloud on video, show the item, weigh the parcel, fit the ProofSeal and photograph it sealed. A courier witnesses packing and takes the parcel, then weighs it at the door. The buyer records the opening and checks the seal. The courier confirms the opening, and the buyer confirms.
   - From £500: an Item Seal is added, and the hub checks both seals, records, inspects and authenticates, then reseals with a new ProofSeal.
   - From £1,500: a second, different authenticator also gives a verdict.
3. **Append-only and hash-chained.** `custody_events` refuses updates, deletes and truncation for everyone. Each record's SHA-256 covers the previous hash, the order, step, actor, evidence and time, in a form the website computes identically. `order_custody()` re-checks the whole chain every time it is read.
4. **Seals and codes come from the server.**
   - Seal codes use Crockford base32. They are issued to the person fitting the seal and hidden from anyone who must check them.
   - A different code at a check puts the order on hold.
   - Challenge codes last 10 minutes (a setting), work once, and only for the person who asked.
5. **Couriers and hubs are separate accounts.**
   - They are listed in `custody_agents`, added by staff only.
   - They can never act on an order they bought or sold.
   - The second authenticator must differ from the first.
   - They see an order only while it is their turn, or after they have worked on it.
6. **Evidence files are private.** Photos and videos go to the private `custody-media` bucket under the order's folder. Only the person whose turn it is can upload, and only the order's people can view. Files can't be replaced or deleted. Each file's SHA-256 is part of the chained record.
7. **Payment is held until confirmation.**
   - The buyer's confirmation sets the payout to due. So does an automatic confirmation after the protection window (48 hours; 7 days after posting for items under £75), run hourly by pg_cron.
   - A dispute, a failed authentication or a seal mismatch holds the payment for a person to review.
   - Paying sellers out through Stripe Connect is deferred with the rest of the Stripe work.

## Consequences

- The prototype's attack tests now run against the database (`tests/custody_attacks.mjs`): skipping steps, faking seal pairing, invented or expired codes, a courier who is also the buyer, and editing records after the fact. The last of these is refused outright. If someone with full database control forces an edit anyway, the chain shows it.
- **Live testing needs:**
  - Payments switched on (Stripe test keys), because custody starts only on a paid order.
  - For items from £75, a courier account; from £500, one or two hub accounts. Staff add these to `custody_agents`.
- Example mode keeps orders in the browser's localStorage. Two tabs can therefore play buyer and seller (and courier), like two phones.
- **Not yet built:**
  - QR or NFC seal scanning (codes are typed).
  - Messages between buyer and seller.
  - The staff side of disputes.
  - Carrier tracking lookups.
  - One continuous recording instead of separate clips.
