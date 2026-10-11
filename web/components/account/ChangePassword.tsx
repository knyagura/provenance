'use client';

import { useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';

export function ChangePassword() {
  const { backend } = useMember();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (password.length < 8) return setError('Your password needs at least 8 characters.');
    setBusy(true);
    const r = await backend.setPassword(password);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setPassword('');
    setDone(true);
  }

  return (
    <form className="pv-panel pv-form" onSubmit={save} noValidate aria-labelledby="pw-h">
      <h2 id="pw-h">Password</h2>
      <div className="pv-field">
        <label htmlFor="change-password">New password</label>
        <input id="change-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="cp-note" />
        <span id="cp-note" className="pv-note">At least 8 characters.</span>
      </div>
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      <div className="pv-actions">
        <button type="submit" className="pv-btn pv-btn--secondary" disabled={busy || !password}>{busy ? 'Saving…' : 'Change password'}</button>
        {done ? <span className="pv-note" role="status">Password changed</span> : null}
      </div>
    </form>
  );
}
