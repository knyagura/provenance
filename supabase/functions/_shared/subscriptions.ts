// Paid plans (migration 035) for the subscribe Edge Function: Stripe Checkout to start one, Stripe's billing portal to
// change or cancel it. Stripe's webhook keeps the subscription in the database up to date. Outside world passed in.
type Reply = { status: number; body: Record<string, unknown> };

export interface SubscribeDeps {
  userFromToken(token: string): Promise<{ id: string; email: string | null } | null>;
  context(userId: string, planKey: string): Promise<{ plan: { key: string; name: string; price_pence: number } | null; customer: string | null; paid_active: boolean }>;
  stripe: {
    checkout(p: { planKey: string; planName: string; pricePence: number; userId: string; email: string | null; customer: string | null; successUrl: string; cancelUrl: string }): Promise<{ url: string | null }>;
    portal(customer: string, returnUrl: string): Promise<{ url: string }>;
  } | null;
  siteUrl: string;
}

/** POST {action: 'checkout', plan} or {action: 'portal'} with the member's token. */
export async function handleSubscribe(token: string | null, body: unknown, deps: SubscribeDeps): Promise<Reply> {
  if (!deps.stripe) return { status: 503, body: { error: 'payments_not_configured' } };
  const user = token ? await deps.userFromToken(token) : null;
  if (!user) return { status: 401, body: { error: 'sign_in' } };
  const b = (body ?? {}) as { action?: string; plan?: string };
  if (b.action === 'portal') {
    const ctx = await deps.context(user.id, 'standard');
    if (!ctx.customer) return { status: 409, body: { error: 'no_billing', message: 'You don’t have a paid plan.' } };
    return { status: 200, body: { url: (await deps.stripe.portal(ctx.customer, `${deps.siteUrl}/plans`)).url } };
  }
  if (b.action !== 'checkout' || typeof b.plan !== 'string') return { status: 400, body: { error: 'bad_request' } };
  const ctx = await deps.context(user.id, b.plan);
  if (!ctx.plan || ctx.plan.price_pence <= 0) return { status: 400, body: { error: 'bad_plan' } };
  if (ctx.paid_active) return { status: 409, body: { error: 'already_paid', message: 'You already have a paid plan. Change it in Manage billing.' } };
  const s = await deps.stripe.checkout({
    planKey: ctx.plan.key, planName: ctx.plan.name, pricePence: ctx.plan.price_pence, userId: user.id, email: user.email, customer: ctx.customer,
    successUrl: `${deps.siteUrl}/plans?subscribed=1`, cancelUrl: `${deps.siteUrl}/plans`,
  });
  return { status: 200, body: { url: s.url } };
}
