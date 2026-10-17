'use client';

import { useMarketState } from './MarketState';

/** The number of things waiting for the member, on the Inbox tab and link. Hidden at zero. */
export function InboxBadge() {
  const { attention } = useMarketState();
  if (!attention) return null;
  return (
    <span className="pv-count">
      <span aria-hidden="true">{attention > 99 ? '99+' : attention}</span>
      <span className="pv-visually-hidden">, {attention} waiting for you</span>
    </span>
  );
}
