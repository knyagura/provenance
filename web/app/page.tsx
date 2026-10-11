import Link from 'next/link';
import { CategoryBar } from '@/components/browse/CategoryBar';
import { ExamplesNote } from '@/components/browse/ExamplesNote';
import { ListingGrid } from '@/components/browse/ListingGrid';
import { CatalogueUnavailable, siteCatalogue } from '@/lib/domain/catalogue';
import { fallbackCategories } from '@/lib/domain/examples';
import type { Category, Listing } from '@/lib/domain/types';

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
        <h1 id="hero">Pre-loved, with proof.</h1>
        <p className="pv-lead">
          Every item carries its own record: photographed when listed, sealed and witnessed when it changes hands,
          opened on camera when it arrives.
        </p>
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
          <p className="pv-lead">Nothing is for sale yet.</p>
        )}
      </section>
    </>
  );
}
