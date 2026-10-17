'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { TIER_LABEL } from '@/lib/domain/present';
import type { FeeBreakdown } from '@/lib/domain/fees';
import { listingChanges, type ListingVersion } from '@/lib/domain/versions';
import { formatPence } from '@/lib/format';
import type { CheckoutStarted, PaymentStart } from '@/lib/selling';
import { FeeLines } from './FeeLines';

// Stripe's script loads only when someone actually reaches the payment step.
import { CodesBox } from './CodesBox';
const StripePay = dynamic(() => import('./StripePay').then((m) => m.StripePay), { ssr: false, loading: () => <p role="status">Loading the payment form…</p> });

export interface CheckoutItem {
  id: string;
  title: string;
  seller: string;
  photoUrl: string | null;
  /** The version of the listing on the buyer's screen. */
  version: ListingVersion;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function CheckoutView({ item, offerId = null }: { item: CheckoutItem; offerId?: string | null }) {
  const { member, loading, backend } = useMember();
  const router = useRouter();
  const [quote, setQuote] = useState<FeeBreakdown | null | undefined>(undefined);
  const [started, setStarted] = useState<CheckoutStarted | null>(null);
  const [payment, setPayment] = useState<PaymentStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<ListingVersion>(item.version);
  const [changes, setChanges] = useState<{ now: ListingVersion; lines: string[] } | null>(null);

  const [offerPence, setOfferPence] = useState<number | null>(null);

  useEffect(() => {
    backend.quote(item.id).then(setQuote).catch(() => setQuote(null));
  }, [backend, item.id]);
  useEffect(() => {
    if (!offerId || !member) return;
    backend.myOffers().then((all) => {
      const o = all.find((x) => x.id === offerId && x.role === 'buyer' && x.status === 'accepted');
      if (o) setOfferPence(o.amountPence);
      else setError('This offer has ended or isn’t yours. You can still buy at the listed price, or make a new offer.');
    }).catch(() => {});
  }, [backend, offerId, member]);

  if (loading || quote === undefined) return <p role="status">Working out the price…</p>;

  const shown = started?.quote ?? quote;
  if (!shown) {
    return (
      <section className="pv-section pv-narrow">
        <h1>This item isn’t available</h1>
        <p className="pv-lead">It may have been sold, someone may be buying it right now, or the seller is away.</p>
        <p><Link href={`/item/${item.id}`}>Back to the item</Link></p>
      </section>
    );
  }

  async function begin() {
    setBusy(true);
    setError(null);
    const r = offerPence !== null && offerId ? await backend.startOfferCheckout(offerId) : await backend.startCheckout(item.id, version.revision);
    if (!r.ok) {
      if (r.code === 'listing_changed') {
        // The seller edited the listing since this page loaded. Nothing is held; show what changed.
        const now = await backend.listingNow(item.id);
        setQuote(await backend.quote(item.id).catch(() => null));
        setBusy(false);
        if (now) return setChanges({ now, lines: listingChanges(version, now) });
      }
      setBusy(false);
      return setError(r.message);
    }
    setStarted(r.value);
    const p = await backend.startPayment(r.value.orderId);
    setBusy(false);
    if (!p.ok) {
      if (p.code === 'not_configured') await backend.cancelCheckout(r.value.orderId);
      setStarted(null);
      return setError(p.message);
    }
    setPayment(p.value);
  }

  async function cancel() {
    if (started) await backend.cancelCheckout(started.orderId);
    router.push(`/item/${item.id}`);
  }

  const paid = () => router.push(`/orders/${started!.orderId}?paid=1`);

  return (
    <div className="pv-checkout">
      <header className="pv-section">
        <p className="pv-eyebrow">Checkout</p>
        <h1>{item.title}</h1>
        <p className="pv-note">Sold by {item.seller} · {TIER_LABEL[shown.tier]}</p>
      </header>

      <section className="pv-panel" aria-labelledby="buying-h">
        <h2 id="buying-h">What you’re buying</h2>
        <div className="pv-row pv-row--plain pv-buying">
          <span className="pv-row__thumb" aria-hidden="true">
            {version.media.find((m) => m.kind === 'photo') ? <img src={version.media.find((m) => m.kind === 'photo')!.path} alt="" /> : null}
          </span>
          <span className="pv-row__text">
            <strong>{version.title}</strong>
            <span className="pv-note">
              {[version.size ? `Size ${version.size}` : null, version.condition, version.brand, `${version.media.filter((m) => m.kind === 'photo').length || 'No'} photos`].filter(Boolean).join(' · ')}
            </span>
          </span>
        </div>
        <p className="pv-note">This is the listing as it is now. If the seller changes it before you pay, we’ll show you what changed first.</p>
      </section>

      <section className="pv-panel" aria-labelledby="pay-h">
        <h2 id="pay-h">What you pay</h2>
        {offerPence !== null && !started ? (
          <p className="pv-banner" role="note">
            <strong>Agreed price {formatPence(offerPence)}</strong> (listed at {formatPence(quote?.pricePence ?? 0)}). The same fees and hold apply, worked out on the agreed price; you’ll see the exact total before you pay.
          </p>
        ) : null}
        {offerPence !== null && !started ? null : <FeeLines quote={shown} />}
        <p className="pv-note">Fees version {shown.feeVersion}. The seller receives the item price; the fees pay for protection and the custody steps.</p>
      </section>

      {error ? <p className="pv-errors" role="alert">{error}</p> : null}

      {changes ? (
        <section className="pv-panel pv-changed" role="alert" aria-labelledby="changed-h">
          <h2 id="changed-h">The seller changed this listing</h2>
          <p>They updated it while you were looking, so nothing has been charged or held. What changed:</p>
          {changes.lines.length ? (
            <ul className="pv-list">{changes.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          ) : (
            <p className="pv-note">Small changes only; the price and photos are the same.</p>
          )}
          <div className="pv-actions">
            <button type="button" className="pv-btn pv-btn--primary" onClick={() => { setVersion(changes.now); setChanges(null); }}>
              Continue with the updated listing
            </button>
            <Link className="pv-btn pv-btn--secondary" href={`/item/${item.id}`}>Look at it again</Link>
          </div>
        </section>
      ) : !member ? (
        <section className="pv-panel">
          <p>Sign in to buy. Your basket isn’t held until you continue to payment.</p>
          <Link className="pv-btn pv-btn--primary pv-btn--block" href={`/signin?next=${encodeURIComponent(`/checkout/${item.id}`)}`}>Sign in to buy</Link>
        </section>
      ) : !started ? (
        <section className="pv-panel">
          <button type="button" className="pv-btn pv-btn--primary pv-btn--block" onClick={begin} disabled={busy}>
            {busy ? 'One moment…' : offerPence !== null ? `Continue at the agreed price · ${formatPence(offerPence)} + fees` : `Continue to payment · ${formatPence(shown.buyerTotalPence)}`}
          </button>
          <p className="pv-note">We hold the item for you while you pay.</p>
        </section>
      ) : (
        <section className="pv-panel" aria-labelledby="card-h">
          <h2 id="card-h">Payment</h2>
          <p className="pv-note" role="status">We’re holding this for you until {time(started.holdExpiresAt)}.</p>
          <CodesBox target={started.orderId} onChange={async (c) => {
            if (c.paid) return paid();
            setPayment(null);
            const p = await backend.startPayment(started.orderId);
            if (p.ok) setPayment(p.value);
            else setError(p.message);
          }} />
          {payment?.kind === 'stripe' ? (
            <StripePay clientSecret={payment.clientSecret} publishableKey={payment.publishableKey} amountPence={payment.amountPence} orderId={started.orderId} onPaid={paid} />
          ) : payment?.kind === 'simulated' ? (
            <>
              <p className="pv-banner" role="note"><strong>Test payment.</strong> This site is running on example data, so no card is needed and no money moves.</p>
              <button
                type="button" className="pv-btn pv-btn--primary pv-btn--block" disabled={busy}
                onClick={async () => { setBusy(true); const r = await backend.simulatePayment(started.orderId); setBusy(false); if (r.ok) paid(); else setError(r.message); }}
              >
                {`Pay ${formatPence(payment.amountPence)} (test)`}
              </button>
            </>
          ) : (
            <p role="status">Loading the payment form…</p>
          )}
          <button type="button" className="pv-btn pv-btn--quiet" onClick={cancel}>Cancel and release the item</button>
        </section>
      )}
    </div>
  );
}
