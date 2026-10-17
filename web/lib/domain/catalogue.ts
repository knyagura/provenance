import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '@/lib/config';
import { exampleCatalogue, fallbackCategories } from './examples';
import { nextCursor } from './query';
import { boxAround, milesBetween } from './places';
import { filterInMemory, toPrefixTsQuery } from './search';
import { breakdownFromJson, computeFees, DEFAULT_FEES, type FeeBreakdown } from './fees';
import type { Category, Listing, ListingQuery, Media, MemberPage, Page, Variant } from './types';
import { exampleUnitsLeft } from './exampleStock';

// The catalogue domain module: the one place that reads listings and categories.
// Website pages call it directly on the server; /api/v1 route handlers wrap the same functions.
// It reads with the publishable key, so Row Level Security limits it to what anyone may see.

export interface CatalogueSource {
  categories(): Promise<Category[]>;
  search(query: ListingQuery): Promise<Page<Listing>>;
  get(id: string): Promise<Listing | null>;
  /** True when no listing is published at all. */
  isEmpty(): Promise<boolean>;
  /** A member's public page, by username (any case). */
  member(username: string): Promise<MemberPage | null>;
  /** Today's price breakdown; null when the listing can't be bought. */
  quote(id: string): Promise<FeeBreakdown | null>;
  /** The item's colours and sizes (just itself when it has none). */
  variants(id: string): Promise<Variant[]>;
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
  async quote(id) {
    const l = exampleCatalogue.find((x) => x.id === id);
    return l ? computeFees(DEFAULT_FEES, { pricePence: l.pricePence, postagePence: l.shippingPence, payer: 'buyer', boostBp: null }) : null;
  },
  async variants(id) {
    const l = exampleCatalogue.find((x) => x.id === id);
    if (!l) return [];
    const group = l.variantGroup ? exampleCatalogue.filter((x) => x.variantGroup === l.variantGroup) : [l];
    return group.map((x) => {
      const left = exampleUnitsLeft(x.id, x.stock ?? 1);
      return { id: x.id, colour: x.colour, size: x.size, pricePence: x.pricePence, stock: x.stock ?? 1, unitsLeft: left, status: left > 0 ? 'active' : 'sold', current: x.id === id };
    });
  },
  async member(username) {
    const l = exampleCatalogue.find((x) => x.seller.username.toLowerCase() === username.toLowerCase());
    return l ? { username: l.seller.username, bio: null, verified: l.seller.verified, business: l.seller.business, away: false, joined: '2026-01-15T10:00:00.000Z' } : null;
  },
};

// ---------- Supabase ----------

const LISTING_COLUMNS = [
  'id', 'item_id', 'title', 'description', 'brand', 'category', 'size_label', 'colour', 'condition_label',
  'price_pence', 'shipping_pence', 'tier', 'status', 'created_at', 'serial_hint', 'revision', 'stock', 'variant_group',
  'seller:profiles!listings_seller_id_fkey!inner(username, kyc_verified, is_pro, holiday_mode, area, area_lat, area_lng, collection_ok)',
  'media:listing_media(path, kind, shot, position, retired_at)',
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
  serial_hint?: string | null;
  seller: { username: string; kyc_verified: boolean; is_pro: boolean; holiday_mode?: boolean; area?: string | null; area_lat?: number | null; area_lng?: number | null; collection_ok?: boolean } | null;
  revision?: number;
  stock?: number;
  variant_group?: string | null;
  media: { path: string; kind: Media['kind']; shot: string | null; position: number; retired_at?: string | null }[] | null;
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
    serialHint: r.serial_hint ?? null,
    pricePence: r.price_pence,
    shippingPence: r.shipping_pence,
    tier: r.tier,
    status: r.status,
    revision: r.revision ?? 0,
    media: [...(r.media ?? [])]
      .filter((m) => !m.retired_at)
      .sort((a, b) => a.position - b.position)
      .map((m) => ({ url: mediaUrl(m.path), kind: m.kind, shot: m.shot })),
    seller: {
      username: r.seller?.username ?? 'unknown',
      verified: Boolean(r.seller?.kyc_verified),
      business: Boolean(r.seller?.is_pro),
      away: Boolean(r.seller?.holiday_mode),
      area: r.seller?.collection_ok && r.seller.area && r.seller.area_lat != null && r.seller.area_lng != null
        ? { district: r.seller.area, lat: Number(r.seller.area_lat), lng: Number(r.seller.area_lng) } : null,
    },
    createdAt: r.created_at,
    stock: r.stock ?? 1,
    variantGroup: r.variant_group ?? null,
  };
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export function toVariants(data: any): Variant[] {
  return ((data as Record<string, unknown>[] | null) ?? []).map((v) => ({
    id: v.id as string, colour: (v.colour as string) ?? null, size: (v.size as string) ?? null, pricePence: v.price_pence as number,
    stock: v.stock as number, unitsLeft: v.units_left as number, status: v.status as Variant['status'], current: Boolean(v.current),
  }));
}

