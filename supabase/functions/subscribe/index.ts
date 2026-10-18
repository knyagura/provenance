// Supabase Edge Function: subscribe. Starts a paid plan with Stripe Checkout, or opens Stripe's billing portal to
// change or cancel it (migration 035). Deployed with verify_jwt on. Needs STRIPE_SECRET_KEY; otherwise
// "payments_not_configured". Stripe's webhook (stripe-webhook) keeps the subscription up to date.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import Stripe from 'npm:stripe@22.6.2';
import { CORS } from '../_shared/payments.ts';
import { handleSubscribe } from '../_shared/subscriptions.ts';

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
  const reply = await handleSubscribe(token, await req.json().catch(() => null), {
    async userFromToken(t) {
      const { data } = await admin.auth.getUser(t);
      return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
    },
    async context(userId, planKey) {
      const { data, error } = await admin.rpc('subscription_context', { p_user: userId, p_key: planKey });
      if (error) throw error;
      return data as never;
    },
    stripe: stripe && {
      checkout: ({ planKey, planName, pricePence, userId, email, customer, successUrl, cancelUrl }) => stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ quantity: 1, price_data: { currency: 'gbp', unit_amount: pricePence, recurring: { interval: 'month' }, product_data: { name: `NuTuYu ${planName}` } } }],
        ...(customer ? { customer } : { customer_email: email ?? undefined }),
        metadata: { user_id: userId, plan_key: planKey },
        subscription_data: { metadata: { user_id: userId, plan_key: planKey } },
        success_url: successUrl,
        cancel_url: cancelUrl,
      }) as never,
      portal: (customer, returnUrl) => stripe.billingPortal.sessions.create({ customer, return_url: returnUrl }) as never,
    },
    siteUrl: SITE,
  });
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
