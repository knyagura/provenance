import type { Category, Listing } from './types';

// Example catalogue shown on the website while the real one is empty, and in local tests.
// Every listing is marked example: true and the screens say so. The API never returns these.

export const fallbackCategories: Category[] = [
  { slug: 'women', name: 'Women', parentSlug: null },
  { slug: 'men', name: 'Men', parentSlug: null },
  { slug: 'designer', name: 'Designer', parentSlug: null },
  { slug: 'kids', name: 'Kids', parentSlug: null },
  { slug: 'home', name: 'Home', parentSlug: null },
  { slug: 'electronics', name: 'Electronics', parentSlug: null },
  { slug: 'books-media', name: 'Books and media', parentSlug: null },
  { slug: 'hobbies', name: 'Hobbies and collectables', parentSlug: null },
  { slug: 'sport', name: 'Sport', parentSlug: null },
];

type Seed = [
  title: string, brand: string | null, category: string, size: string | null, condition: string,
  pricePence: number, seller: string, verified: boolean, tier: Listing['tier'], description: string,
];

const seeds: Seed[] = [
  ['Barbour Beaufort wax jacket', 'Barbour', 'men', 'M', 'Very good', 4800, 'resole_archive', true, 'enhanced',
    'Classic olive wax jacket, re-waxed last winter. Tartan lining intact, all poppers work.'],
  ['Floral midi dress', 'Whistles', 'women', '10', 'Good', 1200, 'mia.k', false, 'enhanced',
    'Soft viscose, worn to two weddings. Small pull near the hem, shown in the photos.'],
  ['Ceramic table lamp', 'Habitat', 'home', null, 'Good', 1500, 'mia.k', false, 'enhanced',
    'Sage glaze base with linen shade. Fits a standard E27 bulb.'],
  ['Leather belt', 'Ted Baker', 'men', '34', 'Very good', 1400, 'resole_archive', true, 'enhanced',
    'Brown leather with brushed buckle. Light wear on the third hole.'],
  ['Running shorts', 'Adidas', 'sport', 'M', 'Good', 1000, 'resole_archive', true, 'enhanced',
    'Black with inner brief and zip pocket.'],
  ['Saint Laurent Kate bag', 'Saint Laurent', 'designer', null, 'Very good', 89000, 'lens_vault', true, 'luxury',
    'Black grain de poudre leather with gold hardware. Comes with dust bag and receipt.'],
  ['Fujifilm X100V', 'Fujifilm', 'electronics', null, 'Very good', 98000, 'lens_vault', true, 'verified',
    'Silver body, 4,200 shutter count. Two batteries, original box and strap.'],
  ['Wool rollneck jumper', 'COS', 'women', 'S', 'New with tags', 3500, 'mia.k', false, 'enhanced',
    'Oatmeal merino, never worn. Tags attached.'],
  ['Children’s rain jacket', 'Muddy Puddles', 'kids', '5–6 years', 'Good', 900, 'parent_swap', false, 'enhanced',
    'Navy, fully waterproof, reflective trim. Name label removed.'],
  ['Penguin Modern Classics set', null, 'books-media', null, 'Good', 2200, 'parent_swap', false, 'enhanced',
    'Twelve paperbacks, light shelf wear. List of titles in the photos.'],
  ['LEGO Technic 42110', 'LEGO', 'hobbies', null, 'Very good', 7500, 'brick_bench', true, 'verified',
    'Land Rover Defender, complete with instructions. Every bag checked.'],
  ['Trail running shoes', 'Salomon', 'sport', 'UK 9', 'Good', 4200, 'brick_bench', true, 'enhanced',
    'Speedcross 6, about 150 km of use. Plenty of grip left.'],
];

export const exampleCatalogue: Listing[] = seeds.map((s, i) => ({
  id: `example-${i + 1}`,
  itemId: null,
  title: s[0],
  description: s[9],
  brand: s[1],
  category: s[2],
  size: s[3],
  colour: null,
  condition: s[4],
  pricePence: s[5],
  shippingPence: s[5] >= 50000 ? 0 : 399,
  tier: s[8],
  status: 'active',
  media: [],
  seller: { username: s[6], verified: s[7], business: s[6] === 'lens_vault' },
  // Newest first in seed order, an hour apart.
  createdAt: new Date(Date.UTC(2026, 9, 10, 12) - i * 3_600_000).toISOString(),
  example: true,
}));
