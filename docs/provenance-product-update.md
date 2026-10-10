# Provenance — Full Product & Technical Update

**Tagline:** Buy. Sell. Prove it.
**Status as of 2026-10-10:** Working single-file HTML/JS clickable prototype (PWA, installable on iOS/Android), feature-complete for its current scope, with a backend migration now starting. No real backend, real payments, or real identity verification exist yet — everything described as "real" below means "really implemented client-side," not "production-secure." This document is written to be handed to another AI/developer to continue the work with full context.

---

## 1. Product concept

Provenance is a resale marketplace ("an updated Vinted") whose differentiator is a built-in **physical chain-of-custody and evidence system**, not just listings + checkout. The problem list it was designed against (from the founder's own discovery notes, not generic brainstorming): counterfeits, "seller never sent it" claims, empty-parcel claims, reused/static QR codes being replayed across transactions, "my word against theirs" disputes with no evidence, unfair AI-only dispute decisions, opaque fees, one-size-fits-all protection regardless of item value, no persistent item identity across resales, and fraud patterns that aren't connected across transactions.

### Core mechanisms

- **Item ID + Item Passport** — a persistent provenance record that transfers with the item on every resale (not reset each time it changes hands).
- **Verified Handover** — the seller packs and seals the item at an approved drop-off point (Post Office/InPost-style locker), recorded on camera, not at home — removes "I definitely packed it right" as an unverifiable claim.
- **ProofSeal** — a single-use, transaction-specific tamper-evident seal (not a reusable/static QR that could be photographed and replayed).
- **Protected Unboxing** — the buyer records before opening, scans the ProofSeal and Item ID on camera.
- **Evidence Timeline** — Listed → Purchased → Verified → Packed → Sealed → Handed Over → Shipped → Delivered → Unboxed → Confirmed, each step evidenced, not just claimed.
- **Fair Dispute Resolution** — an AI "Evidence Assistant" organizes and flags gaps in the evidence but is never the final decision-maker; a human dispute specialist decides.

### Mechanisms added during development (now fully built into the prototype)

- **Verifier Hub** — an independent third party that re-authenticates higher-tier items mid-journey (seller → Hub → buyer, two separately sealed legs, its own itemized fee). Two named, rotating hubs exist in the data model so repeat verification doesn't always hit the same authenticator.
- **Paired breakable NFC seals** — a ProofSeal on the parcel *and* a second, one-time "Item Seal" fitted to the item itself (handle, lace hole, button hole), registered as a linked pair at handover and independently re-checked at the hub and at delivery. The buyer scans and photographs the seal **still attached** rather than cutting it — an intact seal is itself evidence in a dispute.
- **Witnessed Packing** (£4.50) and **Witnessed Opening** (£7.50) — optional add-ons where a courier stays and independently logs confirmation of packing/unboxing, from their own separate login and evidence log — a human-witness layer that AI-generated photo/video evidence can't fake.
- **Mandatory dual independent verification for items ≥ £1,500** — not a spot-check, a hard requirement, enforced by tier assignment rather than a price re-check scattered through the code (see §4).
- **Account-level KYC + 2FA + always-on authentication audit log** — bank-style identity check (government ID + live liveness scan) once per account; 2FA required on *every single app launch*; every launch (success or failure, no sampling) is written to a permanent, hash-chained audit log that survives switching between items/roles.

---

## 2. Protection tiers (risk-based, not one-size-fits-all)

| Tier | Threshold | What it adds |
|---|---|---|
| **Enhanced** (the floor — every listing gets at least this) | Under ~£75 | Seller-recorded evidence photo set at listing time. There is no tier below this; the old bare "Standard" (zero extra verification) was retired. |
| **Verified Handover** | ~£75–500 | Recorded drop-off, ProofSeal + Item Seal pairing, Protected Unboxing. |
| **Luxury** | ~£500–1,500 | Adds independent third-party authentication via the Verifier Hub, NFC Item Seal, transferable Item Passport. |
| **Ultra Luxury** | ≥ £1,500 | Everything in Luxury, **plus mandatory dual independent verification** (two separately named hubs, not one hub asked twice), doubled Verifier Hub fee (12% + £20 vs. Luxury's 10% + £15). |

Fees are fully itemized before checkout: item price, buyer protection fee, shipping, seller fee, optional authentication fee, optional Verifier Hub fee, optional Witnessed Packing/Opening fees — no surprise fees. Sellers can choose, per listing, whether they or the buyer absorb any *triggered* fees above the free Enhanced floor; buyers choose free vs. paid shipping before checkout.

Three demo items currently span the tiers: a £9 tee (Enhanced), a £118 pair of sneakers (Verified Handover, the default item), and a £1,850 bag (Ultra Luxury, priced specifically to exercise the dual-verifier rule).

---

## 3. What's actually built (chronological build history)

The prototype is a **single self-contained HTML file** (`provenance-prototype.html`, vanilla JS, no framework, no build step — currently ~672KB), built in the following passes:

1. **Core screens** — Marketplace feed, Item Detail, Checkout, Seller Verified Handover, Buyer Protected Unboxing, Transaction Timeline, Item Passport, Dispute Centre (with its own Evidence Timeline example case), Protection & Risk explainer.
2. **Verifier Hub** — two-leg handover (seller→hub→buyer) added for the Luxury item.
3. **Paired NFC seals + Witnessed Opening** — added, then red-teamed.
4. **Full chain-of-custody threat model & remediation** (2026-10-02) — see §5. This is the most important hardening pass: hash-chained evidence logs, real seal-pairing codes, a live on-screen challenge-code step wired into all three flows, a genuinely separate courier session/log for Witnessed Opening, Witnessed Packing added, parcel-weight mismatch flagging, dual-verifier rule, and the global KYC/2FA/audit-log layer.
5. **Product imagery** — inline SVG illustrations initially (to avoid trademark risk), later replaced with **real but generic/unbranded, CC-licensed stock photography** (sourced via Openverse, visually vetted for hidden logos/iconic silhouettes, embedded as base64 `data:` URIs) at the user's request for "real photos."
6. **Tier restructuring** — Standard tier retired, Enhanced made the floor; later, Ultra Luxury split out from Luxury as its own tier with its own fee rate and the dual-verifier rule as its defining feature (not a price side-check).
7. **Marketplace layer** — categories, seller profiles/storefronts with follow + computed badges, reviews, a computed (not static) **Proof Score** per transaction, a mock payment screen (Visa/Mastercard/Amex/PayPal/Google Pay/Klarna shown as plain text wordmarks only — never recreated logos, to avoid the same trademark issue as product photos), owner-mode storefront management (edit/mark sold/boost/delete/publish, reply to reviews, discount-rate editor, holiday mode).
8. **Full mobile-app E2E build** (2026-10-03/04) — reframed as a phone-frame + bottom-tab-bar mobile UI; one complete, scriptably-testable journey (seller photographs & lists → publishes → buyer finds & buys → full custody chain → Confirmed); per-listing seller choice of who absorbs triggered protection fees; buyer free/paid shipping choice.
9. **PWA conversion** (2026-10-05) — installable on iOS and Android via "Add to Home Screen," shareable as a plain link (e.g. over WhatsApp). Custom app icon (an oxblood wax-seal motif matching the ProofSeal branding), web manifest, cache-first service worker so the installed app still opens offline.
10. **Real device integrations ("M1–M4", 2026-10-05/06)** — genuinely functional, not simulated-but-labelled-real, each with an honest fallback if unsupported:
    - **M1:** real camera capture via `getUserMedia` for every photo-capture moment.
    - **M2:** real QR generation/scanning of the ProofSeal via two vendored MIT/Apache libraries (`qrcode-generator`, `jsQR` — chosen over the native `BarcodeDetector` API specifically because that API has no iOS Safari support at all).
    - **M3:** real Face ID/Touch ID/Windows Hello/fingerprint prompts via WebAuthn for the KYC/2FA moments.
    - **M4:** native share sheet, haptic feedback, and a live offline banner (visible proof the PWA's cached shell still works with no connection).
11. **Visual polish ("V1–V4")** — dark mode (built on a semantic CSS-variable design system so one override block re-themes almost the whole app), an animated/filling evidence-chain timeline, a wax-seal stamp animation, capture-flash + thumbnail pop-in on every photo.
12. **Camera-UX bug fixes ("F1–F4")** — F1–F3 were defensive hardening (stream-attach fallback with live/no-signal status, an explicit shutter button added to the two scan steps, biometric error-handling). **F4 was the real fix**, found only via a real-device screenshot the user sent: the camera viewfinder box used `overflow:hidden` on a fixed aspect-ratio box that couldn't fit all its controls on a narrow phone screen, silently clipping the shutter button, caption, and cancel link invisible — not a JS bug at all. Fixed by moving every interactive control out of the clipped box into normal page flow below it, across all four camera/scan render sites (listing, handover, hub, unboxing). **This is the single most important lesson for continuing this project: the test suite (jsdom-based) cannot catch real CSS layout/overflow bugs — it only confirms markup/logic, not visual rendering. Real-device testing or a real-browser tool (Playwright) is required to catch this class of bug; it was invisible to every automated check until a human screenshot revealed it.**

---

## 4. Current architecture

- **Frontend:** one HTML file, vanilla JS, no React/build step, deliberately kept this way so there's zero build pipeline to break. Every screen is rendered via a full `innerHTML` replace (`render(screenId)`/`goTo(screenId)`) — not a virtual-DOM/reactive framework. Implication for any future dev: re-rendering a screen while a camera `<video>` stream is attached destroys and recreates the element, severing the stream — any status update during an active camera session must mutate the DOM directly rather than trigger a re-render.
- **Design system:** CSS custom properties as semantic "roles" (`--ink`, `--paper`, `--seal`/`--seal-dark`, `--brass`, `--verified`, `--line`, `--muted`) used consistently everywhere, which is why a single `[data-theme="dark"]` override block could re-theme almost the entire app for dark mode.
- **State:** one in-memory JS `state` object. **No persistence** — refreshing the page or opening the link on a different device starts from scratch, and there is no way for two different people to interact with the same listing/order today. This is the gap the backend migration (§6) addresses.
- **Hosting:** CodeSandbox's anonymous `sandboxes/define` API — static file hosting only, no server runtime. Every re-host produces a brand-new random subdomain, so stale home-screen links are a real, recurring risk flagged to the user repeatedly.
- **Testing:** no real browser available in this build environment (Puppeteer failed to launch — missing shared library, no root to fix it). All verification is via jsdom-based scripts: `smoketest.js`, `attacktest.js`, `e2e_journey.js`, plus feature-specific checks (`check_real_camera.js`, `check_qr_scan.js`, `check_webauthn.js`, `check_m4.js`, `check_cam_layout.js`). These catch logic/markup regressions reliably but **cannot** catch real CSS layout bugs (see F4 above) — that is jsdom's documented limitation, not an oversight.

**Current hosted link:** https://hzfrq9.csb.app/ (install via Safari/Chrome "Add to Home Screen" — not inside WhatsApp's in-app browser, which can block camera access).

---

## 5. Threat model & security posture (honest, not marketing)

A scripted red-team pass (2026-10-02) found 12 issues (5 confirmed via actual attack scripts, 7 conceptual). All 12 were remediated and the 5 scripted ones re-verified by rewriting and re-running the attack scripts against the fixed code (`attacktest.js`). Fixes included: hash-chained/signed evidence logs on every actor's log (seller, hub, buyer, courier) via `pushSignedLog`/`verifySignedLog`, with a minimum-entry-count check added after a real bug was found where a fully-forged "Confirmed" state with zero log entries wasn't being caught; real shared seal-pairing codes (`sealsPairMatch()`) instead of narrative-only pairing; a live on-screen challenge-code step actually wired into all three flows; a genuinely separate courier login/log for Witnessed Opening.

**Honest residual gaps, inherent to a client-only app and not fixable without a real backend:**
- There is still no real server trust boundary — a DevTools-capable attacker can still flip state flags directly in the browser. The fixes make tampering *detectable* (the hash chain breaks, the Timeline shows "Evidence chain broken"), not *prevented*.
- `sealScansConsistent()` exists in the data model but has no UI surface yet.
- Witnessed Opening's courier is a separate login/log on the same visit, not separate hardware.
- NFC tag-cloning is a hardware-specification question that software alone can't close.

This is the primary justification for the backend migration starting now — moving the evidence/state logic server-side is what would turn "detectable" into "prevented."

---

## 6. Backend migration (in progress — this is the current/next work)

**Decision made with the user (2026-10-10):** move from the client-only prototype toward a real app, starting with the most foundational piece. Three decisions were made explicitly:
1. **Backend/database: Supabase** (hosted Postgres + built-in auth + generous free tier) — chosen over Firebase (less natural fit for this app's relational data — orders, multi-leg custody chains) and over a fully custom Node server (more control, but more infrastructure to stand up and maintain before anything ships).
2. **Auth method: both email+password AND magic link** offered at login (Supabase supports both natively, no conflict).
3. **Scope of this first pass: accounts + listings/orders persistence only.** The custody-chain/evidence-log logic stays client-side for now, unchanged from the current prototype — moving *that* server-side (the real fix for the residual gap in §5) is explicitly deferred to a later pass, flagged to the user as the "proper" fix for the DevTools-tampering gap when they're ready for a bigger lift.

### What this unlocks immediately
Real signup/login (not everyone sharing one local browser's state); listings that persist in a real database and sync across devices; orders that both buyer and seller can see and update from their own separate phones — i.e., your friend testing on their phone and you testing on yours would, for the first time, actually be interacting with the same shared data instead of two disconnected local copies.

### Schema (already written, not yet applied — needs the user's own Supabase project URL + anon key, which only they can generate)

```sql
-- Provenance: v1 backend schema (accounts + listings + orders)
-- Paste this whole file into Supabase's SQL Editor (Project > SQL Editor > New query) and click Run.
-- Safe to run once on a brand-new project. Does NOT touch Supabase's built-in auth.users table structure.

-- ============================================================
-- 1. PROFILES (extends Supabase's built-in auth.users)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  bio text,
  avatar_url text,
  kyc_verified boolean not null default false,
  is_pro boolean not null default false,
  holiday_mode boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are publicly viewable"
  on public.profiles for select
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up (email+password OR magic link).
-- Username defaults to the part of their email before the @ sign; they can change it later.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, split_part(new.email, '@', 1) || '_' || substr(new.id::text, 1, 4));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- 2. LISTINGS
-- ============================================================
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  price_pence integer not null check (price_pence >= 0),
  category text,
  condition_label text,
  tier text not null default 'enhanced' check (tier in ('enhanced','verified','luxury','ultraLuxury')),
  photos jsonb not null default '[]'::jsonb,
  published boolean not null default false,
  views integer not null default 0,
  favourites integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.listings enable row level security;

create policy "published listings are publicly viewable"
  on public.listings for select
  using (published = true or seller_id = auth.uid());

create policy "sellers can insert their own listings"
  on public.listings for insert
  with check (seller_id = auth.uid());

create policy "sellers can update their own listings"
  on public.listings for update
  using (seller_id = auth.uid());

create policy "sellers can delete their own listings"
  on public.listings for delete
  using (seller_id = auth.uid());

-- ============================================================
-- 3. ORDERS
-- ============================================================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  price_pence integer not null check (price_pence >= 0),
  protection_payer text not null default 'buyer' check (protection_payer in ('buyer','seller')),
  shipping_choice text not null default 'free' check (shipping_choice in ('free','paid')),
  fees jsonb not null default '{}'::jsonb,
  status text not null default 'purchased'
    check (status in ('purchased','handover','hub','unboxing','confirmed','disputed')),
  -- Custody/evidence-chain detail stays client-side for now (unchanged from the current prototype) --
  -- this column just lets it sync across devices; it is NOT yet validated server-side.
  timeline_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders enable row level security;

create policy "buyer or seller can view their own orders"
  on public.orders for select
  using (buyer_id = auth.uid() or seller_id = auth.uid());

create policy "buyer can create an order"
  on public.orders for insert
  with check (buyer_id = auth.uid());

create policy "buyer or seller can update their own order"
  on public.orders for update
  using (buyer_id = auth.uid() or seller_id = auth.uid());

-- ============================================================
-- 4. Keep updated_at fresh automatically
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists listings_touch_updated_at on public.listings;
create trigger listings_touch_updated_at
  before update on public.listings
  for each row execute procedure public.touch_updated_at();

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute procedure public.touch_updated_at();
```

**Design notes on the schema:**
- Money is stored as `price_pence` (integer) rather than a float, to avoid floating-point rounding errors — standard practice for any real payment-adjacent system.
- Row Level Security (RLS) policies are the actual enforcement mechanism — a user's Supabase "anon" public API key only ever lets them see/touch rows the policies above permit (their own profile, published listings, their own orders as buyer or seller). This is real server-side enforcement, unlike anything in the client-only prototype.
- `listings.photos` is a `jsonb` array — currently intended to hold photo URLs once real object storage (S3/R2) is added; storing base64 blobs directly in this column would work short-term but doesn't scale, consistent with the single-file-prototype's own base64-in-HTML approach already being flagged as a scaling limit.
- `orders.timeline_state` is a deliberate escape hatch: it lets the existing client-side custody-chain JS keep working almost unchanged (serialize/deserialize its state into this column) while still getting cross-device sync, without requiring the bigger "move evidence logic server-side" rewrite in the same pass. This was an explicit scope trade-off, not an oversight.

### What happens once the user provides their Supabase project URL + anon key
1. Wire a real sign-up/login screen into the existing mobile UI (choice of password or magic link).
2. Replace the relevant parts of the local `state` object's listing/order handling with Supabase client calls (the existing `ITEMS`/`FILLER_ITEMS`/draft-listing logic maps directly onto the `listings` table; the purchase/checkout flow maps onto `orders`).
3. Re-verify with the existing regression suite plus new checks for the auth/data-layer change.
4. Re-host and confirm two separate devices can now see the same listing/order state.

**Note for whoever continues this:** the user explicitly declined to share the Supabase **service_role** secret key (correctly) — only the public **anon** key should ever be used client-side; the RLS policies above are what make that safe.

---

## 7. Known gaps / explicitly not yet built

Deferred by the user's own narrower focus on the end-to-end journey and now the backend migration, not abandoned: a Browse screen with real filters/sort, a dedicated own-Profile screen (currently reached via the storefront's own tabs), Inbox/chat/offers/counter-offers/bundles, discovery features (recently viewed, recommended, saved searches, restock alerts, price history), paid boost/promotion (still toast-only placeholders), a restore-hidden-listing UI, payout/export settings, real payments (currently a mock payment screen with plain-text card-brand wordmarks, no processor behind it), real identity verification (KYC is currently simulated client-side, not a real document/liveness check), real courier/shipping integration (hardcoded "InPost Locker, Shoreditch" text, no real tracking/webhooks), and push notifications (would need a backend to send them — now that a backend is being added, this becomes feasible).

**Platform caveats worth remembering:** `BarcodeDetector` has no iOS Safari support (hence the vendored `jsQR` library instead); the Vibration API has no iOS Safari support at all; real app-store distribution (native packaging/code signing) is out of reach from this build environment regardless — a PWA via "Add to Home Screen" is the ceiling without a Mac/Xcode/Apple Developer account.

---

## 8. File manifest

- `provenance-prototype.html` — the entire frontend (single file, ~672KB).
- `provenance-manifest.json` / `provenance-sw.js` — PWA manifest and service worker (deliberately **not** named `manifest.json`/`service-worker.js` — CodeSandbox's own platform silently shadows those exact filenames at the root of a hosted sandbox; confirmed by testing).
- `supabase_schema.sql` — the backend schema above, ready to paste into Supabase's SQL Editor.
- `smoketest.js`, `attacktest.js`, `e2e_journey.js`, `check_real_camera.js`, `check_qr_scan.js`, `check_webauthn.js`, `check_m4.js`, `check_cam_layout.js` — the full jsdom regression/attack suite; run all of them (`node <file>.js`) after any change to step-builder, fee, render, or data-layer functions.

**Reusable hosting routine:** `curl -X POST "https://codesandbox.io/api/v1/sandboxes/define?json=1" -H "Content-Type: application/json" --data-binary @payload.json` where `payload.json` is `{"files":{"index.html":{"content":...},"provenance-manifest.json":{"content":...},"provenance-sw.js":{"content":...}}}` — returns a `sandbox_id`; live at `https://<id>.csb.app/`. Two gotchas specific to this API: `isBinary:true` does **not** actually decode base64 server-side (verified by testing) — all binary assets must be inlined as base64 `data:` URIs inside text files instead; and files named exactly `manifest.json`/`service-worker.js` get shadowed by CodeSandbox's own platform files, hence the `provenance-` prefix on both.

---

## 9. Recommended next steps, in priority order

1. **Finish the backend migration** (in progress) — get the user's Supabase credentials, wire up real auth + listings/orders persistence, re-verify, re-host.
2. **Move the evidence/custody-chain logic server-side** — the deferred, "real" fix for the residual DevTools-tampering gap in §5; bigger lift, explicitly scoped out of the first backend pass.
3. **Real payments** (Stripe test mode is a safe, free next step — no real money moves but it's a genuine processor integration rather than a static mock screen).
4. **Real browser/device test automation** (Playwright or similar) — the F4 bug proved jsdom cannot catch real layout/overflow issues; this is a known blind spot in the current verification approach, not a one-off mistake.
5. **Stable hosting on a fixed domain** — CodeSandbox's random-subdomain-per-rehost pattern is a recurring, user-visible failure mode ("stale link on your home screen" problem); moving to Vercel/Netlify/Render with a permanent URL removes this entirely once a real backend exists to deploy alongside.
6. Real identity verification (KYC provider), real courier integration, push notifications, and the explicitly-deferred marketplace features in §7, roughly in that order of how load-bearing they are to the core trust proposition versus how much they're "more marketplace, less core différentiation."
