import { describe, expect, it } from 'vitest';
import tokens from '../../design/tokens.json';

type Tok = { name: string; value: string | Record<string, string>; usage: string };
const colours = tokens.color.tokens as Tok[];
const themes = tokens.color.themes.map((t) => t.id);

function resolve(name: string, theme: string, depth = 0): string {
  const t = colours.find((c) => c.name === name);
  if (!t) throw new Error(`No colour token ${name}`);
  const v = typeof t.value === 'string' ? t.value : t.value[theme] ?? t.value[themes[0]];
  const alias = /^\{([\w.-]+)\}$/.exec(v);
  if (alias) {
    if (depth > 8) throw new Error(`Alias loop at ${name}`);
    return resolve(alias[1], theme, depth + 1);
  }
  return v;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Text and icon pairs the design system promises. 4.5 = body text (WCAG AA), 3 = icons and large text.
const pairs: [fg: string, bg: string, min: number][] = [
  ['ink', 'surface', 4.5], ['ink', 'surface-raised', 4.5], ['ink', 'surface-sand', 4.5],
  ['ink-soft', 'surface', 4.5], ['ink-soft', 'surface-raised', 4.5], ['ink-soft', 'surface-sand', 4.5],
  ['ink-muted', 'surface', 4.5], ['ink-muted', 'surface-raised', 4.5],
  ['on-terracotta', 'terracotta', 4.5], ['on-terracotta', 'terracotta-hover', 4.5],
  ['terracotta-text', 'surface', 4.5], ['terracotta-text', 'surface-raised', 4.5],
  ['on-sage', 'sage', 4.5], ['sage-text', 'surface', 4.5], ['sage-text', 'surface-raised', 4.5],
  ['ink', 'peach', 4.5], ['on-olive', 'olive', 4.5], ['on-olive-active', 'olive', 4.5],
  ['danger', 'surface', 4.5], ['danger', 'surface-raised', 4.5],
  ['taupe', 'surface', 3], ['taupe', 'surface-raised', 3], ['taupe', 'surface-sand', 3],
  ['focus', 'surface', 3], ['focus', 'surface-raised', 3], ['focus', 'surface-sand', 3],
];

describe('design tokens', () => {
  it('every colour token has a usage note and a valid value in every theme', () => {
    for (const t of colours) {
      expect(t.usage.length, t.name).toBeGreaterThan(10);
      for (const theme of themes) expect(resolve(t.name, theme), `${t.name} ${theme}`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  for (const theme of themes) {
    it.each(pairs)(`${theme}: %s on %s meets %s:1`, (fg, bg, min) => {
      expect(contrast(resolve(fg, theme), resolve(bg, theme))).toBeGreaterThanOrEqual(min);
    });
  }
});
