import { describe, expect, it, vi } from 'vitest';
import { handleConnect, sendPayouts, type ConnectDeps, type QueuedPayout, type SendDeps } from '../../../supabase/functions/_shared/payouts';
import { handleWebhook } from '../../../supabase/functions/_shared/payments';

function connect(over: Partial<ConnectDeps> = {}, account: string | null = null) {
  let saved = account;
  const stripe = {
    createAccount: vi.fn(async () => ({ id: 'acct_new123', details_submitted: false, payouts_enabled: false })),
    retrieveAccount: vi.fn(async (id: string) => ({ id, details_submitted: true, payouts_enabled: true })),
    onboardingLink: vi.fn(async () => ({ url: 'https://connect.stripe.com/setup/x' })),
    dashboardLink: vi.fn(async () => ({ url: 'https://connect.stripe.com/express/x' })),
  };
  const accountUpdated = vi.fn(async () => {});
  const d: ConnectDeps = {
    userFromToken: async (t) => (t === 'good' ? { id: 'u1', email: 'sam@example.com' } : null),
    accountFor: async () => saved,
    saveAccount: async (_u, a) => { saved = a; },
    accountUpdated,
    stripe,
    siteUrl: 'https://nutuyu.test',
    ...over,
  };
  return { d, stripe, accountUpdated };
}

describe('connect function (seller payouts)', () => {
  it('is off until Stripe keys are added', async () => {
    expect((await handleConnect('good', { action: 'onboard' }, connect({ stripe: null }).d)).body).toEqual({ error: 'payments_not_configured' });
  });
  it('needs a signed-in member and a known action', async () => {
    const { d } = connect();
    expect((await handleConnect(null, { action: 'onboard' }, d)).status).toBe(401);
    expect((await handleConnect('good', { action: 'steal' }, d)).status).toBe(400);
  });
  it('creates an Express account once, then sends the seller to Stripe’s set-up page', async () => {
    const { d, stripe } = connect();
    const r = await handleConnect('good', { action: 'onboard' }, d);
    expect(r.body).toEqual({ url: 'https://connect.stripe.com/setup/x' });
    expect(stripe.onboardingLink).toHaveBeenCalledWith('acct_new123', 'https://nutuyu.test/profile?payouts=done#payouts', 'https://nutuyu.test/profile?payouts=retry#payouts');
    await handleConnect('good', { action: 'onboard' }, d);
    expect(stripe.createAccount).toHaveBeenCalledTimes(1);
  });
  it('checks status with Stripe and saves it', async () => {
    const { d, accountUpdated } = connect({}, 'acct_have123');
    const r = await handleConnect('good', { action: 'status' }, d);
    expect(r.body).toEqual({ connected: true, details_submitted: true, payouts_enabled: true });
    expect(accountUpdated).toHaveBeenCalledWith('acct_have123', true, true);
    expect((await handleConnect('good', { action: 'status' }, connect().d)).body).toEqual({ connected: false });
  });
  it('opens the Stripe dashboard only with an account', async () => {
    expect((await handleConnect('good', { action: 'dashboard' }, connect().d)).status).toBe(409);
    expect((await handleConnect('good', { action: 'dashboard' }, connect({}, 'acct_have123').d)).body).toEqual({ url: 'https://connect.stripe.com/express/x' });
  });
});

describe('send-payouts function', () => {
  const p = (id: string, ref: string | null = 'pi_1'): QueuedPayout => ({ id, order_id: `o-${id}`, amount_pence: 2500, stripe_account_id: 'acct_s1', payment_ref: ref, attempts: 1 });
  function sender(items: QueuedPayout[], fail = new Set<string>()) {
    const done = vi.fn(async () => {});
    const transfer = vi.fn(async (x: { idempotencyKey: string }) => {
      if (fail.has(x.idempotencyKey)) throw new Error('insufficient funds');
      return { id: `tr_${x.idempotencyKey}` };
    });
    const d: SendDeps = { claim: async () => items, done, stripe: { chargeOf: async (ref) => `ch_for_${ref}`, transfer } };
    return { d, done, transfer };
  }
  it('waits without keys', async () => {
    expect(await sendPayouts({ claim: async () => [p('a')], done: async () => {}, stripe: null })).toEqual({ sent: 0, failed: 0, waiting: 'STRIPE_SECRET_KEY is not set' });
  });
  it('sends each payout from the buyer’s charge, once', async () => {
    const { d, done, transfer } = sender([p('a'), p('b', null)]);
    expect(await sendPayouts(d)).toEqual({ sent: 2, failed: 0 });
    expect(transfer).toHaveBeenCalledWith({ amount: 2500, destination: 'acct_s1', orderId: 'o-a', sourceCharge: 'ch_for_pi_1', idempotencyKey: 'payout-a' });
    expect(transfer).toHaveBeenCalledWith(expect.objectContaining({ sourceCharge: null, idempotencyKey: 'payout-b' }));
    expect(done).toHaveBeenCalledWith('a', true, 'tr_payout-a', null);
  });
  it('records a failure and carries on', async () => {
    const { d, done } = sender([p('a'), p('b')], new Set(['payout-a']));
    expect(await sendPayouts(d)).toEqual({ sent: 1, failed: 1 });
    expect(done).toHaveBeenCalledWith('a', false, null, 'insufficient funds');
  });
});

describe('stripe-webhook: connected accounts', () => {
  it('passes account.updated on', async () => {
    const accountUpdated = vi.fn(async () => {});
    const verify = async () => ({ type: 'account.updated', data: { object: { id: 'acct_s1', details_submitted: true, payouts_enabled: true } as never } });
    const r = await handleWebhook('{}', 'sig', { verify, confirmPayment: async () => 'x', accountUpdated });
    expect(r.body).toEqual({ result: 'account_updated' });
    expect(accountUpdated).toHaveBeenCalledWith('acct_s1', true, true);
  });
});
