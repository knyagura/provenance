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
    // The account endpoint's secret, then the Connect endpoint's (account.updated comes from connected accounts).
    verify: async (p, sig) => {
      try {
        return await stripe.webhooks.constructEventAsync(p, sig, whsec, undefined, crypto) as never;
      } catch (e) {
        const connect = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET');
        if (!connect) throw e;
        return await stripe.webhooks.constructEventAsync(p, sig, connect, undefined, crypto) as never;
      }
    },
    async confirmPayment(orderId, ref, amount) {
      const { data, error } = await admin.rpc('confirm_payment', { p_order: orderId, p_ref: ref, p_amount: amount });
      if (error) throw error;
      return data as string;
    },
    async accountUpdated(accountId, details, enabled) {
      const { error } = await admin.rpc('payout_account_updated', { p_account: accountId, p_details: details, p_enabled: enabled });
      if (error) throw error;
    },
    async subscriptionSynced(f) {
      const { error } = await admin.rpc('subscription_synced', {
        p_user: f.userId, p_key: f.plan, p_customer: f.customer, p_subscription: f.subscription, p_status: f.status, p_period_end: f.periodEnd, p_cancel_at_end: f.cancelAtEnd,
      });
      if (error) throw error;
    },
    async identityUpdated(session, status, err) {
      const { error } = await admin.rpc('identity_updated', { p_session: session, p_status: status, p_error: err });
      if (error) throw error;
    },
    async confirmGiftCard(cardId, ref, amount) {
      const { data, error } = await admin.rpc('confirm_gift_card_payment', { p_card: cardId, p_ref: ref, p_amount: amount });
      if (error) throw error;
      return data as string;
    },
    async confirmGroupPayment(groupId, ref, amount) {
      const { data, error } = await admin.rpc('confirm_group_payment', { p_group: groupId, p_ref: ref, p_amount: amount });
      if (error) throw error;
      return data as string;
    },
  });
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
});
