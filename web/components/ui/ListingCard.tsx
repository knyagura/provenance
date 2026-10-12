'use client';

import { useState } from 'react';
import { formatPence } from '@/lib/format';
import type { Tier } from '@/lib/domain/types';
import { Badge } from './Badge';
import { TierBadge } from './TierBadge';
import { HeartIcon } from './icons';

export interface ListingCardProps {
  href: string;
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
}

export function ListingCard(props: ListingCardProps) {
  const { href, title, pricePence, details, seller, photoUrl, placeholder = 'blush', tier, boosted } = props;
  const [fav, setFav] = useState(Boolean(props.favourited));
  const toggle = () => {
    const next = !fav;
    setFav(next);
    props.onFavouriteChange?.(next);
  };
  return (
    <article className="pv-card">
      <div className="pv-card__photo" style={{ background: `var(--${placeholder})` }}>
        {photoUrl ? <img src={photoUrl} alt="" loading="lazy" /> : null}
        {tier ? <TierBadge tier={tier} /> : null}
        {boosted ? <span className="pv-card__boost"><Badge tone="boosted">Boosted</Badge></span> : null}
        <button
          type="button"
          className="pv-card__fav"
          aria-pressed={fav}
          aria-label={fav ? `Remove ${title} from favourites` : `Add ${title} to favourites`}
          onClick={toggle}
        >
          <HeartIcon filled={fav} />
        </button>
      </div>
      <a className="pv-card__link" href={href}>
        <span className="pv-card__price">{formatPence(pricePence)}</span>
        <span className="pv-card__meta">
          {title} · {details}
        </span>
      </a>
      <span className="pv-card__seller">{seller}</span>
    </article>
  );
}
