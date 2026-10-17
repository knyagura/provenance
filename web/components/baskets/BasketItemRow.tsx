'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { BASKET_TONES, fitNote, type Basket, type BasketItem } from '@/lib/domain/baskets';
import { formatPence } from '@/lib/format';
import { DRAG_TYPE, useBaskets } from './BasketsState';

/** One item in a basket: its person's tag (with a menu to move it), size warning, wrapping and remove. */
export function BasketItemRow({ item, basket, showTag }: { item: BasketItem; basket: Basket; showTag: boolean }) {
  const { backend } = useMember();
  const { baskets, enabled, put, run, data } = useBaskets();
  const id = useId();
  const warn = fitNote(basket, item);
  const canWrap = !basket.general && !!basket.wrapStyle;
  return (
    <li
      className={`pv-bitem${item.available ? '' : ' pv-bitem--gone'}`}
      draggable={enabled || undefined}
      onDragStart={enabled ? (e) => e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ listingId: item.listingId, title: item.title, size: item.size, category: item.category })) : undefined}
    >
      <span className="pv-bitem__thumb" aria-hidden="true">{item.photoUrl ? <img src={item.photoUrl} alt="" /> : null}</span>
      <div className="pv-bitem__body">
        <div className="pv-bitem__top">
          <Link href={`/item/${item.listingId}`}><strong>{item.title}</strong></Link>
          <span>{formatPence(item.pricePence)}</span>
        </div>
        <span className="pv-note">
          {[item.size ? `Size ${item.size}` : null, item.seller, item.postagePence ? `+ ${formatPence(item.postagePence)} postage` : 'Free postage'].filter(Boolean).join(' · ')}
        </span>
        {!item.available ? <span className="pv-warn-text">No longer available. It won’t be included at checkout.</span> : null}
        {warn ? <span className="pv-warn-text" role="note">{warn}</span> : null}
        <div className="pv-bitem__controls">
          {showTag ? <span className={`pv-tag pv-tag--${BASKET_TONES[basket.position]}`}>{basket.name}</span> : null}
          {enabled ? (
            <>
              <label htmlFor={`${id}-for`} className="pv-visually-hidden">Who {item.title} is for</label>
              <select id={`${id}-for`} value={basket.id} onChange={(e) => {
                const to = baskets.find((b) => b.id === e.target.value)!;
                void put(item.listingId, to.general ? null : to.id, item);
              }}>
                {baskets.map((b) => <option key={b.id} value={b.id}>{b.general ? 'General (no one yet)' : `For ${b.name}`}</option>)}
              </select>
            </>
          ) : null}
          {canWrap ? (
            <label className="pv-check">
              <input type="checkbox" checked={item.wrap} onChange={(e) => void run(() => backend.basketSetWrap(item.listingId, e.target.checked), e.target.checked ? `${item.title} will be wrapped.` : `${item.title} won’t be wrapped.`)} />
              Wrap it{data && !data.wrappingLive ? ' (arrives soon)' : ''}
            </label>
          ) : null}
          <Button variant="quiet" onClick={() => void run(() => backend.basketRemove(item.listingId), `${item.title} removed.`)} aria-label={`Remove ${item.title}`}>Remove</Button>
        </div>
      </div>
    </li>
  );
}
