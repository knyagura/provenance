'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import type { SavedSearch } from '@/lib/selling';

/** The search page address for a saved search. */
export function searchHref(s: Pick<SavedSearch, 'q' | 'category' | 'size' | 'condition' | 'minPence' | 'maxPence'>): string {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.category) p.set('category', s.category);
  if (s.size) p.set('size', s.size);
  if (s.condition) p.set('condition', s.condition);
  if (s.minPence !== null) p.set('min', String(s.minPence / 100));
  if (s.maxPence !== null) p.set('max', String(s.maxPence / 100));
  return `/search?${p.toString()}`;
}

/** Saved searches, each with its alert switch. */
export function SavedSearches() {
  const { backend } = useMember();
  const [list, setList] = useState<SavedSearch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    backend.mySavedSearches().then(setList).catch(() => setList([]));
  }, [backend]);
  if (!list) return null;
  const apply = (r: { ok: true; value: SavedSearch[] } | { ok: false; message: string }) => {
    if (r.ok) {
      setList(r.value);
      setError(null);
    } else setError(r.message);
  };
  return (
    <section className="pv-section" id="searches" aria-labelledby="searches-h">
      <h2 id="searches-h">Saved searches</h2>
      {list.length ? (
        <ul className="pv-rows">
          {list.map((s) => (
            <li key={s.id} className="pv-row pv-row--plain pv-row--search">
              <span className="pv-row__text">
                <Link href={searchHref(s)}><strong>{s.name}</strong></Link>
                <span className="pv-note">{s.liveCount === 1 ? '1 item for sale now' : `${s.liveCount} items for sale now`}</span>
              </span>
              <span className="pv-actions pv-row__actions">
                <label className="pv-check">
                  <input type="checkbox" checked={s.alert} onChange={async (e) => apply(await backend.setSearchAlert(s.id, e.target.checked))} />
                  Tell me about new matches
                </label>
                <Button variant="quiet" onClick={async () => apply(await backend.deleteSavedSearch(s.id))} aria-label={`Delete saved search ${s.name}`}>Delete</Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pv-note">No saved searches yet. Search for something, then choose <strong>Save this search</strong> and we’ll tell you when something new matches.</p>
      )}
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      <p className="pv-note">We also tell you when an item you saved drops in price.</p>
    </section>
  );
}
