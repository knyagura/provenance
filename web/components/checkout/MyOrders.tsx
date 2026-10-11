'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { formatPence } from '@/lib/format';
import type { OrderSummary } from '@/lib/selling';

const LABEL: Record<OrderSummary['paymentStatus'], string> = {
  paid: 'Paid', awaiting_payment: 'Awaiting payment', cancelled: 'Cancelled', expired: 'Ended', review: 'Being checked', legacy: '',
};

/** Purchases and sales, newest first. */
export function MyOrders() {
  const { backend } = useMember();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  useEffect(() => {
    backend.myOrders().then(setOrders).catch(() => setOrders([]));
  }, [backend]);
  if (!orders || orders.length === 0) return null;
  return (
    <section className="pv-section" aria-labelledby="orders-h">
      <h2 id="orders-h">Your orders</h2>
      <ul className="pv-rows" aria-label="Your orders">
        {orders.map((o) => (
          <li key={o.id} className="pv-row">
            <span className="pv-row__thumb" aria-hidden="true">{o.photoUrl ? <img src={o.photoUrl} alt="" /> : null}</span>
            <span className="pv-row__text">
              <strong>{o.title}</strong>
              <span className="pv-note">
                {[o.role === 'buyer' ? 'Bought' : 'Sold', o.totalPence ? formatPence(o.role === 'buyer' ? o.totalPence : o.quote?.sellerPayoutPence ?? 0) : null, LABEL[o.paymentStatus]].filter(Boolean).join(' · ')}
              </span>
            </span>
            <Link className="pv-btn pv-btn--secondary" href={`/orders/${o.id}`}>View</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
