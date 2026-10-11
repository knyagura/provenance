import { describe, expect, it } from 'vitest';
import { listingChanges, versionFromSnapshot, type ListingVersion } from '@/lib/domain/versions';

const v1: ListingVersion = {
  revision: 3, title: 'Studio vase', description: 'Small chip on the base.', brand: null, size: null, colour: 'Blue', condition: 'Good',
  pricePence: 3000, shippingPence: 399, serialHint: null,
  media: [{ path: 's/l/front-1.jpg', kind: 'photo', shot: 'front' }, { path: 's/l/mark-1.jpg', kind: 'photo', shot: 'mark' }],
};

describe('what changed between revisions', () => {
  it('lists price, condition and photo changes in plain English, most important first', () => {
    const v2: ListingVersion = { ...v1, revision: 4, pricePence: 4500, condition: 'Satisfactory', media: [{ path: 's/l/front-2.jpg', kind: 'photo', shot: 'front' }, v1.media[1]] };
    expect(listingChanges(v1, v2)).toEqual(['Price: £30.00 → £45.00', 'Condition: Good → Satisfactory', 'Photos: 1 new, 1 removed']);
  });
  it('mentions description and title changes', () => {
    expect(listingChanges(v1, { ...v1, title: 'Studio vase, signed', description: 'No chips.' })).toEqual(['Title: “Studio vase” → “Studio vase, signed”', 'Description updated']);
  });
  it('is empty when nothing a buyer would notice changed', () => {
    expect(listingChanges(v1, { ...v1, revision: 9 })).toEqual([]);
  });
  it('notices reordered photos', () => {
    expect(listingChanges(v1, { ...v1, media: [v1.media[1], v1.media[0]] })).toEqual(['Photos reordered']);
  });
});

describe('reading the database snapshot', () => {
  it('maps fields and photos', () => {
    const v = versionFromSnapshot({ revision: 4, title: 'Studio vase', price_pence: 3000, shipping_pence: 399, condition: 'Good', media: [{ path: 'a/b/c.jpg', kind: 'photo', shot: 'front' }] });
    expect(v).toMatchObject({ revision: 4, title: 'Studio vase', pricePence: 3000, media: [{ path: 'a/b/c.jpg', kind: 'photo', shot: 'front' }] });
  });
  it('is null for orders made before snapshots existed', () => {
    expect(versionFromSnapshot(null)).toBeNull();
    expect(versionFromSnapshot({})).toBeNull();
  });
});
