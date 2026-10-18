import { TrustLine } from '@/components/market/Trust';
import { ReportButton } from '@/components/safety/Report';
import { MemberPlanBadge } from '@/components/account/Growth';
import { MemberReviews } from '@/components/market/Reviews';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { Badge } from '@/components/ui';
import { ExamplesNote } from '@/components/browse/ExamplesNote';
import { ListingGrid } from '@/components/browse/ListingGrid';
import { getMemberPage } from '@/lib/domain/catalogue';

export const revalidate = 60;

type Props = { params: Promise<{ username: string }> };

const load = cache(async (username: string) => getMemberPage(decodeURIComponent(username)));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await load((await params).username);
  if (!page) return { title: 'Member not found' };
  return {
    title: page.member.username,
    description: page.member.bio ?? `${page.member.username} sells on NuTuYu, where every item carries its chain of custody.`,
    robots: page.examples ? { index: false } : undefined,
  };
}

export default async function MemberPage({ params }: Props) {
  const page = await load((await params).username);
  if (!page) notFound();
  const { member, source, examples } = page;
  const listings = await source.search({ seller: member.username, sort: 'newest', limit: 48, offset: 0 });
  const joined = new Date(member.joined).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return (
    <>
      <section className="pv-section pv-member" aria-labelledby="member-h">
        <span className="pv-seller__avatar pv-member__avatar" aria-hidden="true">{member.username.slice(0, 2).toUpperCase()}</span>
        <div className="pv-member__text">
          <h1 id="member-h">{member.username}</h1>
          <p className="pv-note">Member since {joined}</p>
          <div className="pv-actions">
            {member.verified ? <Badge tone="verified">Identity checked</Badge> : null}
            {member.business ? <Badge tone="neutral">Business seller</Badge> : null}
            <MemberPlanBadge username={member.username} />
            {member.away ? <Badge tone="neutral">On holiday</Badge> : null}
          </div>
          <TrustLine username={member.username} />
          {member.bio ? <p className="pv-item__desc">{member.bio}</p> : null}
        </div>
      </section>
      {member.away ? <p className="pv-banner" role="note">{member.username} is on holiday. You can look, but buying is paused until they’re back.</p> : null}
      <section className="pv-section" aria-labelledby="their-items">
        <h2 id="their-items">For sale</h2>
        {examples ? <ExamplesNote /> : null}
        {listings.items.length ? <ListingGrid listings={listings.items} label={`Listings by ${member.username}`} /> : <p>Nothing for sale right now.</p>}
      </section>
      <MemberReviews username={member.username} />
      {examples ? null : <ReportButton target={{ member: member.username }} label={`Report ${member.username}`} />}
    </>
  );
}
