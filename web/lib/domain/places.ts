// Rough locations for "near me": UK postcode districts (the first half of a postcode, such as SW11) and their
// centres. A few are built in (examples and tests work offline); others come from postcodes.io, which is free
// and needs no key. Only districts are ever stored, never addresses.

export interface Point { lat: number; lng: number }

const KNOWN: Record<string, Point> = {
  SW11: { lat: 51.46, lng: -0.16 }, E8: { lat: 51.54, lng: -0.06 }, W1: { lat: 51.51, lng: -0.14 }, N1: { lat: 51.54, lng: -0.1 },
  SE1: { lat: 51.5, lng: -0.09 }, EC1: { lat: 51.52, lng: -0.1 }, M1: { lat: 53.48, lng: -2.24 }, M20: { lat: 53.43, lng: -2.23 },
  BS1: { lat: 51.45, lng: -2.59 }, BS6: { lat: 51.47, lng: -2.6 }, B1: { lat: 52.48, lng: -1.9 }, LS1: { lat: 53.8, lng: -1.55 },
  EH1: { lat: 55.95, lng: -3.19 }, G1: { lat: 55.86, lng: -4.25 }, CF10: { lat: 51.47, lng: -3.18 }, BN1: { lat: 50.83, lng: -0.14 },
};

/** "sw11 2ab" or "SW11" → "SW11"; null if it isn't a UK postcode or district. */
export function toDistrict(input: string): string | null {
  const s = input.trim().toUpperCase().replace(/\s+/g, ' ');
  const full = s.match(/^([A-Z]{1,2}[0-9][0-9A-Z]?) ?[0-9][A-Z]{2}$/);
  if (full) return full[1];
  return /^[A-Z]{1,2}[0-9][0-9A-Z]?$/.test(s) ? s : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The centre of a district, to about 1 km. */
export async function locateDistrict(district: string): Promise<Point | null> {
  const d = toDistrict(district);
  if (!d) return null;
  if (KNOWN[d]) return KNOWN[d];
  try {
    const r = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(d)}`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { result?: { latitude?: number; longitude?: number } };
    return j.result?.latitude && j.result.longitude ? { lat: round2(j.result.latitude), lng: round2(j.result.longitude) } : null;
  } catch {
    return null;
  }
}

export function milesBetween(a: Point, b: Point): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(3958.8 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/** A box around a point that contains everything within `miles` (filtered exactly afterwards). */
export function boxAround(p: Point, miles: number): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const dLat = miles / 69;
  const dLng = miles / (69 * Math.cos((p.lat * Math.PI) / 180));
  return { minLat: p.lat - dLat, maxLat: p.lat + dLat, minLng: p.lng - dLng, maxLng: p.lng + dLng };
}

export function distanceText(miles: number): string {
  return miles < 1 ? 'under a mile away' : `about ${Math.round(miles)} ${Math.round(miles) === 1 ? 'mile' : 'miles'} away`;
}
