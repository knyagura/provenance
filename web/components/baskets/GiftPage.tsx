'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { CustodyPanel } from '@/components/custody/CustodyPanel';
import { Button } from '@/components/ui';
import type { GiftView } from '@/lib/domain/baskets';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** The gift link: the person a basket was for opens it, signs in, and checks the parcel themselves. No prices. */
export function GiftPage({ token }: { token: string }) {
  const { member, loading, backend } = useMember();
  const [g, setG] = useState<GiftView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    backend.giftView(token).then(setG).catch(() => setG(null));
  }, [backend, token, member]);

  if (loading || g === undefined) return <p role="status">Loading your gift…</p>;
  if (!g) return <section className="pv-section pv-narrow"><h1>This gift link isn’t working</h1><p className="pv-lead">Check you have the whole link, or ask the person who sent it.</p></section>;

  const claim = async () => {
    const r = await backend.claimGift(token);
    if (!r.ok) return setError(r.message);
    setError(null);
    setG(r.value);
  };

  return (
    <article className="pv-gift">
      <header className="pv-section">
        <p className="pv-eyebrow">A gift from {g.from}</p>
        <h1>{g.for ? `For ${g.for}` : 'Your gift'}</h1>
      </header>
      {g.message ? <blockquote className="pv-panel"><p className="pv-gift__message">“{g.message}”</p></blockquote> : null}
      <div className="pv-gift__card">
        {g.photo ? <img src={g.photo} alt="" /> : <span />}
        <div>
          <h2>{g.title}</h2>
          <p className="pv-note">{[g.snapshot.brand, g.snapshot.size ? `Size ${g.snapshot.size}` : null, g.snapshot.colour, g.snapshot.condition].filter(Boolean).join(' · ')}</p>
          {g.wrapped ? <p className="pv-note">It’s gift wrapped.</p> : null}
          {g.deliverBy ? <p className="pv-note">Due by {day(g.deliverBy)}.</p> : null}
        </div>
      </div>

      {!member ? (
        <section className="pv-panel">
          <p>Sign in or create a free account to follow your parcel and open it. Opening it on camera protects you if anything is wrong.</p>
          <Link className="pv-btn pv-btn--primary pv-btn--block" href={`/signin?next=/gift/${token}`}>Sign in to open your gift</Link>
        </section>
      ) : !g.orderId ? (
        <section className="pv-panel">
          {g.claimed ? <p>Someone has already opened this gift link.</p> : (
            <>
              <p>This gift will be linked to your account, {member.username}. Only you can then do the unboxing steps.</p>
              <Button variant="primary" block onClick={claim}>Open my gift</Button>
            </>
          )}
          {error ? <p className="pv-errors" role="alert">{error}</p> : null}
        </section>
      ) : (
        <CustodyPanel orderId={g.orderId} />
      )}

      {g.giftReceipt && g.paid ? (
        <section className="pv-panel" aria-labelledby="receipt-h">
          <h2 id="receipt-h">Gift receipt</h2>
          <p>{g.title}{g.itemId ? ` · Item ID ${g.itemId}` : ''}</p>
          <p className="pv-note">Bought on NuTuYu{g.soldOn ? ` on ${day(g.soldOn)}` : ''} by {g.from}. No prices are shown.</p>
          <Button variant="secondary" className="pv-noprint" onClick={() => window.print()}>Print the gift receipt</Button>
        </section>
      ) : null}
    </article>
  );
}
