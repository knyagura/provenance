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

import { sendRefunds, type QueuedRefund } from '../../../supabase/functions/_shared/payouts';
import { handleIdentity, type IdentityDeps } from '../../../supabase/functions/_shared/identity';

describe('refunds (send-payouts function)', () => {
  const r = (id: string, ref: string | null = 'pi_9'): QueuedRefund => ({ id, order_id: `o-${id}`, amount_pence: 3719, payment_ref: ref, attempts: 1 });
  it('refunds the card payment once per order', async () => {
    const done = vi.fn(async () => {});
    const refund = vi.fn(async (x: { idempotencyKey: string }) => ({ id: `re_${x.idempotencyKey}` }));
    expect(await sendRefunds({ claim: async () => [r('a'), r('b', null)], done, stripe: { refund } })).toEqual({ refunded: 1, failed: 1 });
    expect(refund).toHaveBeenCalledWith({ paymentIntent: 'pi_9', amount: 3719, orderId: 'o-a', idempotencyKey: 'refund-a' });
    expect(done).toHaveBeenCalledWith('b', false, null, 'no card payment to refund');
  });
  it('waits without keys', async () => {
    expect((await sendRefunds({ claim: async () => [r('a')], done: async () => {}, stripe: null })).waiting).toBe('STRIPE_SECRET_KEY is not set');
  });
});

describe('identity function', () => {
  const deps = (over: Partial<IdentityDeps> = {}) => {
    const createSession = vi.fn(async () => ({ id: 'vs_123abc', url: 'https://verify.stripe.com/x' }));
    const started = vi.fn(async () => {});
    const d: IdentityDeps = {
      userFromToken: async (t) => (t === 'good' ? { id: 'u1' } : null), canStart: async () => true, started,
      stripe: { createSession }, siteUrl: 'https://nutuyu.test', now: () => 1_000_000_000, ...over,
    };
    return { d, createSession, started };
  };
  it('starts a check and remembers the session', async () => {
    const { d, createSession, started } = deps();
    expect((await handleIdentity('good', { action: 'start' }, d)).body).toEqual({ url: 'https://verify.stripe.com/x' });
    expect(createSession).toHaveBeenCalledWith({ userId: 'u1', returnUrl: 'https://nutuyu.test/profile?identity=done#identity', idempotencyKey: 'identity-u1-1666' });
    expect(started).toHaveBeenCalledWith('u1', 'vs_123abc');
  });
  it('is off without keys, needs sign-in, and keeps to the daily limit', async () => {
    expect((await handleIdentity('good', { action: 'start' }, deps({ stripe: null }).d)).status).toBe(503);
    expect((await handleIdentity(null, { action: 'start' }, deps().d)).status).toBe(401);
    expect((await handleIdentity('good', { action: 'start' }, deps({ canStart: async () => false }).d)).status).toBe(429);
  });
  it('the webhook passes identity results on', async () => {
    const identityUpdated = vi.fn(async () => {});
    const verify = async () => ({ type: 'identity.verification_session.requires_input', data: { object: { id: 'vs_123abc', last_error: { code: 'document_expired' } } as never } });
    expect((await handleWebhook('{}', 'sig', { verify, confirmPayment: async () => 'x', identityUpdated })).body).toEqual({ result: 'identity_updated' });
    expect(identityUpdated).toHaveBeenCalledWith('vs_123abc', 'requires_input', 'document_expired');
  });
});
