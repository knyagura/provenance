'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Button } from '@/components/ui';
import { evidenceProblems, normaliseSeal, stepCopy, type CustodyView, type Evidence, type StepDef } from '@/lib/domain/custody';
import { MediaProblem, preparePhoto, prepareVideo } from '@/lib/media';

const ATTEST: Record<string, string> = {
  courier_pickup: 'I watched the item being packed and sealed, and I have the parcel.',
  witness_opening: 'I watched the buyer open the sealed parcel and take out the item.',
};


/** The form for the current step, shown only to the person whose turn it is. */
export function StepForm({ view, step, onDone }: { view: CustodyView; step: StepDef; onDone: (v: CustodyView) => void }) {
  const { backend } = useMember();
  const id = useId();
  const [e, setE] = useState<Evidence>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(view.challenge);
  const [seal, setSeal] = useState(view.seal);
  const set = (patch: Evidence) => setE((cur) => ({ ...cur, ...patch }));
  const copy = stepCopy(step, view.tier);
  const needs = step.needs;

  const getCode = async () => {
    setBusy('code');
    setError(null);
    const r = await backend.issueChallenge(view.orderId);
    setBusy(null);
    if (r.ok) setChallenge(r.value);
    else setError(r.message);
  };
  const getSeal = async () => {
    setBusy('seal');
    setError(null);
    const r = await backend.issueSeal(view.orderId);
    setBusy(null);
    if (r.ok) setSeal({ kind: r.value.kind as NonNullable<CustodyView['seal']>['kind'], code: r.value.code });
    else setError(r.message);
  };
  const addMedia = async (kind: 'photo' | 'video', file: File | undefined) => {
    if (!file) return;
    setBusy(kind);
    setError(null);
    try {
      const prepared = kind === 'photo' ? await preparePhoto(file) : await prepareVideo(file);
      const r = await backend.uploadEvidence(view.orderId, prepared);
      if (r.ok) set({ media: r.value.path, media_kind: r.value.kind, media_sha256: r.value.sha256 });
      else setError(r.message);
    } catch (err) {
      setError(err instanceof MediaProblem ? err.message : 'That upload didn’t work. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const evidence: Evidence = { ...e };
    if (challenge) evidence.code = challenge.code;
    if (typeof evidence.seal === 'string') evidence.seal = normaliseSeal(evidence.seal);
    if (evidence.grams !== undefined) evidence.grams = Number(evidence.grams);
    const problems = evidenceProblems(step, evidence);
    if (problems.length) {
      setError(problems.join(' '));
      return;
    }
    setBusy('send');
    setError(null);
    const r = await backend.recordStep(view.orderId, step.key, evidence);
    setBusy(null);
    if (r.ok) onDone(r.value);
    else setError(r.message);
  };

  const isConfirm = step.key === 'confirm';
  const mediaKind = needs.includes('video') ? 'video' : needs.includes('photo') ? 'photo' : null;
  const waitForCode = needs.includes('code') && !challenge;

  return (
    <form className="pv-panel pv-form pv-turn" onSubmit={submit} aria-labelledby={`${id}-h`} noValidate>
      <p className="pv-eyebrow">Your turn</p>
      <h2 id={`${id}-h`}>{copy.title}</h2>
      <p className="pv-note">{copy.note}</p>

      {needs.includes('code') ? (
        challenge ? (
          <CodeCountdown code={challenge.code} expiresAt={challenge.expiresAt} onRenew={getCode} busy={busy === 'code'} />
        ) : (
          <Button variant="primary" onClick={getCode} disabled={busy !== null}>{busy === 'code' ? 'Getting your code…' : 'Start recording: get my code'}</Button>
        )
      ) : null}

      {mediaKind && !waitForCode ? (
        <div className="pv-field">
          <span>{mediaKind === 'video' ? 'Your video (up to 30 seconds)' : 'Your photo'}</span>
          <input
            id={`${id}-media`}
            className="pv-visually-hidden"
            type="file"
            accept={mediaKind === 'video' ? 'video/*' : 'image/*'}
            capture="environment"
            onChange={(ev) => void addMedia(mediaKind, ev.target.files?.[0])}
          />
          <label htmlFor={`${id}-media`} className={`pv-btn pv-btn--secondary${busy === mediaKind ? ' pv-btn--busy' : ''}`}>
            {busy === mediaKind ? 'Uploading…' : e.media ? `Retake ${mediaKind}` : mediaKind === 'video' ? 'Record video' : 'Take photo'}
          </label>
          {e.media ? <span className="pv-note" role="status">{mediaKind === 'video' ? 'Video added.' : 'Photo added.'} Fingerprint {String(e.media_sha256).slice(0, 12)}…</span> : null}
        </div>
      ) : null}

      {needs.includes('seal') && step.sealMode === 'apply' ? (
        seal ? (
          <div className="pv-code" role="status">
            <span className="pv-note">Your seal code</span>
            <strong className="pv-code__value pv-mono">{seal.code}</strong>
            <span className="pv-note">Fit the seal with this code. Only you see it until it’s checked.</span>
          </div>
        ) : (
          <Button onClick={getSeal} disabled={busy !== null}>{busy === 'seal' ? 'Getting the code…' : 'Get the seal code'}</Button>
        )
      ) : null}
      {needs.includes('seal') && (step.sealMode === 'check' || seal) ? (
        <div className="pv-field">
          <label htmlFor={`${id}-seal`}>{step.sealMode === 'apply' ? 'Type the code on the seal you fitted' : 'Type the code printed on the seal'}</label>
          <input id={`${id}-seal`} className="pv-mono" autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="PS-7K2M-9QXD"
            value={String(e.seal ?? '')} onChange={(ev) => set({ seal: ev.target.value })} />
        </div>
      ) : null}

      {needs.includes('grams') ? (
        <div className="pv-field">
          <label htmlFor={`${id}-g`}>Weight in grams</label>
          <input id={`${id}-g`} type="number" inputMode="numeric" min={1} max={100000} step={1} value={String(e.grams ?? '')} onChange={(ev) => set({ grams: ev.target.value })} />
        </div>
      ) : null}

      {needs.includes('tracking') ? (
        <div className="pv-grid2">
          <div className="pv-field">
            <label htmlFor={`${id}-carrier`}>Carrier</label>
            <input id={`${id}-carrier`} autoComplete="off" value={String(e.carrier ?? '')} onChange={(ev) => set({ carrier: ev.target.value })} />
          </div>
          <div className="pv-field">
            <label htmlFor={`${id}-track`}>Tracking number</label>
            <input id={`${id}-track`} className="pv-mono" autoComplete="off" autoCapitalize="characters" value={String(e.tracking ?? '')} onChange={(ev) => set({ tracking: ev.target.value })} />
          </div>
        </div>
      ) : null}

      {needs.includes('attest') ? (
        <label className="pv-choice">
          <input type="checkbox" checked={e.attest === true} onChange={(ev) => set({ attest: ev.target.checked })} />
          <span>{ATTEST[step.key] ?? 'I confirm this step happened as described.'}</span>
        </label>
      ) : null}

      {needs.includes('result') ? (
        <>
          <fieldset className="pv-field pv-choices">
            <legend>Verdict</legend>
            {(['pass', 'fail'] as const).map((r) => (
              <label key={r} className="pv-choice">
                <input type="radio" name={`${id}-result`} checked={e.result === r} onChange={() => set({ result: r })} />
                <span>{r === 'pass' ? 'Authentic and as described' : 'Fails: not authentic or not as described'}</span>
              </label>
            ))}
          </fieldset>
          <div className="pv-field">
            <label htmlFor={`${id}-note`}>Notes (optional)</label>
            <textarea id={`${id}-note`} rows={3} maxLength={500} value={String(e.note ?? '')} onChange={(ev) => set({ note: ev.target.value })} />
          </div>
        </>
      ) : null}

      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      {waitForCode ? null : (
        <div className="pv-actions">
          <Button type="submit" variant="primary" disabled={busy !== null}>
            {busy === 'send' ? 'Recording…' : isConfirm ? 'Confirm it’s as described' : 'Record this step'}
          </Button>
        </div>
      )}
    </form>
  );
}

/** The one-time code, large enough to read on camera, with the time it has left. */
function CodeCountdown({ code, expiresAt, onRenew, busy }: { code: string; expiresAt: string; onRenew: () => void; busy: boolean }) {
  const end = new Date(expiresAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.round((end - now) / 1000));
  const total = 10 * 60;
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  if (left === 0) {
    return (
      <div className="pv-code pv-code--expired" role="status">
        <span>That code has expired. Get a new one, then record again.</span>
        <Button variant="primary" onClick={onRenew} disabled={busy}>{busy ? 'Getting your code…' : 'Get a new code'}</Button>
      </div>
    );
  }
  return (
    <div className="pv-code" role="status">
      <span className="pv-note">Say this code clearly on camera</span>
      <span className="pv-code__row">
        <strong className="pv-code__value pv-mono" aria-label={`Code ${code.split('').join(' ')}`}>
          {code.slice(0, 3)}<span className="pv-code__gap" aria-hidden="true"> </span>{code.slice(3)}
        </strong>
        <span className="pv-code__timer" style={{ ['--left' as string]: `${Math.min(100, (left / total) * 100)}%` }} aria-label={`${mm} minutes ${ss} seconds left`}>
          <span aria-hidden="true">{mm}:{ss}</span>
        </span>
      </span>
      <span className="pv-note">Works once, for the next {mm > 0 ? `${mm} min` : `${left} s`}.</span>
    </div>
  );
}
