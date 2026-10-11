import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { safeNext } from '@/components/auth/SignInForm';
import { EVIDENCE_PROFILES, missingForPublish, tierForPrice, type DraftState } from '@/lib/domain/evidence';
import { fallbackCategories } from '@/lib/domain/examples';
import { parsePounds } from '@/lib/format';
import { fitWithin, videoExtension } from '@/lib/media';
import { friendly } from '@/lib/selling/supabaseBackend';

describe('evidence profiles', () => {
  it('match the database (migration 006) exactly', () => {
    const sql = readFileSync(new URL('../../../backend/006_selling.sql', import.meta.url), 'utf8');
    const found = [...sql.matchAll(/update public\.categories set evidence_profile = '(.+?)'::jsonb where slug = '([a-z-]+)';/g)];
    expect(found.map((m) => m[2]).sort()).toEqual(Object.keys(EVIDENCE_PROFILES).sort());
    for (const [, json, slug] of found) {
      const db = JSON.parse(json.replace(/''/g, "'"));
      expect(db, slug).toEqual(JSON.parse(JSON.stringify(EVIDENCE_PROFILES[slug])));
    }
  });
  it('cover every category', () => {
    for (const c of fallbackCategories) expect(EVIDENCE_PROFILES[c.slug], c.slug).toBeDefined();
  });
  it('only offer "No …" on shots that can genuinely be missing', () => {
    const declinable = Object.values(EVIDENCE_PROFILES).flatMap((p) => p.shots.filter((s) => s.decline).map((s) => s.key));
    expect(new Set(declinable)).toEqual(new Set(['label', 'serial', 'mark']));
  });
});

describe('what is missing before publishing', () => {
  const empty: DraftState = { category: 'electronics', title: '', condition: null, pricePence: null, shots: [], declined: [], hasSerial: false, parcelSize: null };
  it('lists everything for an empty electronics draft, in fixing order', () => {
    expect(missingForPublish(empty)).toEqual([
      'Photo: Front', 'Photo: Back', 'Photo: Serial number or IMEI', 'Working video (video)', 'Serial number or IMEI',
      'A title', 'The condition', 'A price of at least £1', 'A parcel size',
    ]);
  });
  it('is empty when complete, and respects "No label"', () => {
    const coat: DraftState = { category: 'women', title: 'Wool coat', condition: 'Good', pricePence: 4500, shots: ['front', 'back'], declined: ['label'], hasSerial: false, parcelSize: 'large' };
    expect(missingForPublish(coat)).toEqual([]);
    expect(missingForPublish({ ...coat, declined: [] })).toEqual(['Photo: Size and care label']);
  });
  it('rejects the placeholder title and out-of-range prices', () => {
    const base: DraftState = { category: 'home', title: 'Untitled draft', condition: 'Good', pricePence: 50, shots: ['front', 'mark'], declined: [], hasSerial: false, parcelSize: 'small' };
    expect(missingForPublish(base)).toEqual(['A title', 'A price of at least £1']);
    expect(missingForPublish({ ...base, title: 'Lamp', pricePence: 6_000_000 })).toEqual(['A price under £50,000']);
  });
  it('asks for a category first', () => {
    expect(missingForPublish({ ...empty, category: null })).toEqual(['Choose a category']);
  });
});

describe('tiers follow the fee model bands', () => {
  it.each([[7499, 'enhanced'], [7500, 'verified'], [49999, 'verified'], [50000, 'luxury'], [150000, 'ultraLuxury']])('%i → %s', (p, t) => {
    expect(tierForPrice(p)).toBe(t);
  });
});

describe('small helpers', () => {
  it('parses pounds', () => {
    expect(parsePounds('£1,250.5')).toBe(125050);
    expect(parsePounds(' 12 ')).toBe(1200);
    expect(parsePounds('12.345')).toBeNull();
    expect(parsePounds('free')).toBeNull();
  });
  it('shrinks photos to 2000 px on the long side, never enlarging', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('knows video types', () => {
    expect(videoExtension('video/quicktime')).toBe('mov');
    expect(videoExtension('video/avi')).toBeNull();
  });
  it('only redirects within the site after sign-in', () => {
    expect(safeNext('/sell/abc')).toBe('/sell/abc');
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', null, '']) expect(safeNext(bad)).toBe('/profile');
  });
  it('turns database errors into plain English', () => {
    expect(friendly({ message: 'Not ready to publish: Front, title' })).toBe('Still needed: Front, title');
    expect(friendly({ message: 'Invalid login credentials' })).toMatch(/don’t match/);
    expect(friendly({ message: 'duplicate key value violates unique constraint "x"' })).toBe('Something went wrong. Please try again.');
  });
});
