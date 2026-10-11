# ADR 0003: API keys, how our own site uses the API, and the example catalogue

Date: 2026-10-11 · Status: accepted · Build step 2

## Context

ADR 0002 made the site API-first. Building step 2 raised three practical questions: how partners prove who they are, whether our own pages should call `/api/v1` over HTTP, and what to show while the catalogue is empty.

## Decisions

1. **Keys, stored hashed.** A key is `pv_<env>_<8-character prefix>_<32 random bytes>`. The database stores the prefix and a SHA-256 of the whole key; the key is shown once. One database function, `api_authenticate`, checks a key and counts the call for that minute in a single round trip. Each key carries scopes, and each key can make 120 calls a minute for now (a per-plan setting later, B60). Every API call needs a key, including reads, because unkeyed reads are how catalogues get scraped.
2. **Our pages call the same code, not the same URL.** Pages call the catalogue domain module on the server; `/api/v1` routes are thin wrappers around the same functions. Same rules, same results, but our pages can be cached and don't pay for an extra HTTP hop or a Netlify function call per view. The API's field names live in one file (`serialize.ts`) and are tested against the OpenAPI description.
3. **Paging stops at 1,000 results.** People narrow a search; scrapers walk pages.
4. **Examples while empty.** Until the first listing is published, the website shows a clearly labelled example catalogue so the screens can be reviewed. The API never returns examples. Tests run against the examples so they never depend on live data.

## Consequences

- The database advisor warns that `api_authenticate` can be called without signing in. That is intended: it reveals nothing without the 32-byte secret.
- Writing through the API (create a listing, reply to a message) needs the request to act as the key's owner. That is designed with step 3 (Sell now): either a short-lived signed token for the owner, or an Edge Function holding the service key. The service key is never placed in this app.
