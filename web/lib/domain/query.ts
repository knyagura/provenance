import { CONDITIONS, type ListingQuery, type Sort } from './types';

// Turning request parameters into a safe ListingQuery. Pure functions, unit-tested.
// The API takes prices in pence (min_price_pence); the website's filter form takes pounds (min, max).

export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 50;
/** Deep paging is how scrapers walk a catalogue; people refine the search instead. */
export const MAX_OFFSET = 1000;
const SORTS: readonly Sort[] = ['newest', 'price_asc', 'price_desc'];

export type Params = Record<string, string | string[] | undefined> | URLSearchParams;

export interface FieldError {
  name: string;
  reason: string;
}

export type Parsed = { ok: true; query: ListingQuery } | { ok: false; errors: FieldError[] };

function get(params: Params, name: string): string | undefined {
  const v = params instanceof URLSearchParams ? params.get(name) ?? undefined : params[name];
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
}

export function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`).toString('base64url');
}

export function decodeCursor(cursor: string): number | null {
  const m = /^o:(\d{1,6})$/.exec(Buffer.from(cursor, 'base64url').toString());
  return m ? Number(m[1]) : null;
}

function wholePence(raw: string | undefined, name: string, errors: FieldError[]): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d{1,9}$/.test(raw)) {
    errors.push({ name, reason: 'Must be a whole number of pence, for example 2500 for £25.' });
    return undefined;
  }
  return Number(raw);
}

function pounds(raw: string | undefined, name: string, errors: FieldError[]): number | undefined {
  if (raw === undefined) return undefined;
  const clean = raw.replace(/^£/, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(clean)) {
    errors.push({ name, reason: 'Enter an amount in pounds, for example 25 or 25.50.' });
    return undefined;
  }
  return Math.round(Number(clean) * 100);
}

function common(params: Params, errors: FieldError[], minPence?: number, maxPence?: number): ListingQuery {
  const q = get(params, 'q');
  if (q && q.length > 100) errors.push({ name: 'q', reason: 'Search text can be at most 100 characters.' });

  const category = get(params, 'category');
  if (category && !/^[a-z0-9-]{1,40}$/.test(category)) errors.push({ name: 'category', reason: 'Unknown category.' });

  const condition = get(params, 'condition');
  if (condition && !CONDITIONS.includes(condition as never)) {
    errors.push({ name: 'condition', reason: `Must be one of: ${CONDITIONS.join(', ')}.` });
  }

  const sortRaw = get(params, 'sort') ?? 'newest';
  if (!SORTS.includes(sortRaw as Sort)) errors.push({ name: 'sort', reason: `Must be one of: ${SORTS.join(', ')}.` });

  let limit = DEFAULT_LIMIT;
  const limitRaw = get(params, 'limit');
  if (limitRaw !== undefined) {
    if (!/^\d{1,3}$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > MAX_LIMIT) {
      errors.push({ name: 'limit', reason: `Must be between 1 and ${MAX_LIMIT}.` });
    } else limit = Number(limitRaw);
  }

  let offset = 0;
  const cursor = get(params, 'cursor');
  if (cursor !== undefined) {
    const o = decodeCursor(cursor);
    if (o === null || o > MAX_OFFSET) errors.push({ name: 'cursor', reason: 'Not a cursor from a previous page.' });
    else offset = o;
  }

  if (minPence !== undefined && maxPence !== undefined && minPence > maxPence) {
    errors.push({ name: 'max', reason: 'The highest price must be more than the lowest.' });
  }

  return { q, category, condition, minPence, maxPence, sort: sortRaw as Sort, limit, offset };
}

export function parseApiQuery(params: Params): Parsed {
  const errors: FieldError[] = [];
  const min = wholePence(get(params, 'min_price_pence'), 'min_price_pence', errors);
  const max = wholePence(get(params, 'max_price_pence'), 'max_price_pence', errors);
  const query = common(params, errors, min, max);
  return errors.length ? { ok: false, errors } : { ok: true, query };
}

/** The website is forgiving: a bad filter is dropped and reported, not a failed page. */
export function parseSiteQuery(params: Params): { query: ListingQuery; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const min = pounds(get(params, 'min'), 'min', errors);
  const max = pounds(get(params, 'max'), 'max', errors);
  const query = common(params, errors, min, max);
  const bad = new Set(errors.map((e) => e.name));
  return {
    query: {
      ...query,
      q: bad.has('q') ? query.q?.slice(0, 100) : query.q,
      category: bad.has('category') ? undefined : query.category,
      condition: bad.has('condition') ? undefined : query.condition,
      sort: bad.has('sort') ? 'newest' : query.sort,
      minPence: bad.has('min') || bad.has('max') ? undefined : query.minPence,
      maxPence: bad.has('min') || bad.has('max') ? undefined : query.maxPence,
      offset: bad.has('cursor') ? 0 : query.offset,
    },
    errors,
  };
}

/** Builds the next page's cursor, or null when this was the last page or paging would go too deep. */
export function nextCursor(query: ListingQuery, returned: number): string | null {
  const next = query.offset + query.limit;
  return returned < query.limit || next > MAX_OFFSET ? null : encodeCursor(next);
}
