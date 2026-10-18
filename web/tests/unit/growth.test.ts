import { describe, expect, it, vi } from 'vitest';
import { brandSlug, brandsIn, collectionLd } from '@/lib/domain/landing';
import { keyBytes, toDashboard, toMyPlan } from '@/lib/selling/growth';
import { handleSubscribe, type SubscribeDeps } from '../../../supabase/functions/_shared/subscriptions';
import { handleWebhook, subscriptionFields } from '../../../supabase/functions/_shared/payments';
import type { Listing } from '@/lib/domain/types';

describe('landing pages', () => {
  it('brand slugs', () => {
    expect(brandSlug('Saint Laurent')).toBe('saint-laurent');
    expect(brandSlug('Ted Baker ')).toBe('ted-baker');
    expect(brandSlug('Agnès b.')).toBe('agnes-b');
  });
  const l = (id: string, brand: string | null, example = false) => ({ id, brand, title: id, tier: 'enhanced', pricePence: 1000, example }) as Listing;
  it('brands by how many items', () => {
    expect(brandsIn([l('a', 'COS'), l('b', 'Barbour'), l('c', 'cos'), l('d', null)]).map((b) => [b.slug, b.count])).toEqual([['cos', 2], ['barbour', 1]]);
  });
  it('structured data lists real items only', () => {
    const [page, crumbs] = collectionLd('Men', '/c/men', [l('a', null), l('b', null, true)], [{ name: 'Home', path: '/' }, { name: 'Men', path: '/c/men' }]) as unknown as [{ mainEntity: { itemListElement: unknown[] } }, { itemListElement: unknown[] }];
    expect(page.mainEntity.itemListElement).toHaveLength(1);
    expect(crumbs.itemListElement).toHaveLength(2);
  });
});

describe('push keys', () => {
  it('turn a base64url key into bytes', () => {
    expect(Array.from(keyBytes('AQID'))).toEqual([1, 2, 3]);
    expect(keyBytes('BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM')).toHaveLength(65);
  });
});

describe('plans and dashboard shapes', () => {
  it('maps my plan', () => {
    expect(toMyPlan({ plan: 'premium_plus', subscription: { plan: 'premium_plus', status: 'active', paid: true, current_period_end: null, cancel_at_period_end: true } }))
      .toEqual({ plan: 'premium_plus', subscription: { plan: 'premium_plus', status: 'active', paid: true, currentPeriodEnd: null, cancelAtPeriodEnd: true } });
    expect(toMyPlan(null).plan).toBe('standard');
  });
  it('maps the dashboard', () => {
    const d = toDashboard({ week: { orders: 2, orders_prev: 1 }, daily: [{ day: '2026-10-18', orders: 2, gmv_pence: 500 }], top_sellers: [] });
    expect(d.week.orders).toBe(2);
    expect(d.daily[0]).toEqual({ day: '2026-10-18', orders: 2, gmvPence: 500, members: 0, listings: 0 });
  });
});

describe('subscribe function', () => {
  const deps = (over: Partial<SubscribeDeps> = {}) => {
    const checkout = vi.fn(async () => ({ url: 'https://checkout.stripe.com/x' }));
    const portal = vi.fn(async () => ({ url: 'https://billing.stripe.com/x' }));
    const d: SubscribeDeps = {
      userFromToken: async (t) => (t === 'good' ? { id: 'u1', email: 'a@b.c' } : null),
      context: async (_u, k) => ({ plan: k === 'premium_plus' ? { key: k, name: 'Premium+', price_pence: 1750 } : k === 'premium' ? { key: k, name: 'Premium', price_pence: 0 } : null, customer: null, paid_active: false }),
      stripe: { checkout, portal }, siteUrl: 'https://nutuyu.test', ...over,
    };
    return { d, checkout, portal };
  };
  it('opens Stripe Checkout for a paid plan', async () => {
    const { d, checkout } = deps();
    expect((await handleSubscribe('good', { action: 'checkout', plan: 'premium_plus' }, d)).body).toEqual({ url: 'https://checkout.stripe.com/x' });
    expect(checkout).toHaveBeenCalledWith(expect.objectContaining({ planKey: 'premium_plus', pricePence: 1750, userId: 'u1', successUrl: 'https://nutuyu.test/plans?subscribed=1' }));
  });
  it('refuses free plans, unknown plans, a second paid plan, and strangers', async () => {
    expect((await handleSubscribe('good', { action: 'checkout', plan: 'premium' }, deps().d)).status).toBe(400);
    expect((await handleSubscribe('good', { action: 'checkout', plan: 'gold' }, deps().d)).status).toBe(400);
    expect((await handleSubscribe('good', { action: 'checkout', plan: 'premium_plus' }, deps({ context: async () => ({ plan: { key: 'premium_plus', name: 'P', price_pence: 1750 }, customer: 'cus_1', paid_active: true }) }).d)).status).toBe(409);
    expect((await handleSubscribe(null, { action: 'checkout', plan: 'premium_plus' }, deps().d)).status).toBe(401);
    expect((await handleSubscribe('good', { action: 'checkout', plan: 'premium_plus' }, deps({ stripe: null }).d)).status).toBe(503);
  });
  it('opens the billing portal for paying members', async () => {
    expect((await handleSubscribe('good', { action: 'portal' }, deps().d)).status).toBe(409);
    const { d } = deps({ context: async () => ({ plan: null, customer: 'cus_1', paid_active: true }) });
    expect((await handleSubscribe('good', { action: 'portal' }, d)).body).toEqual({ url: 'https://billing.stripe.com/x' });
  });
  it('the webhook keeps subscriptions up to date', async () => {
    const subscriptionSynced = vi.fn(async () => {});
    const sub = { id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, metadata: { user_id: 'u1', plan_key: 'premium_plus' }, items: { data: [{ current_period_end: 1_800_000_000 }] } };
    const verify = async () => ({ type: 'customer.subscription.updated', data: { object: sub as never } });
    expect((await handleWebhook('{}', 'sig', { verify, confirmPayment: async () => 'x', subscriptionSynced })).body).toEqual({ result: 'subscription_synced' });
    expect(subscriptionSynced).toHaveBeenCalledWith({ userId: 'u1', plan: 'premium_plus', customer: 'cus_1', subscription: 'sub_1', status: 'active', periodEnd: new Date(1_800_000_000_000).toISOString(), cancelAtEnd: false });
    expect(subscriptionFields({ id: 'not-a-sub' })).toBeNull();
  });
});
