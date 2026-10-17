'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import type { SearchToSave } from '@/lib/selling';
import { formatPence } from '@/lib/format';

/** A short name for a search: "Barbour jacket · women · size 10 · under £60". */
export function searchName(s: SearchToSave, categoryName?: string | null): string {
  const bits = [
    s.q?.trim() || null,
    categoryName ?? s.category ?? null,
    s.size ? `size ${s.size}` : null,
    s.condition ?? null,
    s.minPence !== undefined && s.maxPence !== undefined ? `${formatPence(s.minPence)}–${formatPence(s.maxPence)}`
      : s.maxPence !== undefined ? `under ${formatPence(s.maxPence)}` : s.minPence !== undefined ? `over ${formatPence(s.minPence)}` : null,
  ].filter(Boolean);
  return (bits.join(' · ') || 'Saved search').slice(0, 80);
}

/** "Save this search": we tell the member when something new matches it. */
export function SaveSearch({ search, categoryName, here }: { search: SearchToSave; categoryName: string | null; here: string }) {
  const { member, backend } = useMember();
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const empty = !search.q && !search.category && !search.size && !search.condition && search.minPence === undefined && search.maxPence === undefined;
  if (empty) return null;
  if (!member) {
    return <Link className="pv-btn pv-btn--quiet" href={`/signin?next=${encodeURIComponent(here)}`}>Sign in to save this search</Link>;
  }
  if (state === 'saved') {
    return <p className="pv-note" role="status">Saved. We’ll tell you when something new matches. <Link href="/saved#searches">Your searches</Link></p>;
  }
  return (
    <span className="pv-save-search">
      <Button variant="secondary" disabled={state === 'busy'} onClick={async () => {
        setState('busy');
        const r = await backend.saveSearch(searchName(search, categoryName), search);
        if (!r.ok) {
          setError(r.message);
          setState('idle');
        } else setState('saved');
      }}>
        {state === 'busy' ? 'Saving…' : 'Save this search'}
      </Button>
      {error ? <span className="pv-errors" role="alert">{error}</span> : null}
    </span>
  );
}
