import type { Category } from './types';

/** Canonical catalogue hierarchy. Slugs are stable identifiers stored on listings. */
export const CATEGORY_TREE: Category[] = [
  { slug: 'women', name: "Women's Wear", parentSlug: null },
  { slug: 'women-accessories', name: 'Accessories', parentSlug: 'women' },
  { slug: 'women-accessories-belts', name: 'Belts', parentSlug: 'women-accessories' },
  { slug: 'women-accessories-hats', name: 'Hats', parentSlug: 'women-accessories' },
  { slug: 'women-accessories-jewellery', name: 'Jewellery', parentSlug: 'women-accessories' },
  { slug: 'women-accessories-scarves', name: 'Scarves', parentSlug: 'women-accessories' },
  { slug: 'women-accessories-sunglasses', name: 'Sunglasses', parentSlug: 'women-accessories' },
  { slug: 'women-bags', name: 'Bags', parentSlug: 'women' },
  { slug: 'women-bags-handbags', name: 'Handbags', parentSlug: 'women-bags' },
  { slug: 'women-bags-shoulder-bags', name: 'Shoulder bags', parentSlug: 'women-bags' },
  { slug: 'women-bags-tote-bags', name: 'Tote bags', parentSlug: 'women-bags' },
  { slug: 'women-bags-clutches', name: 'Clutches', parentSlug: 'women-bags' },
  { slug: 'women-clothing', name: 'Clothing', parentSlug: 'women' },
  { slug: 'women-clothing-dresses', name: 'Dresses', parentSlug: 'women-clothing' },
  { slug: 'women-clothing-tops', name: 'Tops', parentSlug: 'women-clothing' },
  { slug: 'women-clothing-trousers', name: 'Trousers', parentSlug: 'women-clothing' },
  { slug: 'women-clothing-jeans', name: 'Jeans', parentSlug: 'women-clothing' },
  { slug: 'women-clothing-skirts', name: 'Skirts', parentSlug: 'women-clothing' },
  { slug: 'women-clothing-knitwear', name: 'Knitwear', parentSlug: 'women-clothing' },
  { slug: 'women-clothing-outerwear', name: 'Outerwear', parentSlug: 'women-clothing' },
  { slug: 'women-clothing-shorts', name: 'Shorts', parentSlug: 'women-clothing' },
  { slug: 'women-clothing-activewear', name: 'Activewear', parentSlug: 'women-clothing' },
  { slug: 'women-clothing-underwear', name: 'Underwear and nightwear', parentSlug: 'women-clothing' },
  { slug: 'women-shoes', name: 'Shoes', parentSlug: 'women' },
  { slug: 'women-shoes-boots', name: 'Boots', parentSlug: 'women-shoes' },
  { slug: 'women-shoes-flats', name: 'Flats', parentSlug: 'women-shoes' },
  { slug: 'women-shoes-heels', name: 'Heels', parentSlug: 'women-shoes' },
  { slug: 'women-shoes-trainers', name: 'Trainers', parentSlug: 'women-shoes' },
  { slug: 'women-shoes-sandals', name: 'Sandals', parentSlug: 'women-shoes' },
  { slug: 'men', name: "Men's Wear", parentSlug: null },
  { slug: 'men-accessories', name: 'Accessories', parentSlug: 'men' },
  { slug: 'men-accessories-belts', name: 'Belts', parentSlug: 'men-accessories' },
  { slug: 'men-accessories-hats', name: 'Hats', parentSlug: 'men-accessories' },
  { slug: 'men-accessories-watches', name: 'Watches', parentSlug: 'men-accessories' },
  { slug: 'men-bags', name: 'Bags', parentSlug: 'men' },
  { slug: 'men-clothing', name: 'Clothing', parentSlug: 'men' },
  { slug: 'men-clothing-shirts', name: 'Shirts', parentSlug: 'men-clothing' },
  { slug: 'men-clothing-t-shirts', name: 'T-shirts', parentSlug: 'men-clothing' },
  { slug: 'men-clothing-trousers', name: 'Trousers', parentSlug: 'men-clothing' },
  { slug: 'men-clothing-jeans', name: 'Jeans', parentSlug: 'men-clothing' },
  { slug: 'men-clothing-knitwear', name: 'Knitwear', parentSlug: 'men-clothing' },
  { slug: 'men-clothing-outerwear', name: 'Outerwear', parentSlug: 'men-clothing' },
  { slug: 'men-clothing-suits', name: 'Suits and tailoring', parentSlug: 'men-clothing' },
  { slug: 'men-shoes', name: 'Shoes', parentSlug: 'men' },
  { slug: 'men-shoes-boots', name: 'Boots', parentSlug: 'men-shoes' },
  { slug: 'men-shoes-trainers', name: 'Trainers', parentSlug: 'men-shoes' },
  { slug: 'men-shoes-formal', name: 'Formal shoes', parentSlug: 'men-shoes' },
  { slug: 'men-shoes-sandals', name: 'Sandals', parentSlug: 'men-shoes' },
  { slug: 'kids', name: "Children's Wear", parentSlug: null },
  { slug: 'kids-accessories', name: 'Accessories', parentSlug: 'kids' },
  { slug: 'kids-bags', name: 'Bags and backpacks', parentSlug: 'kids' },
  { slug: 'kids-clothing', name: 'Clothing', parentSlug: 'kids' },
  { slug: 'kids-clothing-dresses', name: 'Dresses', parentSlug: 'kids-clothing' },
  { slug: 'kids-clothing-tops', name: 'Tops', parentSlug: 'kids-clothing' },
  { slug: 'kids-clothing-trousers', name: 'Trousers', parentSlug: 'kids-clothing' },
  { slug: 'kids-clothing-outerwear', name: 'Outerwear', parentSlug: 'kids-clothing' },
  { slug: 'kids-clothing-school-uniform', name: 'School uniform', parentSlug: 'kids-clothing' },
  { slug: 'kids-shoes', name: 'Shoes', parentSlug: 'kids' },
  { slug: 'kids-shoes-boots', name: 'Boots', parentSlug: 'kids-shoes' },
  { slug: 'kids-shoes-trainers', name: 'Trainers', parentSlug: 'kids-shoes' },
  { slug: 'kids-shoes-flats', name: 'Flats', parentSlug: 'kids-shoes' },
  { slug: 'kids-shoes-sandals', name: 'Sandals', parentSlug: 'kids-shoes' },
  { slug: 'designer', name: 'Designer', parentSlug: null },
  { slug: 'designer-bags', name: 'Bags', parentSlug: 'designer' },
  { slug: 'designer-clothing', name: 'Clothing', parentSlug: 'designer' },
  { slug: 'designer-shoes', name: 'Shoes', parentSlug: 'designer' },
  { slug: 'designer-accessories', name: 'Accessories', parentSlug: 'designer' },
  { slug: 'home', name: 'Home and Living', parentSlug: null },
  { slug: 'home-furniture', name: 'Furniture', parentSlug: 'home' },
  { slug: 'home-decor', name: 'Home decor', parentSlug: 'home' },
  { slug: 'home-kitchen', name: 'Kitchen and dining', parentSlug: 'home' },
  { slug: 'home-bedding', name: 'Bedding and textiles', parentSlug: 'home' },
  { slug: 'home-lighting', name: 'Lighting', parentSlug: 'home' },
  { slug: 'electronics', name: 'Electronics and Tech', parentSlug: null },
  { slug: 'electronics-phones', name: 'Phones and accessories', parentSlug: 'electronics' },
  { slug: 'electronics-computers', name: 'Computers and tablets', parentSlug: 'electronics' },
  { slug: 'electronics-cameras', name: 'Cameras', parentSlug: 'electronics' },
  { slug: 'electronics-audio', name: 'Audio', parentSlug: 'electronics' },
  { slug: 'books-media', name: 'Books and Media', parentSlug: null },
  { slug: 'books-media-books', name: 'Books', parentSlug: 'books-media' },
  { slug: 'books-media-records', name: 'Records and vinyl', parentSlug: 'books-media' },
  { slug: 'books-media-films', name: 'Films and TV', parentSlug: 'books-media' },
  { slug: 'hobbies', name: 'Hobbies and Collectables', parentSlug: null },
  { slug: 'hobbies-toys', name: 'Toys and games', parentSlug: 'hobbies' },
  { slug: 'hobbies-collectables', name: 'Collectables', parentSlug: 'hobbies' },
  { slug: 'hobbies-building-sets', name: 'Building sets', parentSlug: 'hobbies' },
  { slug: 'sport', name: 'Sports and Outdoors', parentSlug: null },
  { slug: 'sport-clothing', name: 'Sportswear', parentSlug: 'sport' },
  { slug: 'sport-shoes', name: 'Sports shoes', parentSlug: 'sport' },
  { slug: 'sport-equipment', name: 'Equipment', parentSlug: 'sport' },
];

