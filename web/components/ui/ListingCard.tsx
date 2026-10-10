'use client';

import { useState } from 'react';
import { formatPence } from '@/lib/format';
import { Badge } from './Badge';
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
  verified?: boolean;
  boosted?: boolean;
  favourited?: boolean;
  onFavouriteChange?: (next: boolean) => void;
}

export function ListingCard(props: ListingCardProps) {
  const { href, title, pricePence, details, seller, photoUrl, placeholder = 'blush', verified, boosted } = props;
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
        {verified ? <Badge tone="verified">Verified</Badge> : boosted ? <Badge tone="boosted">Boosted</Badge> : null}
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
