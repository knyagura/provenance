import type { FeeBreakdown } from '@/lib/domain/fees';
import type { Category, Listing } from '@/lib/domain/types';

// API v1 field names (snake_case, money in pence). Changing a name here breaks partners: add, never rename.

export function listingJson(l: Listing, siteUrl: string) {
  return {
    id: l.id,
    item_id: l.itemId,
    url: `${siteUrl}/item/${l.id}`,
    title: l.title,
    description: l.description,
    brand: l.brand,
    category: l.category,
    size: l.size,
    colour: l.colour,
    condition: l.condition,
    serial_hint: l.serialHint,
    price_pence: l.pricePence,
    shipping_pence: l.shippingPence,
    currency: 'GBP',
    tier: l.tier,
    status: l.status,
    revision: l.revision,
    media: l.media.map((m) => ({ url: m.url, kind: m.kind, shot: m.shot })),
    seller: { username: l.seller.username, verified: l.seller.verified, business: l.seller.business, away: l.seller.away },
    created_at: l.createdAt,
  };
}

export function categoryJson(c: Category) {
  return { slug: c.slug, name: c.name, parent: c.parentSlug };
}

export function quoteJson(listingId: string, q: FeeBreakdown) {
  return {
    listing_id: listingId,
    currency: 'GBP',
    fee_version: q.feeVersion,
    tier: q.tier,
    price_pence: q.pricePence,
    postage_pence: q.postagePence,
    protection_pence: q.payer === 'buyer' ? q.protectionPence : 0,
    processing_pence: q.payer === 'buyer' ? q.processingPence : 0,
    courier_witness_pence: q.courierPence,
    authentication_pence: q.hubPence,
    promotion_pence: q.promotionPence,
    total_pence: q.buyerTotalPence,
  };
}
