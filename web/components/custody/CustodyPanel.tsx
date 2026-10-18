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
  progressOf,
  STAGE_TITLE,
  stagesFor,
  stepCopy,
  type CustodyView,
  type StepDef,
} from '@/lib/domain/custody';
import { formatPence } from '@/lib/format';
import { SealMark } from './SealMark';
import { StepForm } from './StepForm';
import { DeliveryAddress } from '@/components/shipping/Shipping';
import { Returns } from './Returns';

const REFRESH_MS = 8000;
const CHOICES: Record<(typeof BUYER_DISPUTE_REASONS)[number], string> = {
  not_as_described: 'It isn’t as described',
  not_arrived: 'It hasn’t arrived',
  damaged: 'It arrived damaged',
  other: 'Something else',
};
const at = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** One stage's steps for the timeline, each with what was recorded beside it. */
function stageSteps(v: CustodyView, steps: StepDef[]): CustodyStep[] {
  const done = new Map(v.events.map((e) => [e.step, e]));
  return steps.map((s) => {
    const ev = done.get(s.key);
    const copy = stepCopy(s, v.tier);
    const now = v.current?.key === s.key;
    const by = ACTOR_LABEL[s.actor];
    const media = ev && typeof ev.evidence.media === 'string' ? v.mediaUrls[ev.evidence.media] : undefined;
    const label = `${copy.title}, ${ev ? at(ev.at) : ''}`;
    const evidence = ev ? { ...ev.evidence } : null;
    if (evidence?.seal) delete evidence.seal; // shown as a seal below
    return {
      title: copy.title,
      note: ev ? `${ev.actorRole === 'system' ? 'Automatic' : by} · ${at(ev.at)}` : now ? `${by} · now` : by,
      state: ev ? 'done' : now ? 'now' : 'later',
      evidence: ev ? [describeEvidence(evidence!), `#${ev.hash.slice(0, 10)}`].filter(Boolean).join(' · ') : undefined,
      yourTurn: now && v.myRoles.includes(s.actor) && v.state === 'in_progress',
      extra: ev && (media || ev.evidence.seal) ? (
        <>
          {media ? (
            <span className="pv-step__media">
              {ev.evidence.media_kind === 'video' ? <video src={media} controls preload="metadata" aria-label={label} /> : <img src={media} alt={label} loading="lazy" />}
            </span>
          ) : null}
          {ev.evidence.seal ? <SealMark evidence={ev.evidence} /> : null}
        </>
      ) : undefined,
    } satisfies CustodyStep;
  });
}

/** Where the order is: a bar split into its stages, filled as steps are recorded. */
function Progress({ view }: { view: CustodyView }) {
  const { done, total, stage } = progressOf(view);
  const stages = stagesFor(view.tier);
  const recorded = new Set(view.events.map((e) => e.step));
  const label =
    view.state === 'confirmed' ? 'Complete' : view.state === 'disputed' ? `On hold at ${STAGE_TITLE[stage].toLowerCase()}` : STAGE_TITLE[stage];
  return (
    <div className="pv-progress">
      <div className="pv-progress__head">
        <strong>{label}</strong>
        <span className="pv-note">{done} of {total} steps recorded</span>
      </div>
      <div className={`pv-progress__bar${view.state === 'disputed' ? ' pv-progress__bar--held' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Steps recorded">
        {stages.map((st) => {
          const n = st.steps.filter((s) => recorded.has(s.key)).length;
          return (
            <span key={st.key} className="pv-progress__seg" style={{ flexGrow: st.steps.length }}>
              <span className="pv-progress__fill" style={{ width: `${(n / st.steps.length) * 100}%` }} />
            </span>
          );
        })}
      </div>
      <ol className="pv-progress__stages" aria-hidden="true">
        {stages.map((st) => (
          <li key={st.key} style={{ flexGrow: st.steps.length }} className={st.key === stage ? 'pv-progress__now' : undefined}>{st.title}</li>
        ))}
      </ol>
    </div>
  );
}

/** An order's chain of custody: where it is, the evidence so far, and the form when it's your turn. */
export function CustodyPanel({ orderId, sellerPayoutPence, onChange }: { orderId: string; sellerPayoutPence?: number; onChange?: (v: CustodyView) => void }) {
  const { backend } = useMember();
  const [view, setViewState] = useState<CustodyView | null | undefined>(undefined);
  const setView = useCallback((v: CustodyView | null | undefined | ((cur: CustodyView | null | undefined) => CustodyView | null | undefined)) => {
    setViewState((cur) => {
      const next = typeof v === 'function' ? v(cur) : v;
      if (next) queueMicrotask(() => onChange?.(next));
      return next;
    });
  }, [onChange]);
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
  const resolution = view.events.find((e) => e.step === 'staff_resolution');
  const seller = view.myRoles.includes('seller');

  return (
    <>
      {resolution ? (
        <p className="pv-banner" role="status">
          <strong>Decided by NuTuYu staff:</strong> {resolution.evidence.outcome === 'refund' ? 'the buyer is refunded.' : 'the payment is released to the seller.'}
          {resolution.evidence.note ? ` “${resolution.evidence.note}”` : ''}
        </p>
      ) : view.state === 'disputed' ? (
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

      {view.myRoles.includes('buyer') ? <DeliveryAddress orderId={orderId} /> : null}
      {view.myRoles.includes('buyer') || view.myRoles.includes('seller') ? (
        <Returns key={`${view.state}-${view.events.length}`} orderId={orderId} role={view.myRoles.includes('seller') ? 'seller' : 'buyer'} onChange={load} />
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
        <Progress view={view} />
        {stagesFor(view.tier).map((st) => {
          const recorded = st.steps.filter((s) => view.events.some((e) => e.step === s.key)).length;
          const status = recorded === st.steps.length ? 'Done' : st.steps.some((s) => s.key === view.current?.key) ? 'In progress' : recorded ? 'Part done' : 'To come';
          return (
            <details key={st.key} className="pv-stage" open={status !== 'Done'}>
              <summary>
                <span className="pv-stage__title">{st.title}</span>
                <span className={`pv-stage__status pv-stage__status--${status.replace(' ', '-').toLowerCase()}`}>{status} · {recorded}/{st.steps.length}</span>
              </summary>
              <CustodyTimeline steps={stageSteps(view, st.steps)} label={`${st.title} steps`} />
            </details>
          );
        })}
        <p className="pv-note pv-mono pv-wrap">Each step is signed into one chain; the latest fingerprint is #{view.head.slice(0, 16)}.</p>
      </section>

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
