import { describe, expect, it } from 'vitest';
import { byColour, leftText } from '@/components/browse/VariantPicker';
import { exampleSource } from '@/lib/domain/catalogue';
import { exampleCatalogue } from '@/lib/domain/examples';

describe('variants for business sellers', () => {
  it('lists every colour and size of an example item, from any of them', async () => {
    const v = await exampleSource.variants('example-14');
    expect(v).toHaveLength(4);
    expect(v.find((x) => x.current)?.id).toBe('example-14');
    expect(v.every((x) => x.unitsLeft === x.stock)).toBe(true);
    expect(await exampleSource.variants('example-1')).toHaveLength(1);
  });
  it('groups by colour in order', async () => {
    const groups = byColour(await exampleSource.variants('example-13'));
    expect(groups.map(([c, list]) => `${c}:${list.map((x) => x.size).join('')}`)).toEqual(['Oatmeal:SM', 'Charcoal:SM']);
  });
  it('words what is left', () => {
    expect(leftText({ unitsLeft: 0, stock: 3 })).toBe('Sold out');
    expect(leftText({ unitsLeft: 2, stock: 3 })).toBe('2 left');
    expect(leftText({ unitsLeft: 9, stock: 12 })).toBe('In stock');
    expect(leftText({ unitsLeft: 1, stock: 1 })).toBe('Available');
  });
  it('shows one search card per group', async () => {
    const page = await exampleSource.search({ q: 'merino crew', sort: 'newest', limit: 24, offset: 0 });
    expect(page.items.map((l) => l.id)).toEqual(['example-13']);
    expect(exampleCatalogue.filter((l) => l.variantGroup === 'example-merino')).toHaveLength(4);
  });
});

import { searchName } from '@/components/browse/SaveSearch';
import { searchHref } from '@/components/market/SavedSearches';
import { parseSiteQuery } from '@/lib/domain/query';
import { filterInMemory } from '@/lib/domain/search';

describe('saved searches and the size filter', () => {
  it('names a search from its filters', () => {
    expect(searchName({ q: 'Barbour jacket', size: '10', maxPence: 6000 }, 'Women')).toBe('Barbour jacket · Women · size 10 · under £60.00');
    expect(searchName({})).toBe('Saved search');
  });
  it('links back to the same search', () => {
    expect(searchHref({ q: 'barbour', category: null, size: '10', condition: null, minPence: null, maxPence: 6000 })).toBe('/search?q=barbour&size=10&max=60');
  });
  it('filters by size, ignoring case and spaces', () => {
    const { query } = parseSiteQuery({ size: ' uk 9 ' });
    expect(query.size).toBe('uk 9');
    expect(filterInMemory(exampleCatalogue, query).map((l) => l.title)).toEqual(['Trail running shoes']);
    expect(parseSiteQuery({ size: 'x'.repeat(41) }).query.size).toBeUndefined();
  });
});
