# 0029: October security review, and faster browser tests

Date: 2026-10-18. Status: accepted.

## Security review
What was checked: every database function added since migration 025 (who can call it, what it checks), Supabase's
security advisor, the Edge Functions, and the website's headers.

**Findings and fixes (migration 037, `web/next.config.ts`):**
- **Suspension reasons were public.** Profiles are readable by anyone, so the reason moved to a private table as it's written. The member sees it through `my_suspension()`; staff see it too.
- **The trust tracker counted every order on every visit.** It's now kept for 5 minutes (`cached_stats`), so it can't be used to load the database.
- **Internal helpers were callable through the API** (`clean_address`, `is_suspended`). They're now callable only from inside the database.
- **Security headers on every page:**
  - a Content Security Policy that names the only outside services (Supabase, Stripe, postcodes.io) and blocks framing, plugins and other sites' forms;
  - HSTS, `nosniff`, a strict referrer policy;
  - a Permissions Policy (camera, microphone and location for this site only).
  - `script-src` keeps `'unsafe-inline'` because Next.js needs it. Nonces are the next step.

**Checked and fine as they are:**
- **Every API-callable function checks its caller.** The advisor flags 117 `SECURITY DEFINER` functions callable by signed-in members and 11 by visitors. That's how the API is built: tables are closed, and functions check who's asking. The visitor-callable ones are the public reads (passport, reviews, questions, trust, variants, bundle offer, gift view, shared basket), the contact form, and API key sign-in.
- **Limits exist:**
  - questions: 5 an hour and 20 a day;
  - reports: 10 a day;
  - identity checks: 3 a day;
  - addresses: 5;
  - push devices: 10;
  - API keys: 120 calls a minute.
- **Workers and webhooks are protected.** Workers check Vault tokens, and webhooks check Stripe signatures. Every money movement carries an idempotency key.
- **Two warnings remain, and are left on purpose:**
  - `pg_net` sits in the public schema. Supabase installs it there and it can't be moved.
  - Supabase's leaked-password protection needs the Pro plan; our own breached-password check stands in for it (ADR, 17 Oct).

## Faster browser tests
- The page sweep runs each theme and width in its own browser context, four at a time, and the two accessibility runs in parallel.
- The test file has two parts: `E2E_PART=layout` (page sweep and accessibility) and `E2E_PART=journeys`.
  - GitHub runs them as two parallel jobs, `web (layout)` and `web (journeys)`.
  - Locally, `npm run test:e2e:parallel` runs both at once on two ports.
- A full run went from about 12 minutes to about 3.

## Consequences
- Migration 037. Tests: `tests/security_checks.mjs`. All browser checks pass under the new headers; a policy violation shows up as a console error, which fails the tests.
