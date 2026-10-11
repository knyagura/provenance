import type { Listing, ListingQuery } from './types';

/** Words people search with: letters and digits only, lower case, at most 8. */
export function searchWords(q: string | undefined): string[] {
  if (!q) return [];
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
}

/**
 * A Postgres tsquery where every word must match the start of a word in the listing,
 * so "barb jack" finds "Barbour jacket". Null when there is nothing to search for.
 */
export function toPrefixTsQuery(q: string | undefined): string | null {
  const words = searchWords(q);
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}

/** The same rules applied in memory, for the example catalogue. Kept in step with the database. */
export function filterInMemory(all: Listing[], query: ListingQuery): Listing[] {
  const words = searchWords(query.q);
  const matches = all.filter((l) => {
    if (l.status !== 'active') return false;
    if (query.category && l.category !== query.category) return false;
    if (query.condition && l.condition !== query.condition) return false;
    if (query.minPence !== undefined && l.pricePence < query.minPence) return false;
    if (query.maxPence !== undefined && l.pricePence > query.maxPence) return false;
    if (words.length) {
      const tokens = searchWords(`${l.title} ${l.brand ?? ''} ${l.description ?? ''}`);
      if (!words.every((w) => tokens.some((t) => t.startsWith(w)))) return false;
    }
    return true;
  });
  const sorted = [...matches].sort((a, b) => {
    if (query.sort === 'price_asc') return a.pricePence - b.pricePence || a.id.localeCompare(b.id);
    if (query.sort === 'price_desc') return b.pricePence - a.pricePence || a.id.localeCompare(b.id);
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
  return sorted.slice(query.offset, query.offset + query.limit);
}
