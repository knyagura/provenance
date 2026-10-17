import type { Balance, CheckoutCodes, GiftCard, Voucher, VoucherPatch } from './types';

// Translating migration 022's JSON (codes, gift cards, balance) to and from the web types.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const toCodes = (c: any): CheckoutCodes => ({
  voucher: c?.voucher ? { code: c.voucher.code, shop: c.voucher.shop ?? null, discountPence: Number(c.voucher.discount_pence ?? 0) } : null,
  balancePence: Number(c?.balance_pence ?? 0), balanceAvailable: Number(c?.balance_available ?? 0), totalPence: Number(c?.total_pence ?? 0), paid: Boolean(c?.paid),
});

export const toVoucher = (v: any): Voucher => ({
  id: v.id, code: v.code, shop: v.shop ?? null, kind: v.kind, value: Number(v.value), minSpendPence: Number(v.min_spend_pence ?? 0),
  maxDiscountPence: v.max_discount_pence ?? null, perMember: Number(v.per_member ?? 1), maxUses: v.max_uses ?? null, firstOrderOnly: Boolean(v.first_order_only),
  startsAt: v.starts_at ?? null, endsAt: v.ends_at ?? null, active: Boolean(v.active), note: v.note ?? null, uses: Number(v.uses ?? 0),
  discountGivenPence: Number(v.discount_given_pence ?? 0),
});

export const fromVoucherPatch = (p: VoucherPatch): Record<string, unknown> => {
  const map: Record<string, string> = { minSpendPence: 'min_spend_pence', maxDiscountPence: 'max_discount_pence', perMember: 'per_member', maxUses: 'max_uses',
    firstOrderOnly: 'first_order_only', startsAt: 'starts_at', endsAt: 'ends_at' };
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [map[k] ?? k, v === null || v === undefined ? '' : v]));
};

export const toGiftCard = (c: any): GiftCard => ({
  id: c.id, amountPence: Number(c.amount_pence), recipientName: c.recipient_name ?? null, recipientEmail: c.recipient_email ?? null, message: c.message ?? null,
  paymentStatus: c.payment_status, paidAt: c.paid_at ?? null, expiresAt: c.expires_at ?? null, createdAt: c.created_at, code: c.code ?? null, redeemed: Boolean(c.redeemed),
});

export const toBalance = (b: any): Balance => ({
  balancePence: Number(b?.balance_pence ?? 0),
  lots: ((b?.lots ?? []) as any[]).map((l) => ({ source: l.source, amountPence: Number(l.amount_pence), remainingPence: Number(l.remaining_pence), expiresAt: l.expires_at })),
});

/** "10% off" / "£5 off", with its conditions. */
export function describeVoucher(v: Pick<Voucher, 'kind' | 'value' | 'minSpendPence' | 'maxDiscountPence' | 'firstOrderOnly'>, money: (p: number) => string): string {
  return [
    v.kind === 'percent' ? `${v.value}% off` : `${money(v.value)} off`,
    v.minSpendPence ? `when you spend ${money(v.minSpendPence)}` : null,
    v.maxDiscountPence ? `up to ${money(v.maxDiscountPence)}` : null,
    v.firstOrderOnly ? 'first order only' : null,
  ].filter(Boolean).join(', ');
}