export const ROOT_CATEGORIES = CATEGORY_TREE.filter((c) => c.parentSlug === null);
export const ALL_CATEGORIES = CATEGORY_TREE;

export function categoryPath(slug: string | null | undefined): string {
  if (!slug) return '';
  const current = CATEGORY_TREE.find((c) => c.slug === slug);
  if (!current) return slug;
  const parts = [current.name];
  let parent = current.parentSlug;
  while (parent) {
    const p = CATEGORY_TREE.find((c) => c.slug === parent);
    if (!p) break;
    parts.unshift(p.name);
    parent = p.parentSlug;
  }
  return parts.join(' / ');
}

export function categoryRoot(slug: string | null | undefined): string | null {
  if (!slug) return null;
  let current = CATEGORY_TREE.find((c) => c.slug === slug);
  while (current?.parentSlug) current = CATEGORY_TREE.find((c) => c.slug === current!.parentSlug);
  return current?.slug ?? (slug.split('-')[0] || null);
}

export function isCategoryOrDescendant(listingSlug: string | null | undefined, selectedSlug: string | null | undefined): boolean {
  if (!selectedSlug) return true;
  return listingSlug === selectedSlug || Boolean(listingSlug?.startsWith(selectedSlug + '-'));
}

export type SizeKind = 'womens-clothing' | 'mens-clothing' | 'childrens-clothing' | 'womens-shoes' | 'mens-shoes' | 'childrens-shoes' | 'general';

