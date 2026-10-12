import type { CustodyStep, ListingCardProps } from '@/components/ui';

// Example content for the style guide and the empty home page. Clearly not real listings.
export const exampleListings: ListingCardProps[] = [
  { href: '#', title: 'Barbour jacket', pricePence: 4800, details: 'M · Very good', seller: 'resole_archive', tier: 'enhanced', placeholder: 'blush', photoUrl: '/examples/example-1-front.svg' },
  { href: '#', title: 'Floral midi dress', pricePence: 1200, details: '10 · Good', seller: 'mia.k', favourited: true, tier: 'enhanced', placeholder: 'sage', photoUrl: '/examples/example-2-front.svg' },
  { href: '#', title: 'Ceramic table lamp', pricePence: 1500, details: 'Habitat · Good', seller: 'mia.k', boosted: true, tier: 'enhanced', placeholder: 'peach', photoUrl: '/examples/example-3-front.svg' },
  { href: '#', title: 'Leather belt', pricePence: 1400, details: 'Ted Baker · Very good', seller: 'resole_archive', tier: 'verified', placeholder: 'surface-sand', photoUrl: '/examples/example-4-front.svg' },
  { href: '#', title: 'Running shorts', pricePence: 1000, details: 'Adidas · Good', seller: 'resole_archive', tier: 'luxury', placeholder: 'blush', photoUrl: '/examples/example-5-front.svg' },
];

export const exampleSteps: CustodyStep[] = [
  { title: 'Packed and sealed', note: 'resole_archive filmed the jacket going into the box.', evidence: 'Seal PV-48213 · 9 Oct, 14:02', state: 'done' },
  { title: 'Witnessed by courier', note: 'The courier confirmed the seal at collection.', evidence: 'a3f9…c21e · 9 Oct, 16:40', state: 'done' },
  { title: 'Open on camera', note: 'Film the seal before you cut it. It takes about a minute.', state: 'now', yourTurn: true },
  { title: 'Payment released', note: "We pay the seller once you've confirmed the item.", state: 'later' },
];
