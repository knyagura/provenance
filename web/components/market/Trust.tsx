'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';
import { Badge } from '@/components/ui';
import { TIER_LABEL } from '@/lib/domain/present';
import type { SellerTrust, TrustStats } from '@/lib/selling/types';

export function handoverTime(hours: number): string {
  if (hours < 36) return `about ${Math.max(1, Math.round(hours))} ${Math.round(hours) === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  return `about ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** What a seller's record says, in words. */
export function trustWords(t: SellerTrust): string[] {
  if (!t.finished) return ['New seller: no protected handovers yet'];
  const out = [`${t.completed} protected ${t.completed === 1 ? 'handover' : 'handovers'} completed`];
  out.push(t.disputeRate === null ? 'too few sales yet for a dispute rate' : `${t.disputeRate}% disputed`);
  if (t.avgHandoverHours !== null) out.push(`usually done in ${handoverTime(t.avgHandoverHours)}`);
  return out;
}

/** A seller's badges and record, for item pages and member pages. */
export function TrustLine({ username, badges = true }: { username: string; badges?: boolean }) {
  const { backend } = useMember();
  const [t, setT] = useState<SellerTrust | null>(null);
  useEffect(() => {
    backend.sellerTrust(username).then(setT).catch(() => setT(null));
  }, [backend, username]);
  if (!t) return null;
  return (
    <span className="pv-trust">
      {badges && t.trusted ? <Badge tone="verified">Trusted seller</Badge> : null}
      <span className="pv-note">{trustWords(t).join(' · ')}</span>
    </span>
  );
}

/** The public tracker: protected handovers completed on NuTuYu, without anyone's details. */
export function TrustTracker({ example }: { example: boolean }) {
  const { backend } = useMember();
  const [s, setS] = useState<TrustStats | null | undefined>(undefined);
  useEffect(() => {
    backend.trustStats().then(setS).catch(() => setS(null));
  }, [backend]);
  if (s === undefined) return <p role="status">Counting…</p>;
  if (!s) return <p>The tracker isn’t available right now. Try again in a minute.</p>;
  const rate = s.finished ? Math.round((1000 * s.disputes) / s.finished) / 10 : null;
  const tiers = (Object.keys(TIER_LABEL) as (keyof typeof TIER_LABEL)[]).filter((k) => s.byTier[k]);
  return (
    <>
      {example ? <p className="pv-banner" role="note">Example mode: these figures count the example orders in this browser only.</p> : null}
      <dl className="pv-stats" aria-label="Protected handovers">
        <div><dt>Protected handovers completed</dt><dd>{s.completed.toLocaleString('en-GB')}</dd></div>
        <div><dt>In the last 30 days</dt><dd>{s.completed30d.toLocaleString('en-GB')}</dd></div>
        <div><dt>Disputed</dt><dd>{rate === null ? '–' : `${rate}%`}</dd></div>
        <div><dt>Typical time from payment to confirmation</dt><dd>{s.avgHandoverHours === null ? '–' : handoverTime(s.avgHandoverHours)}</dd></div>
      </dl>
      <p className="pv-note">
        Disputed counts every order where the buyer reported a problem, whatever the outcome. {s.refunds ? `${s.refunds} ${s.refunds === 1 ? 'was' : 'were'} refunded.` : ''}
      </p>
      {tiers.length ? (
        <section aria-labelledby="by-tier">
          <h2 id="by-tier" className="pv-h3">By level of protection</h2>
          <ul className="pv-stats__tiers">
            {tiers.map((k) => <li key={k}><strong>{s.byTier[k]}</strong> {TIER_LABEL[k]}</li>)}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="recent-h">
        <h2 id="recent-h" className="pv-h3">Recently completed</h2>
        {s.recent.length ? (
          <ul className="pv-stats__recent">
            {s.recent.map((r) => (
              <li key={`${r.listingId}-${r.confirmedOn}`}>
                <Link href={`/passport/${r.listingId}`}>{r.title}</Link>
                <span className="pv-note">{TIER_LABEL[r.tier]} · {new Date(r.confirmedOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              </li>
            ))}
          </ul>
        ) : <p>None yet. Each one appears here once its buyer confirms.</p>}
      </section>
    </>
  );
}
