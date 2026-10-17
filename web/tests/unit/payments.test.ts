import { describe, expect, it, vi } from 'vitest';
import { handleCheckout, handleWebhook, type CheckoutDeps, type Group, type Order } from '../../../supabase/functions/_shared/payments';

const ORDER = '0b6c3c9e-8f1a-4c4e-9d2a-5f6e7a8b9c0d';
const soon = () => new Date(Date.now() + 10 * 60_000).toISOString();
const order = (o: Partial<Order> = {}): Order => ({
  id: ORDER, buyer_id: 'buyer', listing_id: 'l', payment_status: 'awaiting_payment', total_pence: 4679, payment_ref: null, hold_expires_at: soon(), ...o,
});

function deps(o: Order | null, over: Partial<CheckoutDeps> = {}) {
  const create = vi.fn(async ({ amount }: { amount: number }) => ({ id: 'pi_new', client_secret: 'pi_new_secret', amount, status: 'requires_payment_method', metadata: {} }));
  const retrieve = vi.fn(async (id: string) => ({ id, client_secret: `${id}_secret`, amount: 4679, status: 'requires_payment_method', metadata: {} }));
  const setPaymentRef = vi.fn(async () => {});
  const d: CheckoutDeps = {
    userFromToken: async (t) => (t === 'good' ? { id: 'buyer' } : t === 'other' ? { id: 'someone-else' } : null),
    getOrder: async () => o,
    setPaymentRef,
    stripe: { create, retrieve },
    publishableKey: 'pk_test_x',
    ...over,
  };
  return { d, create, retrieve, setPaymentRef };
}

describe('checkout function', () => {
  it('creates a payment for the order total and remembers it', async () => {
    const { d, create, setPaymentRef } = deps(order());
    const r = await handleCheckout('good', { order_id: ORDER }, d);
    expect(r).toEqual({ status: 200, body: { client_secret: 'pi_new_secret', publishable_key: 'pk_test_x', amount_pence: 4679 } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ amount: 4679, currency: 'gbp', orderId: ORDER }));
    expect(setPaymentRef).toHaveBeenCalledWith(ORDER, 'pi_new');
  });
  it('reuses the payment when the buyer presses Pay again', async () => {
    const { d, create, retrieve } = deps(order({ payment_ref: 'pi_old' }));
    const r = await handleCheckout('good', { order_id: ORDER }, d);
    expect(r.body.client_secret).toBe('pi_old_secret');
    expect(retrieve).toHaveBeenCalledWith('pi_old');
    expect(create).not.toHaveBeenCalled();
  });
  it('refuses strangers, other people’s orders and nonsense', async () => {
    expect((await handleCheckout(null, { order_id: ORDER }, deps(order()).d)).status).toBe(401);
    expect((await handleCheckout('forged', { order_id: ORDER }, deps(order()).d)).status).toBe(401);
    expect((await handleCheckout('other', { order_id: ORDER }, deps(order()).d)).status).toBe(404);
    expect((await handleCheckout('good', { order_id: 'x; drop' }, deps(order()).d)).status).toBe(400);
  });
  it('refuses paid, expired and cancelled orders', async () => {
    expect((await handleCheckout('good', { order_id: ORDER }, deps(order({ payment_status: 'paid' })).d)).body.error).toBe('already_paid');
    expect((await handleCheckout('good', { order_id: ORDER }, deps(order({ hold_expires_at: new Date(Date.now() - 1000).toISOString() })).d)).body.error).toBe('expired');
    expect((await handleCheckout('good', { order_id: ORDER }, deps(order({ payment_status: 'cancelled' })).d)).body.error).toBe('expired');
  });
  it('says so plainly when payments aren’t switched on', async () => {
    const r = await handleCheckout('good', { order_id: ORDER }, deps(order(), { stripe: null, publishableKey: null }).d);
    expect(r).toMatchObject({ status: 503, body: { error: 'payments_not_configured' } });
  });
});

