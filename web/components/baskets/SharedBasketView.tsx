'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import type { SharedBasket } from '@/lib/domain/baskets';
import { formatPence } from '@/lib/format';

/** A basket someone shared: their sizes, notes and the items in it. Never the budget, address or owner. */
export function SharedBasketView({ token }: { token: string }) {
  const { backend } = useMember();
  const [b, setB] = useState<SharedBasket | null | undefined>(undefined);
  useEffect(() => {
    backend.sharedBasket(token).then(setB).catch(() => setB(null));
  }, [backend, token]);
  if (b === undefined) return <p role="status">Loading…</p>;
  if (!b) return <section className="pv-section pv-narrow"><h1>This link isn’t working</h1><p className="pv-lead">The basket may no longer be shared.</p></section>;
  const sizes = Object.entries(b.sizes).map(([k, v]) => `${k} ${v}`).join(' · ');
  return (
    <section className="pv-section pv-baskets">
      <p className="pv-eyebrow">Shared basket</p>
      <h1>For {b.name}</h1>
      {sizes ? <p className="pv-note">Sizes: {sizes}</p> : null}
      {b.styleNotes ? <p className="pv-note">Notes: {b.styleNotes}</p> : null}
      <ul className="pv-rows">
        {b.items.map((i) => (
          <li key={i.listingId} className="pv-bitem">
            <span className="pv-bitem__thumb" aria-hidden="true">{i.photoUrl ? <img src={i.photoUrl} alt="" /> : null}</span>
            <div className="pv-bitem__body">
              <Link href={`/item/${i.listingId}`}><strong>{i.title}</strong></Link>
              <span className="pv-note">{[i.size ? `Size ${i.size}` : null, formatPence(i.pricePence)].filter(Boolean).join(' · ')}</span>
            </div>
          </li>
        ))}
      </ul>
      {!b.items.length ? <p className="pv-note">Nothing in it yet.</p> : null}
    </section>
  );
}
