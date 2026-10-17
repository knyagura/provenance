// Shipping labels: shared between the database backend and example mode.
import type { Address, OrderShipping, ParcelSize, ShippingLabel, ShippingQuote } from './types';

export const PARCEL_SIZES: OrderShipping['sizes'] = [
  { key: 'small', name: 'Small', limit: 'Up to 2 kg, 45 × 35 × 16 cm' },
  { key: 'medium', name: 'Medium', limit: 'Up to 5 kg, 61 × 46 × 46 cm' },
  { key: 'large', name: 'Large', limit: 'Up to 10 kg, 100 × 50 × 50 cm' },
];

/** The same services and prices as migration 025 (Parcel2Go's will replace them once live). */
export const SERVICES: ShippingQuote[] = [
  { service: 'evri_dropoff', carrier: 'Evri', name: 'Evri drop-off, 2–3 days', dropOff: true, prices: { small: 319, medium: 449, large: 799 } },
  { service: 'royalmail_48', carrier: 'Royal Mail', name: 'Royal Mail Tracked 48', dropOff: true, prices: { small: 379, medium: 529, large: 949 } },
  { service: 'dpd_pickup', carrier: 'DPD', name: 'DPD Pickup, next day', dropOff: true, prices: { small: 499, medium: 599, large: 899 } },
];

const POSTCODE = /^([A-Z]{1,2}[0-9][0-9A-Z]?) ?([0-9][A-Z]{2})$/;

/** Checks and tidies an address like clean_address() in the database; a message when it isn't usable. */
export function cleanAddress(a: Partial<Address>): Address | string {
  const t = (s: unknown) => (typeof s === 'string' ? s.trim() : '');
  const pc = t(a.postcode).toUpperCase().match(POSTCODE);
  if (!t(a.name) || t(a.name).length > 80 || !t(a.line1) || t(a.line1).length > 120 || t(a.line2).length > 120 || !t(a.town) || t(a.town).length > 80 || !pc) {
    return 'Enter the name, first line, town and a UK postcode.';
  }
  return { name: t(a.name), line1: t(a.line1), line2: t(a.line2) || null, town: t(a.town), postcode: `${pc[1]} ${pc[2]}` };
}

export function addressLines(a: Address): string[] {
  return [a.name, a.line1, a.line2, a.town, a.postcode].filter((x): x is string => !!x);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toAddress = (a: any): Address | null => (a ? { name: a.name, line1: a.line1, line2: a.line2 ?? null, town: a.town, postcode: a.postcode } : null);
const toLabel = (l: any): ShippingLabel | null => (l ? {
  id: l.id, carrier: l.carrier, service: l.service, parcel: l.parcel as ParcelSize, pricePence: Number(l.price_pence ?? 0), mode: l.mode,
  tracking: l.tracking, labelUrl: l.label_url ?? null, deliverTo: toAddress(l.deliver_to)!, createdAt: l.created_at,
} : null);
export const toShipping = (s: any): OrderShipping => ({
  canLabel: Boolean(s.can_label), address: toAddress(s.address), hasAddress: Boolean(s.has_address), addressFromBasket: Boolean(s.address_from_basket),
  label: toLabel(s.label),
  quotes: Array.isArray(s.quotes) ? s.quotes.map((q: any) => ({ service: q.service, carrier: q.carrier, name: q.name, dropOff: Boolean(q.drop_off), prices: q.prices })) : null,
  sizes: Array.isArray(s.sizes) ? s.sizes : PARCEL_SIZES,
});
/* eslint-enable @typescript-eslint/no-explicit-any */
