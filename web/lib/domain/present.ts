import type { ListingCardProps } from '@/components/ui';
import type { Category, Listing, Tier } from './types';

// Turning domain records into what the screens show. Pure, unit-tested.

const FILLS: NonNullable<ListingCardProps['placeholder']>[] = ['blush', 'sage', 'peach', 'surface-sand'];

/** A stable placeholder colour per listing, so a card doesn't change colour between visits. */
export function placeholderFor(id: string): NonNullable<ListingCardProps['placeholder']> {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FILLS[h % FILLS.length];
}

export function cardDetails(l: Listing): string {
  return [l.size ?? l.brand, l.condition].filter(Boolean).join(' · ');
}

export function toCard(l: Listing): ListingCardProps {
  const photo = l.media.find((m) => m.kind === 'photo');
  return {
    href: `/item/${l.id}`,
    listingId: l.id,
    title: l.title,
    pricePence: l.pricePence,
    details: cardDetails(l),
    seller: l.seller.username,
    photoUrl: photo?.url,
    placeholder: placeholderFor(l.id),
    tier: l.tier,
    size: l.size,
    category: l.category,
    boosted: l.boosted,
  };
}

/** Clear, customer-friendly names for each level of protection. */
export const TIER_LABEL: Record<Tier, string> = {
  enhanced: 'Photos and tracking',
  verified: 'Courier handover check',
  luxury: 'Specialist checked',
  ultraLuxury: 'Two specialist checks',
};

/** Plain-language explanation of the checks included at each price level. */
export const TIER_NOTE: Record<Tier, string> = {
  enhanced: 'Photos are taken when the item is listed and packed, then it is sent with tracking.',
  verified: 'For items listed at £75 or more, we record the parcel being handed over and opened, with a courier present.',
  luxury: 'For items listed at £500 or more, a specialist also checks the item before it continues to you.',
  ultraLuxury: 'For items listed at £1,500 or more, two independent specialists check the item before it continues to you.',
};

/** The price each level starts at, in pence. */
export const TIER_FROM: Record<Tier, number> = { enhanced: 0, verified: 7500, luxury: 50000, ultraLuxury: 150000 };

const SHOT_LABEL: Record<string, string> = {
  front: 'Front', back: 'Back', label: 'Label', detail: 'Close-up', wear: 'Wear and marks', working: 'Working',
};

/** "Front", "Close-up"… for a photo's shot key; unknown keys are tidied ("serial_plate" → "Serial plate"). */
export function shotLabel(shot: string | null | undefined): string | null {
  if (!shot) return null;
  return SHOT_LABEL[shot] ?? shot.charAt(0).toUpperCase() + shot.slice(1).replace(/[_-]+/g, ' ');
}

export function categoryName(categories: Category[], slug: string | null | undefined): string | undefined {
  return slug ? categories.find((c) => c.slug === slug)?.name : undefined;
}

/** "Results for “barbour” in Men", "Men", "Everything". */
export function resultsHeading(q: string | undefined, category: string | undefined): string {
  if (q && category) return `“${q}” in ${category}`;
  if (q) return `Results for “${q}”`;
  return category ?? 'Everything for sale';
}

/** "12 items", or "Showing 25–48" when there are more pages. */
export function countText(offset: number, shown: number, more: boolean): string {
  if (shown === 0) return 'No items found';
  if (offset === 0 && !more) return shown === 1 ? '1 item' : `${shown} items`;
  return `Showing ${offset + 1}–${offset + shown}`;
}
