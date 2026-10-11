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
| `PV_DATA_SOURCE=examples npm run build && PV_DATA_SOURCE=examples npm run test:e2e` | Real browser: every page at 360, 768, 1024 and 1440px in light and dark, then the browsing journey (search, open an item, category, filters, a 404) and the API (keys, errors, paging, OpenAPI). Fails on sideways scrolling, a misplaced bottom bar, text under 11px, tap targets under 44px or console errors. Screenshots go to `test-results/`. |

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
| `app/` | Pages: home, `/search`, `/item/[id]` (with a link-preview image), `/sell`, `/sell/[id]` (the draft editor), `/signin`, `/profile`, `/developers`, `/styleguide`. |

## Example catalogue

While no listing has been published, the website shows a labelled example catalogue (`lib/domain/examples.ts`) instead of empty pages. Real listings replace it as soon as the first is published. The API never returns examples.

Set `PV_DATA_SOURCE=examples` to run with no database at all; CI and the browser tests do this, so they never depend on live data. In that mode only the test key `pv_test_Example1_` + 43 × `x` works on the API.

## API keys

Keys look like `pv_live_<8 characters>_<43 characters>`. The database keeps the first part and a SHA-256 of the whole key, never the key itself. `generateKey()` in `lib/api/keys.ts` makes one; the screen for members to do this arrives with accounts.

Only the Supabase **publishable** key is used here (`lib/config.ts`). Never add a secret or service-role key.

`netlify.toml` (repo root) names Netlify's Next.js adapter (`@netlify/plugin-nextjs`). Without it Netlify publishes the raw build folder and every page returns 404.

`.npmrc` sets `legacy-peer-deps` because npm 10 fails to resolve this dependency tree without it.
