import Link from 'next/link';
import { CategoryBar } from '@/components/browse/CategoryBar';
import { ExamplesNote } from '@/components/browse/ExamplesNote';
import { ListingGrid } from '@/components/browse/ListingGrid';
import { EmptyState } from '@/components/EmptyState';
import { TierBadge } from '@/components/ui';
import { TIER_FROM, TIER_NOTE } from '@/lib/domain/present';
import { formatPence } from '@/lib/format';
import { CatalogueUnavailable, siteCatalogue } from '@/lib/domain/catalogue';
import { fallbackCategories } from '@/lib/domain/examples';
import type { Category, Listing, Tier } from '@/lib/domain/types';

const TIERS: Tier[] = ['enhanced', 'verified', 'luxury', 'ultraLuxury'];

// Rebuilt at most once a minute, so most visits are served from the cache (no function call).
export const revalidate = 60;

async function load(): Promise<{ categories: Category[]; newest: Listing[]; examples: boolean; failed: boolean }> {
  try {
    const { source, examples } = await siteCatalogue();
    const [categories, page] = await Promise.all([
      source.categories(),
      source.search({ sort: 'newest', limit: 20, offset: 0 }),
    ]);
    return { categories, newest: page.items, examples, failed: false };
  } catch (e) {
    if (!(e instanceof CatalogueUnavailable)) throw e;
    return { categories: fallbackCategories, newest: [], examples: false, failed: true };
  }
}

export default async function HomePage() {
  const { categories, newest, examples, failed } = await load();
  return (
    <>
      <CategoryBar categories={categories} />
      {/* Straight to the items. Popups (offers, announcements) are set up by staff in the console and are off by default. */}
      <section className="pv-section pv-home" aria-labelledby="newest">
        <div className="pv-section__head">
          <h1 id="newest" className="pv-home__title">Newly listed</h1>
          <Link href="/search">See everything</Link>
        </div>
        {examples ? <ExamplesNote /> : null}
        {failed ? (
          <p className="pv-banner pv-banner--warn" role="status">We couldn’t load listings just now. Try again in a minute.</p>
        ) : newest.length ? (
          <ListingGrid listings={newest} label="Newly listed items" />
        ) : (
          <EmptyState heading title="Nothing is for sale yet" note="Be the first: list something and it appears here." action={{ href: '/sell', label: 'Sell an item' }} />
        )}
      </section>

      <section className="pv-section" aria-labelledby="protect">
        <div className="pv-section__head">
          <h2 id="protect">More protection for higher-value items</h2>
        </div>
        <p className="pv-lead">The price you list your item for determines the standard checks included with its sale. Higher-value items receive additional checks, such as a recorded courier handover or independent authentication. Any protection or authentication charges will be shown clearly before you pay.</p>
        <ul className="pv-tiers">
          {TIERS.map((t) => (
            <li key={t}>
              <TierBadge tier={t} size="large" />
              <span className="pv-tiers__from">{TIER_FROM[t] ? `From ${formatPence(TIER_FROM[t]).replace('.00', '')}` : 'Every item'}</span>
              <span className="pv-note">{TIER_NOTE[t]}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
