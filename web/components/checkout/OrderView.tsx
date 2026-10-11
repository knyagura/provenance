'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { mediaUrl } from '@/lib/domain/catalogue';
import { formatPence } from '@/lib/format';
import type { OrderSummary } from '@/lib/selling';
import { FeeLines } from './FeeLines';

const HEADINGS: Record<OrderSummary['paymentStatus'], string> = {
  paid: 'Paid',
  awaiting_payment: 'Waiting for payment',
  cancelled: 'Checkout cancelled',
  expired: 'Checkout ended',
  review: 'We’re checking this payment',
  legacy: 'Order',
};

/** One order, for its buyer or seller. After paying, it waits a few seconds for Stripe's confirmation. */
export function OrderView({ id }: { id: string }) {
  const { member, loading, backend } = useMember();
  const justPaid = useSearchParams().get('paid') === '1';
  const [order, setOrder] = useState<OrderSummary | null | undefined>(undefined);

  useEffect(() => {
    if (!member) return;
    let tries = 0;
    let stop = false;
    const load = async () => {
      const o = await backend.getOrder(id).catch(() => null);
      if (stop) return;
      setOrder(o);
      // Stripe tells us about a payment a moment after the buyer sees "paid"; keep looking for ~30 s.
      if (o && o.paymentStatus === 'awaiting_payment' && justPaid && tries++ < 15) setTimeout(load, 2000);
    };
    void load();
    return () => {
      stop = true;
    };
  }, [member, backend, id, justPaid]);

  if (loading || (member && order === undefined)) return <p role="status">Loading your order…</p>;
  if (!member) return <p><Link href={`/signin?next=/orders/${id}`}>Sign in</Link> to see this order.</p>;
  if (!order) return <section className="pv-section"><h1>Order not found</h1><p><Link href="/profile">Your account</Link></p></section>;

  const waitingForStripe = order.paymentStatus === 'awaiting_payment' && justPaid;
  return (
    <div className="pv-checkout">
      <header className="pv-section">
        <p className="pv-eyebrow">{order.role === 'buyer' ? 'Your purchase' : 'Your sale'}</p>
        <h1>{waitingForStripe ? 'Confirming your payment…' : HEADINGS[order.paymentStatus]}</h1>
        <p className="pv-lead">{order.title}</p>
      </header>

      {order.paymentStatus === 'paid' ? (
        <section className="pv-panel" aria-labelledby="next-h">
          <h2 id="next-h">What happens next</h2>
          {order.role === 'buyer' ? (
            <p>The seller is told to get it ready. You’ll follow every step, from packing to your door, on this page once orders and custody arrive in the next build step.</p>
          ) : (
            <p>
              Get it ready to hand over. You’ll receive {formatPence(order.quote?.sellerPayoutPence ?? 0)} once the buyer confirms
              the item is as described.
            </p>
          )}
        </section>
      ) : order.paymentStatus === 'review' ? (
        <p className="pv-banner" role="status">Something didn’t match, so a person is checking this payment. If it can’t go ahead you’ll get a full refund.</p>
      ) : waitingForStripe ? (
        <p className="pv-note" role="status">This usually takes a few seconds.</p>
      ) : order.paymentStatus !== 'awaiting_payment' ? (
        <p><Link href={`/item/${order.listingId}`}>Back to the item</Link></p>
      ) : null}

      {order.bought ? (
        <section className="pv-panel" aria-labelledby="bought-h">
          <h2 id="bought-h">{order.role === 'buyer' ? 'What you bought' : 'What was bought'}</h2>
          <p className="pv-note">The listing exactly as it was when checkout started (version {order.bought.revision}). Later edits can’t change this.</p>
          <dl className="pv-details">
            <div><dt>Title</dt><dd>{order.bought.title}</dd></div>
            {order.bought.brand ? <div><dt>Brand</dt><dd>{order.bought.brand}</dd></div> : null}
            {order.bought.size ? <div><dt>Size</dt><dd>{order.bought.size}</dd></div> : null}
            {order.bought.condition ? <div><dt>Condition</dt><dd>{order.bought.condition}</dd></div> : null}
            {order.bought.colour ? <div><dt>Colour</dt><dd>{order.bought.colour}</dd></div> : null}
            {order.bought.serialHint ? <div><dt>Serial ends</dt><dd className="pv-mono">{order.bought.serialHint}</dd></div> : null}
            <div><dt>Price</dt><dd>{formatPence(order.bought.pricePence)}</dd></div>
          </dl>
          {order.bought.description ? <p className="pv-item__desc">{order.bought.description}</p> : null}
          {order.bought.media.some((m) => m.kind === 'photo') ? (
            <ul className="pv-bought-photos" aria-label="Photos when bought">
              {order.bought.media.filter((m) => m.kind === 'photo').map((m, i) => (
                <li key={m.path}><img src={m.path.startsWith('http') ? m.path : mediaUrl(m.path)} alt={`${order.bought!.title}, photo ${i + 1}${m.shot ? ` (${m.shot})` : ''}`} loading="lazy" /></li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {order.quote ? (
        <section className="pv-panel" aria-labelledby="sum-h">
          <h2 id="sum-h">{order.role === 'buyer' ? 'What you paid' : 'The buyer’s total'}</h2>
          <FeeLines quote={order.quote} />
          {order.role === 'seller' ? (
            <p className="pv-note">You receive {formatPence(order.quote.sellerPayoutPence)}.</p>
          ) : null}
        </section>
      ) : null}
      <p className="pv-note pv-mono">Order {order.id.slice(0, 8).toUpperCase()}</p>
    </div>
  );
}
