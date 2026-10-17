// Example mode's delivery addresses and test shipping labels, on the example orders in localStorage.
// Same rules as migration 025 (tests/label_checks.mjs checks the database).
import { planFor } from '@/lib/domain/custody';
import { exampleNotify } from './exampleNotifications';
import { loadMarket, saveMarket, type StoredOrder } from './exampleMarket';
import { cleanAddress, PARCEL_SIZES, SERVICES } from './shipping';
import type { Address, Member, OrderShipping, ParcelSize, Result, ShippingLabel } from './types';

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
type Stored = StoredOrder & { deliverTo?: Address | null; label?: ShippingLabel | null };

const shipped = (o: Stored) => !!o.custody?.events.some((e) => e.step === 'ship');
export const postsItself = (o: StoredOrder) => planFor(o.custody?.tier ?? o.summary.quote?.tier ?? 'enhanced').some((s) => s.key === 'ship');
const canLabel = (o: Stored) => o.summary.paymentStatus === 'paid' && o.custody?.state === 'in_progress' && postsItself(o) && !shipped(o);
const isStaff = (m: Member) => m.email.toLowerCase().startsWith('staff');

function view(o: Stored, m: Member): OrderShipping {
  const addr = (o.deliverTo ?? (o.shipTo as Address | null | undefined)) ?? null;
  const label = o.label ?? null;
  const seller = o.sellerId === m.id;
  return {
    canLabel: canLabel(o),
    address: o.buyerId === m.id || isStaff(m) || label ? addr : null,
    hasAddress: !!addr,
    addressFromBasket: !o.deliverTo && !!o.shipTo,
    label,
    quotes: seller && !label && canLabel(o) ? SERVICES : null,
    sizes: PARCEL_SIZES,
  };
}

function withOrder<T>(orderId: string, m: Member | null, fn: (o: Stored, all: ReturnType<typeof loadMarket>) => Result<T> | T): Result<T> | T {
  if (!m) return fail('Sign in first.');
  const all = loadMarket();
  const o = all.orders.find((x) => x.summary.id === orderId) as Stored | undefined;
  if (!o || (o.buyerId !== m.id && o.sellerId !== m.id && !isStaff(m))) return fail('Order not found.');
  return fn(o, all);
}

export const exampleShipping = {
  get(orderId: string, m: Member | null): OrderShipping | null {
    const r = withOrder(orderId, m, (o) => view(o, m!));
    return 'ok' in r ? null : r;
  },
  setAddress(orderId: string, a: Address, m: Member | null): Result<OrderShipping> {
    return withOrder(orderId, m, (o, all): Result<OrderShipping> => {
      if (o.buyerId !== m!.id) return fail('Order not found.');
      if (o.summary.paymentStatus !== 'paid' || shipped(o) || ['confirmed', 'disputed'].includes(o.custody?.state ?? '')) return fail('The parcel is already on its way, so the address can’t change now. Message the seller.');
      if (o.label) return fail('The seller has already printed a label. Message them to change the address.');
      const clean = cleanAddress(a);
      if (typeof clean === 'string') return fail(clean);
      o.deliverTo = clean;
      saveMarket(all);
      return { ok: true, value: view(o, m!) };
    }) as Result<OrderShipping>;
  },
  create(orderId: string, service: string, parcel: ParcelSize, m: Member | null): Result<OrderShipping> {
    return withOrder(orderId, m, (o, all): Result<OrderShipping> => {
      if (o.sellerId !== m!.id) return fail('Order not found.');
      if (!canLabel(o)) return fail('Labels are for paid orders you post yourself, before you’ve recorded sending it.');
      if (o.label) return fail('This order already has a label. Cancel it to make a new one.');
      const addr = o.deliverTo ?? (o.shipTo as Address | null | undefined);
      if (!addr) return fail('The buyer hasn’t given a delivery address yet. We’ve asked them to.');
      const s = SERVICES.find((x) => x.service === service);
      if (!s) return fail('Choose a delivery service.');
      if (!s.prices[parcel]) return fail('Choose a parcel size.');
      const hex = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 9).toUpperCase();
      o.label = { id: crypto.randomUUID(), carrier: s.carrier, service: s.name, parcel, pricePence: 0, mode: 'test', tracking: `P2GTEST${hex}`, labelUrl: null, deliverTo: addr, createdAt: new Date().toISOString() };
      saveMarket(all);
      exampleNotify(o.buyerId, 'turn', 'Your item has a shipping label', `The seller has a ${s.carrier} label for your order and will post it soon.`, `/orders/${o.summary.id}`, { orderId: o.summary.id, dedupe: `label:${o.summary.id}` });
      return { ok: true, value: view(o, m!) };
    }) as Result<OrderShipping>;
  },
  cancel(orderId: string, m: Member | null): Result<OrderShipping> {
    return withOrder(orderId, m, (o, all): Result<OrderShipping> => {
      if (o.sellerId !== m!.id) return fail('Order not found.');
      if (shipped(o)) return fail('You’ve already recorded sending it, so the label can’t be cancelled.');
      if (!o.label) return fail('There’s no label to cancel.');
      o.label = null;
      saveMarket(all);
      return { ok: true, value: view(o, m!) };
    }) as Result<OrderShipping>;
  },
};