const WOMENS_CLOTHING = ['UK 4', 'UK 6', 'UK 8', 'UK 10', 'UK 12', 'UK 14', 'UK 16', 'UK 18', 'UK 20', 'UK 22', 'UK 24', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];
const MENS_CLOTHING = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', 'UK waist 28', 'UK waist 30', 'UK waist 32', 'UK waist 34', 'UK waist 36', 'UK waist 38', 'UK waist 40', 'UK waist 42'];
const CHILDRENS_CLOTHING = ['Newborn', '0–3 months', '3–6 months', '6–9 months', '9–12 months', '12–18 months', '18–24 months', '2–3 years', '3–4 years', '4–5 years', '5–6 years', '6–7 years', '7–8 years', '8–9 years', '9–10 years', '10–11 years', '11–12 years', '12–13 years', '13–14 years'];
const ADULT_SHOES = Array.from({ length: 14 }, (_, i) => `UK ${i + 2}`);
const CHILD_SHOES = ['UK child 0', 'UK child 1', 'UK child 2', 'UK child 3', 'UK child 4', 'UK child 5', 'UK child 6', 'UK child 7', 'UK child 8', 'UK child 9', 'UK child 10', 'UK child 11', 'UK child 12', 'UK child 13'];

export function sizeKindFor(slug: string | null | undefined): SizeKind {
  const s = slug ?? '';
  if (s.startsWith('kids-shoes') || s === 'kids') return 'childrens-shoes';
  if (s.startsWith('kids-clothing')) return 'childrens-clothing';
  if (s.startsWith('women-shoes') || s === 'women-shoes') return 'womens-shoes';
  if (s.startsWith('men-shoes')) return 'mens-shoes';
  if (s.startsWith('women-clothing') || s === 'women') return 'womens-clothing';
  if (s.startsWith('men-clothing') || s === 'men') return 'mens-clothing';
  if (s.startsWith('designer-shoes')) return 'womens-shoes';
  if (s.startsWith('designer-clothing')) return 'womens-clothing';
  return 'general';
}

