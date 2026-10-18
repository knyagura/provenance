import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ListingGrid } from '@/components/browse/ListingGrid';
import { ExamplesNote } from '@/components/browse/ExamplesNote';
import { siteCatalogue } from '@/lib/domain/catalogue';
import { brandSlug, collectionLd, jsonLd } from '@/lib/domain/landing';

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

// The brand's name as sellers wrote it, found from recent listings (a slug like "saint-laurent" has lost its spelling).
async function load(slug: string) {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  const { source, examples } = await siteCatalogue();
  const recent = await source.search({ q: slug.replace(/-/g, ' '), sort: 'newest', limit: 48, offset: 0 });
  const name = recent.items.find((l) => l.brand && brandSlug(l.brand) === slug)?.brand;
  if (!name) return null;
  const page = await source.search({ brand: name, sort: 'newest', limit: 24, offset: 0 });
  return { name, items: page.items, more: !!page.nextCursor, examples };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await load((await params).slug).catch(() => null);
  if (!d) return { title: 'Brand not found' };
  return {
    title: `Pre-loved ${d.name}`,
    description: `Pre-loved ${d.name} on NuTuYu: photographed in the app, handed over on the record, with buyer protection.`,
    alternates: { canonical: `/brand/${brandSlug(d.name)}` },
  };
}

export default async function BrandPage({ params }: Props) {
  const d = await load((await params).slug);
  if (!d) notFound();
  const path = `/brand/${brandSlug(d.name)}`;
  return (
    <section className="pv-section pv-landing" aria-labelledby="landing-h">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(collectionLd(d.name, path, d.items, [{ name: 'Home', path: '/' }, { name: d.name, path }])) }} />
      <nav className="pv-crumbs" aria-label="Breadcrumb"><ol><li><Link href="/">Home</Link></li><li aria-current="page">{d.name}</li></ol></nav>
      <h1 id="landing-h">Pre-loved {d.name}</h1>
      <p className="pv-lead">Every {d.name} item here was photographed in the app when it was listed, and is handed over on the record with buyer protection.</p>
      {d.examples ? <ExamplesNote /> : null}
      <ListingGrid listings={d.items} label={d.name} />
      <p><Link className="pv-btn pv-btn--secondary" href={`/search?q=${encodeURIComponent(d.name)}`}>Search for {d.name}</Link></p>
    </section>
  );
}
