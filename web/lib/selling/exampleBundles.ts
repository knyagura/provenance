import { computeFees, DEFAULT_FEES, type FeeBreakdown } from '@/lib/domain/fees';
import type { BundleOffer } from './types';

// Example mode's bundle discounts (migration 020), by seller username, in localStorage.
// resole_archive offers 10% off 2 or more so the discount can be tried with the example catalogue.

const KEY = 'pv-example-bundles';
const SEEDED: Record<string, BundleOffer> = { resole_archive: { minItems: 2, pct: 10 } };

function load(): Record<string, BundleOffer | null> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...SEEDED, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...SEEDED };
}

export function exampleBundle(username: string): BundleOffer | null {
  return load()[username.toLowerCase()] ?? null;
}

export function setExampleBundle(username: string, offer: BundleOffer | null): void {
  try {
    const all = load();
    all[username.toLowerCase()] = offer;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full */
  }
}

/** The quote for one item of a bundle: the fees worked out again on the discounted price. */
export function bundledQuote(q: FeeBreakdown, offer: BundleOffer): FeeBreakdown {
  const price = Math.max(Math.round((q.pricePence * (100 - offer.pct)) / 100), 1);
  const next = computeFees(DEFAULT_FEES, { pricePence: price, postagePence: q.postagePence, payer: q.payer, boostBp: null });
  return { ...next, bundle: { pct: offer.pct, discountPence: q.pricePence - price, listPricePence: q.pricePence } };
}
