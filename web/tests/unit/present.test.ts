import { describe, expect, it } from 'vitest';
import { exampleCatalogue } from '@/lib/domain/examples';
import { cardDetails, placeholderFor, resultsHeading, toCard } from '@/lib/domain/present';

describe('presenting listings', () => {
  it('cards link to the item page and keep a stable colour', () => {
    const c = toCard(exampleCatalogue[0]);
    expect(c.href).toBe('/item/example-1');
    expect(placeholderFor('example-1')).toBe(c.placeholder);
    expect(c.photoUrl).toBeUndefined();
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
