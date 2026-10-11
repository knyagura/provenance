// The fee engine: what a buyer pays and a seller receives for one item, from the fee settings.
// The database has the same engine (backend/008_checkout.sql) and that one decides real orders; this one
// shows the breakdown on screens. Both are tested against the same agreed baskets
// (backend/fixtures/fee_baskets.json). All money is in whole pence; rates are in basis points (1% = 100).

export type TierKey = 'enhanced' | 'verified' | 'luxury' | 'ultraLuxury';

export interface FeeTier {
  key: TierKey;
  /** The tier applies from this price upwards. */
  fromPence: number;
  /** Buyer protection, as basis points of the price. */
  protectionBp: number;
  /** Courier witness at collection and delivery. */
  courierPence: number;
  /** Verifier Hub check (authentication). */
  hubPence: number;
}

export interface FeeSettings {
  version: number;
  tiers: FeeTier[];
  processingPence: number;
  protectionMinPence: number;
  protectionMaxPence: number;
  boostOn: boolean;
  boostMinPricePence: number;
  boostMinBp: number;
  boostMaxBp: number;
  boostFixedPence: number;
  /** Share of a boosted sale's advertising money taken off the buyer's charges. */
  promotionShareBp: number;
  promotionCovers: { protection: boolean; processing: boolean; addOns: boolean };
  /** How long an item is held for a buyer while they pay. */
  checkoutHoldMinutes: number;
}

/** Version 1: the fee model's defaults, agreed 11 Oct 2026. The live values come from the database. */
export const DEFAULT_FEES: FeeSettings = {
  version: 1,
  tiers: [
    { key: 'enhanced', fromPence: 0, protectionBp: 500, courierPence: 0, hubPence: 0 },
    { key: 'verified', fromPence: 7500, protectionBp: 500, courierPence: 500, hubPence: 0 },
    { key: 'luxury', fromPence: 50000, protectionBp: 500, courierPence: 500, hubPence: 1500 },
    { key: 'ultraLuxury', fromPence: 150000, protectionBp: 500, courierPence: 500, hubPence: 3000 },
  ],
  processingPence: 80,
  protectionMinPence: 50,
  protectionMaxPence: 25000,
  boostOn: true,
  boostMinPricePence: 2500,
  boostMinBp: 300,
  boostMaxBp: 800,
  boostFixedPence: 80,
  promotionShareBp: 0,
  promotionCovers: { protection: true, processing: true, addOns: false },
  checkoutHoldMinutes: 30,
};

export interface FeeInput {
  pricePence: number;
  postagePence: number;
  /** Who pays buyer protection and the processing fee. */
  payer: 'buyer' | 'seller';
  /** The seller's boost rate when the buyer bought through a boost; null otherwise. */
  boostBp: number | null;
}

export interface FeeBreakdown {
  feeVersion: number;
  tier: TierKey;
  pricePence: number;
  postagePence: number;
  protectionPence: number;
  processingPence: number;
  courierPence: number;
  hubPence: number;
  /** Taken off the buyer's charges on a promoted, boosted sale. */
  promotionPence: number;
  buyerTotalPence: number;
  /** Advertising fee the seller pays on a boosted sale. */
  commissionPence: number;
  /** Protection and processing, when the seller has chosen to pay them. */
  sellerFeesPence: number;
  sellerPayoutPence: number;
  payer: 'buyer' | 'seller';
}

