'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatPence } from '@/lib/format';
import type { Draft } from '@/lib/selling';
import { VariantManager } from './VariantManager';
import { BackLink } from '@/components/ui/BackLink';

/** A published listing, seen by its seller: view it, or pause it to edit. Locked while being bought and once sold. */
export function LiveListing({ draft, onPause, onDelete }: { draft: Draft; onPause: () => Promise<string | null>; onDelete: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const example = draft.id.startsWith('example-');

  if (draft.status !== 'active') {
    const sold = draft.status === 'sold';
    return (
      <section className="pv-section pv-narrow">
        <BackLink fallback="/profile" label="Back to your listings" />
        <p className="pv-eyebrow">{sold ? 'Sold' : 'Being bought'}</p>
        <h1>{draft.title}</h1>
        <p className="pv-lead">
          {sold
            ? 'This item has been sold, so its listing is locked. The buyer’s order keeps a copy of exactly what they bought.'
            : 'Someone is paying for this item right now, so the listing is locked. If they don’t complete payment within 30 minutes it unlocks again.'}
        </p>
        <div className="pv-actions">
          {!example ? <Link className="pv-btn pv-btn--secondary" href={`/item/${draft.id}`}>View the listing</Link> : null}
          <Link className="pv-btn pv-btn--secondary" href="/profile">Your listings</Link>
        </div>
        {sold && !example ? <VariantManager listingId={draft.id} /> : null}
      </section>
    );
  }

  return (
    <section className="pv-section pv-narrow">
      <BackLink fallback="/profile" label="Back to your listings" />
      <p className="pv-eyebrow">Live{draft.revision > 1 ? ` · version ${draft.revision}` : ''}</p>
      <h1>{draft.title} is live</h1>
      <p className="pv-lead">
        Buyers can see it now{draft.pricePence ? ` at ${formatPence(draft.pricePence)}` : ''}. You can change anything, including the photos, until someone buys it.
      </p>
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      <div className="pv-actions">
        <button
          type="button" className="pv-btn pv-btn--primary" disabled={busy}
          onClick={async () => { setBusy(true); setError(await onPause()); setBusy(false); }}
        >
          {busy ? 'One moment…' : 'Edit listing'}
        </button>
        {example ? (
          <Link className="pv-btn pv-btn--secondary" href="/profile">See your listings</Link>
        ) : (
          <Link className="pv-btn pv-btn--secondary" href={`/item/${draft.id}`}>View your listing</Link>
        )}
        <Link className="pv-btn pv-btn--quiet" href="/sell">List another item</Link>
        {!example ? <button type="button" className="pv-btn pv-btn--quiet" disabled={busy || deleting} onClick={async () => {
          if (!window.confirm('Delete this listing? This cannot be undone. Listings with an active sale, a completed sale or dispute history cannot be deleted.')) return;
          setDeleting(true); const message = await onDelete(); setDeleting(false); if (message) setError(message);
        }}>{deleting ? 'Deleting…' : 'Delete listing'}</button> : null}
      </div>
      <p className="pv-note">
        Editing takes the item off sale until you publish your changes. Anyone part-way through buying it is shown what changed and
        asked to confirm before they pay.
      </p>
      {!example ? <VariantManager listingId={draft.id} /> : null}
    </section>
  );
}
