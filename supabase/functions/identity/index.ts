// Supabase Edge Function: identity. Starts a Stripe Identity check for the signed-in member (migration 033).
// Deployed with verify_jwt on. Needs STRIPE_SECRET_KEY and Identity switched on in Stripe; otherwise "payments_not_configured".
// Stripe tells us the result through stripe-webhook (identity.verification_session.*).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import Stripe from 'npm:stripe@22.6.2';
import { CORS } from '../_shared/payments.ts';
import { handleIdentity } from '../_shared/identity.ts';

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
  const reply = await handleIdentity(token, await req.json().catch(() => null), {
    async userFromToken(t) {
      const { data } = await admin.auth.getUser(t);
      return data.user ? { id: data.user.id } : null;
    },
    async canStart(userId) {
      const { data } = await admin.rpc('identity_can_start', { p_user: userId });
      return data === true;
    },
    async started(userId, sessionId) {
      const { error } = await admin.rpc('identity_session_started', { p_user: userId, p_session: sessionId });
      if (error) throw error;
    },
    stripe: stripe && {
      createSession: ({ userId, returnUrl, idempotencyKey }) => stripe.identity.verificationSessions.create(
        { type: 'document', metadata: { user_id: userId }, options: { document: { require_matching_selfie: true } }, return_url: returnUrl },
        { idempotencyKey },
      ) as never,
    },
    siteUrl: SITE,
    now: () => Date.now(),
  });
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