export function sizeSuggestions(slug: string | null | undefined): string[] {
  switch (sizeKindFor(slug)) {
    case 'womens-clothing': return WOMENS_CLOTHING;
    case 'mens-clothing': return MENS_CLOTHING;
    case 'childrens-clothing': return CHILDRENS_CLOTHING;
    case 'womens-shoes':
    case 'mens-shoes': return ADULT_SHOES;
    case 'childrens-shoes': return CHILD_SHOES;
    default: return [];
  }
}

export function sizeConversions(kind: SizeKind): { uk: string; eu: string; us: string }[] {
  if (kind === 'womens-shoes') return Array.from({ length: 13 }, (_, i) => ({ uk: String(i + 2), eu: String(i + 35), us: String(i + 4) }));
  if (kind === 'mens-shoes') return Array.from({ length: 13 }, (_, i) => ({ uk: String(i + 6), eu: String(i + 40), us: String(i + 7) }));
  if (kind === 'childrens-shoes') return Array.from({ length: 14 }, (_, i) => ({ uk: `child ${i}`, eu: String(i + 16), us: String(i + 1) }));
  if (kind === 'womens-clothing') return Array.from({ length: 12 }, (_, i) => ({ uk: String(i * 2 + 4), eu: String(i * 2 + 32), us: String(i * 2), }));
  if (kind === 'mens-clothing') return Array.from({ length: 8 }, (_, i) => ({ uk: String(36 + i * 2), eu: String(46 + i * 2), us: String(36 + i * 2) }));
  return [];
}

export const MATERIAL_SUGGESTIONS: Record<string, string[]> = {
  clothing: ['Cotton', 'Denim', 'Linen', 'Polyester', 'Viscose', 'Wool', 'Cashmere', 'Silk', 'Leather', 'Suede', 'Nylon', 'Elastane'],
  shoes: ['Leather', 'Suede', 'Nubuck', 'Canvas', 'Mesh', 'Rubber', 'Synthetic', 'Textile'],
  bags: ['Leather', 'Suede', 'Canvas', 'Nylon', 'Polyester', 'Vegan leather', 'Straw', 'Raffia'],
  accessories: ['Leather', 'Suede', 'Cotton', 'Wool', 'Silk', 'Metal', 'Gold-plated metal', 'Sterling silver', 'Plastic', 'Acetate'],
  home: ['Wood', 'Metal', 'Glass', 'Ceramic', 'Cotton', 'Linen', 'Wool', 'Leather', 'Plastic'],
  electronics: ['Aluminium', 'Plastic', 'Glass', 'Stainless steel', 'Silicone'],
  general: ['Cotton', 'Leather', 'Suede', 'Wool', 'Wood', 'Metal', 'Glass', 'Plastic', 'Other'],
};

export function materialSuggestions(slug: string | null | undefined): string[] {
  const s = slug ?? '';
  if (s.includes('shoes') || s.includes('boots') || s.includes('trainers') || s.includes('flats') || s.includes('heels') || s.includes('sandals')) return MATERIAL_SUGGESTIONS.shoes;
  if (s.includes('bags')) return MATERIAL_SUGGESTIONS.bags;
  if (s.includes('clothing') || s.startsWith('women') || s.startsWith('men') || s.startsWith('kids')) return MATERIAL_SUGGESTIONS.clothing;
  if (s.startsWith('home')) return MATERIAL_SUGGESTIONS.home;
  if (s.startsWith('electronics')) return MATERIAL_SUGGESTIONS.electronics;
  if (s.includes('accessories')) return MATERIAL_SUGGESTIONS.accessories;
  return MATERIAL_SUGGESTIONS.general;
}
