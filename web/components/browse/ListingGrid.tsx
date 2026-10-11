import { ListingCard } from '@/components/ui';
import { toCard } from '@/lib/domain/present';
import type { Listing } from '@/lib/domain/types';

export function ListingGrid({ listings, label }: { listings: Listing[]; label: string }) {
  return (
    <ul className="pv-grid pv-grid--list" aria-label={label}>
      {listings.map((l) => (
        <li key={l.id}>
          <ListingCard {...toCard(l)} />
        </li>
      ))}
    </ul>
  );
}
