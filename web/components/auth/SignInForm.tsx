'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useMember } from './MemberProvider';

/** Only send people back to a page on this site. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/profile';
}

export function SignInForm() {
  const { backend, member } = useMember();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (member) {
    return (
      <div className="pv-panel">
        <p>You’re signed in as <strong>{member.username}</strong>.</p>
        <p><Link href={next}>Continue</Link></p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('Your password needs at least 8 characters.');
    setBusy(true);
    try {
      if (mode === 'in') {
        const r = await backend.signIn(email.trim(), password);
        if (!r.ok) return setError(r.message);
        router.push(next);
      } else {
        const r = await backend.signUp(email.trim(), password);
        if (!r.ok) return setError(r.message);
        if (r.value.needsConfirmation) {
          setNotice('Check your email and open the link to confirm your account. Then sign in here.');
          setMode('in');
        } else {
          router.push(next);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pv-panel pv-form" onSubmit={submit} noValidate>
      <div className="pv-field">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="pv-field">
        <label htmlFor="password">Password</label>
        <input
          id="password" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} aria-describedby="pw-note"
        />
        <span id="pw-note" className="pv-note">At least 8 characters.</span>
      </div>
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      {notice ? <p className="pv-banner" role="status">{notice}</p> : null}
      <button type="submit" className="pv-btn pv-btn--primary pv-btn--block" disabled={busy}>
        {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}
      </button>
      <button type="button" className="pv-btn pv-btn--quiet" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); }}>
        {mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
    </form>
  );
}
