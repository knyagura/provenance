'use client';

import Link from 'next/link';
import { Button } from '@/components/ui';
import { useMember } from '@/components/auth/MemberProvider';
import { BASKET_TONES, fitNote } from '@/lib/domain/baskets';
import { useBaskets } from './BasketsState';

/** On an item page: add it to the basket, or to a person's basket when shopping for several people. */
export function ItemBasketButton({ listingId, title, size, category }: { listingId: string; title: string; size: string | null; category: string | null }) {
  const { member } = useMember();
  const { data, enabled, baskets, placement, put } = useBaskets();
  if (!member) return <Link className="pv-btn pv-btn--secondary pv-btn--block" href={`/signin?next=/item/${listingId}`}>Sign in to add to your basket</Link>;
  if (!data) return null;
  const here = placement.get(listingId);
  if (!enabled) {
    return here
      ? <Link className="pv-btn pv-btn--secondary pv-btn--block" href="/basket">In your basket · view</Link>
      : <Button variant="secondary" block onClick={() => void put(listingId, null, { size, category, title })}>Add to basket</Button>;
  }
  return (
    <fieldset className="pv-field pv-item__baskets">
      <legend>{here ? `In ${here.general ? 'General' : `${here.name}’s basket`}. Move to:` : 'Add to a basket'}</legend>
      <div className="pv-chips">
        {baskets.map((b) => {
          const warn = fitNote(b, { size, category });
          return (
            <button key={b.id} type="button" className="pv-chip" aria-pressed={here?.id === b.id} onClick={() => void put(listingId, b.general ? null : b.id, { size, category, title })}
              aria-describedby={warn ? `fit-${b.id}` : undefined}>
              <span className={`pv-dot pv-dot--${BASKET_TONES[b.position]}`} aria-hidden="true" />{b.name}
              {warn ? <span id={`fit-${b.id}`} className="pv-visually-hidden">{warn}</span> : null}
              {warn ? <span className="pv-warn-text" aria-hidden="true">!</span> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
