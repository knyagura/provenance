import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, MAX_LIMIT, nextCursor, parseApiQuery, parseSiteQuery } from '@/lib/domain/query';

describe('API query parsing', () => {
  it('defaults', () => {
    const r = parseApiQuery(new URLSearchParams(''));
    expect(r).toEqual({ ok: true, query: { q: undefined, category: undefined, seller: undefined, condition: undefined, minPence: undefined, maxPence: undefined, sort: 'newest', limit: 24, offset: 0 } });
  });
  it('reads every filter', () => {
    const r = parseApiQuery(new URLSearchParams('q=barbour&category=men&condition=Good&min_price_pence=1000&max_price_pence=5000&sort=price_asc&limit=10'));
    expect(r.ok && r.query).toMatchObject({ q: 'barbour', category: 'men', condition: 'Good', minPence: 1000, maxPence: 5000, sort: 'price_asc', limit: 10 });
  });
  it.each([
    ['min_price_pence=12.5', 'min_price_pence'],
    ['max_price_pence=-1', 'max_price_pence'],
    ['sort=random', 'sort'],
    [`limit=${MAX_LIMIT + 1}`, 'limit'],
    ['limit=0', 'limit'],
    ['condition=Mint', 'condition'],
    ['category=Men%20Shoes', 'category'],
    ['cursor=nonsense', 'cursor'],
    [`q=${'a'.repeat(101)}`, 'q'],
    ['min_price_pence=5000&max_price_pence=1000', 'max'],
  ])('rejects %s', (qs, name) => {
    const r = parseApiQuery(new URLSearchParams(qs));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.name)).toContain(name);
  });
  it('refuses cursors past the paging limit', () => {
    expect(parseApiQuery(new URLSearchParams(`cursor=${encodeCursor(5000)}`)).ok).toBe(false);
  });
});

describe('site query parsing', () => {
  it('takes pounds and converts to pence', () => {
    const { query, errors } = parseSiteQuery({ min: '£12.50', max: '40' });
    expect(errors).toEqual([]);
    expect(query).toMatchObject({ minPence: 1250, maxPence: 4000 });
  });
  it('drops bad filters instead of failing', () => {
    const { query, errors } = parseSiteQuery({ min: 'cheap', sort: 'x', condition: 'Mint', q: 'jacket' });
    expect(errors.map((e) => e.name).sort()).toEqual(['condition', 'min', 'sort']);
    expect(query).toMatchObject({ q: 'jacket', sort: 'newest', minPence: undefined, condition: undefined });
  });
  it('takes the first of repeated values', () => {
    expect(parseSiteQuery({ q: ['a', 'b'] }).query.q).toBe('a');
  });
});

describe('cursors', () => {
  it('round-trips', () => expect(decodeCursor(encodeCursor(48))).toBe(48));
  it('gives no next page when the page was short', () => {
    expect(nextCursor({ sort: 'newest', limit: 24, offset: 0 }, 10)).toBeNull();
    expect(decodeCursor(nextCursor({ sort: 'newest', limit: 24, offset: 24 }, 24)!)).toBe(48);
  });
  it('stops at the paging limit', () => {
    expect(nextCursor({ sort: 'newest', limit: 50, offset: 1000 }, 50)).toBeNull();
  });
});
