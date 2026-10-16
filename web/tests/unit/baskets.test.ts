import { describe, expect, it } from 'vitest';
import { budgetState, everything, fitFor, fitNote, sizeKindOf, visibleBaskets, wrapCharge, type Basket, type Baskets } from '@/lib/domain/baskets';

const basket = (o: Partial<Basket> = {}): Basket => ({
  id: 'b1', position: 1, name: 'Alex', general: false, ageGroup: 'adult', sizes: {}, budgetPence: null, styleNotes: null, wrapStyle: null,
  wrapAll: false, giftMessage: null, hidePrices: true, deliverBy: null, giftReceipt: false, recipientAddress: null, shareToken: null, items: [], ...o,
});
const item = (o = {}) => ({ listingId: 'l1', title: 'Coat', pricePence: 4000, postagePence: 399, size: 'M', category: 'men', available: true, photoUrl: null, seller: 's', wrap: false, addedAt: '2026-10-16T10:00:00Z', ...o });

describe('size kinds', () => {
  it('reads the common UK size labels', () => {
    expect(sizeKindOf('UK 9', 'sport')).toBe('shoe');
    expect(sizeKindOf('M', 'men')).toBe('top');
    expect(sizeKindOf('34', 'men')).toBe('trousers');
    expect(sizeKindOf('10', 'women')).toBe('dress');
    expect(sizeKindOf('5–6 years', 'kids')).toBe('kids');
    expect(sizeKindOf(null, 'home')).toBeNull();
    expect(sizeKindOf('One size', 'women')).toBeNull();
  });
});

describe('fit', () => {
  const alex = basket({ sizes: { shoe: 'UK 9', top: 'm', trousers: '32', kids: '5-6' } });
  it('matches sizes however they are written', () => {
    expect(fitFor(alex, { size: '9', category: 'shoes' })).toBe('fits');
    expect(fitFor(alex, { size: 'M', category: 'women' })).toBe('fits');
    expect(fitFor(alex, { size: '5–6 years', category: 'kids' })).toBe('fits');
  });
  it('warns on a different size, and explains it', () => {
    expect(fitFor(alex, { size: '34', category: 'men' })).toBe('mismatch');
    expect(fitNote(alex, { size: '34', category: 'men' })).toBe('Size 34, but Alex’s trousers size is 32.');
  });
  it('never warns for unsized items, unknown kinds or General', () => {
    expect(fitFor(alex, { size: null, category: 'home' })).toBe('unknown');
    expect(fitFor(alex, { size: '10', category: 'women' })).toBe('unknown');
    expect(fitFor(basket({ general: true, position: 0, sizes: { top: 'S' } }), { size: 'M', category: 'men' })).toBe('unknown');
  });
});

describe('money', () => {
  it('tracks spend against the budget, postage included', () => {
    expect(budgetState(basket({ budgetPence: 5000, items: [item()] }))).toEqual({ spent: 4399, budget: 5000, over: false, share: 4399 / 5000 });
    expect(budgetState(basket({ budgetPence: 4000, items: [item()] }))?.over).toBe(true);
    expect(budgetState(basket())).toBeNull();
  });
  it('wrapping is counted per wrapped item, but only charged once switched on', () => {
    const all: Baskets = { enabled: true, wrapFeePence: 300, wrappingLive: false, baskets: [basket({ wrapStyle: 'kraft', items: [item({ wrap: true }), item({ listingId: 'l2', wrap: false })] })] };
    expect(wrapCharge(all)).toEqual({ items: 1, pence: 0, charged: false });
    expect(wrapCharge({ ...all, wrappingLive: true })).toEqual({ items: 1, pence: 300, charged: true });
  });
});

describe('views', () => {
  const general = basket({ id: 'g', position: 0, name: 'General', general: true, items: [item({ listingId: 'a', addedAt: '2026-10-16T09:00:00Z' })] });
  const alex = basket({ items: [item({ listingId: 'b' })] });
  it('the single view lists everything with its basket; multi-basket off shows General only', () => {
    expect(everything({ enabled: true, wrapFeePence: 0, wrappingLive: false, baskets: [general, alex] }).map((x) => [x.item.listingId, x.basket.name])).toEqual([['a', 'General'], ['b', 'Alex']]);
    expect(visibleBaskets({ enabled: false, wrapFeePence: 0, wrappingLive: false, baskets: [general, alex] }).map((b) => b.name)).toEqual(['General']);
  });
});
