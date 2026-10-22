'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { ROOT_CATEGORIES } from '@/lib/domain/taxonomy';
import { profileFor } from '@/lib/domain/evidence';
import type { Draft } from '@/lib/selling';
import { MyListings } from './MyListings';

/** Step one of selling: pick a category. That sets which photos the camera asks for. */
export function SellStart() {
  const { member, loading, backend } = useMember();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (member) backend.myListings().then((all) => setDrafts(all.filter((d) => !d.published))).catch(() => {});
  }, [member, backend]);

  if (loading) return <p role="status">Loading…</p>;
  if (!member) {
    return (
      <section className="pv-section pv-narrow">
        <h1>Sell an item</h1>
        <p className="pv-lead">Sign in to list something. It takes a few minutes, and the photos you take become the item’s record.</p>
        <p><Link className="pv-btn pv-btn--primary" href="/signin?next=/sell">Sign in to sell</Link></p>
      </section>
    );
  }

  async function start(slug: string) {
    setBusy(slug);
    setError(null);
    const r = await backend.createDraft(slug);
    if (r.ok) router.push(`/sell/${r.value}`);
    else {
      setError(r.message);
      setBusy(null);
    }
  }

  return (
    <>
      <section className="pv-section" aria-labelledby="what">
        <h1 id="what">What are you selling?</h1>
        <p className="pv-lead">Choose a category. We’ll ask for the photos buyers of that kind of item expect, and they become the item’s record if anything is disputed.</p>
        {error ? <p className="pv-errors" role="alert">{error}</p> : null}
        <ul className="pv-picks">
          {ROOT_CATEGORIES.map((c) => {
            const p = profileFor(c.slug);
            const req = p?.shots.filter((s) => s.required && s.kind === 'photo').length ?? 0;
            return (
              <li key={c.slug}>
                <button type="button" className="pv-pick" onClick={() => start(c.slug)} disabled={busy !== null}>
                  <strong>{c.name}</strong>
                  <span className="pv-note">
                    {busy === c.slug ? 'Starting…' : `${req} photos${p?.shots.some((s) => s.kind === 'video' && s.required) ? ' and a short video' : ''}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <MyListings drafts={drafts} heading="Carry on with a draft" />
    </>
  );
}
