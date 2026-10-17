'use client';

import { photo, SIZES, THUMB_WIDTHS } from '@/lib/images';
import { useState } from 'react';
import { useMarketState } from '@/components/market/MarketState';
import { AddToBasket } from '@/components/baskets/AddToBasket';
import { DRAG_TYPE, useBaskets } from '@/components/baskets/BasketsState';
import { fitFor, fitNote } from '@/lib/domain/baskets';
import { formatPence } from '@/lib/format';
import type { Tier } from '@/lib/domain/types';
import { Badge } from './Badge';
import { TierBadge } from './TierBadge';
import { HeartIcon } from './icons';

export interface ListingCardProps {
  href: string;
  /** When set, the heart saves to the member's favourites. */
  listingId?: string;
  title: string;
  pricePence: number;
  /** e.g. "M · Very good" */
  details: string;
  seller: string;
  photoUrl?: string;
  /** Placeholder fill while there is no photo: a design token name. */
  placeholder?: 'blush' | 'sage' | 'peach' | 'surface-sand';
  /** The protection level shown on the photo. */
  tier?: Tier;
  boosted?: boolean;
  favourited?: boolean;
  onFavouriteChange?: (next: boolean) => void;
  /** For multi-basket shopping: the size label and category, to match a person's sizes. */
  size?: string | null;
  category?: string | null;
}

export function ListingCard(props: ListingCardProps) {
  const { href, title, pricePence, details, seller, photoUrl, placeholder = 'blush', tier, boosted } = props;
  const market = useMarketState();
  const baskets = useBaskets();
  const fit = baskets.focus ? fitFor(baskets.focus, { size: props.size ?? null, category: props.category ?? null }) : 'unknown';
  const draggable = baskets.enabled && !!props.listingId;
  const [localFav, setLocalFav] = useState(Boolean(props.favourited));
  const fav = props.listingId ? market.saved.has(props.listingId) : localFav;
  const toggle = () => {
    if (props.listingId) return void market.toggleSaved(props.listingId);
    const next = !localFav;
    setLocalFav(next);
    props.onFavouriteChange?.(next);
  };
  return (
    <article
      className={`pv-card${fit === 'mismatch' ? ' pv-card--mismatch' : ''}`}
      hidden={fit === 'mismatch' && baskets.onlyFits ? true : undefined}
      draggable={draggable || undefined}
      onDragStart={draggable ? (e) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ listingId: props.listingId, title, size: props.size ?? null, category: props.category ?? null }));
        e.dataTransfer.effectAllowed = 'copyMove';
      } : undefined}
    >
      <div className="pv-card__photo" style={{ background: `var(--${placeholder})` }}>
        {photoUrl ? <img {...photo(photoUrl, SIZES.card)} alt="" loading="lazy" decoding="async" /> : null}
        {tier ? <TierBadge tier={tier} /> : null}
        {boosted ? <span className="pv-card__boost"><Badge tone="boosted">Boosted</Badge></span> : null}
        <button
          type="button"
          className="pv-card__fav"
          aria-pressed={fav}
          aria-label={fav ? `Remove ${title} from saved items` : `Save ${title}`}
          onClick={toggle}
        >
          <HeartIcon filled={fav} />
        </button>
        {props.listingId ? <AddToBasket listingId={props.listingId} title={title} size={props.size ?? null} category={props.category ?? null} /> : null}
      </div>
      <a className="pv-card__link" href={href}>
        <span className="pv-card__price">{formatPence(pricePence)}</span>
        <span className="pv-card__meta">
          {title} · {details}
        </span>
      </a>
      <span className="pv-card__seller">{seller}</span>
      {fit === 'mismatch' && baskets.focus ? <span className="pv-card__fit pv-warn-text">{fitNote(baskets.focus, { size: props.size ?? null, category: props.category ?? null })}</span> : null}
      {fit === 'fits' && baskets.focus ? <span className="pv-card__fit pv-note">{baskets.focus.name}’s size</span> : null}
    </article>
  );
}
