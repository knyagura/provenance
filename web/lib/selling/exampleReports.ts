// Example mode's staff report, counted from the example orders in this browser by the rules of migration 027
// (tests/report_checks.mjs checks the database).
import { exampleCatalogue } from '@/lib/domain/examples';
import { exampleOrders, type StoredOrder } from './exampleMarket';
import { toReport } from './reports';
import type { Result, ShippingLabel, StaffReport } from './types';

const ukDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const within = (iso: string | null | undefined, from: string, to: string) => !!iso && ukDay(iso) >= from && ukDay(iso) <= to;
const ev = (o: StoredOrder, step: string) => o.custody?.events.find((e) => e.step === step)?.at ?? null;
const resolution = (o: StoredOrder) => (o.custody as { resolution?: 'release' | 'refund' } | null)?.resolution ?? null;
const confirmedAt = (o: StoredOrder) => (o.custody?.state === 'confirmed' ? o.custody.events.at(-1)?.at ?? null : null);
const hrs = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return Math.round(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2);
};
const net = (o: StoredOrder) => { const q = o.summary.quote; return q ? q.protectionPence + q.processingPence + q.commissionPence - q.promotionPence : 0; };

export function exampleReport(from: string, to: string): Result<StaffReport> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 731) {
    return { ok: false, message: 'Choose a date range of up to two years.' };
  }
  const all = exampleOrders();
  const paid = all.filter((o) => o.summary.paymentStatus === 'paid' && within(o.summary.paidAt, from, to));
  const sum = (xs: StoredOrder[], f: (o: StoredOrder) => number) => xs.reduce((s, o) => s + f(o), 0);
  const q = (o: StoredOrder) => o.summary.quote!;
  const tierOf = (o: StoredOrder) => o.custody?.tier ?? o.summary.quote?.tier ?? 'enhanced';
  const group = <T,>(xs: StoredOrder[], key: (o: StoredOrder) => string, f: (g: StoredOrder[]) => T) => {
    const m = new Map<string, StoredOrder[]>();
    for (const o of xs) m.set(key(o), [...(m.get(key(o)) ?? []), o]);
    return Object.fromEntries([...m].map(([k, g]) => [k, f(g)]));
  };
  const gmv = sum(paid, (o) => q(o).pricePence);
  const fees = {
    transaction_pence: sum(paid, (o) => q(o).protectionPence), processing_pence: sum(paid, (o) => q(o).processingPence),
    commission_pence: sum(paid, (o) => q(o).commissionPence), courier_pence: sum(paid, (o) => q(o).courierPence), hub_pence: sum(paid, (o) => q(o).hubPence),
    promotion_pence: sum(paid, (o) => q(o).promotionPence), nutuyu_vouchers_pence: 0,
  };
  const opened = all.filter((o) => within(ev(o, 'dispute'), from, to));
  const decided = all.filter((o) => within(ev(o, 'staff_resolution'), from, to));
  const done = all.filter((o) => resolution(o) !== 'refund' && within(confirmedAt(o), from, to) && o.summary.paidAt);
  const h = (o: StoredOrder) => hrs(o.summary.paidAt!, confirmedAt(o)!);
  const cat = (o: StoredOrder) => exampleCatalogue.find((l) => l.id === o.summary.listingId)?.category ?? 'other';
  const labels = all.map((o) => (o as { label?: ShippingLabel | null }).label).filter((l): l is ShippingLabel => !!l && within(l.createdAt, from, to));
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
    const key = d.toISOString().slice(0, 7);
    const inMonth = all.filter((o) => o.summary.paymentStatus === 'paid' && o.summary.paidAt && ukDay(o.summary.paidAt).startsWith(key));
    return { month: key, orders: inMonth.length, gmv_pence: sum(inMonth, (o) => q(o).pricePence), net_fees_pence: sum(inMonth, net),
      disputes: all.filter((o) => ev(o, 'dispute') && ukDay(ev(o, 'dispute')!).startsWith(key)).length };
  });
  return {
    ok: true,
    value: toReport({
      from, to,
      sales: {
        orders: paid.length, sellers: new Set(paid.map((o) => o.sellerId)).size, buyers: new Set(paid.map((o) => o.buyerId)).size, gmv_pence: gmv,
        buyer_paid_pence: sum(paid, (o) => o.summary.totalPence ?? 0), postage_pence: sum(paid, (o) => q(o).postagePence),
        average_order_pence: paid.length ? Math.round(gmv / paid.length) : null, seller_payouts_pence: sum(paid, (o) => q(o).sellerPayoutPence),
      },
      fees: { ...fees, net_pence: fees.transaction_pence + fees.processing_pence + fees.commission_pence - fees.promotion_pence - fees.nutuyu_vouchers_pence },
      by_tier: group(paid, tierOf, (g) => ({ orders: g.length, gmv_pence: sum(g, (o) => q(o).pricePence) })),
      by_category: Object.entries(group(paid, cat, (g) => ({ orders: g.length, gmv_pence: sum(g, (o) => q(o).pricePence) })))
        .map(([category, v]) => ({ category, ...v })).sort((a, b) => b.gmv_pence - a.gmv_pence).slice(0, 10),
      disputes: {
        opened: opened.length,
        rate_pct: paid.length ? Math.round((1000 * paid.filter((o) => ev(o, 'dispute')).length) / paid.length) / 10 : null,
        by_reason: group(opened, (o) => o.custody?.disputeReason ?? 'other', (g) => g.length),
        released: decided.filter((o) => resolution(o) === 'release').length, refunded: decided.filter((o) => resolution(o) === 'refund').length,
        open_now: all.filter((o) => o.custody?.state === 'disputed' && !resolution(o)).length,
        avg_hours_to_decide: avg(decided.filter((o) => ev(o, 'dispute')).map((o) => hrs(ev(o, 'dispute')!, ev(o, 'staff_resolution')!))),
      },
      handover: {
        completed: done.length, avg_hours: avg(done.map(h)), median_hours: median(done.map(h)),
        by_tier: group(done, tierOf, (g) => ({ completed: g.length, avg_hours: avg(g.map(h)) })),
      },
      labels: labels.reduce<Record<string, number>>((m, l) => { const k = l.carrier + (l.mode === 'test' ? ' (test)' : ''); m[k] = (m[k] ?? 0) + 1; return m; }, {}),
      months,
    }),
  };
}
