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
| `npm run build && npm run test:e2e` | Real browser: every page at 360, 768, 1024 and 1440px in light and dark. Fails on sideways scrolling, a misplaced bottom bar, text under 11px, tap targets under 44px or console errors. Screenshots go to `test-results/`. |

Netlify runs typecheck, unit tests and the build on every push, so a failing change is never published. GitHub Actions runs all three plus the browser check.

## Where things live

| Path | What |
|---|---|
| `design/tokens.json` | A copy of the [Provenance Design System](https://claude.ai/artifact/LupKBiAfdki9LXr3a46o87) tokens. Change colours in the design system first, then copy the file here. |
| `scripts/build-tokens.mjs` | Turns `tokens.json` into `app/tokens.css` (generated, not committed). |
| `components/ui/` | The design system's components: Button, Badge, ListingCard, CustodyTimeline, BottomNav, TopBar. |
| `lib/` | Shared code. Screens call domain modules here, never Supabase directly. |
| `app/` | Pages. `/styleguide` shows every token and component. |

Only the Supabase **publishable** key is used here (`lib/config.ts`). Never add a secret or service-role key.

`.npmrc` sets `legacy-peer-deps` because npm 10 fails to resolve this dependency tree without it.
