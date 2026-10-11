# ADR 0002: Build API-first; our apps use the same API as members and partners

- **Status:** Accepted
- **Date:** 2026-10-11
- **Decided by:** Kudzai

## Context

We will offer seller APIs on the Premium plan, buyer-facing APIs, and paid services to other businesses (witnessed hand-over, evidence packs, Item Passport, authentication). If our own screens used a private route to the database, every rule (fees, custody checks, access) would exist twice and drift.

## Decision

Every feature is built as an API first, then the screens on top. Our web app, phone app, courier app and Verifier Hub app call the same versioned API (v1) as Premium members and partners, with their own keys and scopes. The API never bypasses the database's Row Level Security. The staff console uses a separate staff-only API that is never offered outside.

No API can buy or make offers automatically, bulk-copy listings, mark a custody step done, or return personal data beyond what a person agreed to share with that app.

## Consequences

- Build step 2 starts with the API platform (backlog B58): versioning, keys and scopes, limits, logs, webhooks, generated docs and a sandbox.
- Each later step ships its API with tests before its screens.
- Breaking changes need a new version and a notice period (a setting).
- The full list of APIs, who can use each and where it shows on our site is in the plan's "Our APIs and how the site uses them" section; records are in the Data model tab.
