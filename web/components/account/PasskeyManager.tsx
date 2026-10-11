'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { passkeysAvailable } from '@/lib/account/passkeyOffer';
import type { Passkey } from '@/lib/selling';

const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The member's passkeys: add, rename, remove. */
export function PasskeyManager() {
  const { backend } = useMember();
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    const r = await backend.passkeys();
    if (r.ok) setKeys(r.value);
    else {
      setKeys([]);
      setError(r.message);
    }
  }, [backend]);

  useEffect(() => {
    setSupported(passkeysAvailable());
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    const r = await backend.addPasskey();
    setBusy(false);
    if (!r.ok) return setError(r.message);
    await load();
  }

  async function rename(id: string) {
    const r = await backend.renamePasskey(id, name);
    if (!r.ok) return setError(r.message);
    setEditing(null);
    await load();
  }

  async function remove(p: Passkey) {
    setError(null);
    const r = await backend.removePasskey(p.id);
    if (!r.ok) return setError(r.message);
    await load();
  }

  return (
    <section className="pv-panel" aria-labelledby="pk-h">
      <h2 id="pk-h">Passkeys</h2>
      <p className="pv-note">Sign in with Face ID, your fingerprint or your screen lock instead of a password. Add one on each phone or computer you use.</p>
      {keys === null ? <p role="status">Loading…</p> : keys.length === 0 ? <p>No passkeys yet.</p> : (
        <ul className="pv-rows" aria-label="Your passkeys">
          {keys.map((p) => (
            <li key={p.id} className="pv-row pv-row--plain">
              {editing === p.id ? (
                <form className="pv-inline-form" onSubmit={(e) => { e.preventDefault(); void rename(p.id); }}>
                  <label htmlFor={`pk-${p.id}`} className="pv-visually-hidden">Name for this passkey</label>
                  <input id={`pk-${p.id}`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
                  <button type="submit" className="pv-btn pv-btn--secondary">Save</button>
                  <button type="button" className="pv-btn pv-btn--quiet" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <span className="pv-row__text">
                    <strong>{p.name}</strong>
                    <span className="pv-note">Added {when(p.createdAt)}{p.lastUsedAt ? ` · last used ${when(p.lastUsedAt)}` : ''}</span>
                  </span>
                  <span className="pv-actions">
                    <button type="button" className="pv-btn pv-btn--quiet" onClick={() => { setEditing(p.id); setName(p.name); }} aria-label={`Rename ${p.name}`}>Rename</button>
                    <button type="button" className="pv-btn pv-btn--quiet" onClick={() => remove(p)} aria-label={`Remove ${p.name}`}>Remove</button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      {supported ? (
        <button type="button" className="pv-btn pv-btn--secondary" onClick={add} disabled={busy}>
          {busy ? 'Waiting for your device…' : 'Add a passkey on this device'}
        </button>
      ) : (
        <p className="pv-note">This browser can’t create passkeys. Try Safari on iPhone or Chrome on Android.</p>
      )}
    </section>
  );
}
