# Provenance — Buy. Sell. Prove it.

A resale marketplace prototype with a built-in physical chain-of-custody and evidence system. Read `docs/provenance-product-update.md` FIRST — it's the full context document (concept, build history, architecture, security posture, decisions already made, next steps). This README just orients you to the files.

## Folder guide

- **app/** — the actual product. `index.html` is the entire frontend: a single self-contained file, vanilla JS, no framework, no build step. Open it directly in a browser to run it locally, or re-host it (see "Hosting" below). `provenance-manifest.json` and `provenance-sw.js` are its PWA manifest and service worker — they must be hosted alongside `index.html` at the same origin, or the installable-app behavior breaks.

- **backend/supabase_schema.sql** — the database schema for the backend migration that's currently in progress (not yet applied). Paste into a Supabase project's SQL Editor and run once. See the product update doc, section 6, for the full rationale and what's deliberately deferred.

- **tests/** — the full regression/attack suite. Run `npm install` then `npm test` in this folder; it runs every jsdom script plus `real_browser_layout.js`, a Playwright/Chromium audit that renders every screen and live-camera step at four phone widths (280–393px) in light and dark mode and fails on any clipped, covered or off-screen control. The same suite runs automatically on every push and pull request via GitHub Actions (`.github/workflows/tests.yml`), with screenshots uploaded as a build artifact. Re-run ALL of them after any change to render functions, step-builders, fee logic, or the data layer. `attacktest.js` specifically re-verifies the chain-of-custody security fixes described in the threat-model doc — don't let it go stale.

- **docs/** — `provenance-product-update.md` (read this first) and `chain-of-custody-threat-model.md` (the detailed red-team findings + remediation mapping referenced in the update doc's section 5).

## Critical things to know before touching this code

1. **jsdom cannot catch real CSS layout bugs.** A real bug (camera shutter button invisible on real phones, due to `overflow:hidden` clipping) passed every jsdom test and was only found via a user's real-device screenshot. `real_browser_layout.js` now closes this gap in a real browser engine (verified: re-introducing the F4 bug makes it fail). It is still an emulated phone, so occasional checks on real iOS/Android devices remain worthwhile.

2. **The render model is full-replace, not reactive.** Every screen navigation (`goTo()`/`render()`) does a complete `innerHTML` swap of `#main`. This means: (a) re-rendering while a camera `<video>` stream is attached destroys the stream — any status update during an active camera session must mutate the DOM directly, not trigger a re-render; (b) CSS animations tied to a persistent state (e.g. "sealed") will replay on every re-render of that screen — this was accepted as a trade-off, not treated as a bug.

3. **No real backend yet.** The entire app currently runs on one in-memory JS `state` object with zero persistence. The Supabase schema in `backend/` is step one of fixing that, scoped deliberately to just accounts + listings/orders — the custody-chain/evidence-log logic is explicitly staying client-side for this first pass (see product update doc section 6 for why, and section 5 for the security gap this leaves open).

4. **Trademark/copyright care already taken, keep it up:** no real brand logos or copyrighted product photography anywhere (generic/unbranded CC-licensed stock photos only, sourced via Openverse with visual vetting); payment card brands are shown as plain text wordmarks, never recreated logos.

5. **Hosting gotchas** if you continue using CodeSandbox's `sandboxes/define` API the way this was built: (a) its `isBinary:true` flag does NOT actually decode base64 server-side — binary assets must be inlined as base64 `data:` URIs inside text files; (b) files named exactly `manifest.json` or `service-worker.js` get shadowed by CodeSandbox's own platform files — hence the `provenance-` prefix on both files here. Full detail in the product update doc.

6. **Never use a Supabase "service_role" key client-side** — only ever the public "anon" key, which is safe specifically because the Row Level Security policies in `supabase_schema.sql` constrain what it can access.

## What's already decided (don't re-litigate without reason)

- Backend: Supabase (Postgres + built-in auth), not Firebase or a custom Node server.
- Auth: both email+password and magic link offered at login.
- First backend pass scope: accounts + listings/orders persistence only. Evidence/custody-chain logic server-side migration is an explicitly deferred, bigger follow-up pass.

## What's next (priority order, from the product update doc)

1. Finish wiring the app to Supabase (needs a real project URL + anon key from the user — can't be generated on their behalf).
2. Move evidence/custody-chain logic server-side (closes the real DevTools-tampering gap documented in the threat model).
3. Real payments (Stripe test mode is a safe first step).
4. ~~Real browser/device test automation (Playwright)~~ — done (2026-10-10), see `tests/real_browser_layout.js`.
5. Stable hosting on a fixed domain instead of CodeSandbox's random-subdomain-per-rehost pattern.
6. Real KYC provider, real courier integration, push notifications, and the deferred marketplace features listed in the product update doc section 7.
