// Builds app/tokens.css from design/tokens.json.
// design/tokens.json is a copy of the Provenance Design System's tokens: change colours there first,
// copy the file here, and this script turns it into CSS custom properties for light and dark mode.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'design/tokens.json'), 'utf8'));

const themes = tokens.color.themes.map((t) => t.id);
const [first, ...others] = themes;
const css = (v) => (typeof v === 'string' && /^\{[\w.-]+\}$/.test(v) ? `var(--${v.slice(1, -1)})` : v);
const valueFor = (t, theme) => (typeof t.value === 'string' ? t.value : t.value[theme] ?? t.value[first]);

const decl = (name, value) => `  --${name}: ${css(value)};`;
const lines = [];
lines.push('/* Generated from design/tokens.json by scripts/build-tokens.mjs. Do not edit by hand. */');

// Colours and shadows: first theme on :root, the others as overrides.
const themed = [...tokens.color.tokens, ...(tokens.shadow?.tokens ?? [])];
lines.push(':root {', ...themed.map((t) => decl(t.name, valueFor(t, first))));
for (const fam of Object.keys(tokens)) {
  if (['name', 'version', 'color', 'type', 'shadow'].includes(fam) || !tokens[fam]?.tokens) continue;
  lines.push(...tokens[fam].tokens.map((t) => decl(t.name, t.value)));
}
for (const [key, stack] of Object.entries(tokens.type.families)) lines.push(`  --font-${key}: ${stack};`);
lines.push('  color-scheme: light;', '}');

for (const theme of others) {
  const body = themed
    .filter((t) => typeof t.value !== 'string' && t.value[theme] && t.value[theme] !== t.value[first])
    .map((t) => '  ' + decl(t.name, t.value[theme]));
  lines.push(`@media (prefers-color-scheme: ${theme}) {`, `  :root:not([data-theme="${first}"]) {`, ...body, `    color-scheme: ${theme};`, '  }', '}');
  lines.push(`:root[data-theme="${theme}"] {`, ...body.map((l) => l.slice(2)), `  color-scheme: ${theme};`, '}');
}

writeFileSync(join(root, 'app/tokens.css'), lines.join('\n') + '\n');
console.log(`tokens.css written: ${themed.length} colour/shadow tokens, themes ${themes.join(', ')}`);
