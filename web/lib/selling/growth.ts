// Push, plans, boosts and the owner's dashboard: the database's JSON as the web's shapes (migrations 034–036).
import type { BoostRules, MyPlan, OwnerDashboard, Plan, PushStatus } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const n = (x: any) => Number(x ?? 0);
export const toPush = (d: any): PushStatus => ({ on: d?.on !== false, devices: n(d?.devices), endpoints: Array.isArray(d?.endpoints) ? d.endpoints : [] });
export const toPlan = (p: any): Plan => ({
  key: p.key, name: p.name, pricePence: n(p.price_pence),
  perks: { api: p.perks?.api ?? 'none', badge: !!p.perks?.badge, fee_free_orders: n(p.perks?.fee_free_orders), boost_credits: n(p.perks?.boost_credits), blurb: p.perks?.blurb ?? '' },
});
export const toMyPlan = (d: any): MyPlan => ({
  plan: d?.plan ?? 'standard',
  subscription: d?.subscription ? {
    plan: d.subscription.plan, status: d.subscription.status, paid: !!d.subscription.paid,
    currentPeriodEnd: d.subscription.current_period_end ?? null, cancelAtPeriodEnd: !!d.subscription.cancel_at_period_end,
  } : null,
});
export const toBoostRules = (d: any): BoostRules => ({ on: !!d?.on, minPricePence: n(d?.min_price_pence), minBp: n(d?.min_bp), maxBp: n(d?.max_bp), fixedPence: n(d?.fixed_pence) });
export const toDashboard = (d: any): OwnerDashboard => ({
  week: { orders: n(d.week?.orders), ordersPrev: n(d.week?.orders_prev), gmvPence: n(d.week?.gmv_pence), gmvPrevPence: n(d.week?.gmv_prev_pence), netFeesPence: n(d.week?.net_fees_pence), netFeesPrevPence: n(d.week?.net_fees_prev_pence) },
  members: { total: n(d.members?.total), new: n(d.members?.new), newPrev: n(d.members?.new_prev), paidPlans: n(d.members?.paid_plans), identityChecked: n(d.members?.identity_checked) },
  listings: { live: n(d.listings?.live), new: n(d.listings?.new), newPrev: n(d.listings?.new_prev), boosted: n(d.listings?.boosted) },
  month: { completed: n(d.month?.completed), disputed: n(d.month?.disputed), orders: n(d.month?.orders), avgHandoverHours: d.month?.avg_handover_hours ?? null },
  attention: {
    disputes: n(d.attention?.disputes), paymentsToCheck: n(d.attention?.payments_to_check), reports: n(d.attention?.reports), payoutsFailed: n(d.attention?.payouts_failed),
    payoutsWaitingPence: n(d.attention?.payouts_waiting_pence), refundsByHand: n(d.attention?.refunds_by_hand), contact: n(d.attention?.contact),
  },
  daily: (d.daily ?? []).map((x: any) => ({ day: x.day, orders: n(x.orders), gmvPence: n(x.gmv_pence), members: n(x.members), listings: n(x.listings) })),
  topSellers: (d.top_sellers ?? []).map((x: any) => ({ seller: x.seller, orders: n(x.orders), gmvPence: n(x.gmv_pence) })),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Default fee settings' boost rules (example mode, and before the database answers). */
export const DEFAULT_BOOST: BoostRules = { on: true, minPricePence: 2500, minBp: 300, maxBp: 800, fixedPence: 80 };

/** The plans as agreed (Plan, Account plans): the database is the source; example mode uses these. */
export const DEFAULT_PLANS: Plan[] = [
  { key: 'standard', name: 'Standard', pricePence: 0, perks: { api: 'none', badge: false, fee_free_orders: 0, boost_credits: 0, blurb: 'Buy and sell with full buyer protection.' } },
  { key: 'premium', name: 'Premium', pricePence: 0, perks: { api: 'core', badge: true, fee_free_orders: 0, boost_credits: 0, blurb: 'For regular sellers: the core seller API and a Premium badge.' } },
  { key: 'premium_plus', name: 'Premium+', pricePence: 1750, perks: { api: 'full', badge: true, fee_free_orders: 0, boost_credits: 0, blurb: 'Everything in Premium, the full API set, and new perks first.' } },
];

/** A browser push key (base64url) as the bytes pushManager.subscribe wants. */
export function keyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
