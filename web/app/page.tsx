import Link from 'next/link';
import { CategoryBar } from '@/components/browse/CategoryBar';
import { ExamplesNote } from '@/components/browse/ExamplesNote';
import { ListingGrid } from '@/components/browse/ListingGrid';
import { HeroArt } from '@/components/browse/HeroArt';
import { EmptyState } from '@/components/EmptyState';
import { CameraIcon, EyeIcon, PackageIcon, TierBadge } from '@/components/ui';
import { TIER_FROM, TIER_NOTE } from '@/lib/domain/present';
import { formatPence } from '@/lib/format';
import { CatalogueUnavailable, siteCatalogue } from '@/lib/domain/catalogue';
import { fallbackCategories } from '@/lib/domain/examples';
import type { Category, Listing, Tier } from '@/lib/domain/types';

const TIERS: Tier[] = ['enhanced', 'verified', 'luxury', 'ultraLuxury'];
const STEPS = [
  { icon: <CameraIcon />, title: 'Listed with proof', note: 'The app asks for the right photos for each kind of item, so the listing is the reference.' },
  { icon: <PackageIcon />, title: 'Sealed and witnessed', note: 'From £75 a courier watches it packed and fits a numbered seal. Over £500 it’s authenticated too.' },
  { icon: <EyeIcon />, title: 'Opened on camera', note: 'You check the seal and open it on camera. The seller is paid when you confirm.' },
];

// Rebuilt at most once a minute, so most visits are served from the cache (no function call).
export const revalidate = 60;

async function load(): Promise<{ categories: Category[]; newest: Listing[]; examples: boolean; failed: boolean }> {
  try {
    const { source, examples } = await siteCatalogue();
    const [categories, page] = await Promise.all([
      source.categories(),
      source.search({ sort: 'newest', limit: 12, offset: 0 }),
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
      <section className="pv-hero" aria-labelledby="hero">
        <div className="pv-hero__text">
          <h1 id="hero">Pre-loved, with proof.</h1>
          <p className="pv-lead">
            Every item carries its own record: photographed when listed, sealed and witnessed when it changes hands,
            opened on camera when it arrives.
          </p>
          <div className="pv-actions">
            <Link className="pv-btn pv-btn--primary" href="/search">Start browsing</Link>
            <Link className="pv-btn pv-btn--secondary" href="/sell">Sell an item</Link>
          </div>
        </div>
        <HeroArt />
      </section>

      <section className="pv-section" aria-labelledby="how">
        <h2 id="how" className="pv-visually-hidden">How it works</h2>
        <ol className="pv-how">
          {STEPS.map((st, i) => (
            <li key={st.title}>
              <span className="pv-how__icon" aria-hidden="true">{st.icon}</span>
              <span className="pv-how__num">{i + 1}</span>
              <strong>{st.title}</strong>
              <span className="pv-note">{st.note}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="pv-section" aria-labelledby="newest">
        <div className="pv-section__head">
          <h2 id="newest">Newly listed</h2>
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
          <h2 id="protect">Protection grows with the price</h2>
        </div>
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
