import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '@/lib/config';
import { exampleCatalogue, fallbackCategories } from './examples';
import { nextCursor } from './query';
import { filterInMemory, toPrefixTsQuery } from './search';
import type { Category, Listing, ListingQuery, Media, Page } from './types';

// The catalogue domain module: the one place that reads listings and categories.
// Website pages call it directly on the server; /api/v1 route handlers wrap the same functions.
// It reads with the publishable key, so Row Level Security limits it to what anyone may see.

export interface CatalogueSource {
  categories(): Promise<Category[]>;
  search(query: ListingQuery): Promise<Page<Listing>>;
  get(id: string): Promise<Listing | null>;
  /** True when no listing is published at all. */
  isEmpty(): Promise<boolean>;
}

export class CatalogueUnavailable extends Error {
  constructor(cause: unknown) {
    super('The catalogue could not be reached.', { cause });
  }
}

// ---------- Examples (in memory) ----------

export const exampleSource: CatalogueSource = {
  async categories() {
    return fallbackCategories;
  },
  async search(query) {
    const items = filterInMemory(exampleCatalogue, query);
    return { items, nextCursor: nextCursor(query, items.length) };
  },
  async get(id) {
    return exampleCatalogue.find((l) => l.id === id) ?? null;
  },
  async isEmpty() {
    return false;
  },
};

// ---------- Supabase ----------

const LISTING_COLUMNS = [
  'id', 'item_id', 'title', 'description', 'brand', 'category', 'size_label', 'colour', 'condition_label',
  'price_pence', 'shipping_pence', 'tier', 'status', 'created_at',
  'seller:profiles!listings_seller_id_fkey(username, kyc_verified, is_pro)',
  'media:listing_media(path, kind, shot, position)',
].join(', ');

interface Row {
  id: string;
  item_id: string | null;
  title: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  size_label: string | null;
  colour: string | null;
  condition_label: string | null;
  price_pence: number;
  shipping_pence: number;
  tier: Listing['tier'];
  status: Listing['status'];
  created_at: string;
  seller: { username: string; kyc_verified: boolean; is_pro: boolean } | null;
  media: { path: string; kind: Media['kind']; shot: string | null; position: number }[] | null;
}

export function mediaUrl(path: string): string {
  const safe = path.split('/').map(encodeURIComponent).join('/');
  return `${config.supabaseUrl}/storage/v1/object/public/listing-media/${safe}`;
}

export function toListing(r: Row): Listing {
  return {
    id: r.id,
    itemId: r.item_id,
    title: r.title,
    description: r.description,
    brand: r.brand,
    category: r.category,
    size: r.size_label,
    colour: r.colour,
    condition: r.condition_label,
    pricePence: r.price_pence,
    shippingPence: r.shipping_pence,
    tier: r.tier,
    status: r.status,
    media: [...(r.media ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((m) => ({ url: mediaUrl(m.path), kind: m.kind, shot: m.shot })),
    seller: {
      username: r.seller?.username ?? 'unknown',
      verified: Boolean(r.seller?.kyc_verified),
      business: Boolean(r.seller?.is_pro),
    },
    createdAt: r.created_at,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let server: SupabaseClient | undefined;
function db(): SupabaseClient {
  server ??= createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
  });
  return server;
}

export const supabaseSource: CatalogueSource = {
  async categories() {
    const { data, error } = await db().from('categories').select('slug, name, parent_slug').order('position');
    if (error) throw new CatalogueUnavailable(error);
    return (data ?? []).map((c) => ({ slug: c.slug, name: c.name, parentSlug: c.parent_slug }));
  },

  async search(query) {
    let req = db()
      .from('listings')
      .select(LISTING_COLUMNS)
      .eq('published', true)
      .eq('status', 'active');
    const ts = toPrefixTsQuery(query.q);
    if (ts) req = req.textSearch('search', ts, { config: 'simple' });
    if (query.category) req = req.eq('category', query.category);
    if (query.condition) req = req.eq('condition_label', query.condition);
    if (query.minPence !== undefined) req = req.gte('price_pence', query.minPence);
    if (query.maxPence !== undefined) req = req.lte('price_pence', query.maxPence);
    if (query.sort === 'price_asc') req = req.order('price_pence', { ascending: true });
    else if (query.sort === 'price_desc') req = req.order('price_pence', { ascending: false });
    else req = req.order('created_at', { ascending: false });
    req = req.order('id').range(query.offset, query.offset + query.limit - 1);

    const { data, error } = await req;
    if (error) throw new CatalogueUnavailable(error);
    const items = (data as unknown as Row[]).map(toListing);
    return { items, nextCursor: nextCursor(query, items.length) };
  },

  async get(id) {
    if (!UUID.test(id)) return null;
    const { data, error } = await db().from('listings').select(LISTING_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw new CatalogueUnavailable(error);
    return data ? toListing(data as unknown as Row) : null;
  },

  async isEmpty() {
    const { count, error } = await db()
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('published', true);
    if (error) throw new CatalogueUnavailable(error);
    return (count ?? 0) === 0;
  },
};

// ---------- Choosing a source ----------

/** PV_DATA_SOURCE=examples runs the site with no database (local tests). Anything else uses Supabase. */
export function liveSource(): CatalogueSource {
  return process.env.PV_DATA_SOURCE === 'examples' ? exampleSource : supabaseSource;
}

/** What the API reads. Never the examples, unless the whole server is in example mode for tests. */
export const apiCatalogue = (): CatalogueSource => liveSource();

/**
 * What the website reads. While no listing has been published yet it shows the example catalogue
 * instead, and every example is labelled. Real listings replace them as soon as the first one is published.
 */
export async function siteCatalogue(): Promise<{ source: CatalogueSource; examples: boolean }> {
  const live = liveSource();
  if (live === exampleSource) return { source: exampleSource, examples: true };
  return (await live.isEmpty()) ? { source: exampleSource, examples: true } : { source: live, examples: false };
}

/** Item pages: example IDs always come from the examples, real IDs from the database. */
export async function getListing(id: string): Promise<Listing | null> {
  return id.startsWith('example-') ? exampleSource.get(id) : liveSource().get(id);
}
