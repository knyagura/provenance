'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { fitFor, BASKET_TONES } from '@/lib/domain/baskets';
import { BagIcon } from '@/components/ui/icons';
import { useBaskets } from './BasketsState';

/** "Add to…" on a card: the tap-to-add way into a basket (phones, keyboards), alongside drag and drop. */
export function AddToBasket({ listingId, title, size, category }: { listingId: string; title: string; size: string | null; category: string | null }) {
  const { data, enabled, baskets, placement, put } = useBaskets();
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  if (!data) return null;
  const here = placement.get(listingId);
  if (!enabled) {
    return (
      <div className="pv-addto">
        <button type="button" className={`pv-addto__btn${here ? ' pv-addto__btn--in' : ''}`} aria-pressed={!!here}
          aria-label={here ? `${title} is in your basket` : `Add ${title} to your basket`}
          onClick={() => (here ? undefined : void put(listingId, null, { size, category, title }))}>
          <BagIcon width={20} height={20} />
          {here ? <span className="pv-tag" aria-hidden="true">In basket</span> : null}
        </button>
      </div>
    );
  }
  return (
    <div className="pv-addto" ref={wrap}>
      <button type="button" className={`pv-addto__btn${here ? ' pv-addto__btn--in' : ''}`} aria-expanded={open} aria-controls={`${id}-menu`}
        aria-label={here ? `${title} is in ${here.name}’s basket. Move it` : `Add ${title} to a basket`} onClick={() => setOpen((o) => !o)}>
        <BagIcon width={20} height={20} />
        {here ? <span className={`pv-tag pv-tag--${BASKET_TONES[here.position]}`} aria-hidden="true">{here.name}</span> : null}
      </button>
      {open ? (
        <ul className="pv-addto__menu" id={`${id}-menu`} aria-label={`Add ${title} to`}>
          {baskets.map((b) => {
            const fit = fitFor(b, { size, category });
            return (
              <li key={b.id}>
                <button type="button" aria-current={here?.id === b.id ? 'true' : undefined} onClick={async () => { await put(listingId, b.general ? null : b.id, { size, category, title }); setOpen(false); }}>
                  <span className={`pv-dot pv-dot--${BASKET_TONES[b.position]}`} aria-hidden="true" />
                  {b.name}
                  {fit === 'fits' ? <span className="pv-note"> · their size</span> : fit === 'mismatch' ? <span className="pv-note pv-warn-text"> · not their size</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
