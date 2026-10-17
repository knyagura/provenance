import { ListingCard } from '@/components/ui';
import { toCard } from '@/lib/domain/present';
import type { Listing } from '@/lib/domain/types';
import { distanceText, milesBetween, type Point } from '@/lib/domain/places';

export function ListingGrid({ listings, label, near }: { listings: Listing[]; label: string; near?: Point }) {
  return (
    <ul className="pv-grid pv-grid--list" aria-label={label}>
      {listings.map((l) => (
        <li key={l.id}>
          <ListingCard {...toCard(l)} seller={near && l.seller.area ? `${l.seller.username} · ${l.seller.area.district}, ${distanceText(milesBetween(near, l.seller.area))}` : l.seller.username} />
        </li>
      ))}
    </ul>
  );
}
