// Example mode's trust figures, counted from the example orders in this browser, by the rules of migration 026
// (tests/trust_checks.mjs checks the database). Nothing is made up: example sellers start with no record.
import { exampleCatalogue } from '@/lib/domain/examples';
import { exampleOrders, type StoredOrder } from './exampleMarket';
import type { SellerTrust, TrustStats } from './types';

const nameOf = (id: string) => id.replace(/^example:/, '').split('@')[0].toLowerCase();
const finished = (o: StoredOrder) => o.summary.paymentStatus === 'paid' && (o.custody?.state === 'confirmed' || o.custody?.state === 'disputed');
const disputed = (o: StoredOrder) => !!o.custody?.events.some((e) => e.step === 'dispute') || o.custody?.state === 'disputed';
const refunded = (o: StoredOrder) => (o.custody as { resolution?: string } | null)?.resolution === 'refund';
const confirmedAt = (o: StoredOrder) => o.custody?.events.at(-1)?.at ?? null;
const hours = (o: StoredOrder) => {
  const end = confirmedAt(o);
  const start = o.summary.paidAt ?? o.summary.createdAt;
  return end && start ? (Date.parse(end) - Date.parse(start)) / 3_600_000 : null;
};
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

export const exampleTrust = {
  seller(username: string): SellerTrust | null {
    const u = username.trim().toLowerCase();
    const listed = exampleCatalogue.find((l) => l.seller.username.toLowerCase() === u);
    const mine = exampleOrders().filter((o) => nameOf(o.sellerId) === u && finished(o));
    if (!listed && !mine.length) return null;
    const verified = !!listed?.seller.verified;
    const done = mine.filter((o) => o.custody?.state === 'confirmed' && !disputed(o));
    const disputes = mine.filter(disputed).length;
    return {
      verified, completed: done.length, finished: mine.length, disputes,
      disputeRate: mine.length >= 5 ? Math.round((1000 * disputes) / mine.length) / 10 : null,
      avgHandoverHours: done.length >= 3 ? avg(done.map(hours)) : null,
      trusted: verified && done.length >= 5 && disputes * 20 <= mine.length,
    };
  },
  stats(): TrustStats {
    const all = exampleOrders().filter(finished);
    const done = all.filter((o) => o.custody?.state === 'confirmed' && !refunded(o));
    const month = Date.now() - 30 * 86_400_000;
    const byTier: TrustStats['byTier'] = {};
    for (const o of done) byTier[o.custody!.tier] = (byTier[o.custody!.tier] ?? 0) + 1;
    return {
      completed: done.length,
      completed30d: done.filter((o) => Date.parse(confirmedAt(o) ?? '') > month).length,
      finished: all.length, disputes: all.filter(disputed).length, refunds: all.filter(refunded).length,
      avgHandoverHours: avg(done.map(hours)), byTier,
      recent: done.sort((a, b) => (confirmedAt(b) ?? '').localeCompare(confirmedAt(a) ?? '')).slice(0, 8)
        .map((o) => ({ listingId: o.summary.listingId, title: o.summary.title, tier: o.custody!.tier, confirmedOn: (confirmedAt(o) ?? '').slice(0, 10) })),
    };
  },
};
