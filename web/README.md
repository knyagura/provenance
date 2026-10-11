# Provenance web app (Next.js)

The new site, built in the stages set out in the plan's build order. Netlify builds and hosts it from this folder; the old single-file app in `../app` stays on GitHub Pages until the switch-over.

## Run it

```bash
cd web
npm ci
npm run dev          # http://localhost:3000, regenerates tokens first
```

## Checks

| Command | What it checks |
|---|---|
| `npm run typecheck` | TypeScript |
| `npm test` | Unit tests, including every colour pair in the design system meeting its contrast minimum in light and dark |
| `PV_DATA_SOURCE=examples npm run build && PV_DATA_SOURCE=examples npm run test:e2e` | Real browser: every page at 360, 768, 1024 and 1440px in light and dark, then the journeys (browsing, selling, account and passkeys, buying, and an order handed over and confirmed by buyer, seller and courier in three tabs) and the API (keys, errors, paging, OpenAPI). Fails on sideways scrolling, a misplaced bottom bar, text under 11px, tap targets under 44px or console errors. Screenshots go to `test-results/`. |

Netlify runs typecheck, unit tests and the build on every push, so a failing change is never published. GitHub Actions runs all three plus the browser check.

## Where things live

| Path | What |
|---|---|
| `design/tokens.json` | A copy of the [Provenance Design System](https://claude.ai/artifact/LupKBiAfdki9LXr3a46o87) tokens. Change colours in the design system first, then copy the file here. |
| `scripts/build-tokens.mjs` | Turns `tokens.json` into `app/tokens.css` (generated, not committed). |
| `components/ui/` | The design system's components: Button, Badge, ListingCard, CustodyTimeline, BottomNav, TopBar. |
| `lib/domain/` | Domain modules. `catalogue.ts` is the only code that reads listings and categories; pages call it on the server and the API wraps it. `query.ts` validates search parameters for both. |
| `lib/api/` | API v1 plumbing: keys (`keys.ts`), authentication and rate limits (`auth.ts`), problem+json responses (`http.ts`), field names (`serialize.ts`) and the OpenAPI description (`openapi.ts`). |
| `app/api/v1/` | API v1 routes: `/listings`, `/listings/{id}`, `/categories`, `/openapi.json`. Every call needs a key. |
| `lib/domain/evidence.ts` | What each category must photograph before a listing can go live. The database holds the same lists (migration 006) and has the final say; a unit test fails if the two drift apart. |
| `lib/selling/` | Signing in and selling. `supabaseBackend.ts` uses the member's own session, so Row Level Security applies; `exampleBackend.ts` is a pretend account in the browser tab for tests. |
| `lib/media.ts` | Prepares photos in the browser: at most 2000 px, re-saved as JPEG (which drops location data), with a SHA-256 fingerprint. Videos up to 30 seconds and 50 MB. |
| `lib/account/passkeyOffer.ts` | When to offer a passkey (third password sign-in on a device; "Not now" waits three more), and the username rules. |
| `components/account/` | Account page sections (profile and holiday mode, passkeys, password), the passkey offer and password reset. |
| `app/` | Pages: home, `/search`, `/item/[id]` (with a link-preview image), `/member/[username]`, `/sell`, `/sell/[id]` (the draft editor), `/signin`, `/passkey`, `/reset`, `/profile`, `/developers`, `/styleguide`. |

## Example catalogue

While no listing has been published, the website shows a labelled example catalogue (`lib/domain/examples.ts`) instead of empty pages. Real listings replace it as soon as the first is published. The API never returns examples.

Set `PV_DATA_SOURCE=examples` to run with no database at all; CI and the browser tests do this, so they never depend on live data. In that mode only the test key `pv_test_Example1_` + 43 × `x` works on the API.

## API keys

Keys look like `pv_live_<8 characters>_<43 characters>`. The database keeps the first part and a SHA-256 of the whole key, never the key itself. `generateKey()` in `lib/api/keys.ts` makes one; the screen for members to do this arrives with accounts.

Only the Supabase **publishable** key is used here (`lib/config.ts`). Never add a secret or service-role key.

`netlify.toml` (repo root) names Netlify's Next.js adapter (`@netlify/plugin-nextjs`). Without it Netlify publishes the raw build folder and every page returns 404.

`.npmrc` sets `legacy-peer-deps` because npm 10 fails to resolve this dependency tree without it.

## Passkeys

Passkeys use Supabase Auth's built-in WebAuthn support. They only work once switched on in Supabase (Authentication → Passkeys) with the relying party set to the site's domain; see [ADR 0004](../docs/adr/0004-passkeys.md). The browser test uses Chrome's virtual authenticator on `localhost`, because passkeys refuse IP addresses such as 127.0.0.1.

## Fees and payments

- `lib/domain/fees.ts` is the fee engine the screens use. The database's `compute_fees()` (migration 008) decides real orders. Both must match the agreed baskets in `backend/fixtures/fee_baskets.json`; unit and database tests check this.
- Checkout calls `start_checkout()` (prices the order on the server, holds the item), then the `checkout` Edge Function for Stripe's payment form. Stripe confirms through the `stripe-webhook` Edge Function. Both functions are in `../supabase/functions/`; their logic is in `_shared/payments.ts` and unit-tested here.
- In example mode there is no Stripe: a "Pay (test)" button stands in. See [ADR 0005](../docs/adr/0005-payments.md) for the Stripe settings.

## Orders and custody

- `lib/domain/custody.ts` holds the steps for each tier and the hash used for every record. The database (migration 011) holds the same rules and decides. Both are tested against `backend/fixtures/custody_plans.json`. The database's attack tests are in `../tests/custody_attacks.mjs`.
- `/inbox` lists your orders with the ones waiting for you first. Each order page shows its chain of custody, with the form for the current step when it's your turn. Pages refresh by themselves while someone else's step is pending.
- Couriers and authentication hubs are separate accounts, listed in the `custody_agents` table. Staff add them; nobody can add themselves. See [ADR 0008](../docs/adr/0008-custody-on-the-server.md).
- **In example mode:**
  - Orders are kept in the browser's localStorage, so two tabs can act as two phones.
  - The seller of an example listing signs in as `<their username>@example.test` (for example `brick_bench@example.test`).
  - Emails starting `courier` are couriers, and emails starting `hub` are hubs.
  - Any password of 8 or more characters works.
