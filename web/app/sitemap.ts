import type { MetadataRoute } from 'next';
import { config } from '@/lib/config';
import { siteCatalogue } from '@/lib/domain/catalogue';
import type { Listing } from '@/lib/domain/types';
import { fallbackCategories } from '@/lib/domain/examples';
import { brandsIn } from '@/lib/domain/landing';

// Rebuilt at most hourly. Example listings are never listed: they aren't real items.
export const revalidate = 3600;

const PAGE = 100;
const MAX = 5000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = config.siteUrl;
  const fixed: MetadataRoute.Sitemap = ['', '/search', '/developers', '/privacy', '/terms', '/contact', '/gift-cards', '/trust', '/plans'].map((p) => ({
    url: `${base}${p}`, changeFrequency: p === '' || p === '/search' ? 'hourly' : 'monthly', priority: p === '' ? 1 : 0.5,
  }));
  let listings: Listing[] = [];
  try {
    const { source, examples } = await siteCatalogue();
    if (!examples) {
      for (let offset = 0; offset < MAX; offset += PAGE) {
        const page = await source.search({ sort: 'newest', limit: PAGE, offset });
        listings = listings.concat(page.items);
        if (!page.nextCursor || page.items.length < PAGE) break;
      }
    }
  } catch {
    /* the sitemap still lists the fixed pages */
  }
  const sellers = [...new Set(listings.map((l) => l.seller.username))];
  const landing: MetadataRoute.Sitemap = [
    ...fallbackCategories.map((c) => ({ url: `${base}/c/${c.slug}`, changeFrequency: 'daily' as const, priority: 0.7 })),
    ...brandsIn(listings, 200).map((b) => ({ url: `${base}/brand/${b.slug}`, changeFrequency: 'daily' as const, priority: 0.6 })),
  ];
  return [
    ...fixed,
    ...landing,
    ...listings.flatMap((l) => [
      { url: `${base}/item/${l.id}`, lastModified: l.createdAt, changeFrequency: 'daily' as const, priority: 0.8 },
      { url: `${base}/passport/${l.id}`, changeFrequency: 'weekly' as const, priority: 0.4 },
    ]),
    ...sellers.map((u) => ({ url: `${base}/member/${encodeURIComponent(u)}`, changeFrequency: 'daily' as const, priority: 0.5 })),
  ];
}
