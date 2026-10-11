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
    title: l.title,
    pricePence: l.pricePence,
    details: cardDetails(l),
    seller: l.seller.username,
    photoUrl: photo?.url,
    placeholder: placeholderFor(l.id),
    verified: l.seller.verified,
  };
}

export const TIER_LABEL: Record<Tier, string> = {
  enhanced: 'Standard evidence',
  verified: 'Courier witnessed',
  luxury: 'Courier witnessed, with seal',
  ultraLuxury: 'Specialist checked',
};

export function categoryName(categories: Category[], slug: string | null | undefined): string | undefined {
  return slug ? categories.find((c) => c.slug === slug)?.name : undefined;
}

/** "Results for “barbour” in Men", "Men", "Everything". */
export function resultsHeading(q: string | undefined, category: string | undefined): string {
  if (q && category) return `“${q}” in ${category}`;
  if (q) return `Results for “${q}”`;
  return category ?? 'Everything for sale';
}
