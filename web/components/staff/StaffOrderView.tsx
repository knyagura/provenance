'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { ACTOR_LABEL, DISPUTE_REASONS, stepTitle, type Actor } from '@/lib/domain/custody';
import { formatPence } from '@/lib/format';
import type { StaffOrder } from '@/lib/selling';
import { StaffGate } from './StaffGate';

const at = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const PRIVATE = new Set(['media', 'media_sha256']);

export function StaffOrderView({ orderId }: { orderId: string }) {
  return (
    <StaffGate>
      <Detail orderId={orderId} />
    </StaffGate>
  );
}

function Detail({ orderId }: { orderId: string }) {
  const { backend } = useMember();
  const id = useId();
  const [o, setO] = useState<StaffOrder | null | undefined>(undefined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    backend.staffOrder(orderId).then(setO).catch(() => setO(null));
  }, [backend, orderId]);

  if (o === undefined) return <p role="status">Loading the order…</p>;
  if (!o) return <section className="pv-section"><h1>Order not found</h1><p><Link href="/staff">Back to the queue</Link></p></section>;

  const decide = async (kind: 'dispute' | 'payment', outcome: 'release' | 'refund' | 'accept') => {
    if (note.trim().length < 3) return setError('Write a short note on your reasons. The buyer and seller see it.');
    setBusy(true);
    const r = kind === 'dispute'
      ? await backend.staffResolveDispute(o.orderId, outcome as 'release' | 'refund', note.trim())
      : await backend.staffResolvePayment(o.orderId, outcome as 'accept' | 'refund', note.trim());
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    setNote('');
    setO(r.value);
  };

  const openDispute = o.state === 'disputed' && !o.disputeResolution;
  const paymentReview = o.paymentStatus === 'review';
  return (
    <div className="pv-sell pv-staff">
      <p><Link href="/staff">Back to the queue</Link></p>
      <header className="pv-section">
        <p className="pv-eyebrow">Staff · order {o.orderId.slice(-8)}</p>
        <h1>{o.title}</h1>
        <p className="pv-note">
          Buyer {o.buyer} · seller {o.seller} · {o.totalPence ? formatPence(o.totalPence) : 'no total'} · payment {o.paymentStatus}{o.paymentRef ? ` (${o.paymentRef})` : ''} · custody {o.state} · payout {o.payoutStatus}
        </p>
        {o.weightFlag ? <p className="pv-banner pv-banner--warn" role="note">The parcel’s weight changed more than allowed between two steps.</p> : null}
        {o.disputeReason ? <p className="pv-banner" role="note">Dispute: {DISPUTE_REASONS[o.disputeReason] ?? o.disputeReason}{o.disputeResolution ? `. Decided: ${o.disputeResolution === 'release' ? 'paid to the seller' : 'refunded to the buyer'}.` : ''}</p> : null}
        <p><Link href={`/item/${o.listingId}`}>See the listing</Link> · <Link href={`/passport/${o.listingId}`}>Passport</Link></p>
      </header>

      {openDispute || paymentReview ? (
        <section className="pv-panel pv-form" aria-labelledby={`${id}-d`}>
          <h2 id={`${id}-d`}>{openDispute ? 'Decide the dispute' : 'Decide the payment check'}</h2>
          <div className="pv-field">
            <label htmlFor={`${id}-note`}>Your reasons</label>
            <textarea id={`${id}-note`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={`${id}-nh`} />
            <span id={`${id}-nh`} className="pv-note">Shown to the buyer and seller, and kept with the order’s record.</span>
          </div>
          {error ? <p className="pv-errors" role="alert">{error}</p> : null}
          <div className="pv-actions">
            {openDispute ? (
              <>
                <Button variant="primary" disabled={busy} onClick={() => decide('dispute', 'release')}>Pay the seller</Button>
                <Button disabled={busy} onClick={() => decide('dispute', 'refund')}>Refund the buyer</Button>
              </>
            ) : (
              <>
                <Button variant="primary" disabled={busy} onClick={() => decide('payment', 'accept')}>Accept the payment</Button>
                <Button disabled={busy} onClick={() => decide('payment', 'refund')}>Refund it</Button>
              </>
            )}
          </div>
        </section>
      ) : null}

      <section className="pv-panel" aria-labelledby={`${id}-ev`}>
        <h2 id={`${id}-ev`}>Custody record</h2>
        {o.events.length ? (
          <ol className="pv-passport__steps pv-events">
            {o.events.map((e) => (
              <li key={e.seq}>
                <strong>{e.seq}. {stepTitle(e.step)}</strong>
                <span className="pv-note">{ACTOR_LABEL[e.actorRole as Actor] ?? e.actorRole}{e.actor ? ` (${e.actor})` : ''} · {at(e.at)} · <span className="pv-mono">{e.hash.slice(0, 12)}…</span></span>
                {Object.entries(e.evidence).filter(([k]) => !PRIVATE.has(k)).length ? (
                  <span className="pv-note pv-mono">{Object.entries(e.evidence).filter(([k]) => !PRIVATE.has(k)).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : <p className="pv-note">No steps yet.</p>}
      </section>

      <section className="pv-panel" aria-labelledby={`${id}-m`}>
        <h2 id={`${id}-m`}>Messages</h2>
        {o.messages.length ? (
          <ol className="pv-passport__steps">{o.messages.map((m, i) => <li key={i}><span>{m.body}</span><span className="pv-note">{m.from} ({m.role}) · {at(m.at)}</span></li>)}</ol>
        ) : <p className="pv-note">No messages.</p>}
      </section>

      <section className="pv-panel" aria-labelledby={`${id}-a`}>
        <h2 id={`${id}-a`}>Staff actions</h2>
        {o.actions.length ? (
          <ul className="pv-list">{o.actions.map((a, i) => <li key={i}>{a.action} by {a.by}, {at(a.at)}{typeof a.detail.note === 'string' ? `: ${a.detail.note}` : ''}</li>)}</ul>
        ) : <p className="pv-note">None yet.</p>}
      </section>
    </div>
  );
}
