import { describe, expect, it } from 'vitest';
import { boxAround, distanceText, locateDistrict, milesBetween, toDistrict } from '@/lib/domain/places';
import { rankSimilar } from '@/lib/domain/catalogue';
import { parseSiteQuery } from '@/lib/domain/query';
import type { Listing } from '@/lib/domain/types';

describe('postcode districts', () => {
  it.each([
    ['sw11 2ab', 'SW11'],
    ['SW112AB', 'SW11'],
    [' e8 ', 'E8'],
    ['M20', 'M20'],
    ['EC1A 1BB', 'EC1A'],
    ['london', null],
    ['12345', null],
    ['', null],
  ])('%s → %s', (input, out) => expect(toDistrict(input)).toBe(out));

  it('knows the built-in districts without the network', async () => {
    expect(await locateDistrict('sw11 1aa')).toEqual({ lat: 51.46, lng: -0.16 });
    expect(await locateDistrict('not a postcode')).toBeNull();
  });
});

describe('distances', () => {
  const sw11 = { lat: 51.46, lng: -0.16 };
  const e8 = { lat: 51.54, lng: -0.06 };
  const m20 = { lat: 53.43, lng: -2.23 };
  it('measures in miles', () => {
    expect(milesBetween(sw11, sw11)).toBe(0);
    expect(milesBetween(sw11, e8)).toBeGreaterThan(5);
    expect(milesBetween(sw11, e8)).toBeLessThan(8);
    expect(milesBetween(sw11, m20)).toBeGreaterThan(150);
  });
  it('a box that holds everything within the radius', () => {
    const b = boxAround(sw11, 10);
    expect(b.minLat).toBeLessThan(sw11.lat);
    expect(b.maxLng).toBeGreaterThan(sw11.lng);
    expect(e8.lat).toBeLessThan(b.maxLat);
    expect(m20.lat).toBeGreaterThan(b.maxLat);
  });
  it('reads naturally', () => {
    expect(distanceText(0.3)).toBe('under a mile away');
    expect(distanceText(1.2)).toBe('about 1 mile away');
    expect(distanceText(6.6)).toBe('about 7 miles away');
  });
});

describe('near in the search address', () => {
  it('reads a point and radius', () => {
    const { query, errors } = parseSiteQuery({ lat: '51.4612', lng: '-0.1634', miles: '5' });
    expect(errors).toEqual([]);
    expect(query.near).toEqual({ lat: 51.46, lng: -0.16, miles: 5 });
  });
  it('defaults to 10 miles', () => {
    expect(parseSiteQuery({ lat: '51.46', lng: '-0.16' }).query.near?.miles).toBe(10);
  });
  it('refuses places outside the UK and odd radii', () => {
    expect(parseSiteQuery({ lat: '48.85', lng: '2.35' }).errors.map((e) => e.name)).toEqual(['lat']);
    expect(parseSiteQuery({ lat: '51.46', lng: '-0.16', miles: '7' }).errors.map((e) => e.name)).toEqual(['miles']);
    expect(parseSiteQuery({ lat: '51.46', lng: '-0.16', miles: '7' }).query.near).toBeUndefined();
  });
});

describe('similar items', () => {
  const l = (id: string, extra: Partial<Listing> = {}) => ({ id, status: 'active', pricePence: 5000, brand: null, size: null, variantGroup: null, ...extra }) as Listing;
  const base = l('a', { brand: 'Barbour', size: 'M' });
  it('prefers the same brand, then the same size, then a close price', () => {
    const out = rankSimilar(base, [l('far', { pricePence: 9000 }), l('size', { size: 'm' }), l('brand', { brand: 'Barbour' }), l('near', { pricePence: 5100 })]);
    expect(out.map((x) => x.id)).toEqual(['brand', 'size', 'near', 'far']);
  });
  it('leaves out the item itself, its other variants and sold items', () => {
    const v = l('v1', { variantGroup: 'g' });
    const out = rankSimilar(v, [v, l('v2', { variantGroup: 'g' }), l('sold', { status: 'sold' }), l('ok')]);
    expect(out.map((x) => x.id)).toEqual(['ok']);
  });
  it('shows at most six', () => {
    expect(rankSimilar(base, Array.from({ length: 10 }, (_, i) => l(`x${i}`)))).toHaveLength(6);
  });
});
