'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { addressLines } from '@/lib/selling/shipping';
import { RETURN_REASONS } from '@/lib/selling/trustAndSafety';
import type { OrderReturn, ReturnReason } from '@/lib/selling/types';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Returns on the order page: the buyer asks, the seller accepts or declines, the buyer posts it back, the seller confirms. */
export function Returns({ orderId, role, onChange }: { orderId: string; role: 'buyer' | 'seller'; onChange?: () => void }) {
  const { backend } = useMember();
  const id = useId();
  const [r, setR] = useState<OrderReturn | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    backend.orderReturn(orderId).then(setR).catch(() => setR(null));
  }, [backend, orderId]);
  if (!r || (!r.canRequest && !r.return)) return null;

  const run = async (fn: () => ReturnType<typeof backend.requestReturn>) => {
    setBusy(true);
    setError(null);
    const x = await fn();
    setBusy(false);
    if (!x.ok) return setError(x.message);
    setR(x.value);
    setOpen(false);
    onChange?.();
  };
  const request = (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return setError('Choose why you’re returning it.');
    run(() => backend.requestReturn(orderId, reason, note));
  };
  const ret = r.return;

  return (
    <section className="pv-panel pv-returns" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{ret ? 'Return' : 'Not right?'}</h2>
      {!ret ? (
        open ? (
          <form className="pv-form" onSubmit={request}>
            <fieldset className="pv-field pv-choices">
              <legend>Why are you returning it?</legend>
              {(Object.keys(RETURN_REASONS) as ReturnReason[]).map((k) => (
                <label key={k} className="pv-choice"><input type="radio" name={`${id}-r`} checked={reason === k} onChange={() => setReason(k)} /><span>{RETURN_REASONS[k]}</span></label>
              ))}
            </fieldset>
            <div className="pv-field">
              <label htmlFor={`${id}-n`}>What’s wrong (optional)</label>
              <textarea id={`${id}-n`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <p className="pv-note">The payment stays held. The seller has 48 hours to accept, or it’s accepted for you. Once they have it back, you’re refunded.</p>
            <div className="pv-actions">
              <Button type="submit" variant="primary" disabled={busy}>Ask to return it</Button>
              <Button variant="quiet" onClick={() => setOpen(false)}>Not now</Button>
            </div>
          </form>
        ) : (
          <>
            <p>If it isn’t as described, arrived damaged, or is the wrong item, you can send it back for a refund instead of confirming.</p>
            <div className="pv-actions"><Button onClick={() => setOpen(true)}>Return it</Button></div>
          </>
        )
      ) : (
        <>
          <p className="pv-note">{RETURN_REASONS[ret.reason]}{ret.note ? `: “${ret.note}”` : ''} · asked {when(ret.requestedAt)}</p>
          {ret.status === 'requested' ? (
            role === 'seller' ? (
              <>
                <p>The buyer wants to return this. Answer by {when(ret.respondBy)}, or it’s accepted for you. If you accept, they post it back to your default address and are refunded when you confirm it arrived.</p>
                <div className="pv-field">
                  <label htmlFor={`${id}-s`}>If you decline, say why (our team will read it)</label>
                  <textarea id={`${id}-s`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <div className="pv-actions">
                  <Button variant="primary" disabled={busy} onClick={() => run(() => backend.respondReturn(orderId, true, ''))}>Accept the return</Button>
                  <Button disabled={busy} onClick={() => run(() => backend.respondReturn(orderId, false, note))}>Decline</Button>
                </div>
              </>
            ) : (
              <>
                <p role="status">Waiting for the seller to answer (by {when(ret.respondBy)}). The payment stays held.</p>
                <Button variant="quiet" disabled={busy} onClick={() => run(() => backend.cancelReturn(orderId))}>Keep the item instead</Button>
              </>
            )
          ) : ret.status === 'accepted' || ret.status === 'posted' ? (
            <>
              <p role="status">
                {ret.status === 'accepted' ? `Return accepted${ret.autoAccepted ? ' (the seller didn’t answer in time)' : ''}. ` : 'Posted back. '}
                {role === 'buyer' ? (ret.status === 'accepted' ? 'Post it back, then tell us.' : 'You’ll be refunded when the seller confirms it arrived.') : (ret.status === 'posted' ? 'Confirm when it arrives so the buyer is refunded.' : 'Waiting for the buyer to post it.')}
              </p>
              {r.label ? (
                <div className="pv-shiplabel">
                  <p><strong>{r.label.carrier}</strong> · {r.label.service}{r.label.mode === 'test' ? <span className="pv-shiplabel__test"> Test label</span> : null}</p>
                  <p>Tracking number <span className="pv-mono">{r.label.tracking}</span></p>
                  {r.label.deliverTo ? <address className="pv-address">{addressLines(r.label.deliverTo).map((l) => <span key={l}>{l}</span>)}</address> : null}
                </div>
              ) : role === 'buyer' ? <p className="pv-note">The seller will message you the address to post it to.</p> : null}
              <div className="pv-actions">
                {role === 'buyer' && ret.status === 'accepted' ? <Button variant="primary" disabled={busy} onClick={() => run(() => backend.returnPosted(orderId))}>I’ve posted it</Button> : null}
                {role === 'buyer' && ret.status === 'accepted' ? <Button variant="quiet" disabled={busy} onClick={() => run(() => backend.cancelReturn(orderId))}>Keep the item instead</Button> : null}
                {role === 'seller' ? <Button variant="primary" disabled={busy} onClick={() => run(() => backend.returnReceived(orderId))}>It’s arrived back</Button> : null}
              </div>
            </>
          ) : ret.status === 'declined' ? (
            <p role="status">The seller declined{ret.sellerNote ? `: “${ret.sellerNote}”` : ''}. Our team will decide; the payment stays held until then.</p>
          ) : ret.status === 'received' ? (
            <p role="status">The seller has it back. {role === 'buyer' ? 'Your refund is on its way.' : 'The buyer is refunded.'}</p>
          ) : (
            <p className="pv-note">The return was cancelled.</p>
          )}
        </>
      )}
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
    </section>
  );
}
