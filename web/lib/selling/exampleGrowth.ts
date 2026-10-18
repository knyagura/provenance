// Example mode's push devices, plans, boosts and owner dashboard, in this browser's localStorage. Same rules as
// migrations 034–036 (tests/growth_checks.mjs checks the database). Example limits: no push service, so "Notify me
// on this device" just records the device; paid plans start without Stripe; boosts don't reorder the fixed example
// catalogue (the item page and the seller still see them).
import { exampleCatalogue } from '@/lib/domain/examples';
import { exampleOrders, memberId } from './exampleMarket';
import { DEFAULT_BOOST, DEFAULT_PLANS } from './growth';
import type { BoostRules, Member, MyPlan, OwnerDashboard, Plan, PlanKey, PlanPerks, PushStatus, Result } from './types';

const KEY = 'pv-example-growth';
interface Store {
  push: Record<string, { on: boolean; endpoints: string[] }>;
  plans: Record<string, PlanKey>;
  planSettings: Partial<Record<PlanKey, { pricePence: number; perks: Partial<PlanPerks> }>>;
  boosts: Record<string, number>;
}
const empty = (): Store => ({ push: {}, plans: {}, planSettings: {}, boosts: {} });
function load(): Store {
  try {
    return { ...empty(), ...(JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? {}) };
  } catch {
    return empty();
  }
}
function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const isStaff = (m: Member | null) => !!m && m.email.toLowerCase().startsWith('staff');

function plans(): Plan[] {
  const s = load();
  return DEFAULT_PLANS.map((p) => {
    const o = s.planSettings[p.key];
    return o ? { ...p, pricePence: o.pricePence, perks: { ...p.perks, ...o.perks } } : p;
  });
}
const push = (m: Member): PushStatus => {
  const p = load().push[m.id] ?? { on: true, endpoints: [] };
  return { on: p.on, devices: p.endpoints.length, endpoints: p.endpoints };
};
const myPlan = (m: Member): MyPlan => {
  const key = load().plans[m.id] ?? 'standard';
  return { plan: key, subscription: key === 'standard' ? null : { plan: key, status: 'active', paid: (plans().find((p) => p.key === key)?.pricePence ?? 0) > 0, currentPeriodEnd: null, cancelAtPeriodEnd: false } };
};

