'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { EmptyState } from '@/components/EmptyState';
import { ListingCard } from '@/components/ui';
import { toCard } from '@/lib/domain/present';
import type { Listing } from '@/lib/domain/types';
import { useMarketState } from './MarketState';
import { SavedSearches } from './SavedSearches';

/** The member's saved items. Removing the heart takes an item off the list. */
export function SavedList() {
  const { member, loading, backend } = useMember();
  const { saved } = useMarketState();
  const [items, setItems] = useState<Listing[] | null>(null);
  useEffect(() => {
    if (member) backend.savedListings().then(setItems).catch(() => setItems([]));
  }, [member, backend]);

  if (loading) return <p role="status">Loading…</p>;
  if (!member) {
    return (
      <section className="pv-section">
        <h1>Saved</h1>
        <p className="pv-lead">Tap the heart on anything you like and it waits for you here, on every device.</p>
        <p><Link className="pv-btn pv-btn--primary" href="/signin?next=/saved">Sign in</Link></p>
      </section>
    );
  }
  if (!items) return <p role="status">Loading your saved items…</p>;
  const shown = items.filter((l) => saved.has(l.id));
  return (
    <>
    <section className="pv-section" aria-labelledby="saved-h">
      <h1 id="saved-h">Saved</h1>
      {shown.length ? (
        <ul className="pv-grid pv-grid--list" aria-label="Saved items">
          {shown.map((l) => (
            <li key={l.id}>
              <ListingCard {...toCard(l)} />
              {l.status !== 'active' ? <span className="pv-note">{l.status === 'sold' ? 'Sold' : 'Someone is buying this'}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState heading title="Nothing saved yet" note="Tap the heart on an item to keep it here." action={{ href: '/search', label: 'Start browsing' }} />
      )}
    </section>
    <SavedSearches />
    </>
  );
}
