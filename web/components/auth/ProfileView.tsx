'use client';

import { InstallApp } from '@/components/pwa/InstallApp';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChangePassword } from '@/components/account/ChangePassword';
import { MyOrders } from '@/components/checkout/MyOrders';
import { PasskeyManager } from '@/components/account/PasskeyManager';
import { ProfileEditor } from '@/components/account/ProfileEditor';
import { CollectionSettings } from '@/components/account/CollectionSettings';
import { PayoutsPanel } from '@/components/account/Payouts';
import { MyListings } from '@/components/sell/MyListings';
import { NotificationSettings } from '@/components/market/Notifications';
import type { Draft } from '@/lib/selling';
import { useMember } from './MemberProvider';

export function ProfileView() {
  const { member, loading, backend } = useMember();
  const router = useRouter();
  const [mine, setMine] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState(false);

  useEffect(() => {
    if (!member) return;
    backend.myListings().then(setMine).catch((e: Error) => setError(e.message));
    backend.isStaff().then(setStaff).catch(() => setStaff(false));
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
          <Link className="pv-btn pv-btn--secondary" href="/selling">Your sales</Link>
          <Link className="pv-btn pv-btn--secondary" href="/saved">Saved items</Link>
          <Link className="pv-btn pv-btn--secondary" href="/gift-cards">Gift cards and balance</Link>
          <Link className="pv-btn pv-btn--secondary" href={`/member/${encodeURIComponent(member.username)}`}>Your public page</Link>
          {staff ? <Link className="pv-btn pv-btn--secondary" href="/staff">Staff console</Link> : null}
          <button type="button" className="pv-btn pv-btn--secondary" onClick={async () => { await backend.signOut(); router.push('/'); }}>
            Sign out
          </button>
        </div>
        <InstallApp />
      </section>
      <MyOrders />
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      {mine === null && !error ? <p role="status">Loading your listings…</p> : null}
      {mine && mine.length === 0 ? <p>You haven’t listed anything yet.</p> : null}
      {mine ? <MyListings drafts={mine} heading="Your listings" /> : null}
      <div className="pv-account">
        <PayoutsPanel />
        <ProfileEditor />
        <CollectionSettings />
        <NotificationSettings />
        <PasskeyManager />
        <ChangePassword />
      </div>
    </>
  );
}
