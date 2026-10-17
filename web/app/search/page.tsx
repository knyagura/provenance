import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { CategoryBar } from '@/components/browse/CategoryBar';
import { ExamplesNote } from '@/components/browse/ExamplesNote';
import { ListingGrid } from '@/components/browse/ListingGrid';
import { SaveSearch } from '@/components/browse/SaveSearch';
import { BasketSizes, NearMeButton } from '@/components/browse/SearchHelpers';
import { locateDistrict, milesBetween, toDistrict, type Point } from '@/lib/domain/places';
import { CatalogueUnavailable, siteCatalogue } from '@/lib/domain/catalogue';
import { fallbackCategories } from '@/lib/domain/examples';
import { categoryName, countText, resultsHeading } from '@/lib/domain/present';
import { get as getParam, parseSiteQuery, type Params } from '@/lib/domain/query';
import { CONDITIONS, type Listing, type ListingQuery, type Page } from '@/lib/domain/types';

type Props = { searchParams: Promise<Params> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { query } = parseSiteQuery(await searchParams);
  const cat = categoryName(fallbackCategories, query.category);
  return { title: query.q || cat ? resultsHeading(query.q, cat) : 'Search', robots: { index: !query.q } };
}

const SORT_LABELS = { newest: 'Newest first', price_asc: 'Price: low to high', price_desc: 'Price: high to low' } as const;

function pounds(p: number | undefined): string {
  return p === undefined ? '' : (p / 100).toFixed(p % 100 ? 2 : 0);
}

/** Link to the same search at another page (null = the first), keeping every filter. */
function pageHref(params: Params, cursor: string | null): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, string | string[] | undefined>)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s && k !== 'cursor') sp.set(k, s);
  }
  if (cursor) sp.set('cursor', cursor);
  const qs = sp.toString();
  return qs ? `/search?${qs}` : '/search';
}

const sortByDistance = (items: Listing[], p: Point) =>
  [...items].sort((a, b) => (a.seller.area ? milesBetween(p, a.seller.area) : 999) - (b.seller.area ? milesBetween(p, b.seller.area) : 999));

