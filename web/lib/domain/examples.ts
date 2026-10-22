import type { Category, Listing } from './types';
import { ALL_CATEGORIES } from './taxonomy';

// Example catalogue shown on the website while the real one is empty, and in local tests.
// Every listing is marked example: true and the screens say so. The API never returns these.

export const fallbackCategories: Category[] = ALL_CATEGORIES;

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

// Where example sellers are, for "near me" (districts only). lens_vault doesn't offer collection.
const EXAMPLE_AREAS: Record<string, { district: string; lat: number; lng: number }> = {
  resole_archive: { district: 'SW11', lat: 51.46, lng: -0.16 },
  'mia.k': { district: 'E8', lat: 51.54, lng: -0.06 },
  parent_swap: { district: 'M20', lat: 53.43, lng: -2.23 },
  brick_bench: { district: 'BS6', lat: 51.47, lng: -2.6 },
};

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
  serialHint: s[2] === 'electronics' ? '4D7K' : null,
  pricePence: s[5],
  shippingPence: s[5] >= 50000 ? 0 : 399,
  tier: s[8],
  status: 'active',
  revision: 1,
  // Drawn pictures (scripts/example-art.mjs): the whole item, a close-up and its label.
  media: (['front', 'detail', 'label'] as const).map((shot) => ({ url: `/examples/example-${i + 1}-${shot}.svg`, kind: 'photo' as const, shot })),
  seller: { username: s[6], verified: s[7], business: s[6] === 'lens_vault', away: false, area: EXAMPLE_AREAS[s[6]] ?? null },
  // Newest first in seed order, an hour apart.
  createdAt: new Date(Date.UTC(2026, 9, 10, 12) - i * 3_600_000).toISOString(),
  example: true,
}));

// A business seller's item in two colours and two sizes, each with its own stock (migration 018).
// They share the jumper drawings; search shows the first one.
const VARIANTS: [colour: string, size: string, stock: number][] = [
  ['Oatmeal', 'S', 3], ['Oatmeal', 'M', 2], ['Charcoal', 'S', 1], ['Charcoal', 'M', 4],
];
const base = exampleCatalogue.length;
exampleCatalogue.push(...VARIANTS.map(([colour, size, stock], i): Listing => ({
  id: `example-${base + i + 1}`,
  itemId: null,
  title: 'Merino crew jumper',
  description: 'Fine-knit extra-fine merino, made in Scotland. New, from our shop: each one you buy is its own protected order.',
  brand: 'Knit House',
  category: 'women',
  size,
  colour,
  condition: 'New with tags',
  serialHint: null,
  pricePence: 6500,
  shippingPence: 399,
  tier: 'enhanced',
  status: 'active',
  revision: 1,
  media: (['front', 'detail', 'label'] as const).map((shot) => ({ url: `/examples/example-8-${shot}.svg`, kind: 'photo' as const, shot })),
  seller: { username: 'knit_house', verified: true, business: true, away: false },
  createdAt: new Date(Date.UTC(2026, 9, 9, 12) + i * 60_000).toISOString(),
  example: true,
  stock,
  variantGroup: 'example-merino',
  browseVisible: i === 0,
})));
