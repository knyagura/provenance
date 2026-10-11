import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeFees, DEFAULT_FEES, divRound, feeSettingsFromJson, type FeeSettings } from '@/lib/domain/fees';

interface Basket {
  name: string;
  price: number;
  postage: number;
  payer: 'buyer' | 'seller';
  boostBp: number | null;
  settings?: Partial<FeeSettings>;
  expect: Record<string, number | string>;
}
const fixture = JSON.parse(readFileSync(new URL('../../../backend/fixtures/fee_baskets.json', import.meta.url), 'utf8')) as { baskets: Basket[] };

describe('the agreed test baskets', () => {
  it.each(fixture.baskets.map((b) => [b.name, b] as const))('%s', (_n, b) => {
    const s = { ...DEFAULT_FEES, ...b.settings };
    const f = computeFees(s, { pricePence: b.price, postagePence: b.postage, payer: b.payer, boostBp: b.boostBp });
    expect({
      tier: f.tier, protection: f.protectionPence, processing: f.processingPence, courier: f.courierPence, hub: f.hubPence,
      promotion: f.promotionPence, buyerTotal: f.buyerTotalPence, commission: f.commissionPence, sellerFees: f.sellerFeesPence,
      sellerPayout: f.sellerPayoutPence,
    }).toEqual(b.expect);
  });
});

describe('matches the fee model', () => {
  // The fee model (Fee model artifact) in floating point, with its defaults, for unboosted sales.
  const model = (price: number) => {
    const tiers = [[0, 0], [75, 5], [500, 20], [1500, 35]];
    let add = 0;
    for (const [from, a] of tiers) if (price >= from) add = a;
    const prot = Math.min(250, Math.max(0.5, price * 0.05));
    return price + prot + 0.8 + add;
  };
  it.each([15, 40, 74.99, 75, 150, 800, 2000, 5, 10000])('£%s', (price) => {
    const f = computeFees(DEFAULT_FEES, { pricePence: Math.round(price * 100), postagePence: 0, payer: 'buyer', boostBp: null });
    expect(Math.abs(f.buyerTotalPence / 100 - model(price))).toBeLessThan(0.006);
  });
});

describe('arithmetic', () => {
  it('rounds halves up with whole numbers only', () => {
    expect(divRound(5000, 10000)).toBe(1);
    expect(divRound(4999, 10000)).toBe(0);
    expect(divRound(3754500, 10000)).toBe(375);
  });
  it('refuses fractions of a penny', () => {
    expect(() => computeFees(DEFAULT_FEES, { pricePence: 10.5, postagePence: 0, payer: 'buyer', boostBp: null })).toThrow();
  });
  it('reads settings stored in the database', () => {
    const s = feeSettingsFromJson(1, {
      tiers: DEFAULT_FEES.tiers.map((t) => ({ key: t.key, from_pence: t.fromPence, protection_bp: t.protectionBp, courier_pence: t.courierPence, hub_pence: t.hubPence })),
      processing_pence: 80, protection_min_pence: 50, protection_max_pence: 25000, boost_on: true, boost_min_price_pence: 2500,
      boost_min_bp: 300, boost_max_bp: 800, boost_fixed_pence: 80, promotion_share_bp: 0,
      promotion_covers: { protection: true, processing: true, add_ons: false }, checkout_hold_minutes: 30,
    });
    expect(s).toEqual(DEFAULT_FEES);
  });
});
