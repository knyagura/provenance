# When the custom domain is bought

A checklist of everything tied to the temporary address `lucky-gnome-de81b6.netlify.app`. Work through it once the domain is live on Netlify.

1. **Netlify:** add the domain under Domain management, and let Netlify issue the HTTPS certificate.
2. **Supabase Auth → URL Configuration:**
   - set Site URL to the new domain;
   - add `https://<domain>/auth/callback` to the redirect URLs, and keep the Netlify one until you're sure.
3. **Passkeys** ([ADR 0004](adr/0004-passkeys.md)): add the new domain as the relying party in Supabase. Passkeys made on the old address won't work on the new one, so members add them again.
4. **Google sign-in** ([ADR 0011](adr/0011-google-and-facebook-sign-in.md)):
   - add the domain to the OAuth client's JavaScript origins;
   - update the consent screen's homepage, privacy and terms links;
   - publish the app (out of Testing).
5. **Resend email** ([ADR 0012](adr/0012-notifications.md)):
   - verify the domain in Resend (add its DNS records);
   - in Supabase → Edge Functions → Secrets, set `RESEND_FROM` (for example `NuTuYu <hello@<domain>>`) and `SITE_URL` (`https://<domain>`).
6. **Site settings:** set `NEXT_PUBLIC_SITE_URL` in Netlify so links, the sitemap and sharing previews use the new domain.
7. **Uptime check:** update the address in `.github/workflows/uptime.yml`.
