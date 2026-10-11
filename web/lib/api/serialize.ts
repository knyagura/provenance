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
    price_pence: l.pricePence,
    shipping_pence: l.shippingPence,
    currency: 'GBP',
    tier: l.tier,
    status: l.status,
    media: l.media.map((m) => ({ url: m.url, kind: m.kind, shot: m.shot })),
    seller: { username: l.seller.username, verified: l.seller.verified, business: l.seller.business },
    created_at: l.createdAt,
  };
}

export function categoryJson(c: Category) {
  return { slug: c.slug, name: c.name, parent: c.parentSlug };
}