/** Rounds n ÷ d to the nearest whole number, halves up. Integers only, so no floating-point drift. */
export function divRound(n: number, d: number): number {
  return Math.floor((n + Math.floor(d / 2)) / d);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function tierFor(s: FeeSettings, pricePence: number): FeeTier {
  let t = s.tiers[0];
  for (const x of s.tiers) if (pricePence >= x.fromPence) t = x;
  return t;
}

export function computeFees(s: FeeSettings, input: FeeInput): FeeBreakdown {
  const { pricePence: price, postagePence: postage, payer } = input;
  if (!Number.isInteger(price) || price < 0 || !Number.isInteger(postage) || postage < 0) throw new Error('Prices are whole pence');
  const t = tierFor(s, price);
  const protection = clamp(divRound(price * t.protectionBp, 10000), s.protectionMinPence, s.protectionMaxPence);
  const processing = s.processingPence;
  const addOns = t.courierPence + t.hubPence;

  let commission = 0;
  let promotion = 0;
  if (input.boostBp !== null && s.boostOn && price >= s.boostMinPricePence) {
    const rate = clamp(input.boostBp, s.boostMinBp, s.boostMaxBp);
    commission = divRound(price * rate, 10000) + s.boostFixedPence;
    const buyerPays = payer === 'buyer';
    const coverable =
      (s.promotionCovers.protection && buyerPays ? protection : 0) +
      (s.promotionCovers.processing && buyerPays ? processing : 0) +
      (s.promotionCovers.addOns ? addOns : 0);
    promotion = Math.min(coverable, divRound(commission * s.promotionShareBp, 10000));
  }

  const buyerFees = payer === 'buyer' ? protection + processing : 0;
  const sellerFees = payer === 'seller' ? protection + processing : 0;
  return {
    feeVersion: s.version,
    tier: t.key,
    pricePence: price,
    postagePence: postage,
    protectionPence: protection,
    processingPence: processing,
    courierPence: t.courierPence,
    hubPence: t.hubPence,
    promotionPence: promotion,
    buyerTotalPence: price + postage + buyerFees + addOns - promotion,
    commissionPence: commission,
    sellerFeesPence: sellerFees,
    sellerPayoutPence: price - commission - sellerFees,
    payer,
  };
}

/** Reads settings stored in the database (snake_case JSON) into FeeSettings. */
export function feeSettingsFromJson(version: number, j: Record<string, unknown>): FeeSettings {
  const tiers = (j.tiers as Record<string, number | string>[]).map((t) => ({
    key: t.key as TierKey,
    fromPence: Number(t.from_pence),
    protectionBp: Number(t.protection_bp),
    courierPence: Number(t.courier_pence),
    hubPence: Number(t.hub_pence),
  }));
  const covers = j.promotion_covers as Record<string, boolean>;
  return {
    version,
    tiers,
    processingPence: Number(j.processing_pence),
    protectionMinPence: Number(j.protection_min_pence),
    protectionMaxPence: Number(j.protection_max_pence),
    boostOn: Boolean(j.boost_on),
    boostMinPricePence: Number(j.boost_min_price_pence),
    boostMinBp: Number(j.boost_min_bp),
    boostMaxBp: Number(j.boost_max_bp),
    boostFixedPence: Number(j.boost_fixed_pence),
    promotionShareBp: Number(j.promotion_share_bp),
    promotionCovers: { protection: Boolean(covers.protection), processing: Boolean(covers.processing), addOns: Boolean(covers.add_ons) },
    checkoutHoldMinutes: Number(j.checkout_hold_minutes),
  };
}

/** Reads a breakdown stored by the database (compute_fees / order_quote, snake_case) into FeeBreakdown. */
export function breakdownFromJson(j: Record<string, unknown> | null): FeeBreakdown | null {
  if (!j) return null;
  const n = (k: string) => Number(j[k] ?? 0);
  return {
    feeVersion: n('fee_version'),
    tier: j.tier as TierKey,
    pricePence: n('price_pence'),
    postagePence: n('postage_pence'),
    protectionPence: n('protection_pence'),
    processingPence: n('processing_pence'),
    courierPence: n('courier_pence'),
    hubPence: n('hub_pence'),
    promotionPence: n('promotion_pence'),
    buyerTotalPence: n('buyer_total_pence'),
    commissionPence: n('commission_pence'),
    sellerFeesPence: n('seller_fees_pence'),
    sellerPayoutPence: n('seller_payout_pence'),
    payer: (j.payer as 'buyer' | 'seller') ?? 'buyer',
  };
}

/** The lines a buyer sees, in order, leaving out anything that is zero. */
export function buyerLines(b: FeeBreakdown): { key: string; label: string; note: string; pence: number }[] {
  const lines = [
    { key: 'price', label: 'Item', note: '', pence: b.pricePence },
    { key: 'postage', label: 'Postage', note: 'Tracked delivery to your door.', pence: b.postagePence },
    ...(b.payer === 'buyer'
      ? [
          { key: 'protection', label: 'Buyer protection', note: 'Your money back if the item isn’t as described, backed by its custody record.', pence: b.protectionPence },
          { key: 'processing', label: 'Processing fee', note: 'Card and payment handling.', pence: b.processingPence },
        ]
      : []),
    { key: 'courier', label: 'Courier witness', note: 'A courier watches it packed and sealed, and checks the seal at your door.', pence: b.courierPence },
    { key: 'hub', label: 'Authentication check', note: 'Checked at our Verifier Hub before it reaches you.', pence: b.hubPence },
    { key: 'promotion', label: 'Seller’s promotion', note: 'The seller is paying part of your fees.', pence: -b.promotionPence },
  ];
  return lines.filter((l) => l.key === 'price' || l.pence !== 0);
}
