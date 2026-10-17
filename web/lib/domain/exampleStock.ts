// Example mode: units of a stocked example listing that are paid for or held by someone paying, read from the
// shared example orders (localStorage, written by lib/selling/exampleMarket). On the server there are none.

interface StoredOrderLite { summary: { listingId: string; paymentStatus: string; holdExpiresAt?: string | null }; buyerId?: string }

export function exampleUnitsTaken(listingId: string, exceptBuyer?: string): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const raw = localStorage.getItem('pv-example-market');
    if (!raw) return 0;
    const now = new Date().toISOString();
    return ((JSON.parse(raw) as { orders?: StoredOrderLite[] }).orders ?? []).filter((o) =>
      o.summary.listingId === listingId && o.buyerId !== exceptBuyer &&
      (o.summary.paymentStatus === 'paid' || (o.summary.paymentStatus === 'awaiting_payment' && (o.summary.holdExpiresAt ?? '') > now))).length;
  } catch {
    return 0;
  }
}

export function exampleUnitsLeft(listingId: string, stock: number, exceptBuyer?: string): number {
  return Math.max(stock - exampleUnitsTaken(listingId, exceptBuyer), 0);
}
