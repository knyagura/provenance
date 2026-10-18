// Supabase Edge Function: connect. A seller sets up payouts with Stripe Connect Express, checks their status, or opens
// their Stripe dashboard. Deployed with verify_jwt on. Needs STRIPE_SECRET_KEY (a function secret the owner adds;
// test-mode keys while testing); without it the answer is "payments_not_configured". SITE_URL optional.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import Stripe from 'npm:stripe@22.6.2';
import { CORS } from '../_shared/payments.ts';
import { handleConnect } from '../_shared/payouts.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const secret = Deno.env.get('STRIPE_SECRET_KEY');
const stripe = secret ? new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() }) : null;
const SITE = (Deno.env.get('SITE_URL') || 'https://lucky-gnome-de81b6.netlify.app').replace(/\/$/, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method' }), { status: 405, headers: CORS });
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const reply = await handleConnect(token, await req.json().catch(() => null), {
    async userFromToken(t) {
      const { data } = await admin.auth.getUser(t);
      return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
    },
    async accountFor(userId) {
      const { data } = await admin.rpc('payout_account_for', { p_user: userId });
      return (data as string | null) ?? null;
    },
    async saveAccount(userId, accountId) {
      const { error } = await admin.rpc('set_payout_account', { p_user: userId, p_account: accountId });
      if (error) throw error;
    },
    async accountUpdated(accountId, details, enabled) {
      await admin.rpc('payout_account_updated', { p_account: accountId, p_details: details, p_enabled: enabled });
    },
    stripe: stripe && {
      createAccount: ({ email, userId }) => stripe.accounts.create(
        { type: 'express', country: 'GB', email: email ?? undefined, capabilities: { transfers: { requested: true } }, business_type: 'individual', metadata: { user_id: userId } },
        { idempotencyKey: `connect-${userId}` },
      ) as never,
      retrieveAccount: (id) => stripe.accounts.retrieve(id) as never,
      onboardingLink: (account, returnUrl, refreshUrl) => stripe.accountLinks.create({ account, return_url: returnUrl, refresh_url: refreshUrl, type: 'account_onboarding' }) as never,
      dashboardLink: (account) => stripe.accounts.createLoginLink(account) as never,
    },
    siteUrl: SITE,
  });
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
