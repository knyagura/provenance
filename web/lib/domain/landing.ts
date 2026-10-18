// Category and brand landing pages: words for each category, brand slugs, and structured data for search engines.
import { config } from '@/lib/config';
import { TIER_LABEL } from './present';
import type { Listing } from './types';

export const CATEGORY_INTRO: Record<string, string> = {
  women: 'Pre-loved womenswear: dresses, coats, knitwear and shoes, each with photos taken in the app and a recorded handover.',
  men: 'Pre-loved menswear: jackets, shirts, knitwear and shoes, photographed when listed and handed over on the record.',
  designer: 'Designer bags, shoes and clothing, authenticated by an independent hub from £500 and twice from £1,500.',
  kids: 'Children’s clothes, shoes and toys, passed on with photos of the real item and buyer protection.',
  home: 'Lamps, ceramics, textiles and furniture for the home, with every handover recorded.',
  electronics: 'Cameras, phones and gadgets with a working video and the serial number checked, courier-witnessed from £75.',
  'books-media': 'Books, records and films, photographed when listed and posted with tracking.',
  hobbies: 'Collectables, LEGO, games and kit for your hobbies, with a recorded handover.',
  sport: 'Sportswear, running shoes and equipment, pre-loved and protected.',
};

/** "Barbour" → "barbour"; "Saint Laurent" → "saint-laurent". */
export function brandSlug(brand: string): string {
  return brand.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Brands present in these listings, most items first. */
export function brandsIn(listings: Listing[], max = 12): { name: string; slug: string; count: number }[] {
  const m = new Map<string, { name: string; slug: string; count: number }>();
  for (const l of listings) {
    if (!l.brand) continue;
    const slug = brandSlug(l.brand);
    if (!slug) continue;
    const e = m.get(slug) ?? { name: l.brand, slug, count: 0 };
    e.count++;
    m.set(slug, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, max);
}

/** CollectionPage with its items and breadcrumbs (schema.org). Example listings are left out: they aren't for sale. */
export function collectionLd(name: string, path: string, listings: Listing[], crumbs: { name: string; path: string }[]) {
  const real = listings.filter((l) => !l.example);
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name,
      url: `${config.siteUrl}${path}`,
      ...(real.length ? {
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: real.slice(0, 24).map((l, i) => ({
            '@type': 'ListItem', position: i + 1, url: `${config.siteUrl}/item/${l.id}`, name: l.title,
            description: `${TIER_LABEL[l.tier]} · £${(l.pricePence / 100).toFixed(2)}`,
          })),
        },
      } : {}),
    },
    breadcrumbLd(crumbs),
  ];
}

export function breadcrumbLd(crumbs: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${config.siteUrl}${c.path}` })),
  };
}

export const jsonLd = (x: unknown) => JSON.stringify(x).replace(/</g, '\\u003c');
