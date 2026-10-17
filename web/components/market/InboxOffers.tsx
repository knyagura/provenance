'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { formatPence } from '@/lib/format';
import type { Offer, OfferAction } from '@/lib/selling';
import { useMarketState } from './MarketState';

const until = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** Offers waiting for the member (to answer, or to pay for), shown at the top of the Inbox. */
export function InboxOffers() {
  const { backend } = useMember();
  const { refreshCounts } = useMarketState();
  const [offers, setOffers] = useState<Offer[] | null>(null);

  const load = useCallback(() => {
    backend.myOffers().then(setOffers).catch(() => setOffers([]));
  }, [backend]);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 20000);
    return () => clearInterval(t);
  }, [load]);

  if (!offers) return null;
  const mine = offers.filter((o) => {
    const theirMove = o.madeBy !== o.role;
    return (o.status === 'pending' && theirMove) || (o.status === 'accepted' && o.role === 'buyer') || (o.status === 'pending' && !theirMove);
  });
  if (!mine.length) return null;
  const ordered = [...mine].sort((a, b) => Number(b.madeBy !== b.role || b.status === 'accepted') - Number(a.madeBy !== a.role || a.status === 'accepted'));
  return (
    <section className="pv-section" aria-labelledby="offers-h">
      <h2 id="offers-h">Offers</h2>
      <ul className="pv-rows">
        {ordered.map((o) => (
          <OfferRow key={o.id} offer={o} onDone={() => { load(); refreshCounts(); }} />
        ))}
      </ul>
    </section>
  );
}

function OfferRow({ offer: o, onDone }: { offer: Offer; onDone: () => void }) {
  const { backend } = useMember();
  const id = useId();
  const [countering, setCountering] = useState(false);
  const [amount, setAmount] = useState(((o.amountPence + o.pricePence) / 200).toFixed(0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toAnswer = o.status === 'pending' && o.madeBy !== o.role;
  const other = o.role === 'buyer' ? o.seller : o.buyer;

  const act = async (action: OfferAction, pence?: number) => {
    setBusy(true);
    const r = await backend.respondOffer(o.id, action, pence);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onDone();
  };
  const counter = (e: FormEvent) => {
    e.preventDefault();
    const p = Math.round(Number(amount.replace(/[£,\s]/g, '')) * 100);
    if (!Number.isFinite(p) || p <= 0) return setError('Enter an amount in pounds.');
    void act('counter', p);
  };

  const line = o.status === 'accepted'
    ? `Accepted at ${formatPence(o.amountPence)}. Pay before ${until(o.expiresAt)}.`
    : toAnswer
      ? `${other} offered ${formatPence(o.amountPence)} (listed at ${formatPence(o.pricePence)}). Answer before ${until(o.expiresAt)}.`
      : `You offered ${formatPence(o.amountPence)}. Waiting for ${other}.`;

  return (
    <li className={`pv-row pv-row--offer${toAnswer || o.status === 'accepted' ? ' pv-row--turn' : ''}`}>
      <span className="pv-row__text">
        <span className="pv-row__top">
          <strong><Link href={`/item/${o.listingId}`}>{o.title}</Link></strong>
          <span className={`pv-status pv-status--${toAnswer || o.status === 'accepted' ? 'turn' : 'waiting'}`}>{o.status === 'accepted' ? 'Ready to buy' : toAnswer ? 'Your turn' : 'Offer sent'}</span>
        </span>
        <span className={toAnswer ? 'pv-turn-line' : 'pv-note'}>{line}</span>
        {countering ? (
          <form className="pv-offer__form" onSubmit={counter}>
            <div className="pv-field">
              <label htmlFor={`${id}-amt`}>Your amount (£)</label>
              <input id={`${id}-amt`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="pv-actions">
              <Button type="submit" variant="primary" disabled={busy}>Send</Button>
              <Button variant="quiet" onClick={() => setCountering(false)}>Cancel</Button>
            </div>
          </form>
        ) : null}
        {error ? <span className="pv-errors" role="alert">{error}</span> : null}
      </span>
      <span className="pv-actions pv-row__actions">
        {o.status === 'accepted' ? (
          <Link className="pv-btn pv-btn--primary" href={`/checkout/${o.listingId}?offer=${o.id}`}>Buy for {formatPence(o.amountPence)}</Link>
        ) : toAnswer && !countering ? (
          <>
            <Button variant="primary" disabled={busy} onClick={() => act('accept')}>Accept</Button>
            <Button disabled={busy} onClick={() => setCountering(true)}>Counter</Button>
            <Button variant="quiet" disabled={busy} onClick={() => act('decline')}>Decline</Button>
          </>
        ) : !toAnswer ? (
          <Button variant="quiet" disabled={busy} onClick={() => act('withdraw')}>Withdraw</Button>
        ) : null}
      </span>
    </li>
  );
}

/** Gifts someone sent the member, waiting to be followed and opened. */
export function InboxGifts() {
  const { backend } = useMember();
  const [gifts, setGifts] = useState<Awaited<ReturnType<typeof backend.myGifts>> | null>(null);
  useEffect(() => {
    backend.myGifts().then(setGifts).catch(() => setGifts([]));
  }, [backend]);
  if (!gifts?.length) return null;
  return (
    <section className="pv-section" aria-labelledby="gifts-h">
      <h2 id="gifts-h">Gifts for you</h2>
      <ul className="pv-rows">
        {gifts.map((g) => (
          <li key={g.orderId} className={`pv-row pv-row--offer${g.custodyState === 'confirmed' ? '' : ' pv-row--turn'}`}>
            <span className="pv-row__text"><strong>{g.title}</strong><span className="pv-note">From {g.from}</span></span>
            <Link className="pv-btn pv-btn--secondary" href={`/gift/${g.token}`} aria-label={`Open gift: ${g.title}`}>Open</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
