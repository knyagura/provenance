import { describe, expect, it } from 'vitest';
import { afterPasswordSignIn, initialOffer, neverAsk, notNow, usernameProblem } from '@/lib/account/passkeyOffer';
import { likeExact } from '@/lib/domain/catalogue';
import { exampleCatalogue } from '@/lib/domain/examples';
import { parseApiQuery } from '@/lib/domain/query';
import { filterInMemory } from '@/lib/domain/search';
import type { ListingQuery } from '@/lib/domain/types';

describe('passkey offer', () => {
  const run = (n: number, hasPasskey = false) => {
    let s = initialOffer;
    const offers: boolean[] = [];
    for (let i = 0; i < n; i++) {
      const r = afterPasswordSignIn(s, hasPasskey);
      s = r.state;
      offers.push(r.offer);
    }
    return { s, offers };
  };
  it('is first offered on the third password sign-in', () => {
    expect(run(3).offers).toEqual([false, false, true]);
  });
  it('is never offered to someone who already has a passkey', () => {
    expect(run(5, true).offers.some(Boolean)).toBe(false);
  });
  it('"Not now" waits three more sign-ins', () => {
    let { s } = run(3);
    s = notNow(s);
    const later: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      const r = afterPasswordSignIn(s, false);
      s = r.state;
      later.push(r.offer);
    }
    expect(later).toEqual([false, false, true]);
  });
  it('"Don\'t ask again" stops it', () => {
    let { s } = run(3);
    s = neverAsk(s);
    expect(afterPasswordSignIn(s, false).offer).toBe(false);
  });
});

describe('usernames', () => {
  it.each([['ab', 'at least 3'], ['x'.repeat(31), 'at most 30'], ['has space', 'letters, numbers'], ['mia.k', null], ['resole_archive', null], ['Jo-Shop', null]])('%s', (u, problem) => {
    const p = usernameProblem(u);
    if (problem === null) expect(p).toBeNull();
    else expect(p).toMatch(new RegExp(problem));
  });
  it('escapes ilike wildcards so "a_b" only matches itself', () => {
    expect(likeExact('resole_archive')).toBe('resole\\_archive');
    expect(likeExact('100%')).toBe('100\\%');
  });
});

describe('seller filter and holiday mode', () => {
  const base: ListingQuery = { sort: 'newest', limit: 50, offset: 0 };
  it('lists one seller’s items, any case', () => {
    const r = filterInMemory(exampleCatalogue, { ...base, seller: 'MIA.K' });
    expect(r.length).toBe(3);
    expect(r.every((l) => l.seller.username === 'mia.k')).toBe(true);
  });
  it('hides sellers on holiday from browsing, but not from their own page', () => {
    const away = exampleCatalogue.map((l) => (l.seller.username === 'mia.k' ? { ...l, seller: { ...l.seller, away: true } } : l));
    expect(filterInMemory(away, base).some((l) => l.seller.username === 'mia.k')).toBe(false);
    expect(filterInMemory(away, { ...base, seller: 'mia.k' }).length).toBe(3);
  });
  it('the API accepts a seller and rejects nonsense', () => {
    const ok = parseApiQuery(new URLSearchParams('seller=resole_archive'));
    expect(ok.ok && ok.query.seller).toBe('resole_archive');
    expect(parseApiQuery(new URLSearchParams('seller=a%20b')).ok).toBe(false);
  });
});
