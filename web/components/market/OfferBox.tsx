'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { formatPence } from '@/lib/format';
import type { Offer } from '@/lib/selling';

const MIN_PCT = 40;
const pounds = (pence: number) => (pence / 100).toFixed(2).replace(/\.00$/, '');
const parsePounds = (s: string) => Math.round(Number(s.replace(/[£,\s]/g, '')) * 100);
const until = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** "Make an offer" on an item page, and where the buyer's latest offer on it stands. */
export function OfferBox({ listingId, pricePence, available, sellerName }: { listingId: string; pricePence: number; available: boolean; sellerName: string }) {
  const { member, backend } = useMember();
  const id = useId();
  const [offer, setOffer] = useState<Offer | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(pounds(Math.round((pricePence * 0.85) / 100) * 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!member) return setOffer(null);
    const all = await backend.myOffers().catch(() => []);
    setOffer(all.find((o) => o.listingId === listingId && o.role === 'buyer') ?? null);
  }, [member, backend, listingId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!available) return <Button variant="secondary" block disabled>Make an offer</Button>;
  if (!member) return <Link className="pv-btn pv-btn--secondary pv-btn--block" href={`/signin?next=/item/${listingId}`}>Sign in to make an offer</Link>;
  if (offer === undefined) return null;
  if (member.username === sellerName) return null;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const p = parsePounds(amount);
    if (!Number.isFinite(p) || p <= 0) return setError('Enter an amount in pounds, like 42 or 42.50.');
    setBusy(true);
    const countering = offer?.status === 'pending' && offer.madeBy === 'seller';
    const r = countering ? await backend.respondOffer(offer.id, 'counter', p) : await backend.makeOffer(listingId, p);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    setOpen(false);
    setOffer(r.value);
  };
  const act = async (action: 'accept' | 'decline' | 'withdraw') => {
    if (!offer) return;
    setBusy(true);
    const r = await backend.respondOffer(offer.id, action);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setOffer(r.value);
  };

  const live = offer && ['pending', 'accepted'].includes(offer.status);
  return (
    <div className="pv-offer">
      {offer && live ? (
        <div className="pv-offer__status" role="status">
          {offer.status === 'accepted' ? (
            <>
              <strong>{offer.madeBy === 'buyer' ? `${sellerName} accepted your offer of ${formatPence(offer.amountPence)}` : `You accepted ${formatPence(offer.amountPence)}`}</strong>
              <span className="pv-note">Buy it at that price before {until(offer.expiresAt)}.</span>
              <Link className="pv-btn pv-btn--primary pv-btn--block" href={`/checkout/${listingId}?offer=${offer.id}`}>Buy for {formatPence(offer.amountPence)}</Link>
            </>
          ) : offer.madeBy === 'seller' ? (
            <>
              <strong>{sellerName} offered {formatPence(offer.amountPence)}</strong>
              <span className="pv-note">In reply to your offer. Answer before {until(offer.expiresAt)}.</span>
              <div className="pv-actions">
                <Button variant="primary" onClick={() => act('accept')} disabled={busy}>Accept {formatPence(offer.amountPence)}</Button>
                <Button onClick={() => act('decline')} disabled={busy}>Decline</Button>
                <Button variant="quiet" onClick={() => setOpen(true)} disabled={busy}>Offer another amount</Button>
              </div>
            </>
          ) : (
            <>
              <strong>You offered {formatPence(offer.amountPence)}</strong>
              <span className="pv-note">Waiting for {sellerName} to reply, until {until(offer.expiresAt)}.</span>
              <Button variant="quiet" onClick={() => act('withdraw')} disabled={busy}>Withdraw offer</Button>
            </>
          )}
        </div>
      ) : offer && offer.status !== 'used' ? (
        <p className="pv-note" role="status">Your last offer was {offer.status === 'declined' ? 'declined' : offer.status === 'expired' ? 'not answered in time' : offer.status === 'countered' ? 'answered with another amount' : 'withdrawn'}. You can make a new one.</p>
      ) : null}

      {!live || (offer?.madeBy === 'seller' && open) ? (
        open ? (
          <form className="pv-offer__form" onSubmit={send}>
            <div className="pv-field">
              <label htmlFor={`${id}-amt`}>Your offer (£)</label>
              <input id={`${id}-amt`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby={`${id}-help`} />
              <span id={`${id}-help`} className="pv-note">Listed at {formatPence(pricePence)}. Offers start at {formatPence(Math.ceil((pricePence * MIN_PCT) / 100))}. Fees are added at checkout on the agreed price.</span>
            </div>
            {error ? <p className="pv-errors" role="alert">{error}</p> : null}
            <div className="pv-actions">
              <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Sending…' : 'Send offer'}</Button>
              <Button variant="quiet" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" block onClick={() => setOpen(true)}>Make an offer</Button>
        )
      ) : null}
      {error && !open ? <p className="pv-errors" role="alert">{error}</p> : null}
    </div>
  );
}
