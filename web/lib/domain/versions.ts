import { formatPence } from '@/lib/format';

// A listing as a buyer saw it at one revision, and what changed between two revisions.
// Used when a seller edits a listing while someone is about to buy it, and on order pages
// ("what you bought"), which show the version that was bought, not the listing as it is now.

export interface ListingVersion {
  revision: number;
  title: string;
  description: string | null;
  brand: string | null;
  size: string | null;
  colour: string | null;
  condition: string | null;
  pricePence: number;
  shippingPence: number;
  serialHint: string | null;
  /** Photo and video file paths, in display order. */
  media: { path: string; kind: 'photo' | 'video'; shot: string | null }[];
}

/** Reads the database's listing snapshot (listing_snapshot(), snake_case). */
export function versionFromSnapshot(j: Record<string, unknown> | null | undefined): ListingVersion | null {
  if (!j || typeof j !== 'object' || !('title' in j)) return null;
  const media = Array.isArray(j.media) ? (j.media as Record<string, unknown>[]) : [];
  return {
    revision: Number(j.revision ?? 0),
    title: String(j.title ?? ''),
    description: (j.description as string | null) ?? null,
    brand: (j.brand as string | null) ?? null,
    size: (j.size as string | null) ?? null,
    colour: (j.colour as string | null) ?? null,
    condition: (j.condition as string | null) ?? null,
    pricePence: Number(j.price_pence ?? 0),
    shippingPence: Number(j.shipping_pence ?? 0),
    serialHint: (j.serial_hint as string | null) ?? null,
    media: media.map((m) => ({ path: String(m.path), kind: (m.kind as 'photo' | 'video') ?? 'photo', shot: (m.shot as string | null) ?? null })),
  };
}

const text = (v: string | null) => (v && v.trim() ? v.trim() : 'none');

/** Plain-English lines for what changed, most important first. Empty when nothing a buyer cares about changed. */
export function listingChanges(before: ListingVersion, after: ListingVersion): string[] {
  const out: string[] = [];
  if (before.pricePence !== after.pricePence) out.push(`Price: ${formatPence(before.pricePence)} → ${formatPence(after.pricePence)}`);
  if (before.shippingPence !== after.shippingPence) out.push(`Postage: ${formatPence(before.shippingPence)} → ${formatPence(after.shippingPence)}`);
  if (before.condition !== after.condition) out.push(`Condition: ${text(before.condition)} → ${text(after.condition)}`);
  if (before.title !== after.title) out.push(`Title: “${before.title}” → “${after.title}”`);
  if (before.size !== after.size) out.push(`Size: ${text(before.size)} → ${text(after.size)}`);
  if (before.brand !== after.brand) out.push(`Brand: ${text(before.brand)} → ${text(after.brand)}`);
  if (before.colour !== after.colour) out.push(`Colour: ${text(before.colour)} → ${text(after.colour)}`);
  if (before.serialHint !== after.serialHint) out.push(`Serial number now ends ${text(after.serialHint)}`);
  const paths = (v: ListingVersion) => v.media.map((m) => m.path).join('|');
  if (paths(before) !== paths(after)) {
    const added = after.media.filter((m) => !before.media.some((b) => b.path === m.path)).length;
    const removed = before.media.filter((m) => !after.media.some((a) => a.path === m.path)).length;
    out.push(added || removed ? `Photos: ${added} new, ${removed} removed` : 'Photos reordered');
  }
  if ((before.description ?? '') !== (after.description ?? '')) out.push('Description updated');
  return out;
}
