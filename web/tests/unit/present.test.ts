import { describe, expect, it } from 'vitest';
import { exampleCatalogue } from '@/lib/domain/examples';
import { cardDetails, placeholderFor, resultsHeading, shotLabel, toCard } from '@/lib/domain/present';

describe('presenting listings', () => {
  it('cards link to the item page and keep a stable colour', () => {
    const c = toCard(exampleCatalogue[0]);
    expect(c.href).toBe('/item/example-1');
    expect(placeholderFor('example-1')).toBe(c.placeholder);
    expect(c.photoUrl).toBe('/examples/example-1-front.svg');
    expect(c.tier).toBe('enhanced');
  });
  it('every example has its three drawn pictures, labelled by shot', async () => {
    const { existsSync } = await import('node:fs');
    for (const l of exampleCatalogue) {
      expect(l.media.map((m) => m.shot)).toEqual(['front', 'detail', 'label']);
      for (const m of l.media) expect(existsSync(new URL(`../../public${m.url}`, import.meta.url))).toBe(true);
    }
  });
  it('names shots plainly', () => {
    expect(shotLabel('detail')).toBe('Close-up');
    expect(shotLabel('serial_plate')).toBe('Serial plate');
    expect(shotLabel(null)).toBeNull();
  });
  it('details prefer size, then brand', () => {
    expect(cardDetails(exampleCatalogue[0])).toBe('M · Very good');
    expect(cardDetails(exampleCatalogue[2])).toBe('Habitat · Good');
  });
  it('headings', () => {
    expect(resultsHeading('barbour', 'Men')).toBe('“barbour” in Men');
    expect(resultsHeading('barbour', undefined)).toBe('Results for “barbour”');
    expect(resultsHeading(undefined, 'Men')).toBe('Men');
    expect(resultsHeading(undefined, undefined)).toBe('Everything for sale');
  });
});

import { countText } from '@/lib/domain/present';
describe('result counts', () => {
  it('reads naturally', () => {
    expect(countText(0, 0, false)).toBe('No items found');
    expect(countText(0, 1, false)).toBe('1 item');
    expect(countText(0, 7, false)).toBe('7 items');
    expect(countText(0, 24, true)).toBe('Showing 1–24');
    expect(countText(24, 5, false)).toBe('Showing 25–29');
  });
});
