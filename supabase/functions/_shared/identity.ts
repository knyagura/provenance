// Identity checks (migration 033) for the identity Edge Function: Stripe Identity shows the member its own pages to
// photograph an ID document and take a selfie. NuTuYu only learns whether it passed. Outside world passed in for tests.
type Reply = { status: number; body: Record<string, unknown> };

export interface IdentityDeps {
  userFromToken(token: string): Promise<{ id: string } | null>;
  canStart(userId: string): Promise<boolean>;
  started(userId: string, sessionId: string): Promise<void>;
  stripe: { createSession(p: { userId: string; returnUrl: string; idempotencyKey: string }): Promise<{ id: string; url: string | null }> } | null;
  siteUrl: string;
  now(): number;
}

/** POST {action: 'start'} with the member's token: a link to Stripe's identity check. */
export async function handleIdentity(token: string | null, body: unknown, deps: IdentityDeps): Promise<Reply> {
  if (!deps.stripe) return { status: 503, body: { error: 'payments_not_configured' } };
  const user = token ? await deps.userFromToken(token) : null;
  if (!user) return { status: 401, body: { error: 'sign_in' } };
  if ((body as { action?: string } | null)?.action !== 'start') return { status: 400, body: { error: 'bad_request' } };
  if (!(await deps.canStart(user.id))) return { status: 429, body: { error: 'limit', message: 'You’ve tried 3 times today, or you’re already checked. Try again tomorrow.' } };
  // One session per member per 10 minutes, so a double tap doesn't start (and pay for) two.
  const s = await deps.stripe.createSession({ userId: user.id, returnUrl: `${deps.siteUrl}/profile?identity=done#identity`, idempotencyKey: `identity-${user.id}-${Math.floor(deps.now() / 600_000)}` });
  await deps.started(user.id, s.id);
  return { status: 200, body: { url: s.url } };
}
