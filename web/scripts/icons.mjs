// Renders the app icons (home screen and install) from app/icon.svg. Run: node scripts/icons.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('../app/icon.svg', import.meta.url), 'utf8');
// Maskable icons need the mark inside the middle 80%, on a full-bleed background.
const maskable = svg.replace('<rect width="120" height="120" rx="26" fill="#F9F7F3"/>', '<rect width="120" height="120" fill="#F9F7F3"/>').replace('translate(6 6) scale(0.9)', 'translate(18 18) scale(0.7)');
const out = [
  ['app/apple-icon.png', 180, svg.replace('rx="26"', 'rx="0"')],
  ['public/icons/icon-192.png', 192, svg],
  ['public/icons/icon-512.png', 512, svg],
  ['public/icons/maskable-512.png', 512, maskable],
];
const b = await chromium.launch();
for (const [path, size, s] of out) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<body style="margin:0;background:transparent">${s.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await p.screenshot({ path: new URL(`../${path}`, import.meta.url).pathname, omitBackground: true });
  await p.close();
}
await b.close();
console.log('Drew', out.length, 'icons');
