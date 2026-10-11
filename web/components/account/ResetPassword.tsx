'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';

/**
 * Two halves. Without a reset link: ask for an email and send one. Arriving from the link (Supabase
 * signs the person in and flags it as a password recovery): choose a new password.
 */
export function ResetPassword() {
  const { backend } = useMember();
  const [recovering, setRecovering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    // Read the link's marker first: the sign-in library tidies the address bar once it has used it.
    if (/type=recovery/.test(window.location.hash)) setRecovering(true);
    return backend.onPasswordRecovery(() => setRecovering(true));
  }, [backend]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.');
    setBusy(true);
    const r = await backend.requestPasswordReset(email.trim());
    setBusy(false);
    if (r.ok) setSent(true);
    else setError(r.message);
  }

  async function choose(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Your password needs at least 8 characters.');
    setBusy(true);
    const r = await backend.setPassword(password);
    setBusy(false);
    if (r.ok) setChanged(true);
    else setError(r.message);
  }

  if (changed) {
    return (
      <section className="pv-section pv-narrow">
        <h1>Password changed</h1>
        <p className="pv-lead">You’re signed in with your new password.</p>
        <p><Link className="pv-btn pv-btn--primary" href="/profile">Go to your account</Link></p>
      </section>
    );
  }

  if (recovering) {
    return (
      <section className="pv-section pv-narrow">
        <h1>Choose a new password</h1>
        <form className="pv-panel pv-form" onSubmit={choose} noValidate>
          <div className="pv-field">
            <label htmlFor="new-password">New password</label>
            <input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="np-note" />
            <span id="np-note" className="pv-note">At least 8 characters.</span>
          </div>
          {error ? <p className="pv-errors" role="alert">{error}</p> : null}
          <button type="submit" className="pv-btn pv-btn--primary pv-btn--block" disabled={busy}>{busy ? 'One moment…' : 'Save new password'}</button>
        </form>
      </section>
    );
  }

  return (
    <section className="pv-section pv-narrow">
      <h1>Reset your password</h1>
      {sent ? (
        <p className="pv-banner" role="status">
          If there’s an account for {email.trim()}, we’ve emailed it a link. Open it on this device to choose a new password.
        </p>
      ) : (
        <form className="pv-panel pv-form" onSubmit={send} noValidate>
          <div className="pv-field">
            <label htmlFor="reset-email">Email</label>
            <input id="reset-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error ? <p className="pv-errors" role="alert">{error}</p> : null}
          <button type="submit" className="pv-btn pv-btn--primary pv-btn--block" disabled={busy}>{busy ? 'Sending…' : 'Email me a link'}</button>
        </form>
      )}
      <p><Link href="/signin">Back to sign in</Link></p>
    </section>
  );
}
