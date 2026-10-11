'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MyListings } from '@/components/sell/MyListings';
import type { Draft } from '@/lib/selling';
import { useMember } from './MemberProvider';

export function ProfileView() {
  const { member, loading, backend } = useMember();
  const router = useRouter();
  const [mine, setMine] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    backend.myListings().then(setMine).catch((e: Error) => setError(e.message));
  }, [member, backend]);

  if (loading) return <p role="status">Loading your account…</p>;
  if (!member) {
    return (
      <section className="pv-section pv-narrow">
        <h1>Your account</h1>
        <p className="pv-lead">Sign in to see your listings and sell.</p>
        <p><Link className="pv-btn pv-btn--primary" href="/signin?next=/profile">Sign in</Link></p>
      </section>
    );
  }
  return (
    <>
      <section className="pv-section">
        <p className="pv-eyebrow">Your account</p>
        <h1>{member.username}</h1>
        <p className="pv-note">{member.email}</p>
        <div className="pv-actions">
          <Link className="pv-btn pv-btn--primary" href="/sell">Sell an item</Link>
          <button type="button" className="pv-btn pv-btn--secondary" onClick={async () => { await backend.signOut(); router.push('/'); }}>
            Sign out
          </button>
        </div>
      </section>
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      {mine === null && !error ? <p role="status">Loading your listings…</p> : null}
      {mine && mine.length === 0 ? <p>You haven’t listed anything yet.</p> : null}
      {mine ? <MyListings drafts={mine} heading="Your listings" /> : null}
    </>
  );
}
