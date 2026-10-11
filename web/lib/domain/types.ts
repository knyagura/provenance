// The public shapes of the catalogue. The website and API v1 both return these, so a change here is
// an API change: add fields freely, but never rename or remove one without a new API version.

export type Condition = 'New with tags' | 'New' | 'Very good' | 'Good' | 'Satisfactory';
export const CONDITIONS: readonly Condition[] = ['New with tags', 'New', 'Very good', 'Good', 'Satisfactory'];

export type Tier = 'enhanced' | 'verified' | 'luxury' | 'ultraLuxury';

export interface Category {
  slug: string;
  name: string;
  parentSlug: string | null;
}

export interface Media {
  url: string;
  kind: 'photo' | 'video';
  /** Which shot this is, e.g. "front" or "label". */
  shot: string | null;
}

export interface Seller {
  username: string;
  /** Identity checked. */
  verified: boolean;
  business: boolean;
  /** On holiday: listings are hidden from browsing and buying is paused. */
  away: boolean;
}

/** A member's public page. */
export interface MemberPage {
  username: string;
  bio: string | null;
  verified: boolean;
  business: boolean;
  away: boolean;
  joined: string;
}

export interface Listing {
  id: string;
  /** The item's own ID, carried across resales (IT-2026-00001). Null until the item is first sold here. */
  itemId: string | null;
  title: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  size: string | null;
  colour: string | null;
  condition: string | null;
  /** Last 4 characters of the serial number or IMEI; the full number stays private. */
  serialHint: string | null;
  pricePence: number;
  shippingPence: number;
  tier: Tier;
  status: 'active' | 'reserved' | 'sold';
  media: Media[];
  seller: Seller;
  createdAt: string;
  /** True for the example listings shown while the catalogue is empty. Never true in the API. */
  example?: boolean;
}

export type Sort = 'newest' | 'price_asc' | 'price_desc';

export interface ListingQuery {
  q?: string;
  category?: string;
  /** Only this seller's listings (username, any case). */
  seller?: string;
  minPence?: number;
  maxPence?: number;
  condition?: string;
  sort: Sort;
  limit: number;
  /** Opaque position from the previous page's nextCursor. */
  offset: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
