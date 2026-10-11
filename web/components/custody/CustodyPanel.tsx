'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button, CustodyTimeline, type CustodyStep } from '@/components/ui';
import {
  ACTOR_LABEL,
  BUYER_DISPUTE_REASONS,
  DISPUTE_REASONS,
  describeEvidence,
  isMyTurn,
  planFor,
  stepCopy,
  type CustodyView,
} from '@/lib/domain/custody';
import { formatPence } from '@/lib/format';
import { StepForm } from './StepForm';

const REFRESH_MS = 8000;
const CHOICES: Record<(typeof BUYER_DISPUTE_REASONS)[number], string> = {
  not_as_described: 'It isn’t as described',
  not_arrived: 'It hasn’t arrived',
  damaged: 'It arrived damaged',
  other: 'Something else',
};
const at = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Builds the timeline from the tier's steps and what has been recorded so far. */
export function timelineSteps(v: CustodyView): CustodyStep[] {
  const done = new Map(v.events.map((e) => [e.step, e]));
  return planFor(v.tier).map((s) => {
    const ev = done.get(s.key);
    const copy = stepCopy(s, v.tier);
    const now = v.current?.key === s.key;
    const by = ACTOR_LABEL[s.actor];
    return {
      title: copy.title,
      note: ev ? `${ev.actorRole === 'system' ? 'Automatic' : by} · ${at(ev.at)}` : `${by}${now ? '' : ' · to come'}`,
      state: ev ? 'done' : now ? 'now' : 'later',
      evidence: ev ? [describeEvidence(ev.evidence), `#${ev.hash.slice(0, 10)}`].filter(Boolean).join(' · ') : undefined,
      yourTurn: now && v.myRoles.includes(s.actor) && v.state === 'in_progress',
    } satisfies CustodyStep;
  });
}

/** An order's chain of custody: where it is, the evidence so far, and the form when it's your turn. */
export function CustodyPanel({ orderId, sellerPayoutPence }: { orderId: string; sellerPayoutPence?: number }) {
  const { backend } = useMember();
  const [view, setView] = useState<CustodyView | null | undefined>(undefined);
  const load = useCallback(() => backend.custody(orderId).then(setView).catch(() => setView((v) => v ?? null)), [backend, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  // While it's someone else's turn, keep looking for their progress (the other phone).
  const waiting = view && view.state === 'in_progress' && !isMyTurn(view);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void load(), REFRESH_MS);
    const onShow = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [waiting, load]);

  if (view === undefined) return <p role="status">Loading the custody record…</p>;
  if (view === null) return null;

  const mine = isMyTurn(view);
  const dispute = view.events.find((e) => e.step === 'dispute');
  const media = view.events.filter((e) => typeof e.evidence.media === 'string' && view.mediaUrls[e.evidence.media as string]);
  const seller = view.myRoles.includes('seller');

  return (
    <>
      {view.state === 'disputed' ? (
        <p className="pv-banner pv-banner--warn" role="status">
          <strong>On hold.</strong> {DISPUTE_REASONS[view.disputeReason ?? 'other'] ?? DISPUTE_REASONS.other}
          {dispute?.evidence.note ? ` “${dispute.evidence.note}”` : ''} The payment stays held while a person looks into it.
        </p>
      ) : null}
      {view.state === 'confirmed' ? (
        <p className="pv-banner" role="status">
          <strong>Complete.</strong> {seller ? `Your ${sellerPayoutPence ? formatPence(sellerPayoutPence) : 'payment'} is released and will be paid out once payouts are switched on.` : 'The payment has been released to the seller.'}
        </p>
      ) : null}
      {view.weightFlag && view.state !== 'confirmed' ? (
        <p className="pv-banner pv-banner--warn" role="status">The parcel’s weight at the door differs from its weight at packing. It’s on the record; open it on camera as usual.</p>
      ) : null}

      {mine && view.current ? <StepForm key={view.current.key} view={view} step={view.current} onDone={setView} /> : null}

      <section className="pv-panel" aria-labelledby={`custody-${orderId}`}>
        <div className="pv-panel__head">
          <h2 id={`custody-${orderId}`}>Chain of custody</h2>
          <span className={`pv-chain ${view.chainOk ? 'pv-chain--ok' : 'pv-chain--bad'}`}>
            {view.chainOk ? 'Record verified' : 'Record altered — reported'}
          </span>
        </div>
        {!mine && view.current && view.state === 'in_progress' ? (
          <p className="pv-note" role="status">
            Waiting for the {ACTOR_LABEL[view.current.actor].toLowerCase()}: {stepCopy(view.current, view.tier).title.toLowerCase()}. This page updates by itself.
          </p>
        ) : null}
        {seller && view.state === 'in_progress' && sellerPayoutPence ? (
          <p className="pv-note">You receive {formatPence(sellerPayoutPence)} when the buyer confirms, or automatically after the protection window.</p>
        ) : null}
        <CustodyTimeline steps={timelineSteps(view)} label="Custody steps" />
        <p className="pv-note pv-mono pv-wrap">Each step is signed into one chain; the latest fingerprint is #{view.head.slice(0, 16)}.</p>
      </section>

      {media.length ? (
        <section className="pv-panel" aria-labelledby={`evidence-${orderId}`}>
          <h2 id={`evidence-${orderId}`}>Evidence</h2>
          <ul className="pv-bought-photos" aria-label="Evidence photos and videos">
            {media.map((e) => {
              const url = view.mediaUrls[e.evidence.media as string];
              const label = `${stepCopy(planFor(view.tier).find((p) => p.key === e.step) ?? { key: e.step, actor: 'seller', needs: [] }, view.tier).title}, ${at(e.at)}`;
              return (
                <li key={e.seq}>
                  {e.evidence.media_kind === 'video' ? <video src={url} controls preload="metadata" aria-label={label} /> : <img src={url} alt={label} loading="lazy" />}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {view.myRoles.includes('buyer') && view.state === 'in_progress' ? <DisputeForm view={view} onDone={setView} /> : null}
    </>
  );
}

function DisputeForm({ view, onDone }: { view: CustodyView; onDone: (v: CustodyView) => void }) {
  const { backend } = useMember();
  const id = useId();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!reason) {
      setError('Choose what went wrong.');
      return;
    }
    setBusy(true);
    const r = await backend.openDispute(view.orderId, reason, note);
    setBusy(false);
    if (r.ok) onDone(r.value);
    else setError(r.message);
  };
  return (
    <details className="pv-panel">
      <summary>Report a problem</summary>
      <form className="pv-form" onSubmit={submit} noValidate>
        <p className="pv-note">The payment stays held until it’s sorted out. Keep the item and its packaging.</p>
        <div className="pv-field">
          <label htmlFor={`${id}-reason`}>What went wrong?</label>
          <select id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose…</option>
            {BUYER_DISPUTE_REASONS.map((r) => (
              <option key={r} value={r}>{CHOICES[r]}</option>
            ))}
          </select>
        </div>
        <div className="pv-field">
          <label htmlFor={`${id}-note`}>Tell us more (optional)</label>
          <textarea id={`${id}-note`} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error ? <p className="pv-errors" role="alert">{error}</p> : null}
        <div className="pv-actions">
          <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Report the problem'}</Button>
        </div>
      </form>
    </details>
  );
}
