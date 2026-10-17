# 0011: Google and Facebook sign-in

Date: 2026-10-17. Status: accepted (switched on once the providers are configured in Supabase).

## Decision
- The sign-in page shows "Continue with Google" and "Continue with Facebook" above the email form, the way Vinted does. One button serves both new and returning members: Supabase creates the account on first use, and the existing sign-up trigger gives it a username from the email.
- Buttons only appear for providers that Supabase reports as enabled (`/auth/v1/settings`), so nothing broken shows before setup.
- People come back to `/auth/callback?next=…`, which waits for the session and continues to the page they were on. Errors and cancellations return to sign-in with a plain message.
- If someone already has a password account with the same verified email, Supabase links the identities rather than making a second account.
- The buttons are text-only. The official Google and Facebook button artwork can be dropped in from their brand pages.

## Setup (done by the owner; secrets go only into Supabase, never into the code)
1. **Google Cloud Console** → APIs & Services → Credentials → OAuth client ID (Web application).
   Authorised JavaScript origin: `https://lucky-gnome-de81b6.netlify.app`.
   Authorised redirect URI: `https://tkjmnivvcrcqkqjywafb.supabase.co/auth/v1/callback`.
   OAuth consent screen: app name NuTuYu; scopes `email`, `profile`.
2. **Meta for Developers** → Create app → Facebook Login.
   Valid OAuth redirect URI: `https://tkjmnivvcrcqkqjywafb.supabase.co/auth/v1/callback`.
   Permissions: `email`, `public_profile` (email needs Advanced access before the public can use it). Then switch the app to Live.
3. **Supabase** → Authentication → Sign In / Providers. Enable Google and Facebook and paste each client ID and secret.
4. **Supabase** → Authentication → URL Configuration. Set Site URL to `https://lucky-gnome-de81b6.netlify.app`. Add these redirect URLs:
   - `https://lucky-gnome-de81b6.netlify.app/auth/callback`
   - `https://*--lucky-gnome-de81b6.netlify.app/auth/callback`
   - `http://localhost:3000/auth/callback`
