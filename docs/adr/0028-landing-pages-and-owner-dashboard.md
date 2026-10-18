# 0028: Category and brand pages, and the owner's dashboard

Date: 2026-10-18. Status: accepted.

## Decision
- **Search engine pages.**
  - `/c/{category}` pages: a heading, a short introduction about how that category is protected, brand links, and the newest 24 items.
  - `/brand/{brand}` pages: the newest items of that brand.
  - Both carry `CollectionPage` and `ItemList` and `BreadcrumbList` structured data (example items are left out), and are in the sitemap.
  - Item pages gain `BreadcrumbList` data, and their category link now goes to the category page.
- **The owner's dashboard** (*Staff console → Dashboard*, now the first tab):
  - this week against last week: orders, items sold, NuTuYu's fees, new members, new listings;
  - live and boosted listings, members on paid plans, and identity checks;
  - the last 30 days: completed orders, dispute rate and typical handover time;
  - **Needs attention**: disputes, payments to check, reports, failed payouts, money waiting for payout set-up, refunds to do by hand, and contact messages, each linking to its tab;
  - 30 days day by day, and the top 5 sellers.

## Consequences
- Migration 036 adds `staff_dashboard()` (staff only) and `order_net_fees()` (the same rule as the staff report).
- `ListingQuery` gains an internal `brand` filter.
- Tests: `tests/growth_checks.mjs`, unit tests for brand slugs and structured data, and the new pages in the layout and accessibility checks.
