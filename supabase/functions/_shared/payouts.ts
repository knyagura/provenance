// Payout logic for the connect and send-payouts Edge Functions, with its outside world passed in so the website's
// unit tests can run it. Stripe Connect Express: Stripe collects each seller's bank details and identity; NuTuYu only
// keeps the account id. Transfers go from NuTuYu's Stripe balance, tied to the buyer's payment (source_transaction),
// so they wait for that money to clear. Idempotency keys stop a retried run paying twice.
type Reply = { status: number; body: Record<string, unknown> };

export interface AccountLike { id: string; details_submitted: boolean; payouts_enabled: boolean }

export interface ConnectDeps {
  userFromToken(token: string): Promise<{ id: string; email: string | null } | null>;
  accountFor(userId: string): Promise<string | null>;
  saveAccount(userId: string, accountId: string): Promise<void>;
  accountUpdated(accountId: string, detailsSubmitted: boolean, payoutsEnabled: boolean): Promise<void>;
  stripe: {
    createAccount(p: { email: string | null; userId: string }): Promise<AccountLike>;
    retrieveAccount(id: string): Promise<AccountLike>;
    onboardingLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<{ url: string }>;
    dashboardLink(accountId: string): Promise<{ url: string }>;
  } | null;
  siteUrl: string;
}

/** POST {action: 'onboard' | 'status' | 'dashboard'} with the member's token. */
export async function handleConnect(token: string | null, body: unknown, deps: ConnectDeps): Promise<Reply> {
  if (!deps.stripe) return { status: 503, body: { error: 'payments_not_configured' } };
  const user = token ? await deps.userFromToken(token) : null;
  if (!user) return { status: 401, body: { error: 'sign_in' } };
  const action = (body as { action?: string } | null)?.action;
  if (!['onboard', 'status', 'dashboard'].includes(action ?? '')) return { status: 400, body: { error: 'bad_request' } };
  let account = await deps.accountFor(user.id);
  if (action === 'status') {
    if (!account) return { status: 200, body: { connected: false } };
    const a = await deps.stripe.retrieveAccount(account);
    await deps.accountUpdated(a.id, a.details_submitted, a.payouts_enabled);
    return { status: 200, body: { connected: true, details_submitted: a.details_submitted, payouts_enabled: a.payouts_enabled } };
  }
  if (action === 'dashboard') {
    if (!account) return { status: 409, body: { error: 'not_connected' } };
    return { status: 200, body: { url: (await deps.stripe.dashboardLink(account)).url } };
  }
  if (!account) {
    const a = await deps.stripe.createAccount({ email: user.email, userId: user.id });
    await deps.saveAccount(user.id, a.id);
    account = (await deps.accountFor(user.id)) ?? a.id;
  }
  const back = `${deps.siteUrl}/profile?payouts=done#payouts`;
  const link = await deps.stripe.onboardingLink(account, back, `${deps.siteUrl}/profile?payouts=retry#payouts`);
  return { status: 200, body: { url: link.url } };
}

export interface QueuedPayout { id: string; order_id: string; amount_pence: number; stripe_account_id: string; payment_ref: string | null; attempts: number }

export interface SendDeps {
  claim(limit: number): Promise<QueuedPayout[]>;
  done(id: string, ok: boolean, ref: string | null, error: string | null): Promise<void>;
  stripe: {
    /** The charge behind a payment, so the transfer waits for that money to arrive. */
    chargeOf(paymentRef: string): Promise<string | null>;
    transfer(p: { amount: number; destination: string; orderId: string; sourceCharge: string | null; idempotencyKey: string }): Promise<{ id: string }>;
  } | null;
}

export async function sendPayouts(deps: SendDeps, limit = 20): Promise<{ sent: number; failed: number; waiting?: string }> {
  if (!deps.stripe) return { sent: 0, failed: 0, waiting: 'STRIPE_SECRET_KEY is not set' };
  let sent = 0;
  let failed = 0;
  for (const p of await deps.claim(limit)) {
    try {
      const charge = p.payment_ref?.startsWith('pi_') ? await deps.stripe.chargeOf(p.payment_ref) : null;
      const t = await deps.stripe.transfer({ amount: p.amount_pence, destination: p.stripe_account_id, orderId: p.order_id, sourceCharge: charge, idempotencyKey: `payout-${p.id}` });
      await deps.done(p.id, true, t.id, null);
      sent++;
    } catch (e) {
      await deps.done(p.id, false, null, String((e as Error)?.message ?? e).slice(0, 300));
      failed++;
    }
  }
  return { sent, failed };
}

export interface QueuedRefund { id: string; order_id: string; amount_pence: number; payment_ref: string | null; attempts: number }

export interface RefundDeps {
  claim(limit: number): Promise<QueuedRefund[]>;
  done(id: string, ok: boolean, ref: string | null, error: string | null): Promise<void>;
  stripe: { refund(p: { paymentIntent: string; amount: number; orderId: string; idempotencyKey: string }): Promise<{ id: string }> } | null;
}

/** Card refunds (migration 031): what the buyer paid by card for that order goes back to the same card. */
export async function sendRefunds(deps: RefundDeps, limit = 20): Promise<{ refunded: number; failed: number; waiting?: string }> {
  if (!deps.stripe) return { refunded: 0, failed: 0, waiting: 'STRIPE_SECRET_KEY is not set' };
  let refunded = 0;
  let failed = 0;
  for (const r of await deps.claim(limit)) {
    try {
      if (!r.payment_ref?.startsWith('pi_')) throw new Error('no card payment to refund');
      const x = await deps.stripe.refund({ paymentIntent: r.payment_ref, amount: r.amount_pence, orderId: r.order_id, idempotencyKey: `refund-${r.id}` });
      await deps.done(r.id, true, x.id, null);
      refunded++;
    } catch (e) {
      await deps.done(r.id, false, null, String((e as Error)?.message ?? e).slice(0, 300));
      failed++;
    }
  }
  return { refunded, failed };
}
