// Staff reports (migration 027): the database's JSON as the web's shape, shared with example mode.
import type { StaffReport } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (x: any): number => Number(x ?? 0);
const opt = (x: any): number | null => (x == null ? null : Number(x));
const mapObj = <T,>(o: any, f: (v: any) => T): Record<string, T> => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, f(v)]));

export function toReport(r: any): StaffReport {
  return {
    from: r.from, to: r.to,
    sales: {
      orders: num(r.sales?.orders), sellers: num(r.sales?.sellers), buyers: num(r.sales?.buyers), gmvPence: num(r.sales?.gmv_pence),
      buyerPaidPence: num(r.sales?.buyer_paid_pence), postagePence: num(r.sales?.postage_pence), averageOrderPence: opt(r.sales?.average_order_pence),
      sellerPayoutsPence: num(r.sales?.seller_payouts_pence),
    },
    fees: {
      transactionPence: num(r.fees?.transaction_pence), processingPence: num(r.fees?.processing_pence), commissionPence: num(r.fees?.commission_pence),
      courierPence: num(r.fees?.courier_pence), hubPence: num(r.fees?.hub_pence), promotionPence: num(r.fees?.promotion_pence),
      nutuyuVouchersPence: num(r.fees?.nutuyu_vouchers_pence), netPence: num(r.fees?.net_pence),
    },
    byTier: mapObj(r.by_tier, (v) => ({ orders: num(v.orders), gmvPence: num(v.gmv_pence) })),
    byCategory: (r.by_category ?? []).map((c: any) => ({ category: c.category, orders: num(c.orders), gmvPence: num(c.gmv_pence) })),
    disputes: {
      opened: num(r.disputes?.opened), ratePct: opt(r.disputes?.rate_pct), byReason: mapObj(r.disputes?.by_reason, num),
      released: num(r.disputes?.released), refunded: num(r.disputes?.refunded), openNow: num(r.disputes?.open_now), avgHoursToDecide: opt(r.disputes?.avg_hours_to_decide),
    },
    handover: {
      completed: num(r.handover?.completed), avgHours: opt(r.handover?.avg_hours), medianHours: opt(r.handover?.median_hours),
      byTier: mapObj(r.handover?.by_tier, (v) => ({ completed: num(v.completed), avgHours: opt(v.avg_hours) })),
    },
    labels: mapObj(r.labels, num),
    months: (r.months ?? []).map((m: any) => ({ month: m.month, orders: num(m.orders), gmvPence: num(m.gmv_pence), netFeesPence: num(m.net_fees_pence), disputes: num(m.disputes) })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The report as CSV rows (one section per block), for a spreadsheet. */
export function reportCsv(r: StaffReport): string {
  const p = (pence: number | null) => (pence == null ? '' : (pence / 100).toFixed(2));
  const rows: (string | number)[][] = [
    ['NuTuYu report', `${r.from} to ${r.to}`],
    [],
    ['Sales', ''],
    ['Orders', r.sales.orders], ['Sellers', r.sales.sellers], ['Buyers', r.sales.buyers],
    ['Items sold (£)', p(r.sales.gmvPence)], ['Buyers paid (£)', p(r.sales.buyerPaidPence)], ['Average order (£)', p(r.sales.averageOrderPence)],
    ['Seller payouts (£)', p(r.sales.sellerPayoutsPence)],
    [],
    ['Fees', ''],
    ['Transaction fees (£)', p(r.fees.transactionPence)], ['Processing (£)', p(r.fees.processingPence)], ['Commission (£)', p(r.fees.commissionPence)],
    ['Promotions covered (£)', p(r.fees.promotionPence)], ['NuTuYu voucher codes (£)', p(r.fees.nutuyuVouchersPence)], ['Net to NuTuYu (£)', p(r.fees.netPence)],
    ['Courier charges, passed on (£)', p(r.fees.courierPence)], ['Authentication charges, passed on (£)', p(r.fees.hubPence)],
    [],
    ['Disputes', ''],
    ['Opened', r.disputes.opened], ['Rate (%)', r.disputes.ratePct ?? ''], ['Released to seller', r.disputes.released], ['Refunded', r.disputes.refunded],
    ['Open now', r.disputes.openNow], ['Average hours to decide', r.disputes.avgHoursToDecide ?? ''],
    [],
    ['Handover', ''],
    ['Completed', r.handover.completed], ['Average hours', r.handover.avgHours ?? ''], ['Median hours', r.handover.medianHours ?? ''],
    [],
    ['Month', 'Orders', 'Items sold (£)', 'Net fees (£)', 'Disputes'],
    ...r.months.map((m) => [m.month, m.orders, p(m.gmvPence), p(m.netFeesPence), m.disputes]),
  ];
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
