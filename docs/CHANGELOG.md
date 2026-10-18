# Changelog

Newest first. Each entry says what changed for people using the site, and which documents were updated.

| Date | Change | Documents updated |
|---|---|---|
| 2026-10-12 | Visual update: example items have drawn pictures (front, close-up, label) and item pages a swipeable gallery with labelled thumbnails. Every card and item page shows its protection level (Photo evidence, Courier witnessed, Authenticated, Double authenticated), and item pages explain the steps for that level. Home page: picture, how-it-works strip and "Protection grows with the price". The custody record is grouped into stages with a progress bar, finished stages fold away, photos and seals sit beside their steps, and the one-time code shows a countdown. Inbox: status chips, progress bars and thumbnails. Seal logo mark, app icon, fuller footer and friendlier empty states | Plan (design), Design system (protection badges, logo mark), [web/README.md](../web/README.md) |
| 2026-10-11 | Build step 6, Orders and custody: an Inbox with "Your turn" first, and each paid order's page now runs its chain of custody. Seller handover (code read aloud on video, photos, weight, ProofSeal), courier witness at packing and delivery, the authentication hub from £500 (and a second authenticator from £1,500), buyer unboxing with the seal check, then confirmation. Every step is accepted only by the server, written to an append-only, hash-chained record, and shown with its evidence. A wrong seal code, a failed authentication or a buyer's reported problem holds the payment. Payment is released on confirmation, or automatically after the protection window. Database: migration 011 (applied live in two parts, plus an hourly auto-confirm job) | Plan (build order: step 6), Backlog, Data model (orders and custody), [ADR 0008](adr/0008-custody-on-the-server.md), [web/README.md](../web/README.md) |
| 2026-10-11 | Every item now carries a transaction fee paid by the buyer: 8% under £75, 6% from £75, 4% from £500, 3% from £1,500, kept within a configurable 3–8%, plus £0.80 processing. Replaces the flat 5% buyer protection (fee settings version 2; earlier orders keep version 1). Checkout shows "Transaction fee (8%)". API quote gains `transaction_rate_bp`. Database: migration 010 | Plan (fees), Backlog (B48), Data model (settings), [ADR 0007](adr/0007-transaction-fee.md), [Fee model](https://claude.ai/artifact/VUH2mjkuZAwTDNZjSrQS6x) |
| 2026-10-11 | Sellers can edit live listings, including photos, category and serial number: "Edit listing" takes it off sale, "Publish changes" puts it back as a new version. Locked while someone is paying and once sold. Every version is kept with its photos. If the seller changes a listing while someone is about to buy it, checkout shows what changed and asks them to confirm. Order pages show exactly what was bought. Database: migration 009 | Plan (decisions), Backlog (B07), Data model (listings, orders), [ADR 0006](adr/0006-listing-edits.md) |
| 2026-10-11 | Build step 5, Buy and pay: Buy now opens a checkout with every charge on its own line (item, postage, buyer protection, processing, courier witness, authentication); the item is held for 30 minutes while you pay; Stripe's card form; an order page; orders on the account page. Fees come from versioned settings (version 1 = the fee model), priced on the server, and 14 agreed test baskets match the fee model in both the website and the database. Payments stay off until Stripe test keys are added. API gains `/listings/{id}/quote`. Database: migrations 008, 008b; two Supabase Edge Functions | Plan (build order: step 5), Backlog (B08, B12, B48), Data model (orders and money, settings), [ADR 0005](adr/0005-payments.md), [web/README.md](../web/README.md) |
| 2026-10-11 | Passkeys switched on in Supabase for lucky-gnome-de81b6.netlify.app; they will need adding again after the move to our own domain | [ADR 0004](adr/0004-passkeys.md), Plan (step 4 status) |
| 2026-10-11 | Build step 4, Account: sign in with a passkey (offered after the third password sign-in on a device; add, rename and remove them on the account page); edit username and bio; public member pages; holiday mode hides your listings and pauses buying; forgotten-password emails; change password. API gains a `seller` filter and `seller.away`. Database: migration 007 (username and bio rules). Passkeys need switching on in Supabase before they work live | Plan (build order: step 4), Backlog (B02), [ADR 0004](adr/0004-passkeys.md), [web/README.md](../web/README.md) |
| 2026-10-11 | Build step 3, Sell now: sign in with an existing Provenance account; choose a category and the camera asks for that category's photos (and a working video and serial number for electronics); drafts save as you go; Publish stays off until the evidence is complete, and the database refuses it too. Photos are resized and their location data removed; serial numbers stay private (buyers see the last 4 characters); reference photos are fixed once live. Database: migration 006 | Plan (build order: step 3), Backlog (B07, B13), Data model (built so far), [web/README.md](../web/README.md) |
| 2026-10-11 | Build step 2: browsing (category bar, search with filters, item pages with link previews), API v1 (listings, categories; hashed keys with scopes, 120 calls a minute, problem+json errors, OpenAPI at `/api/v1/openapi.json`) and a Developers page. Database: categories, search index, listing photos table and storage bucket, API keys and usage (migrations 004, 005). Examples show while nobody has listed yet | Plan (build order: step 2), Backlog (B01, B02, B03, B58 and others), Data model (catalogue, API keys), [web/README.md](../web/README.md), [ADR 0003](adr/0003-api-keys-and-example-catalogue.md) |
| 2026-10-11 | Premium+ starting price set at £17.50 a month incl. VAT (about £4 margin per member); all plan prices and allowances stay configurable | Plan (Account plans), Backlog (B56), [Fee model](https://claude.ai/artifact/VUH2mjkuZAwTDNZjSrQS6x) |
| 2026-10-11 | Premium+ added to the fee model: price options, perk costs, break-even (about £13 a month with default perks); £15 suggested | [Fee model](https://claude.ai/artifact/VUH2mjkuZAwTDNZjSrQS6x), Plan (Account plans) |
| 2026-10-11 | Premium+ added as a paid plan; Premium (free) set to at least match Vinted Pro; APIs split between Premium (core) and Premium+ (full set) | Plan (Account plans, APIs), Backlog (B56), Data model (settings) |
| 2026-10-11 | Premium set to free (£0) for now; price stays a setting; fee-free orders and boost credit start at 0 until modelled | Plan (Account plans), Backlog (B56) |
| 2026-10-11 | API-first decided; 22 APIs and partner services added (B56–B77), each mapped to where it shows on our site; architecture now has one API layer | Plan (APIs section, architecture, build order), Backlog, Data model, [ADR 0002](adr/0002-api-first.md) |
| 2026-10-11 | Plans settled as Standard (free) and Premium (paid, the only plan with seller APIs, broader than Vinted Pro's); replaces the Premium+ proposal | Plan (Account plans), Data model (API keys and webhooks) |
| 2026-10-11 | Proposed Standard, Premium and Premium+ account plans, with business seller status kept separate and free | Plan (Account plans; Data model: plans and subscriptions, settings) |
| 2026-10-11 | Mockups for phone, desktop and the staff console | [Provenance Mockups](https://claude.ai/artifact/BxdbvWujyLBgevyMN1Q13T) |
| 2026-10-11 | Listed every configurable setting, including data retention rules with legal minimums and legal hold | Plan (Data model tab: Configurable settings) |
| 2026-10-11 | Data model designed: records, access by persona, data by journey, custody evidence storage, retention, and migration from today's tables | Plan (new Data model tab) |
| 2026-10-11 | Fixed the new site showing "Page not found" on Netlify: the Next.js adapter is now named in `netlify.toml` | [web/README.md](../web/README.md) |
| 2026-10-10 | Build step 1: new Next.js site in `web/` with the design system's colours, fonts and components, a style guide page, unit and browser tests, and Netlify hosting | Plan (build order), Design system (focus-ring note), [web/README.md](../web/README.md) |
| 2026-10-10 | Decided to host the new Next.js site on Netlify's free plan | Plan (Decisions, Code structure, Build order), [ADR 0001](adr/0001-hosting-on-netlify.md) |
| 2026-10-10 | Added the architecture and build order, and the rule that every change updates its document | Plan |
| 2026-10-10 | New colour palette (cream, sand, sage, terracotta, charcoal-olive) on the live site; design system written up | Design system, Plan (Decisions) |

## 2026-10-16: NuTuYu marketplace features and multi-basket shopping
- Renamed to NuTuYu with the hand-over-circle logo; installable app (manifest, offline page, service worker).
- Favourites and Saved page; Inbox badge; buyer–seller messages per order with unread counts.
- Offers: make, accept, decline, counter; accepted offers check out at the agreed price with the same fees and hold.
- Seal QR scanning (camera) and printable seal labels; Item Passport (public, no personal details); reviews after confirmation.
- Staff console v1: queue, dispute and payment decisions, courier/hub accounts, custody/offer/wrapping settings, fee versions.
- Accessibility: skip link, axe checks in e2e, contrast and list-semantics fixes.
- Multi-basket shopping (opt-in, migration 013): General plus up to 4 people with sizes, budget, notes, wrapping and gift options;
  drag and drop, tap to add, one-basket and by-person views; one payment for all baskets with combined or separate shipping;
  gift links where the recipient does the unboxing steps without prices; shared baskets.
- Migration 012 applied live. Migration 013 still to apply (basket features need it on the live site).
- Next: variants for business sellers (colour/size, stock per variant, each unit its own protected order).

## 2026-10-17: Sizes learned on drop; Google and Facebook sign-in
- Dropping clothing into a person's basket checks its size. If the basket has no size yet for that kind of item, it takes the item's size ("Alex's tops size is now S"). If the sizes differ, it warns and offers "Make UK 9 Alex's size". Adult and child sizes never mix.
- "Continue with Google" and "Continue with Facebook" on sign-in and registration (ADR 0011). They appear once each provider is enabled in Supabase.

## 2026-10-17: Migrations apply themselves from GitHub
- New workflow `.github/workflows/migrate.yml`: when a migration file reaches `main`, the database tests run, and then any file not yet recorded in `ops.applied_migrations` is applied to the live database in one transaction. Needs the `SUPABASE_ACCESS_TOKEN` secret. It can also be run by hand from the Actions tab, with a dry-run option.
- Ledger seeded with 002–012. 013 is left off, so the first run finishes it (013 is safe to re-run).

## 2026-10-17: Privacy notice, terms and a contact form
- New `/privacy` page (needed for Google sign-in's public mode), `/terms`, and `/contact`, all linked from the footer and the social sign-in buttons.
- Migration 014: the contact form stores messages that only staff can read, in the console's new Messages tab. No email address is published. Limits: 5 messages per address per day and 200 an hour overall, plus a hidden field to catch bots. It is applied automatically when merged.
- The privacy notice is a plain-English first draft. Have it reviewed before launch, and add the legal entity name once there is one.
## 2026-10-17: Breached passwords refused (free stand-in for Supabase's Pro-plan setting)
- Creating an account or setting a new password checks the password against Have I Been Pwned. Only the first 5 characters of its SHA-1 hash are sent, using k-anonymity. A password found in a breach is refused with a plain message. If the service can't be reached, the check passes rather than blocking anyone.
- This applies to the site's own forms. Once on Supabase Pro, switch on "Prevent use of leaked passwords" so passwords set any other way are covered too.

## 2026-10-17: Tidy-up (search engines, faster photos, indexes, error pages, live checks)
- `sitemap.xml` covers live listings, Item Passports and member pages. `robots.txt` keeps private pages out of search. Item pages carry schema.org Product data (price, photo, condition, availability).
- On Netlify, listing photos are served through its image CDN at the width each screen needs (WebP/AVIF). Cards, the gallery and thumbnails use `srcset`. Local runs and tests use the originals.
- Migration 015: indexes behind 12 foreign keys flagged by the database advisor.
- Friendly error, not-found and last-resort pages.
- New workflow `uptime.yml` checks the live pages and the database every 30 minutes, so a failure emails the owner.
- Download size: the largest shared piece is the Supabase client, which every page needs. Stripe, QR and camera code already load only where they're used.

## 2026-10-17: Notifications (in-app Updates and email)
- New **Updates** list (`/notifications`, and the unread ones at the top of the Inbox). It covers: your turn in a handover; new messages (grouped per order); new offers, counter-offers, accepted offers and offers about to end; sold, payment released, problem reported, and staff decisions. Opening one marks it read. Reading an order's messages also reads its message update. The Inbox badge counts unread updates too.
- **Email** for the same events, sent with Resend. Members choose which groups they get under *Account → Emails*. Message emails are held for 2 minutes, so nobody is emailed about a message they're already reading, and go out at most once every 15 minutes per order. Emails that wait more than 2 days are dropped.
- Migration 016: notifications and email settings tables, triggers on orders, messages and offers, member functions, and a service-only email outbox. Migration 016b schedules the sender every minute and the "offer ending soon" check every hour.
- New Edge Function `send-notifications`. It sends nothing until the owner adds `RESEND_API_KEY` (and later `RESEND_FROM` with a verified domain) to the Supabase function secrets.
- Migration 017: only the scheduled job can start the sender. It uses a random token kept in Supabase Vault, and nobody handles it.
- Documents: [ADR 0012](adr/0012-notifications.md).

## 2026-10-17: Variants and stock for business sellers
- Business sellers (marked by staff in the console) can sell more than one of an item, and add colours and sizes from the listing page (*Stock, colours and sizes*). Each one has its own stock and, if they like, its own price, and shares the original's photos.
- Item pages show every colour and size with what's left ("2 left", "Sold out"). Search shows one card per item. With multi-basket shopping on, each size can be dragged straight onto someone's basket.
- Every unit sold is its own order with its own protected handover. A listing stays on sale while units are left, shows "Reserved" while the rest are being paid for, and "Sold" when they've all gone. Overselling is refused. Business prices are fixed, so they don't take offers.
- Migration 018. Example mode has a business seller, `knit_house`, selling a merino jumper in two colours and two sizes.
- New checklist: [When the domain is bought](when-the-domain-is-bought.md), covering Netlify, Supabase, passkeys, Google sign-in, Resend and the uptime check.
- Documents: [ADR 0013](adr/0013-variants-for-business-sellers.md).

## 2026-10-17: Saved searches, price-drop alerts and a size filter
- *Save this search* on the results page. The Saved page lists your searches with how many items match now, an alert switch and Delete.
- When a new listing matches a saved search (or drops into its price range), you get an Update and, if you like, an email. Items you saved tell you when their price drops ("Now £49 (was £55)").
- New **Size** filter in search, and a `size` parameter in the API.
- New email switch, *Alerts*, under Account → Emails.
- Migration 019. Documents: [ADR 0014](adr/0014-saved-searches-and-alerts.md).

## 2026-10-17: Seller tools: bundle discounts, sold history and a sales dashboard
- **Bundle discounts:** sellers can offer, for example, 10% off when someone buys 2 or more of their items in one basket checkout. Their item pages show the offer. Checkout shows the discount against each item ("Bundle: 10% off (was £10.00)"), and the fees and the one payment are worked out on the discounted prices.
- **Your sales** (`/selling`, linked from your account) shows:
  - what you've sold, what you've taken, what's held and what's been released;
  - average handover time and problems reported;
  - sales by month for the last year;
  - every sale, with its buyer, handover and payment status;
  - the bundle discount settings.
- Migration 020. Example mode: `resole_archive` offers 10% off 2 or more.

## 2026-10-17: Voucher codes, gift cards and a NuTuYu balance
- **Voucher codes.** Staff make NuTuYu codes in the console (*Vouchers*). NuTuYu pays for them: the buyer pays less, and the seller still gets their full payout. Sellers make codes for their own shop on *Your sales*; the discount comes off their price. Options: percentage or amount off, a cap, minimum spend, uses per person, total uses, end date, and first order only (good for a sign-up offer in a popup).
- **Gift cards** from £10 to £250 at `/gift-cards` (in the footer and your account). The code appears once paid, and is emailed to the recipient if you give their address. They add it to their **NuTuYu balance**, valid for 2 years.
- **At checkout**, one box takes a voucher or gift card code, and a tick box uses your balance. You see the discount and what's left to pay by card. With nothing left to pay, the order is paid straight away. Codes and balance come back if you don't finish paying, and the balance part comes back if an order is refunded.
- Migration 022, plus updated checkout, webhook and email functions. Documents: [ADR 0016](adr/0016-vouchers-gift-cards-balance.md).
## 2026-10-17: Home page goes straight to the items; popups staff configure
- The home page now starts with the items ("Newly listed", 20 of them) right under the category bar. The hero and the how-it-works strip are gone. "How protection works" opens the explanation as a popup, which new visitors also see once.
- New *Popups* tab in the staff console: explanations, announcements and offers, with title, text, steps, a button, an optional offer code, who sees it, which pages, a delay, priority and dates. "Show again" shows a popup again to everyone who closed it.
- Offer codes are shown, but checkout doesn't apply them yet.
- Migration 021. Documents: [ADR 0015](adr/0015-home-page-and-popups.md).

## 2026-10-17: No popup on the home page
- The "how it works" popup and its link are off. The site opens straight onto the items. Popups stay available in the staff console (*Popups*) for offers and announcements, all switched off to begin with. Migration 024.

## 2026-10-17: Better search: collect near me, sizes from your baskets, similar items
- **Collect in person near you.** Sellers can add the first half of their postcode and offer collection (*Account → Collection in person*). Buyers search *Collect in person near* with a postcode or *Use my location*, and choose a distance. Results are nearest first, with "SW11, about 3 miles away". Only districts are stored, never addresses.
- **Sizes from your baskets** appear as one-tap chips above the Size filter.
- **Similar items** on every item page.
- Migration 023. Documents: [ADR 0017](adr/0017-better-search.md).

## 2026-10-17: Shipping labels (Parcel2Go, test mode)
- **Delivery address.** When the seller posts the item themselves, the buyer is asked for a delivery address on the order page. Only the seller sees it, printed on the label.
- **Labels.** At *Post it with tracking*, the seller chooses a parcel size and a service (Evri, Royal Mail or DPD, with prices). They get a printable label, and the carrier and tracking number are filled in. The buyer sees the carrier and tracking number.
- **Test mode for now.** Labels say *TEST — not valid for posting* and cost nothing. Live labels need NuTuYu's Parcel2Go key, added as a Supabase function secret.
- Migration 025. Documents: [ADR 0018](adr/0018-shipping-labels.md).

## 2026-10-17: Trust badges and a public trust tracker
- Seller record on item and member pages: protected handovers completed, the dispute rate (from 5 sales) and the typical handover time.
- **Trusted seller** badge: identity checked, 5 or more completed and no more than 1 in 20 disputed.
- **Trust tracker** at `/trust` (in the footer): completed handovers, disputes and refunds, typical time, counts by protection level, and recently completed items linked to their passports. It never shows anyone's details.
- Migration 026. Documents: [ADR 0019](adr/0019-trust-badges-and-tracker.md).

## 2026-10-17: Staff reports
- New *Reports* tab in the staff console, for any period:
  - sales: orders, items sold, buyers paid, average item, by protection level and category;
  - fees, and what NuTuYu keeps after promotions and its own voucher codes;
  - disputes: rate, outcomes, reasons, time to decide;
  - handover time from payment to confirmation;
  - 12 months by month;
  - a CSV download.
- Migration 027. Documents: [ADR 0020](adr/0020-staff-reports.md).

## 2026-10-18: Seller payouts, questions before buying, and reporting
- **Payouts (Stripe Connect).**
  - Sellers set up payouts once with Stripe (*Account* or *Your sales → Getting paid*).
  - When a buyer confirms, the seller's share is sent to their bank automatically.
  - Staff can hold, release or retry payouts (*Staff console → Payouts*).
  - Off until Stripe Connect and the keys are switched on.
- **Ask the seller.** Buyers can ask before buying. Answers are public on the item page, without the asker's name. Contact and payment details are refused, to keep sales protected.
- **Report and moderation.** Report a listing or a member. Staff see reports grouped in *Moderation* and can hide a listing, suspend or restore an account, or dismiss. Every decision is recorded and the member is told why.
- Migrations 028, 028b and 029. Documents: [ADR 0021](adr/0021-seller-payouts.md), [ADR 0022](adr/0022-questions-reports-moderation.md).

## 2026-10-18: Returns, refunds to cards, saved addresses, privacy tools and identity checks
- **Returns.** Once the item arrives, the buyer can return it if it isn't as described, is damaged or is the wrong item. The seller accepts (or it's accepted after 48 hours) and a return label is made. When the item is back, the buyer is refunded.
- **Refunds to cards.** Every refund now goes back to the buyer's card automatically, through Stripe.
- **Saved addresses.** Up to 5. The default is used for orders automatically, and for returns when you sell.
- **Your data.** Download everything NuTuYu holds about you. You can also delete your account once nothing is in progress; order records are kept without your name, as the law requires. Old data is cleaned up automatically.
- **Identity check.** Check your identity with Stripe to show "Identity checked". Off until Stripe Identity is switched on.
- Migrations 030, 031, 031b, 032, 032b and 033. Documents: [ADR 0023](adr/0023-refunds-and-returns.md), [ADR 0024](adr/0024-addresses-and-privacy.md), [ADR 0025](adr/0025-identity-checks.md).

## 2026-10-18: Notifications on your phone, plans, boosts, category and brand pages, and the owner's dashboard
- **Phone and desktop notifications.** Turn them on per device in your account. They work with no extra set-up.
- **Plans.** Standard and Premium are free; Premium+ is £17.50 a month through Stripe, managed in Stripe's billing portal. Plan badges show on member pages. Staff set prices and perks.
- **Boosts.** Sellers can boost items of £25 or more and pay 3–8% plus 80p only if it sells. Boosted items come first and are labelled.
- **Category and brand pages** for search engines, with structured data, and in the sitemap.
- **Owner's dashboard.** The first tab in the staff console: this week against last, what needs attention, 30 days, and top sellers.
- Migrations 034, 034b, 035 and 036. Documents: [ADR 0026](adr/0026-push-notifications.md), [ADR 0027](adr/0027-plans-and-boosts.md), [ADR 0028](adr/0028-landing-pages-and-owner-dashboard.md).

## 2026-10-18: Security review and faster tests
- **Security.** Suspension reasons are now private. The trust tracker is cached so it can't load the database. Internal helpers can no longer be called from outside. Every page now sends security headers (a Content Security Policy, HSTS, no framing, a strict referrer policy).
- **Faster tests.** The browser checks run in parallel, locally and on GitHub: about 3 minutes instead of 12.
- Migration 037. Documents: [ADR 0029](adr/0029-security-review-and-faster-tests.md).
