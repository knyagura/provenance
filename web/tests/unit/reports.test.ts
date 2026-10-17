import { describe, expect, it } from 'vitest';
import { reportCsv, toReport } from '@/lib/selling/reports';
import { cleanAddress } from '@/lib/selling/shipping';
import { handoverTime, trustWords } from '@/components/market/Trust';

const raw = {
  from: '2026-10-01', to: '2026-10-17',
  sales: { orders: 2, sellers: 1, buyers: 2, gmv_pence: 5000, buyer_paid_pence: 5900, postage_pence: 798, average_order_pence: 2500, seller_payouts_pence: 5000 },
  fees: { transaction_pence: 400, processing_pence: 160, commission_pence: 0, courier_pence: 0, hub_pence: 0, promotion_pence: 0, nutuyu_vouchers_pence: 100, net_pence: 460 },
  by_tier: { enhanced: { orders: 2, gmv_pence: 5000 } }, by_category: [{ category: 'men', orders: 2, gmv_pence: 5000 }],
  disputes: { opened: 1, rate_pct: 50, by_reason: { damaged: 1 }, released: 0, refunded: 0, open_now: 1, avg_hours_to_decide: null },
  handover: { completed: 1, avg_hours: 50, median_hours: 50, by_tier: { enhanced: { completed: 1, avg_hours: 50 } } },
  labels: { 'Evri (test)': 1 },
  months: [{ month: '2026-10', orders: 2, gmv_pence: 5000, net_fees_pence: 560, disputes: 1 }],
};

describe('staff reports', () => {
  it('maps the database’s report', () => {
    const r = toReport(raw);
    expect(r.sales).toMatchObject({ orders: 2, gmvPence: 5000, averageOrderPence: 2500 });
    expect(r.fees.netPence).toBe(460);
    expect(r.disputes).toMatchObject({ ratePct: 50, openNow: 1, avgHoursToDecide: null, byReason: { damaged: 1 } });
    expect(r.byTier.enhanced).toEqual({ orders: 2, gmvPence: 5000 });
  });
  it('downloads as CSV in pounds', () => {
    const csv = reportCsv(toReport(raw));
    expect(csv).toContain('NuTuYu report,2026-10-01 to 2026-10-17');
    expect(csv).toContain('Items sold (£),50.00');
    expect(csv).toContain('Net to NuTuYu (£),4.60');
    expect(csv).toContain('2026-10,2,50.00,5.60,1');
  });
});

describe('delivery addresses', () => {
  it('tidies a good one', () => {
    expect(cleanAddress({ name: ' Bea ', line1: '1 St', town: 'London', postcode: 'sw112ab' })).toEqual({ name: 'Bea', line1: '1 St', line2: null, town: 'London', postcode: 'SW11 2AB' });
  });
  it('refuses a missing town or a non-UK postcode', () => {
    expect(typeof cleanAddress({ name: 'Bea', line1: '1 St', town: '', postcode: 'SW11 2AB' })).toBe('string');
    expect(typeof cleanAddress({ name: 'Bea', line1: '1 St', town: 'Paris', postcode: '75001' })).toBe('string');
  });
});

describe('trust words', () => {
  it('a new seller', () => {
    expect(trustWords({ verified: true, completed: 0, finished: 0, disputes: 0, disputeRate: null, avgHandoverHours: null, trusted: false })).toEqual(['New seller: no protected handovers yet']);
  });
  it('a record', () => {
    expect(trustWords({ verified: true, completed: 6, finished: 6, disputes: 0, disputeRate: 0, avgHandoverHours: 50, trusted: true }))
      .toEqual(['6 protected handovers completed', '0% disputed', 'usually done in about 2 days']);
    expect(handoverTime(5)).toBe('about 5 hours');
  });
});
