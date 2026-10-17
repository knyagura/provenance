# 0017: Better search: near me, sizes from baskets, similar items

Date: 2026-10-17. Status: accepted.

## Decision
- **Collection near me, by postcode district.** Sellers can set the first half of their postcode (such as SW11) and tick *Buyers can collect from me* (Account → Collection in person). Only the district and its centre, rounded to 2 decimal places (about 1 km), are stored. Never an address.
- **Searching near a place.** Search has *Collect in person near*. A buyer types a postcode or district, or taps *Use my location* (the browser's location, rounded to 2 decimal places before it leaves the page). They choose 1, 2, 5, 10, 25 or 50 miles. Results show only sellers who offer collection within that distance, nearest first, with "SW11, about 3 miles away". Districts come from a small built-in list, or from postcodes.io (free, no key). The API and saved searches don't take a location yet.
- **Search filter:** a bounding box on the seller's stored point, then an exact distance check.
- **Sizes from baskets.** With several baskets switched on, the search filters show each person's sizes as chips ("Sam · shoes UK 9"). Tapping one filters by that size.
- **Similar items** on every item page: up to six live items from the same category. Ranking: same brand first, then same size, then closest price. The item's own colours and sizes are left out.

## Consequences
- Migration 023: `profiles.area`, `area_lat`, `area_lng`, `collection_ok` (with checks that the point is in the UK and is rounded), and `miles_between()`.
- Example mode: resole_archive is in SW11, mia.k in E8, parent_swap in M20 and brick_bench in BS6. lens_vault doesn't offer collection.
- Tests: `tests/near_checks.mjs`, `web/tests/unit/places.test.ts`, and a browser journey for near-me and similar items.
