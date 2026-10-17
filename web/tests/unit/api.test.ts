import { describe, expect, it } from 'vitest';
import { authenticate, RATE_LIMIT_PER_MINUTE, type KeyVerifier } from '@/lib/api/auth';
import { problem } from '@/lib/api/http';
import { generateKey, hashKey, keyFromHeaders, parseKey } from '@/lib/api/keys';
import { listingJson } from '@/lib/api/serialize';
import { openApi } from '@/lib/api/openapi';
import { exampleCatalogue } from '@/lib/domain/examples';
import { mediaUrl, toListing } from '@/lib/domain/catalogue';

describe('API keys', () => {
  it('generates keys that match the database rules', () => {
    const { key, prefix, hash } = generateKey();
    expect(prefix).toMatch(/^pv_[a-z]+_[A-Za-z0-9]{8}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(parseKey(key)).toEqual({ prefix, hash });
    expect(hashKey(key)).toBe(hash);
  });
  it('never makes the same key twice', () => {
    expect(generateKey().key).not.toBe(generateKey().key);
  });
  it('rejects things that are not keys', () => {
    expect(parseKey('sb_publishable_abc')).toBeNull();
    expect(parseKey('pv_live_short_x')).toBeNull();
  });
  it('reads Bearer or X-Api-Key', () => {
    expect(keyFromHeaders(new Headers({ Authorization: 'Bearer abc' }))).toBe('abc');
    expect(keyFromHeaders(new Headers({ 'X-Api-Key': 'abc' }))).toBe('abc');
    expect(keyFromHeaders(new Headers({ Authorization: 'Basic abc' }))).toBeNull();
    expect(keyFromHeaders(new Headers())).toBeNull();
  });
});

describe('authenticate', () => {
  const key = generateKey();
  const headers = new Headers({ Authorization: `Bearer ${key.key}` });
  const fake = (calls: number, scopes = ['listings:read']): KeyVerifier => ({
    async verify(prefix, hash) {
      return prefix === key.prefix && hash === key.hash ? { keyId: 'k', ownerId: 'o', scopes, calls } : null;
    },
  });

  it('lets a valid key through and reports the remaining calls', async () => {
    const r = await authenticate(headers, 'listings:read', fake(3));
    expect(r.ok && r.rate).toEqual({ limit: RATE_LIMIT_PER_MINUTE, remaining: RATE_LIMIT_PER_MINUTE - 3 });
  });
  it('401 without a key, with a malformed key, or with an unknown key', async () => {
    for (const h of [new Headers(), new Headers({ Authorization: 'Bearer nope' }), new Headers({ Authorization: `Bearer ${generateKey().key}` })]) {
      const r = await authenticate(h, 'listings:read', fake(1));
      expect(!r.ok && r.response.status).toBe(401);
    }
  });
  it('403 when the scope is missing', async () => {
    const r = await authenticate(headers, 'listings:read', fake(1, ['orders:read']));
    expect(!r.ok && r.response.status).toBe(403);
  });
  it('429 over the limit, with Retry-After', async () => {
    const r = await authenticate(headers, 'listings:read', fake(RATE_LIMIT_PER_MINUTE + 1));
    expect(!r.ok && r.response.status).toBe(429);
    if (!r.ok) expect(Number(r.response.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
  it('503 when the key cannot be checked', async () => {
    const broken: KeyVerifier = { verify: async () => { throw new Error('down'); } };
    const r = await authenticate(headers, 'listings:read', broken);
    expect(!r.ok && r.response.status).toBe(503);
  });
});

describe('responses', () => {
  it('problems are RFC 9457 shaped', async () => {
    const r = problem('invalid-request', 'bad', { errors: [{ name: 'q', reason: 'too long' }] });
    expect(r.status).toBe(400);
    expect(r.headers.get('Content-Type')).toContain('application/problem+json');
    expect(r.headers.get('Provenance-Api-Version')).toBe('1');
    expect(await r.json()).toMatchObject({ title: expect.any(String), status: 400, detail: 'bad', errors: [{ name: 'q' }] });
  });
  it('listing JSON uses the documented field names and nothing else', () => {
    const j = listingJson(exampleCatalogue[0], 'https://x.test');
    const documented = Object.keys(openApi('https://x.test').components.schemas.Listing.properties).sort();
    expect(Object.keys(j).sort()).toEqual(documented);
    expect(j.url).toBe('https://x.test/item/example-1');
    expect(j).not.toHaveProperty('example');
  });
  it('maps database rows and orders media', () => {
    const l = toListing({
      id: 'id', item_id: null, title: 't', description: null, brand: null, category: 'men', size_label: 'M', colour: null,
      condition_label: 'Good', price_pence: 100, shipping_pence: 0, tier: 'enhanced', status: 'active', created_at: 'now',
      seller: { username: 'u', kyc_verified: true, is_pro: false },
      media: [{ path: 'a/b/2.jpg', kind: 'photo', shot: null, position: 2 }, { path: 'a/b/1 x.jpg', kind: 'photo', shot: 'front', position: 1 }],
    });
    expect(l.media.map((m) => m.shot)).toEqual(['front', null]);
    expect(l.media[0].url).toBe(mediaUrl('a/b/1 x.jpg'));
    expect(l.media[0].url).toMatch(/listing-media\/a\/b\/1%20x\.jpg$/);
    expect(l.seller).toEqual({ username: 'u', verified: true, business: false, away: false, area: null });
  });
});