export const exampleGrowth = {
  push(m: Member | null): PushStatus {
    return m ? push(m) : { on: true, devices: 0, endpoints: [] };
  },
  savePush(m: Member | null, endpoint: string): Result<PushStatus> {
    if (!m) return fail('Sign in first.');
    const s = load();
    const p = s.push[m.id] ?? { on: true, endpoints: [] };
    if (!p.endpoints.includes(endpoint)) p.endpoints.push(endpoint);
    p.on = true;
    s.push[m.id] = p;
    save(s);
    return { ok: true, value: push(m) };
  },
  deletePush(m: Member | null, endpoint: string): Result<PushStatus> {
    if (!m) return fail('Sign in first.');
    const s = load();
    const p = s.push[m.id];
    if (p) p.endpoints = p.endpoints.filter((e) => e !== endpoint);
    save(s);
    return { ok: true, value: push(m) };
  },
  setPushOn(m: Member | null, on: boolean): Result<PushStatus> {
    if (!m) return fail('Sign in first.');
    const s = load();
    s.push[m.id] = { ...(s.push[m.id] ?? { endpoints: [] }), on };
    save(s);
    return { ok: true, value: push(m) };
  },

  plans,
  myPlan(m: Member | null): MyPlan | null {
    return m ? myPlan(m) : null;
  },
  choosePlan(m: Member | null, key: PlanKey, paidOk: boolean): Result<MyPlan> {
    if (!m) return fail('Sign in first.');
    const p = plans().find((x) => x.key === key);
    if (!p) return fail('Choose a plan.');
    if (p.pricePence > 0 && !paidOk) return fail('That plan is paid: continue to payment.');
    const s = load();
    s.plans[m.id] = key;
    save(s);
    return { ok: true, value: myPlan(m) };
  },
  memberPlan(username: string): { key: PlanKey; name: string } | null {
    const s = load();
    const id = Object.keys(s.plans).find((k) => k.replace(/^example:/, '').split('@')[0].toLowerCase() === username.toLowerCase());
    const p = id ? plans().find((x) => x.key === s.plans[id]) : null;
    return p && p.perks.badge ? { key: p.key, name: p.name } : null;
  },
  staffPlans(m: Member | null) {
    if (!isStaff(m)) return [];
    const s = load();
    return plans().map((p) => ({ ...p, active: true, members: Object.values(s.plans).filter((k) => k === p.key).length }));
  },
  staffSavePlan(m: Member | null, key: PlanKey, price: number, perks: Partial<PlanPerks>) {
    if (!isStaff(m)) return fail('Staff only.');
    if (key === 'standard' && price !== 0) return fail('Standard is always free.');
    if (!(price >= 0 && price <= 100000)) return fail('Price must be between £0 and £1,000.');
    const s = load();
    s.planSettings[key] = { pricePence: price, perks: { ...(s.planSettings[key]?.perks ?? {}), ...perks } };
    save(s);
    return { ok: true as const, value: this.staffPlans(m) };
  },

  boostRules(): BoostRules {
    return DEFAULT_BOOST;
  },
  boost(listingId: string): number | null {
    return load().boosts[listingId] ?? null;
  },
  setBoost(m: Member | null, listingId: string, bp: number | null): Result<{ boostBp: number | null }> {
    const l = exampleCatalogue.find((x) => x.id === listingId);
    if (!m || !l || memberId(`${l.seller.username}@example.test`) !== m.id) return fail('Listing not found.');
    const s = load();
    if (bp === null) delete s.boosts[listingId];
    else {
      if (l.pricePence < DEFAULT_BOOST.minPricePence) return fail('Boosts are for items priced at £25 or more.');
      if (bp < DEFAULT_BOOST.minBp || bp > DEFAULT_BOOST.maxBp) return fail('Choose a boost between 3% and 8%.');
      s.boosts[listingId] = bp;
    }
    save(s);
    return { ok: true, value: { boostBp: bp } };
  },

  dashboard(m: Member | null): OwnerDashboard | null {
    if (!isStaff(m)) return null;
    const paid = exampleOrders().filter((o) => o.summary.paymentStatus === 'paid' && o.summary.paidAt);
    const t = (iso: string) => Date.parse(iso);
    const now = Date.now();
    const w0 = now - 7 * 86_400_000;
    const w1 = now - 14 * 86_400_000;
    const net = (o: (typeof paid)[number]) => { const q = o.summary.quote; return q ? q.protectionPence + q.processingPence + q.commissionPence - q.promotionPence : 0; };
    const inWeek = paid.filter((o) => t(o.summary.paidAt!) >= w0);
    const prevWeek = paid.filter((o) => t(o.summary.paidAt!) >= w1 && t(o.summary.paidAt!) < w0);
    const sum = (xs: typeof paid, f: (o: (typeof paid)[number]) => number) => xs.reduce((a, o) => a + f(o), 0);
    const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const daily = Array.from({ length: 30 }, (_, i) => {
      const d = day(new Date(now - (29 - i) * 86_400_000));
      const os = paid.filter((o) => day(new Date(o.summary.paidAt!)) === d);
      return { day: d, orders: os.length, gmvPence: sum(os, (o) => o.summary.quote?.pricePence ?? 0), members: 0, listings: 0 };
    });
    const month = paid.filter((o) => t(o.summary.paidAt!) >= now - 30 * 86_400_000);
    const sellers = new Map<string, { orders: number; gmvPence: number }>();
    for (const o of month) {
      const k = o.sellerId.replace(/^example:/, '').split('@')[0];
      const v = sellers.get(k) ?? { orders: 0, gmvPence: 0 };
      v.orders++;
      v.gmvPence += o.summary.quote?.pricePence ?? 0;
      sellers.set(k, v);
    }
    const all = exampleOrders();
    return {
      week: { orders: inWeek.length, ordersPrev: prevWeek.length, gmvPence: sum(inWeek, (o) => o.summary.quote?.pricePence ?? 0), gmvPrevPence: sum(prevWeek, (o) => o.summary.quote?.pricePence ?? 0), netFeesPence: sum(inWeek, net), netFeesPrevPence: sum(prevWeek, net) },
      members: { total: 0, new: 0, newPrev: 0, paidPlans: Object.values(load().plans).filter((k) => k === 'premium_plus').length, identityChecked: 0 },
      listings: { live: exampleCatalogue.filter((l) => l.status === 'active').length, new: 0, newPrev: 0, boosted: Object.keys(load().boosts).length },
      month: { completed: month.filter((o) => o.custody?.state === 'confirmed').length, disputed: month.filter((o) => o.custody?.events.some((e) => e.step === 'dispute' || e.step === 'return_requested')).length, orders: month.length, avgHandoverHours: null },
      attention: { disputes: all.filter((o) => o.custody?.state === 'disputed').length, paymentsToCheck: 0, reports: 0, payoutsFailed: 0, payoutsWaitingPence: 0, refundsByHand: 0, contact: 0 },
      daily,
      topSellers: [...sellers].map(([seller, v]) => ({ seller, ...v })).sort((a, b) => b.gmvPence - a.gmvPence).slice(0, 5),
    };
  },
};
