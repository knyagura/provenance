import { describe, expect, it } from 'vitest';
import { exampleCatalogue } from '@/lib/domain/examples';
import { filterInMemory, searchWords, toPrefixTsQuery } from '@/lib/domain/search';
import type { ListingQuery } from '@/lib/domain/types';

const base: ListingQuery = { sort: 'newest', limit: 50, offset: 0 };

describe('search words', () => {
  it('strips punctuation and operators that could break a tsquery', () => {
    expect(toPrefixTsQuery("barb' & | ! jack:*")).toBe('barb:* & jack:*');
    expect(toPrefixTsQuery('  ')).toBeNull();
    expect(toPrefixTsQuery(undefined)).toBeNull();
  });
  it('keeps accented letters and digits, lower-cased', () => {
    expect(searchWords('Café X100V')).toEqual(['café', 'x100v']);
  });
  it('caps the number of words', () => {
    expect(searchWords('a b c d e f g h i j')).toHaveLength(8);
  });
});

describe('in-memory filtering (example catalogue)', () => {
  it('matches word starts across title and brand', () => {
    const r = filterInMemory(exampleCatalogue, { ...base, q: 'barb jack' });
    expect(r.map((l) => l.title)).toEqual(['Barbour Beaufort wax jacket']);
  });
  it('filters by category, condition and price', () => {
    const r = filterInMemory(exampleCatalogue, { ...base, category: 'sport', maxPence: 2000 });
    expect(r.map((l) => l.title)).toEqual(['Running shorts']);
    // The wool rollneck, and one card for the merino jumper's four colours and sizes.
    expect(filterInMemory(exampleCatalogue, { ...base, condition: 'New with tags' }).map((l) => l.id)).toEqual(['example-13', 'example-8']);
  });
  it('sorts by price both ways', () => {
    const asc = filterInMemory(exampleCatalogue, { ...base, sort: 'price_asc' }).map((l) => l.pricePence);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    const desc = filterInMemory(exampleCatalogue, { ...base, sort: 'price_desc' }).map((l) => l.pricePence);
    expect(desc[0]).toBe(Math.max(...desc));
  });
  it('pages', () => {
    const p1 = filterInMemory(exampleCatalogue, { ...base, limit: 5 });
    const p2 = filterInMemory(exampleCatalogue, { ...base, limit: 5, offset: 5 });
    expect(p1).toHaveLength(5);
    expect(p2[0].id).not.toBe(p1[0].id);
  });
  it('marks every example', () => {
    expect(exampleCatalogue.every((l) => l.example && l.id.startsWith('example-'))).toBe(true);
  });
});
