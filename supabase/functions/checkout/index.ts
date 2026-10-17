// Supabase Edge Function: checkout. Creates (or reuses) a Stripe PaymentIntent for the member's order, or for a basket checkout (one payment for several orders).
// Needs function secrets STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY (test-mode keys while testing);
// without them it answers "payments_not_configured". SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase itself.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import Stripe from 'npm:stripe@22.6.2';
import { CORS, handleCheckout, type GiftCard, type Group, type Order } from '../_shared/payments.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const secret = Deno.env.get('STRIPE_SECRET_KEY');
const stripe = secret ? new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() }) : null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method' }), { status: 405, headers: CORS });
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const body = await req.json().catch(() => null);
  const reply = await handleCheckout(token, body, {
    async userFromToken(t) {
      const { data } = await admin.auth.getUser(t);
      return data.user ? { id: data.user.id } : null;
    },
    async getOrder(id) {
      const { data } = await admin
        .from('orders')
        .select('id, buyer_id, listing_id, payment_status, total_pence, payment_ref, hold_expires_at')
        .eq('id', id)
        .maybeSingle();
      return (data as Order | null) ?? null;
    },
    async setPaymentRef(orderId, ref) {
      const { error } = await admin.from('orders').update({ payment_ref: ref }).eq('id', orderId);
      if (error) throw error;
    },
    async getGroup(id) {
      const { data } = await admin
        .from('checkout_groups')
        .select('id, buyer_id, payment_status, total_pence, payment_ref, hold_expires_at')
        .eq('id', id)
        .maybeSingle();
      return (data as Group | null) ?? null;
    },
    async setGroupPaymentRef(groupId, ref) {
      const { error } = await admin.from('checkout_groups').update({ payment_ref: ref }).eq('id', groupId);
      if (error) throw error;
    },
    async getGiftCard(id) {
      const { data } = await admin.from('gift_cards').select('id, purchaser_id, payment_status, amount_pence, payment_ref').eq('id', id).maybeSingle();
      return (data as GiftCard | null) ?? null;
    },
    async setGiftCardRef(id, ref) {
      const { error } = await admin.from('gift_cards').update({ payment_ref: ref }).eq('id', id);
      if (error) throw error;
    },
    stripe: stripe && {
      create: ({ amount, currency, orderId, groupId, giftCardId, description }) =>
        stripe.paymentIntents.create(
          { amount, currency, description, metadata: giftCardId ? { gift_card_id: giftCardId } : groupId ? { group_id: groupId } : { order_id: orderId! }, automatic_payment_methods: { enabled: true } },
          { idempotencyKey: giftCardId ? `gift-${giftCardId}-${amount}` : groupId ? `group-${groupId}-${amount}` : `order-${orderId}-${amount}` },
        ) as never,
      retrieve: (id) => stripe.paymentIntents.retrieve(id) as never,
    },
    publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY') ?? null,
  });
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
