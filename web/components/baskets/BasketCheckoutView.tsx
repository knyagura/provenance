'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { BASKET_TONES, everything, wrapCharge, type BasketCheckout } from '@/lib/domain/baskets';
import { formatPence } from '@/lib/format';
import type { PaymentStart } from '@/lib/selling';
import { useBaskets } from './BasketsState';

const StripePay = dynamic(() => import('@/components/checkout/StripePay').then((m) => m.StripePay), { ssr: false, loading: () => <p role="status">Loading the payment form…</p> });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** One payment for every basket. Asks first whether to send everything to the buyer or each basket to its person. */
export function BasketCheckoutView({ groupId, paid }: { groupId: string | null; paid: boolean }) {
  const { member, loading, backend } = useMember();
  const { data, baskets, enabled, reload } = useBaskets();
  const router = useRouter();
  const [shipping, setShipping] = useState<'combined' | 'separate'>('combined');
  const [group, setGroup] = useState<BasketCheckout | null>(null);
  const [payment, setPayment] = useState<PaymentStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId || !member) return;
    backend.basketCheckout(groupId).then(setGroup).catch(() => setGroup(null));
  }, [groupId, member, backend]);

  if (loading || (member && !data)) return <p role="status">Loading…</p>;
  if (!member) return <p><Link className="pv-btn pv-btn--primary" href="/signin?next=/basket/checkout">Sign in to check out</Link></p>;

  if (group?.paymentStatus === 'paid' || paid) return <Paid group={group} />;

  const lines = everything(data!).filter((l) => l.item.available);
  const people = baskets.filter((b) => !b.general && b.items.some((i) => i.available));
  const wrap = wrapCharge(data!);
  const needsAddress = shipping === 'separate' ? people.filter((b) => !b.recipientAddress) : [];

  const begin = async () => {
    setBusy(true);
    setError(null);
    const r = await backend.startBasketCheckout(enabled && people.length ? shipping : 'combined');
    if (!r.ok) {
      setBusy(false);
      return setError(r.message);
    }
    setGroup(r.value);
    router.replace(`/basket/checkout?group=${r.value.groupId}`);
    const p = await backend.startGroupPayment(r.value.groupId);
    setBusy(false);
    if (!p.ok) {
      if (p.code === 'not_configured') await backend.cancelBasketCheckout(r.value.groupId);
      setGroup(null);
      return setError(p.message);
    }
    setPayment(p.value);
  };
  const cancel = async () => {
    if (group) await backend.cancelBasketCheckout(group.groupId);
    setGroup(null);
    setPayment(null);
    router.replace('/basket');
  };
  const done = () => {
    reload();
    router.replace(`/basket/checkout?group=${group!.groupId}&paid=1`);
  };

  if (!lines.length && !group) {
    return (
      <section className="pv-section pv-narrow">
        <h1>Nothing to check out</h1>
        <p className="pv-lead">Your baskets are empty, or the items have sold.</p>
        <p><Link href="/basket">Back to your basket</Link></p>
      </section>
    );
  }

  return (
    <div className="pv-checkout pv-baskets">
      <header className="pv-section">
        <p className="pv-eyebrow">Checkout</p>
        <h1>{enabled && people.length ? 'All your baskets, one payment' : 'Your basket'}</h1>
      </header>

      {!group && enabled && people.length ? (
        <fieldset className="pv-panel pv-ship">
          <legend><h2 className="pv-h3">How should we send them?</h2></legend>
          <label>
            <input type="radio" name="ship" checked={shipping === 'combined'} onChange={() => setShipping('combined')} />
            <span><strong>Send everything to me</strong><br /><span className="pv-note">You hand the gifts over. Items from different sellers still arrive as separate parcels.</span></span>
          </label>
          <label>
            <input type="radio" name="ship" checked={shipping === 'separate'} onChange={() => setShipping('separate')} />
            <span><strong>Send each person’s basket to them</strong><br /><span className="pv-note">Each person gets a gift link to open and check their parcel themselves, without seeing prices. General items come to you.</span></span>
          </label>
          {needsAddress.length ? (
            <p className="pv-banner pv-banner--warn" role="alert">
              Add an address for {needsAddress.map((b) => b.name).join(' and ')} in <Link href="/basket">their basket</Link>, or send everything to you.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <section className="pv-panel" aria-labelledby="ck-items">
        <h2 id="ck-items">What you’re buying</h2>
        {(group ? group.orders.map((o) => ({ key: o.orderId, title: o.title, who: o.basket, amount: o.totalPence, wrap: o.wrap, note: [o.discountNote, o.shipTo ? `To ${o.shipTo.name}, ${o.shipTo.postcode}` : null].filter(Boolean).join(' · ') || null }))
          : lines.map((l) => ({ key: l.item.listingId, title: l.item.title, who: l.basket.general ? null : l.basket.name, amount: l.item.pricePence + l.item.postagePence, wrap: l.item.wrap && !l.basket.general, note: null }))
        ).map((x) => {
          const b = baskets.find((y) => y.name === x.who && !y.general);
          return (
            <div key={x.key} className="pv-summary-line">
              <span>
                {x.who ? <span className={`pv-tag pv-tag--${BASKET_TONES[b?.position ?? 0]}`}>{x.who}</span> : null} {x.title}
                {x.wrap ? <span className="pv-note"> · wrapped</span> : null}
                {x.note ? <><br /><span className="pv-note">{x.note}</span></> : null}
              </span>
              <span>{formatPence(x.amount)}</span>
            </div>
          );
        })}
        {group ? (
          <>
            {group.wrappedItems ? <div className="pv-summary-line"><span>Gift wrapping, {group.wrappedItems} × {formatPence(group.wrapFeePence)}</span><span>{formatPence(group.wrapTotalPence)}</span></div> : null}
            {!group.wrappedItems && wrap.items ? <div className="pv-summary-line"><span>Gift wrapping (arrives soon, not charged)</span><span>{formatPence(0)}</span></div> : null}
            <div className="pv-summary-line pv-summary-line--total"><span>Total, one payment</span><span>{formatPence(group.totalPence)}</span></div>
            <p className="pv-note">Each item’s line includes postage, buyer protection and processing, worked out exactly as when you buy one thing.</p>
          </>
        ) : (
          <>
            {wrap.items ? <div className="pv-summary-line"><span>Gift wrapping, {wrap.items} {wrap.items === 1 ? 'item' : 'items'}{wrap.charged ? '' : ' (arrives soon, not charged)'}</span><span>{formatPence(wrap.pence)}</span></div> : null}
            <p className="pv-note">Prices include postage. Buyer protection and processing are added per item on the next step, before you pay.</p>
          </>
        )}
      </section>

      {error ? <p className="pv-errors" role="alert">{error}</p> : null}

      {!group ? (
        <section className="pv-panel">
          <Button variant="primary" block onClick={begin} disabled={busy || needsAddress.length > 0}>{busy ? 'One moment…' : 'Continue to payment'}</Button>
          <p className="pv-note">We hold every item for you while you pay.</p>
        </section>
      ) : (
        <section className="pv-panel" aria-labelledby="ck-pay">
          <h2 id="ck-pay">Payment</h2>
          <p className="pv-note" role="status">We’re holding these for you until {time(group.holdExpiresAt)}.</p>
          {payment?.kind === 'stripe' ? (
            <StripePay clientSecret={payment.clientSecret} publishableKey={payment.publishableKey} amountPence={payment.amountPence} orderId={group.orders[0].orderId}
              returnPath={`/basket/checkout?group=${group.groupId}&paid=1`} onPaid={done} />
          ) : payment?.kind === 'simulated' ? (
            <>
              <p className="pv-banner" role="note"><strong>Test payment.</strong> This site is running on example data, so no card is needed and no money moves.</p>
              <Button variant="primary" block disabled={busy} onClick={async () => { setBusy(true); const r = await backend.simulateGroupPayment(group.groupId); setBusy(false); if (r.ok) done(); else setError(r.message); }}>
                {`Pay ${formatPence(payment.amountPence)} (test)`}
              </Button>
            </>
          ) : (
            <Button variant="primary" block disabled={busy} onClick={async () => { setBusy(true); const p = await backend.startGroupPayment(group.groupId); setBusy(false); if (p.ok) setPayment(p.value); else setError(p.message); }}>
              Pay {formatPence(group.totalPence)}
            </Button>
          )}
          <Button variant="quiet" onClick={cancel}>Cancel and release the items</Button>
        </section>
      )}
    </div>
  );
}

function Paid({ group }: { group: BasketCheckout | null }) {
  const [copied, setCopied] = useState<string | null>(null);
  const gifts = group?.orders.filter((o) => o.giftToken) ?? [];
  return (
    <section className="pv-section pv-narrow">
      <h1>Paid. Thank you</h1>
      <p className="pv-lead">Each item is now its own order, with its own protected handover. You’ll find them all in your Inbox.</p>
      {gifts.length ? (
        <div className="pv-panel">
          <h2>Gift links</h2>
          <p className="pv-note">Send each person their link. They sign in, follow their parcel and open it on camera themselves. They never see prices.</p>
          <ul className="pv-list">
            {gifts.map((g) => {
              const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/gift/${g.giftToken}`;
              return (
                <li key={g.orderId}>
                  <strong>{g.basket}</strong>: {g.title}{' '}
                  <Button variant="quiet" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(g.orderId); } catch { /* shown */ } }}>Copy link</Button>
                  {copied === g.orderId ? <span className="pv-note" role="status"> Copied.</span> : <span className="pv-note pv-mono" style={{ overflowWrap: 'anywhere' }}> {url}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <p><Link className="pv-btn pv-btn--primary" href="/inbox">Go to your Inbox</Link></p>
    </section>
  );
}
