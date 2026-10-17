import { describe, expect, it } from 'vitest';
import { byColour, leftText } from '@/components/browse/VariantPicker';
import { exampleSource } from '@/lib/domain/catalogue';
import { exampleCatalogue } from '@/lib/domain/examples';

describe('variants for business sellers', () => {
  it('lists every colour and size of an example item, from any of them', async () => {
    const v = await exampleSource.variants('example-14');
    expect(v).toHaveLength(4);
    expect(v.find((x) => x.current)?.id).toBe('example-14');
    expect(v.every((x) => x.unitsLeft === x.stock)).toBe(true);
    expect(await exampleSource.variants('example-1')).toHaveLength(1);
  });
  it('groups by colour in order', async () => {
    const groups = byColour(await exampleSource.variants('example-13'));
    expect(groups.map(([c, list]) => `${c}:${list.map((x) => x.size).join('')}`)).toEqual(['Oatmeal:SM', 'Charcoal:SM']);
  });
  it('words what is left', () => {
    expect(leftText({ unitsLeft: 0, stock: 3 })).toBe('Sold out');
    expect(leftText({ unitsLeft: 2, stock: 3 })).toBe('2 left');
    expect(leftText({ unitsLeft: 9, stock: 12 })).toBe('In stock');
    expect(leftText({ unitsLeft: 1, stock: 1 })).toBe('Available');
  });
  it('shows one search card per group', async () => {
    const page = await exampleSource.search({ q: 'merino crew', sort: 'newest', limit: 24, offset: 0 });
    expect(page.items.map((l) => l.id)).toEqual(['example-13']);
    expect(exampleCatalogue.filter((l) => l.variantGroup === 'example-merino')).toHaveLength(4);
  });
});
