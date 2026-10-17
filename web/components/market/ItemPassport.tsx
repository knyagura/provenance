'use client';

import { photo, SIZES, THUMB_WIDTHS } from '@/lib/images';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Badge, Button, TierBadge } from '@/components/ui';
import { ACTOR_LABEL, stepTitle, type Actor } from '@/lib/domain/custody';
import { TIER_LABEL } from '@/lib/domain/present';
import type { Passport } from '@/lib/selling';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const STATE: Record<Passport['sales'][number]['state'], string> = {
  confirmed: 'Complete', in_progress: 'On its way', on_hold: 'On hold while a problem is checked', refunded: 'Refunded', not_started: 'Paid, not yet sent',
};

/**
 * What NuTuYu can show anyone about an item: photos, protection level, each completed step and its date,
 * whether seals matched, and whether the record still verifies. Never names, codes, weights, videos or tracking.
 */
export function ItemPassport({ listingId }: { listingId: string }) {
  const { backend } = useMember();
  const [p, setP] = useState<Passport | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    backend.passport(listingId).then(setP).catch(() => setP(null));
  }, [backend, listingId]);

  if (p === undefined) return <p role="status">Loading the passport…</p>;
  if (!p) {
    return (
      <section className="pv-section pv-narrow">
        <h1>No passport for this item</h1>
        <p className="pv-lead">It may not be published, or the link is wrong.</p>
        <p><Link href="/search">Browse items</Link></p>
      </section>
    );
  }

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: `${p.title}: Item Passport`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      }
    } catch {
      /* the person closed the share sheet */
    }
  };

  return (
    <article className="pv-passport">
      <header className="pv-section">
        <p className="pv-eyebrow">Item Passport</p>
        <h1>{p.title}</h1>
        <p className="pv-note">{[p.brand, p.category, p.condition, `Listed ${day(p.listed)}`].filter(Boolean).join(' · ')}</p>
        <div className="pv-actions">
          <TierBadge tier={p.tier} size="large" />
          {p.itemId ? <span className="pv-note pv-mono">Item ID {p.itemId}</span> : null}
        </div>
        <div className="pv-actions">
          <Button variant="secondary" onClick={share}>Share this passport</Button>
          <Link className="pv-btn pv-btn--quiet" href={`/item/${p.listingId}`}>{p.status === 'active' ? 'See the listing' : 'See the item'}</Link>
          {copied ? <span className="pv-note" role="status">Link copied.</span> : null}
        </div>
      </header>

      {p.photos.length ? (
        <section className="pv-section" aria-labelledby="pp-photos">
          <h2 id="pp-photos">Listing photos</h2>
          <ul className="pv-passport__photos">
            {p.photos.map((ph, i) => <li key={ph.url}><img {...photo(ph.url, SIZES.card)} decoding="async" alt={`${p.title}, photo ${i + 1}`} loading="lazy" /></li>)}
          </ul>
        </section>
      ) : null}

      <section className="pv-section" aria-labelledby="pp-history">
        <h2 id="pp-history">History</h2>
        {p.sales.length ? (
          p.sales.map((s, i) => (
            <div key={i} className="pv-panel pv-passport__sale">
              <div className="pv-row__top">
                <h3 className="pv-h3">Sold {day(s.sold)} · {TIER_LABEL[s.tier]}</h3>
                <Badge tone={s.state === 'confirmed' ? 'verified' : 'neutral'}>{STATE[s.state]}</Badge>
              </div>
              <p className={s.chainOk ? 'pv-note' : 'pv-banner pv-banner--warn'} role={s.chainOk ? undefined : 'alert'}>
                {s.chainOk ? 'The record verifies: no step has been changed or removed since it was recorded.' : 'This record no longer verifies. NuTuYu staff have been told.'}
              </p>
              {s.steps.length ? (
                <ol className="pv-passport__steps">
                  {s.steps.map((st, j) => (
                    <li key={j}>
                      <strong>{stepTitle(st.step)}</strong>
                      <span className="pv-note">
                        {[ACTOR_LABEL[st.actorRole as Actor] ?? (st.actorRole === 'staff' ? 'NuTuYu staff' : st.actorRole), day(st.date),
                          st.sealMatch === true ? 'Seal matched' : st.sealMatch === false ? 'Seal did not match' : null,
                          st.result === 'pass' ? 'Passed' : st.result === 'fail' ? 'Did not pass' : null,
                          st.photo ? 'Photo on file' : null].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : <p className="pv-note">No steps recorded yet.</p>}
            </div>
          ))
        ) : (
          <p className="pv-note">Not sold on NuTuYu yet. Each sale’s handover steps are added here as they happen.</p>
        )}
      </section>
      <p className="pv-note">Names, codes, weights, videos and tracking numbers are kept private. They’re only shared with the buyer, seller and NuTuYu staff on that order.</p>
    </article>
  );
}