function activeFilterCount(q: ListingQuery): number {
  return [q.condition, q.size, q.near, q.minPence, q.maxPence].filter((v) => v !== undefined).length + (q.sort !== 'newest' ? 1 : 0);
}

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const parsed = parseSiteQuery(params);
  const { errors } = parsed;
  let query = parsed.query;
  // "Collect near SW11": the district's centre becomes the point to search around.
  const nearText = (getParam(params, 'near') ?? '').trim();
  let nearLabel: string | null = query.near ? 'your location' : null;
  if (nearText && !query.near) {
    const d = toDistrict(nearText);
    const p = d ? await locateDistrict(d) : null;
    const miles = Number(getParam(params, 'miles') ?? 10);
    if (p && d) {
      query = { ...query, near: { ...p, miles: [1, 2, 5, 10, 25, 50].includes(miles) ? miles : 10 } };
      nearLabel = d;
    } else errors.push({ name: 'near', reason: 'We couldn’t find that postcode. Try the first half, like SW11.' });
  }

  let categories = fallbackCategories;
  let result: Page<Listing> | null = null;
  let examples = false;
  try {
    const cat = await siteCatalogue();
    examples = cat.examples;
    [categories, result] = await Promise.all([cat.source.categories(), cat.source.search(query)]);
  } catch (e) {
    if (!(e instanceof CatalogueUnavailable)) throw e;
  }

  const catName = categoryName(categories, query.category);
  const heading = resultsHeading(query.q, catName);
  const filters = activeFilterCount(query);

  return (
    <>
      <CategoryBar categories={categories} current={query.category} />
      <div className="pv-results">
        <div className="pv-results__head">
          <h1>{heading}</h1>
          {result ? (
            <p className="pv-note" role="status">
              {countText(query.offset, result.items.length, Boolean(result.nextCursor))}
            </p>
          ) : null}
        </div>

        <SaveSearch
          search={{ q: query.q, category: query.category, size: query.size, condition: query.condition, minPence: query.minPence, maxPence: query.maxPence }}
          categoryName={catName ?? null}
          here={pageHref(params, null)}
        />
        <details className="pv-filters" open={filters > 0 || errors.length > 0}>
          <summary className="pv-btn pv-btn--secondary">Filter and sort{filters ? ` (${filters})` : ''}</summary>
          {/* Keyed so the fields reset when a category link changes the search without a full page load. */}
          <form key={JSON.stringify(query)} action="/search" className="pv-filters__form">
            {query.q ? <input type="hidden" name="q" value={query.q} /> : null}
            <div className="pv-field">
              <label htmlFor="f-category">Category</label>
              <select id="f-category" name="category" defaultValue={query.category ?? ''}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
            <div className="pv-field">
              <label htmlFor="f-condition">Condition</label>
              <select id="f-condition" name="condition" defaultValue={query.condition ?? ''}>
                <option value="">Any condition</option>
                {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="pv-field">
              <BasketSizes current={query.size ?? null} />
              <label htmlFor="f-size">Size</label>
              <input id="f-size" name="size" maxLength={40} placeholder="For example 10, M or UK 9" defaultValue={query.size ?? ''} />
            </div>
            <fieldset className="pv-field pv-near">
              <legend>Collect in person near</legend>
              <div>
                <label htmlFor="f-near" className="pv-visually-hidden">Your postcode or its first half</label>
                <input id="f-near" name="near" placeholder="Postcode, like SW11" maxLength={8} defaultValue={nearLabel && nearLabel !== 'your location' ? nearLabel : nearText} autoComplete="postal-code" />
                <label htmlFor="f-miles" className="pv-visually-hidden">Distance</label>
                <select id="f-miles" name="miles" defaultValue={String(query.near?.miles ?? 10)}>
                  {[1, 2, 5, 10, 25, 50].map((m) => <option key={m} value={m}>within {m} {m === 1 ? 'mile' : 'miles'}</option>)}
                </select>
              </div>
              <NearMeButton miles={query.near?.miles ?? 10} />
            </fieldset>
            <fieldset className="pv-field pv-field--range">
              <legend>Price (£)</legend>
              <div>
                <label htmlFor="f-min" className="pv-visually-hidden">Lowest price in pounds</label>
                <input id="f-min" name="min" inputMode="decimal" placeholder="From" defaultValue={pounds(query.minPence)} aria-invalid={errors.some((e) => e.name === 'min') || undefined} />
                <span aria-hidden="true">to</span>
                <label htmlFor="f-max" className="pv-visually-hidden">Highest price in pounds</label>
                <input id="f-max" name="max" inputMode="decimal" placeholder="To" defaultValue={pounds(query.maxPence)} aria-invalid={errors.some((e) => e.name === 'max') || undefined} />
              </div>
            </fieldset>
            <div className="pv-field">
              <label htmlFor="f-sort">Sort by</label>
              <select id="f-sort" name="sort" defaultValue={query.sort}>
                {Object.entries(SORT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {errors.length ? (
              <div role="alert">
                <ul className="pv-errors">
                  {errors.map((e) => <li key={e.name}>{e.reason}</li>)}
                </ul>
              </div>
            ) : null}
            <div className="pv-filters__actions">
              <button type="submit" className="pv-btn pv-btn--primary">Show results</button>
              <Link href={query.q ? `/search?q=${encodeURIComponent(query.q)}` : '/search'} prefetch={false} className="pv-btn pv-btn--quiet">Clear filters</Link>
            </div>
          </form>
        </details>

        <section className="pv-section pv-results__list" aria-label="Results">
          {examples ? <ExamplesNote /> : null}
          {!result ? (
            <p className="pv-banner pv-banner--warn" role="status">We couldn’t load listings just now. Try again in a minute.</p>
          ) : result.items.length ? (
            <>
              {nearLabel && query.near ? <p className="pv-note" role="status">Sellers who offer collection within {query.near.miles} {query.near.miles === 1 ? 'mile' : 'miles'} of {nearLabel}, nearest first.</p> : null}
              <ListingGrid listings={query.near ? sortByDistance(result.items, query.near) : result.items} label={heading} near={query.near} />
              {result.nextCursor || query.offset > 0 ? (
                <nav className="pv-pager" aria-label="More results">
                  {query.offset > 0 ? <Link href={pageHref(params, null)} prefetch={false} className="pv-btn pv-btn--quiet">Back to the start</Link> : <span />}
                  {result.nextCursor ? <Link href={pageHref(params, result.nextCursor)} prefetch={false} className="pv-btn pv-btn--secondary">More results</Link> : null}
                </nav>
              ) : null}
            </>
          ) : (
            <EmptyState heading title="Nothing matches yet" note="Try fewer words, a wider price range, or another category." action={{ href: '/search', label: 'See everything for sale' }} />
          )}
        </section>
      </div>
    </>
  );
}
