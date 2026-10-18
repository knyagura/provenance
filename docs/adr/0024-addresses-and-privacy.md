# 0024: Saved addresses and privacy tools

Date: 2026-10-18. Status: accepted.

## Decision
- **Saved addresses** (*Account → Addresses*):
  - Up to 5 addresses; the first becomes the default.
  - When an order the seller posts is paid, the buyer's default address is used, so they aren't asked for one.
  - On the order page, the buyer can pick from saved addresses.
  - A seller's default address is where returns go.
  - Only the owner sees saved addresses. A seller sees a buyer's address only on the label.
- **Download my data** (*Account → Your data*): one JSON file with everything NuTuYu holds about the account. That covers:
  - profile, addresses, settings and listings;
  - orders (only what the member could see);
  - messages, offers, reviews, favourites, saved searches, questions and reports;
  - gift cards, payouts, and the last 500 notifications.
- **Delete my account:**
  - Allowed once nothing is in progress: no order on its way, no sale in progress, no money still to be paid out.
  - The member types their username to confirm.
  - Removed: profile details, addresses, favourites, saved searches, baskets, notifications, API keys, the payout account link, and sign-in details. The username becomes `deleted_…` and listings come off sale.
  - Kept for 6 years without the member's name: orders, custody records, payments and staff decisions. Financial records must be kept, and items keep their history.
  - A deleted account is blocked like a suspended one.
- **Retention** (nightly job, 032b) deletes:
  - notifications after 1 year;
  - sent emails and API usage counts after 90 days;
  - one-time codes 30 days after they expire;
  - handled contact messages and closed reports after 2 years;
  - removed questions after 1 year.

## Consequences
- Migration 030 adds `addresses`, its functions, and the default-address trigger.
- Migration 032 adds:
  - `profiles.deleted_at`;
  - `export_my_data`, `account_deletion_blockers`, `delete_my_account` and `apply_retention`;
  - a redefined `is_suspended`, which now also covers deleted accounts.
- Sign-in removal edits Supabase's `auth` tables from the database. If a future Supabase change blocks that, the account is still anonymised, and the staff record notes that sign-in removal needs doing by hand.
- Tests: `tests/returns_checks.mjs` (addresses), `tests/privacy_checks.mjs`, and browser checks for download and delete.
