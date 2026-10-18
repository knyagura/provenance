// Supabase Edge Function: send-payouts. Sends queued seller payouts as Stripe transfers (migration 028).
// Called every 10 minutes by pg_cron (028b) with a token kept in Vault; deployed with verify_jwt off because it checks
// that token itself. Needs STRIPE_SECRET_KEY; without it nothing is sent and payouts wait.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import Stripe from 'npm:stripe@22.6.2';
import { sendPayouts } from '../_shared/payouts.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const secret = Deno.env.get('STRIPE_SECRET_KEY');
const stripe = secret ? new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() }) : null;

Deno.serve(async (req) => {
  const { data: allowed } = await admin.rpc('payout_worker_ok', { p_token: req.headers.get('x-worker-token') });
  if (allowed !== true) return Response.json({ error: 'forbidden' }, { status: 403 });
  const result = await sendPayouts({
    async claim(limit) {
      const { data, error } = await admin.rpc('payouts_claim', { p_limit: limit });
      if (error) throw error;
      return (data ?? []) as never;
    },
    async done(id, ok, ref, err) {
      await admin.rpc('payout_done', { p_id: id, p_ok: ok, p_ref: ref, p_error: err });
    },
    stripe: stripe && {
      async chargeOf(ref) {
        const pi = await stripe.paymentIntents.retrieve(ref);
        return typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null;
      },
      transfer: ({ amount, destination, orderId, sourceCharge, idempotencyKey }) => stripe.transfers.create(
        { amount, currency: 'gbp', destination, transfer_group: orderId, metadata: { order_id: orderId }, ...(sourceCharge ? { source_transaction: sourceCharge } : {}) },
        { idempotencyKey },
      ) as never,
    },
  });
  return Response.json(result);
});
