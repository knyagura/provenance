import { describe, expect, it } from 'vitest';
import { formatPence } from '@/lib/format';
import { describeVoucher, fromVoucherPatch, toCodes } from '@/lib/selling/money';

describe('vouchers and gift cards (web side)', () => {
  it('describes a code in plain words', () => {
    expect(describeVoucher({ kind: 'percent', value: 10, minSpendPence: 0, maxDiscountPence: 1000, firstOrderOnly: true }, formatPence)).toBe('10% off, up to £10.00, first order only');
    expect(describeVoucher({ kind: 'amount', value: 500, minSpendPence: 2000, maxDiscountPence: null, firstOrderOnly: false }, formatPence)).toBe('£5.00 off, when you spend £20.00');
  });
  it('reads the checkout figures from the database', () => {
    expect(toCodes({ voucher: { code: 'WELCOME10', shop: null, discount_pence: 400 }, balance_pence: 0, balance_available: 2500, total_pence: 4295, paid: false }))
      .toEqual({ voucher: { code: 'WELCOME10', shop: null, discountPence: 400 }, balancePence: 0, balanceAvailable: 2500, totalPence: 4295, paid: false });
    expect(toCodes(null).voucher).toBeNull();
  });
  it('sends voucher changes with the database’s names', () => {
    expect(fromVoucherPatch({ code: 'X10', minSpendPence: 2000, maxUses: null, firstOrderOnly: true })).toEqual({ code: 'X10', min_spend_pence: 2000, max_uses: '', first_order_only: true });
  });
});
