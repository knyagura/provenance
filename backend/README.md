# Backend (Supabase)

The app talks to Supabase directly from the browser using the project's **publishable** key (in `app/src/backend.js`). That key is public by design; **Row Level Security** in the SQL below decides what each user can read or change. Never put a `secret` / `service_role` key in the app.

Project: `https://tkjmnivvcrcqkqjywafb.supabase.co`

## One-time setup

1. **Run the SQL, in order** (Supabase → SQL Editor → New query → paste → Run):
   1. `supabase_schema.sql` — profiles, listings, orders and their access rules.
   2. `002_listing_status_and_integrity.sql` — listing status and extras, server-side order checks, live updates. Safe to re-run.
2. **Auth → URL Configuration**:
   - **Site URL:** the GitHub Pages address, e.g. `https://<github-username>.github.io/provenance/`.
   - **Redirect URLs:** add the same address. Also add `http://localhost:8765/**` if you test locally.
3. **Auth → Providers → Email**: leave on. "Confirm email" is on by default, so new accounts must click the emailed link before they can sign in. Turn it off during early testing if colleagues find that annoying.

## What the server enforces (migration 002)

| Rule | Where |
|---|---|
| Only the seller can see their drafts, or edit or delete their listings | RLS on `listings` |
| Orders are visible only to their buyer and seller | RLS on `orders` |
| An order can only be placed for a published, still-active listing, by someone other than the seller. Price and seller are taken from the listing, not from the browser | `validate_new_order` trigger |
| The listing is marked sold in the same transaction, with the row locked so two people can't buy the same item | `validate_new_order` trigger |
| An order's price, parties and fees can't be edited after purchase | `protect_order_fields` trigger |
| Users can't mark themselves KYC-verified or Pro | `protect_profile_flags` trigger |

**Not yet enforced (deliberately deferred):** the custody/evidence chain inside `orders.timeline_state` is still produced and verified in the browser. Tampering is *detected* (the hash chain breaks and the timeline says so), not *prevented*. Moving those transitions server-side is the next backend milestone. See `docs/provenance-product-update.md` §5–6.

## How the app uses it

- **Signed out:** the original demo, unchanged. Everything is local to that browser.
- **Signed in:** listings you create are saved to `listings` (photos are downscaled JPEGs in the `photos` JSON column for now; move them to Supabase Storage before real volumes). Publishing makes a listing visible to everyone. Buying creates an `orders` row. Each custody step syncs to `orders.timeline_state` and `orders.status`. **Inbox** lists your orders and highlights "Your turn".
- On a live order, the seller does the handover on their phone and the buyer does the unboxing on theirs. In this test build, either party can act as the Verifier Hub.

## Testing without the real project

`tests/mock_supabase.mjs` is a local stand-in for Supabase's auth and data APIs. It runs on real Postgres (PGlite) with these exact SQL files, so the access rules and triggers are genuinely enforced. `tests/sql_rls_check.mjs` attacks the rules directly. `tests/two_user_journey.mjs` runs two people on two browsers through a full sale. All of these run in `npm test` and in CI.

To run the app against the stand-in locally, start `node tests/mock_supabase.mjs`. Then, in the browser console before the page loads (or via a userscript), set `window.PROVENANCE_CONFIG_OVERRIDE = {supabaseUrl: 'http://localhost:54321', supabaseKey: 'mock'}`.
