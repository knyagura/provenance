// Payment logic for the two Supabase Edge Functions (checkout, stripe-webhook).
// Plain TypeScript with its outside world passed in, so the website's unit tests can run it in Node;
// the function entry files wire in Stripe and Supabase. Secrets (Stripe keys, the service role) exist
// only inside Supabase's function environment.

export interface Order {
  id: string;
  buyer_id: string;
  listing_id: string;
  payment_status: string;
  total_pence: number | null;
  payment_ref: string | null;
  hold_expires_at: string | null;
}

export interface PaymentIntentLike {
  id: string;
  client_secret: string | null;
  amount: number;
  amount_received?: number;
  status: string;
  metadata: Record<string, string>;
}

export interface CheckoutDeps {
  /** The signed-in member, from their access token; null when it isn't valid. */
  userFromToken(token: string): Promise<{ id: string } | null>;
  getOrder(id: string): Promise<Order | null>;
  setPaymentRef(orderId: string, ref: string): Promise<void>;
  stripe: {
    create(params: { amount: number; currency: 'gbp'; orderId: string; description: string }): Promise<PaymentIntentLike>;
    retrieve(id: string): Promise<PaymentIntentLike>;
  } | null;
  publishableKey: string | null;
}

export type Reply = { status: number; body: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST {order_id} with the member's token: returns what the browser needs to show Stripe's payment form. */
export async function handleCheckout(token: string | null, body: unknown, deps: CheckoutDeps): Promise<Reply> {
  if (!token) return { status: 401, body: { error: 'sign_in', message: 'Sign in to pay.' } };
  const user = await deps.userFromToken(token);
  if (!user) return { status: 401, body: { error: 'sign_in', message: 'Sign in to pay.' } };
  const orderId = (body as { order_id?: unknown } | null)?.order_id;
  if (typeof orderId !== 'string' || !UUID.test(orderId)) return { status: 400, body: { error: 'bad_request', message: 'No order to pay for.' } };
  const order = await deps.getOrder(orderId);
  if (!order || order.buyer_id !== user.id) return { status: 404, body: { error: 'not_found', message: 'That order isn’t yours or doesn’t exist.' } };
  if (order.payment_status === 'paid') return { status: 409, body: { error: 'already_paid', message: 'This order is already paid.' } };
  if (order.payment_status !== 'awaiting_payment' || !order.hold_expires_at || Date.parse(order.hold_expires_at) <= Date.now()) {
    return { status: 409, body: { error: 'expired', message: 'This checkout has ended. Start again from the item.' } };
  }
  if (!deps.stripe || !deps.publishableKey) {
    return { status: 503, body: { error: 'payments_not_configured', message: 'Payments aren’t switched on yet.' } };
  }
  if (!order.total_pence || order.total_pence < 30) return { status: 409, body: { error: 'bad_total', message: 'This order has no total to pay.' } };

  let pi: PaymentIntentLike | null = null;
  if (order.payment_ref) {
    pi = await deps.stripe.retrieve(order.payment_ref);
    if (pi.amount !== order.total_pence || pi.status === 'canceled') pi = null;
  }
  if (!pi) {
    pi = await deps.stripe.create({ amount: order.total_pence, currency: 'gbp', orderId: order.id, description: `Provenance order ${order.id.slice(0, 8)}` });
    await deps.setPaymentRef(order.id, pi.id);
  }
  return { status: 200, body: { client_secret: pi.client_secret, publishable_key: deps.publishableKey, amount_pence: order.total_pence } };
}

export interface WebhookDeps {
  /** Verifies Stripe's signature and returns the event; throws when the signature is wrong. */
  verify(payload: string, signature: string): Promise<{ type: string; data: { object: PaymentIntentLike } }>;
  confirmPayment(orderId: string, ref: string, amountPence: number): Promise<string>;
}

/** Stripe calls this when a payment succeeds. Only a correctly signed event can mark an order paid. */
export async function handleWebhook(payload: string, signature: string | null, deps: WebhookDeps): Promise<Reply> {
  if (!signature) return { status: 400, body: { error: 'no_signature' } };
  let event;
  try {
    event = await deps.verify(payload, signature);
  } catch {
    return { status: 400, body: { error: 'bad_signature' } };
  }
  if (event.type !== 'payment_intent.succeeded') return { status: 200, body: { ignored: event.type } };
  const pi = event.data.object;
  const orderId = pi.metadata?.order_id;
  if (!orderId || !UUID.test(orderId)) return { status: 200, body: { ignored: 'no_order' } };
  const result = await deps.confirmPayment(orderId, pi.id, pi.amount_received ?? pi.amount);
  return { status: 200, body: { result } };
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
