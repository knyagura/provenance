'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { BIO_MAX, usernameProblem } from '@/lib/account/passkeyOffer';
import type { Profile } from '@/lib/selling';

/** Username, bio and holiday mode: what buyers see on the member's page. */
export function ProfileEditor() {
  const { backend, refresh } = useMember();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    backend.myProfile().then((p) => {
      setProfile(p);
      if (p) {
        setUsername(p.username);
        setBio(p.bio);
      }
    }).catch((e: Error) => setError(e.message));
  }, [backend]);

  if (!profile) return error ? <p className="pv-errors" role="alert">{error}</p> : <p role="status">Loading your profile…</p>;

  const userProblem = usernameProblem(username);
  const changed = username.trim() !== profile.username || bio.trim() !== profile.bio;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    if (userProblem) return setError(userProblem);
    setBusy(true);
    const r = await backend.saveProfile({ username: username.trim(), bio });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setProfile({ ...profile!, username: username.trim(), bio: bio.trim() });
    setSaved(true);
    await refresh();
  }

  async function toggleHoliday() {
    setError(null);
    const next = !profile!.holidayMode;
    const r = await backend.saveProfile({ holidayMode: next });
    if (r.ok) setProfile({ ...profile!, holidayMode: next });
    else setError(r.message);
  }

  return (
    <section className="pv-panel pv-form" aria-labelledby="shop-h">
      <div className="pv-panel__head">
        <h2 id="shop-h">Your profile</h2>
        <Link href={`/member/${encodeURIComponent(profile.username)}`}>See your public page</Link>
      </div>
      <form className="pv-form" onSubmit={save} noValidate>
        <div className="pv-field">
          <label htmlFor="username">Username</label>
          <input
            id="username" value={username} maxLength={30} autoComplete="username" autoCapitalize="none" spellCheck={false}
            onChange={(e) => { setUsername(e.target.value); setSaved(false); }}
            aria-invalid={userProblem ? true : undefined} aria-describedby="username-note"
          />
          <span id="username-note" className="pv-note">{userProblem ?? 'Shown on your listings. Letters, numbers, dots, dashes and underscores.'}</span>
        </div>
        <div className="pv-field">
          <label htmlFor="bio">About you (optional)</label>
          <textarea id="bio" value={bio} rows={3} maxLength={BIO_MAX} onChange={(e) => { setBio(e.target.value); setSaved(false); }} aria-describedby="bio-note" />
          <span id="bio-note" className="pv-note">{bio.length} of {BIO_MAX} characters</span>
        </div>
        {error ? <p className="pv-errors" role="alert">{error}</p> : null}
        <div className="pv-actions">
          <button type="submit" className="pv-btn pv-btn--primary" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save profile'}</button>
          {saved ? <span className="pv-note" role="status">Saved</span> : null}
        </div>
      </form>
      <div className="pv-toggle-row">
        <span>
          <strong id="holiday-l">Holiday mode</strong>
          <span className="pv-note" id="holiday-d">
            {profile.holidayMode
              ? 'On. Your listings are hidden from browsing and search, and buying is paused.'
              : 'Away for a while? Hide your listings and pause buying until you’re back.'}
          </span>
        </span>
        <button
          type="button" role="switch" aria-checked={profile.holidayMode} aria-labelledby="holiday-l" aria-describedby="holiday-d"
          className="pv-switch" onClick={toggleHoliday}
        >
          <span aria-hidden="true">{profile.holidayMode ? 'On' : 'Off'}</span>
        </button>
      </div>
    </section>
  );
}
