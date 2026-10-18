import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ListingGrid } from '@/components/browse/ListingGrid';
import { ExamplesNote } from '@/components/browse/ExamplesNote';
import { siteCatalogue } from '@/lib/domain/catalogue';
import { fallbackCategories } from '@/lib/domain/examples';
import { brandsIn, CATEGORY_INTRO, collectionLd, jsonLd } from '@/lib/domain/landing';

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const { source, examples } = await siteCatalogue();
  const cats = await source.categories().catch(() => fallbackCategories);
  const cat = cats.find((c) => c.slug === slug) ?? fallbackCategories.find((c) => c.slug === slug);
  if (!cat) return null;
  const page = await source.search({ category: slug, sort: 'newest', limit: 24, offset: 0 });
  return { cat, items: page.items, more: !!page.nextCursor, examples };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await load((await params).slug).catch(() => null);
  if (!d) return { title: 'Category not found' };
  return {
    title: `Pre-loved ${d.cat.name.toLowerCase()}`,
    description: CATEGORY_INTRO[d.cat.slug] ?? `Pre-loved ${d.cat.name.toLowerCase()} on NuTuYu, each sold with its custody record.`,
    alternates: { canonical: `/c/${d.cat.slug}` },
  };
}

export default async function CategoryPage({ params }: Props) {
  const d = await load((await params).slug);
  if (!d) notFound();
  const brands = brandsIn(d.items);
  const path = `/c/${d.cat.slug}`;
  return (
    <section className="pv-section pv-landing" aria-labelledby="landing-h">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(collectionLd(d.cat.name, path, d.items, [{ name: 'Home', path: '/' }, { name: d.cat.name, path }])) }} />
      <nav className="pv-crumbs" aria-label="Breadcrumb"><ol><li><Link href="/">Home</Link></li><li aria-current="page">{d.cat.name}</li></ol></nav>
      <h1 id="landing-h">Pre-loved {d.cat.name.toLowerCase()}</h1>
      <p className="pv-lead">{CATEGORY_INTRO[d.cat.slug] ?? 'Each item is sold with its custody record.'}</p>
      {brands.length ? (
        <nav aria-label={`Brands in ${d.cat.name}`} className="pv-chips">
          {brands.map((b) => <Link key={b.slug} className="pv-chip" href={`/brand/${b.slug}`}>{b.name}</Link>)}
        </nav>
      ) : null}
      {d.examples ? <ExamplesNote /> : null}
      {d.items.length ? <ListingGrid listings={d.items} label={d.cat.name} /> : <p>Nothing here right now. New items are listed every day.</p>}
      <p><Link className="pv-btn pv-btn--secondary" href={`/search?category=${d.cat.slug}`}>{d.more ? `See all ${d.cat.name.toLowerCase()}, with filters` : 'Filter and sort'}</Link></p>
    </section>
  );
}