describe('Stripe webhook', () => {
  const event = (type: string, metadata: Record<string, string>) => ({ type, data: { object: { id: 'pi_1', client_secret: null, amount: 4679, amount_received: 4679, status: 'succeeded', metadata } } });
  it('marks the order paid only after the signature checks out', async () => {
    const confirm = vi.fn(async () => 'paid');
    const r = await handleWebhook('{}', 'sig', { verify: async () => event('payment_intent.succeeded', { order_id: ORDER }), confirmPayment: confirm });
    expect(r).toEqual({ status: 200, body: { result: 'paid' } });
    expect(confirm).toHaveBeenCalledWith(ORDER, 'pi_1', 4679);
  });
  it('rejects unsigned or forged calls without touching the order', async () => {
    const confirm = vi.fn();
    expect((await handleWebhook('{}', null, { verify: async () => event('payment_intent.succeeded', { order_id: ORDER }), confirmPayment: confirm })).status).toBe(400);
    expect((await handleWebhook('{}', 'bad', { verify: async () => { throw new Error('No signatures found'); }, confirmPayment: confirm })).status).toBe(400);
    expect(confirm).not.toHaveBeenCalled();
  });
  it('ignores other events', async () => {
    const confirm = vi.fn();
    const r = await handleWebhook('{}', 'sig', { verify: async () => event('charge.refunded', { order_id: ORDER }), confirmPayment: confirm });
    expect(r.body).toEqual({ ignored: 'charge.refunded' });
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('basket checkout: one payment for several orders', () => {
  const GROUP = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
  const group = (g: Partial<Group> = {}): Group => ({ id: GROUP, buyer_id: 'buyer', payment_status: 'awaiting_payment', total_pence: 12345, payment_ref: null, hold_expires_at: soon(), ...g });
  const withGroup = (g: Group | null, over: Partial<CheckoutDeps> = {}) => {
    const setGroupPaymentRef = vi.fn(async () => {});
    const x = deps(null, { getGroup: async () => g, setGroupPaymentRef, ...over });
    return { ...x, setGroupPaymentRef };
  };
  it('charges the group total once and tags the payment with the group', async () => {
    const { d, create, setGroupPaymentRef } = withGroup(group());
    const r = await handleCheckout('good', { group_id: GROUP }, d);
    expect(r).toEqual({ status: 200, body: { client_secret: 'pi_new_secret', publishable_key: 'pk_test_x', amount_pence: 12345 } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ amount: 12345, groupId: GROUP }));
    expect(setGroupPaymentRef).toHaveBeenCalledWith(GROUP, 'pi_new');
  });
  it('refuses other people’s, paid and ended checkouts', async () => {
    expect((await handleCheckout('other', { group_id: GROUP }, withGroup(group()).d)).status).toBe(404);
    expect((await handleCheckout('good', { group_id: GROUP }, withGroup(group({ payment_status: 'paid' })).d)).body.error).toBe('already_paid');
    expect((await handleCheckout('good', { group_id: GROUP }, withGroup(group({ hold_expires_at: new Date(Date.now() - 1).toISOString() })).d)).body.error).toBe('expired');
    expect((await handleCheckout('good', { group_id: 'nope' }, withGroup(group()).d)).status).toBe(400);
  });
  it('the webhook confirms the whole group', async () => {
    const confirmGroup = vi.fn(async () => 'paid');
    const confirm = vi.fn();
    const ev = { type: 'payment_intent.succeeded', data: { object: { id: 'pi_g', client_secret: null, amount: 12345, amount_received: 12345, status: 'succeeded', metadata: { group_id: GROUP } } } };
    const r = await handleWebhook('{}', 'sig', { verify: async () => ev, confirmPayment: confirm, confirmGroupPayment: confirmGroup });
    expect(r.body).toEqual({ result: 'paid' });
    expect(confirmGroup).toHaveBeenCalledWith(GROUP, 'pi_g', 12345);
    expect(confirm).not.toHaveBeenCalled();
  });
});
