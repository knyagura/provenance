'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { safeNext } from '@/components/auth/SignInForm';
import { loadOffer, neverAsk, notNow, saveOffer } from '@/lib/account/passkeyOffer';

/** Shown after the third password sign-in on a device: set up Face ID or fingerprint sign-in. */
export function PasskeyOffer() {
  const { member, loading, backend } = useMember();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (loading) return <p role="status">Loading…</p>;
  if (!member) {
    return <p><Link href="/signin">Sign in</Link> first.</p>;
  }

  async function setUp() {
    setBusy(true);
    setError(null);
    const r = await backend.addPasskey();
    setBusy(false);
    if (r.ok) setDone(r.value.name);
    else setError(r.message);
  }

  if (done) {
    return (
      <section className="pv-section pv-narrow">
        <h1>Passkey added</h1>
        <p className="pv-lead">Next time, choose “Sign in with a passkey” and use {done}. No password needed.</p>
        <p><Link className="pv-btn pv-btn--primary" href={next}>Continue</Link></p>
      </section>
    );
  }

  return (
    <section className="pv-section pv-narrow" aria-labelledby="offer">
      <h1 id="offer">Sign in faster next time</h1>
      <p className="pv-lead">
        Add a passkey and sign in with Face ID, your fingerprint or your phone’s screen lock instead of typing a password.
        It can’t be phished, and it stays on your device.
      </p>
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      <div className="pv-actions">
        <button type="button" className="pv-btn pv-btn--primary" onClick={setUp} disabled={busy}>
          {busy ? 'Waiting for your device…' : 'Add a passkey'}
        </button>
        <button type="button" className="pv-btn pv-btn--secondary" disabled={busy} onClick={() => { saveOffer(notNow(loadOffer())); router.push(next); }}>
          Not now
        </button>
      </div>
      <button type="button" className="pv-btn pv-btn--quiet" disabled={busy} onClick={() => { saveOffer(neverAsk(loadOffer())); router.push(next); }}>
        Don’t ask again on this device
      </button>
      <p className="pv-note">You can add or remove passkeys any time from your account page.</p>
    </section>
  );
}
