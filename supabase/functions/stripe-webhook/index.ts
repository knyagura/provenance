// Supabase Edge Function: stripe-webhook. Stripe calls it when a payment succeeds; it checks Stripe's
// signature (STRIPE_WEBHOOK_SECRET) and only then marks the order paid through confirm_payment(), which
// only the service role may run. Deployed without JWT checking, because Stripe has no Supabase login.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import Stripe from 'npm:stripe@22.6.2';
import { handleWebhook } from '../_shared/payments.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? 'sk_unset', { httpClient: Stripe.createFetchHttpClient() });
const crypto = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  const whsec = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!whsec) return new Response(JSON.stringify({ error: 'payments_not_configured' }), { status: 503 });
  const payload = await req.text();
  const reply = await handleWebhook(payload, req.headers.get('Stripe-Signature'), {
    verify: (p, sig) => stripe.webhooks.constructEventAsync(p, sig, whsec, undefined, crypto) as never,
    async confirmPayment(orderId, ref, amount) {
      const { data, error } = await admin.rpc('confirm_payment', { p_order: orderId, p_ref: ref, p_amount: amount });
      if (error) throw error;
      return data as string;
    },
  });
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
});
