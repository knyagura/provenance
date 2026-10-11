# ADR 0006: Sellers edit live listings; every version is kept; the buyer confirms changes

Date: 2026-10-11 · Status: accepted · Requested by Kudzai

## Context

Sellers could not change a listing once it was live. They should be able to change anything, including the photos, until someone buys it. Two risks come with that: a buyer could pay for something that changed while they were looking, and the record of what was bought could be rewritten afterwards.

## Decisions

1. **Edit by pausing.** "Edit listing" takes the item off sale (published = false). The seller can then change every field, the category, the serial number and the photos, and press "Publish changes". The publish check runs again, so a live listing always has its full evidence. Simple field changes on a live listing (such as the price) are also allowed and checked straight away.
2. **Every published change is a new revision.** Publishing makes revision 1; each change buyers can see makes the next one. A snapshot of exactly what buyers saw (fields, photo paths and their SHA-256 fingerprints) is stored in `listing_revisions`, readable by the seller and by staff.
3. **Photos are never deleted once a listing has been live.** Removing or retaking one marks the old one retired; the file stays in storage and its storage object can't be deleted or overwritten while any photo row points at it.
4. **Locked while someone pays, and for good once sold.** While a checkout holds the item (up to 30 minutes) and after payment, no field, photo or serial number can change, and the listing can't be paused or deleted.
5. **The buyer confirms changes.** Checkout sends the revision the buyer was looking at. If the seller has published a change since, nothing is held and the checkout shows what changed in plain English ("Price: £890.00 → £850.00", "Photos: 1 new, 1 removed") with "Continue with the updated listing". The item page may be up to a minute old, but the checkout page is always current and is the buyer's final review.
6. **Orders keep what was bought.** Each order stores the revision and a full snapshot. The order page shows "What you bought" from that snapshot, so later edits never change it. Buyers can't alter it.

## Consequences

- Disputes (step 6) compare the item that arrives with the snapshot on the order, not with the listing as it is now.
- A paused listing stays off sale until its seller publishes it; the seller's list shows "Paused while you edit".
- Listings from the current single-file app are unaffected.
