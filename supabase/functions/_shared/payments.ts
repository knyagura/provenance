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

/** One payment for several orders (every basket at once). */
export interface Group {
  id: string;
  buyer_id: string;
  payment_status: string;
  total_pence: number;
  payment_ref: string | null;
  hold_expires_at: string;
}

export interface GiftCard {
  id: string;
  purchaser_id: string;
  payment_status: string;
  amount_pence: number;
  payment_ref: string | null;
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
  getGroup?(id: string): Promise<Group | null>;
  getGiftCard?(id: string): Promise<GiftCard | null>;
  setGiftCardRef?(id: string, ref: string): Promise<void>;
  setGroupPaymentRef?(groupId: string, ref: string): Promise<void>;
  stripe: {
    /** metadata carries order_id, or group_id for a basket checkout. */
    create(params: { amount: number; currency: 'gbp'; orderId?: string; groupId?: string; giftCardId?: string; description: string }): Promise<PaymentIntentLike>;
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
  const groupId = (body as { group_id?: unknown } | null)?.group_id;
  if (groupId !== undefined) return groupCheckout(user.id, groupId, deps);
  const cardId = (body as { gift_card_id?: unknown } | null)?.gift_card_id;
  if (cardId !== undefined) return giftCardCheckout(user.id, cardId, deps);
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
    pi = await deps.stripe.create({ amount: order.total_pence, currency: 'gbp', orderId: order.id, description: `NuTuYu order ${order.id.slice(0, 8)}` });
    await deps.setPaymentRef(order.id, pi.id);
  }
  return { status: 200, body: { client_secret: pi.client_secret, publishable_key: deps.publishableKey, amount_pence: order.total_pence } };
}

async function groupCheckout(userId: string, groupId: unknown, deps: CheckoutDeps): Promise<Reply> {
  if (typeof groupId !== 'string' || !UUID.test(groupId) || !deps.getGroup || !deps.setGroupPaymentRef) {
    return { status: 400, body: { error: 'bad_request', message: 'No checkout to pay for.' } };
  }
  const g = await deps.getGroup(groupId);
  if (!g || g.buyer_id !== userId) return { status: 404, body: { error: 'not_found', message: 'That checkout isn’t yours or doesn’t exist.' } };
  if (g.payment_status === 'paid') return { status: 409, body: { error: 'already_paid', message: 'This checkout is already paid.' } };
  if (g.payment_status !== 'awaiting_payment' || Date.parse(g.hold_expires_at) <= Date.now()) {
    return { status: 409, body: { error: 'expired', message: 'This checkout has ended. Start again from your baskets.' } };
  }
  if (!deps.stripe || !deps.publishableKey) {
    return { status: 503, body: { error: 'payments_not_configured', message: 'Payments aren’t switched on yet.' } };
  }
  if (!g.total_pence || g.total_pence < 30) return { status: 409, body: { error: 'bad_total', message: 'This checkout has no total to pay.' } };
  let pi: PaymentIntentLike | null = null;
  if (g.payment_ref) {
    pi = await deps.stripe.retrieve(g.payment_ref);
    if (pi.amount !== g.total_pence || pi.status === 'canceled') pi = null;
  }
  if (!pi) {
    pi = await deps.stripe.create({ amount: g.total_pence, currency: 'gbp', groupId: g.id, description: `NuTuYu baskets ${g.id.slice(0, 8)}` });
    await deps.setGroupPaymentRef(g.id, pi.id);
  }
  return { status: 200, body: { client_secret: pi.client_secret, publishable_key: deps.publishableKey, amount_pence: g.total_pence } };
}

/** A gift card being bought: its amount is all there is to pay. */
async function giftCardCheckout(userId: string, cardId: unknown, deps: CheckoutDeps): Promise<Reply> {
  if (typeof cardId !== 'string' || !UUID.test(cardId) || !deps.getGiftCard || !deps.setGiftCardRef) {
    return { status: 400, body: { error: 'bad_request', message: 'No gift card to pay for.' } };
  }
  const c = await deps.getGiftCard(cardId);
  if (!c || c.purchaser_id !== userId) return { status: 404, body: { error: 'not_found', message: 'That gift card isn’t yours or doesn’t exist.' } };
  if (c.payment_status === 'paid') return { status: 409, body: { error: 'already_paid', message: 'This gift card is already paid for.' } };
  if (c.payment_status !== 'awaiting_payment') return { status: 409, body: { error: 'expired', message: 'Start again from Gift cards.' } };
  if (!deps.stripe || !deps.publishableKey) {
    return { status: 503, body: { error: 'payments_not_configured', message: 'Payments aren’t switched on yet.' } };
  }
  let pi: PaymentIntentLike | null = null;
  if (c.payment_ref) {
    pi = await deps.stripe.retrieve(c.payment_ref);
    if (pi.amount !== c.amount_pence || pi.status === 'canceled') pi = null;
  }
  if (!pi) {
    pi = await deps.stripe.create({ amount: c.amount_pence, currency: 'gbp', giftCardId: c.id, description: `NuTuYu gift card ${c.id.slice(0, 8)}` });
    await deps.setGiftCardRef(c.id, pi.id);
  }
  return { status: 200, body: { client_secret: pi.client_secret, publishable_key: deps.publishableKey, amount_pence: c.amount_pence } };
}

export interface WebhookDeps {
  /** Verifies Stripe's signature and returns the event; throws when the signature is wrong. */
  verify(payload: string, signature: string): Promise<{ type: string; data: { object: PaymentIntentLike } }>;
  confirmPayment(orderId: string, ref: string, amountPence: number): Promise<string>;
  confirmGroupPayment?(groupId: string, ref: string, amountPence: number): Promise<string>;
  confirmGiftCard?(cardId: string, ref: string, amountPence: number): Promise<string>;
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
  const groupId = pi.metadata?.group_id;
  if (groupId && UUID.test(groupId) && deps.confirmGroupPayment) {
    return { status: 200, body: { result: await deps.confirmGroupPayment(groupId, pi.id, pi.amount_received ?? pi.amount) } };
  }
  const cardId = pi.metadata?.gift_card_id;
  if (cardId && UUID.test(cardId) && deps.confirmGiftCard) {
    return { status: 200, body: { result: await deps.confirmGiftCard(cardId, pi.id, pi.amount_received ?? pi.amount) } };
  }
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