/** An exact, case-insensitive match for ilike: escapes its wildcards (usernames often contain "_"). */
export function likeExact(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
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
      .eq('status', 'active')
      .eq('browse_visible', true);
    const ts = toPrefixTsQuery(query.q);
    if (ts) req = req.textSearch('search', ts, { config: 'simple' });
    // Sellers on holiday drop out of browsing; their own page still lists their items.
    if (query.seller) req = req.ilike('seller.username', likeExact(query.seller));
    else req = req.eq('seller.holiday_mode', false);
    if (query.category) req = req.eq('category', query.category);
    if (query.condition) req = req.eq('condition_label', query.condition);
    if (query.size) req = req.ilike('size_label', likeExact(query.size.trim()));
    if (query.near) {
      const b = boxAround(query.near, query.near.miles);
      req = req.eq('seller.collection_ok', true).gte('seller.area_lat', b.minLat).lte('seller.area_lat', b.maxLat)
        .gte('seller.area_lng', b.minLng).lte('seller.area_lng', b.maxLng);
    }
    if (query.minPence !== undefined) req = req.gte('price_pence', query.minPence);
    if (query.maxPence !== undefined) req = req.lte('price_pence', query.maxPence);
    if (query.sort === 'price_asc') req = req.order('price_pence', { ascending: true });
    else if (query.sort === 'price_desc') req = req.order('price_pence', { ascending: false });
    else req = req.order('created_at', { ascending: false });
    req = req.order('id').range(query.offset, query.offset + query.limit - 1);

    const { data, error } = await req;
    if (error) throw new CatalogueUnavailable(error);
    const all = (data as unknown as Row[]).map(toListing);
    // The box is a little wider than the circle: keep only what's within the distance.
    const items = query.near ? all.filter((l) => l.seller.area && milesBetween(query.near!, l.seller.area) <= query.near!.miles) : all;
    return { items, nextCursor: nextCursor(query, all.length) };
  },

  async get(id) {
    if (!UUID.test(id)) return null;
    const { data, error } = await db().from('listings').select(LISTING_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw new CatalogueUnavailable(error);
    return data ? toListing(data as unknown as Row) : null;
  },

  async quote(id) {
    if (!UUID.test(id)) return null;
    const { data, error } = await db().rpc('order_quote', { p_listing: id });
    if (error) throw new CatalogueUnavailable(error);
    return breakdownFromJson(data as Record<string, unknown> | null);
  },

  async variants(id) {
    if (!UUID.test(id)) return [];
    const { data, error } = await db().rpc('listing_variants', { p_listing: id });
    if (error) throw new CatalogueUnavailable(error);
    return toVariants(data);
  },

  async member(username) {
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) return null;
    const { data, error } = await db()
      .from('profiles')
      .select('username, bio, kyc_verified, is_pro, holiday_mode, created_at')
      .ilike('username', likeExact(username))
      .maybeSingle();
    if (error) throw new CatalogueUnavailable(error);
    return data
      ? { username: data.username, bio: data.bio, verified: data.kyc_verified, business: data.is_pro, away: data.holiday_mode, joined: data.created_at }
      : null;
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

/** Member pages: example sellers come from the examples while the catalogue is empty. */
export async function getMemberPage(username: string): Promise<{ member: MemberPage; source: CatalogueSource; examples: boolean } | null> {
  const live = liveSource();
  if (live !== exampleSource) {
    const m = await live.member(username);
    if (m) return { member: m, source: live, examples: false };
    if (!(await live.isEmpty())) return null;
  }
  const ex = await exampleSource.member(username);
  return ex ? { member: ex, source: exampleSource, examples: true } : null;
}

/** Item pages: example IDs always come from the examples, real IDs from the database. */
export async function getVariants(id: string): Promise<Variant[]> {
  return id.startsWith('example-') ? exampleSource.variants(id) : liveSource().variants(id);
}

export async function getListing(id: string): Promise<Listing | null> {
  return id.startsWith('example-') ? exampleSource.get(id) : liveSource().get(id);
}
