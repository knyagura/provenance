# 0014: Saved searches and price-drop alerts

Date: 2026-10-17. Status: accepted.

## Decision
- **Saving a search:** members save any search from the results page (*Save this search*). It keeps the words, category, size, condition and price range. The limit is 20 per member. Searches are listed on the Saved page with how many items match now, an alert switch and Delete.
- **New-match alerts:** a database trigger checks the saved searches whenever a listing goes live, or gets cheaper (it may now be in someone's price range). Matching uses the same rules as the search box: every word as a prefix, plus an exact size ignoring case. One alert per search per item; colours and sizes of one item count once. Sellers aren't alerted about their own items.
- **Price drops:** members who saved an item hear when it's published at a lower price than buyers last saw. That covers the live price, or the last version when the seller paused the listing to edit it.
- Both are notifications in a new group, **Alerts**, with their own email switch (*Account → Emails*). They're emailed through the same outbox as the other notifications ([ADR 0012](0012-notifications.md)).
- **Size filter:** search gains a Size filter, and the API a `size` parameter (exact, ignoring case), so "size 10" means the same in search, saved searches and alerts.

## Consequences
- Migration 019. It replaces the four-switch `set_notification_prefs` with a five-switch version, whose last switch defaults to on.
- Tests: `tests/alert_checks.mjs`, the unit tests and the saved-search browser journey.
