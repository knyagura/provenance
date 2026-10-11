# ADR 0004: Passkeys through Supabase Auth, tied to the site's domain

Date: 2026-10-11 · Status: accepted · Build step 4

## Context

The plan offers passkeys (Face ID, fingerprint, screen lock) after a member's third sign-in. Supabase Auth now supports passkeys itself (WebAuthn), storing them alongside the account, so we need no tables or server code of our own.

## Decisions

1. **Use Supabase Auth's passkeys.** Sign-in, adding, renaming and removing all go through `supabase.auth` in the browser. Nothing secret is held by our code.
2. **Offer after the third password sign-in on a device.** Counted in that browser, because a passkey belongs to a device. "Not now" asks again three sign-ins later; "Don't ask again" stops on that device. Members can add one any time from the account page.
3. **Passwords stay.** Passkeys are an addition, so nobody is locked out by losing a phone.

## Open: which domain

A passkey is bound to one domain, the "relying party". Supabase allows one relying-party domain and up to five web addresses under it. If we register passkeys on `lucky-gnome-de81b6.netlify.app` and later move to our own domain, every passkey stops working and members must add new ones.

- **Option A, use the Netlify address now.** Works today; passkeys are re-added after the switch-over (step 7). Acceptable while only testers use them.
- **Option B, buy the domain first.** Point it at Netlify, set it as the relying party, and passkeys survive the switch-over.

**Decided 11 Oct 2026: Option A.** Passkeys are switched on in Supabase with the relying party `lucky-gnome-de81b6.netlify.app` (checked: Supabase's sign-in challenge names that domain). Passkeys made now must be added again after the switch-over to our own domain; the switch-over checklist must say so to members.

## Consequences

- Supabase marks passkey support as new; the client API may change, so passkey calls sit in one file (`lib/selling/supabaseBackend.ts`).
- Turning passkeys on: Supabase → Authentication → Passkeys → Enable; display name "Provenance"; relying party ID = the chosen domain; origins = its https address.
