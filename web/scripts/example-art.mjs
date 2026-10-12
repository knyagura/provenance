// Draws the example catalogue's pictures: three views per item (the whole item, a close-up and its label),
// as small SVG files in public/examples/. Original flat drawings: no brand names or logos.
// Run: node scripts/example-art.mjs   (the output is committed; re-run after changing a drawing).
import { mkdirSync, writeFileSync } from 'node:fs';

const W = 400;
const H = 500;
const INK = '#3E3B33';
const BG = { cream: '#EFE7DC', sand: '#E6DACB', sage: '#DCE0D3', blush: '#EAD8CB', stone: '#E3DFD8' };

const shadow = (cx, cy, rx, ry = 14) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity=".08"/>`;
const stitch = (d, colour = '#fff', op = 0.35) => `<path d="${d}" fill="none" stroke="${colour}" stroke-width="2" stroke-dasharray="5 5" opacity="${op}"/>`;

// Each drawing: background, the item, and the region to zoom into for the close-up [x, y, w, h].
const ITEMS = {
  'example-1': { // wax jacket
    bg: BG.sand, detail: [150, 110, 130, 160],
    art: () => `${shadow(200, 448, 150)}
      <path d="M118 120 L80 140 L52 330 L62 420 L104 418 L110 300 L112 440 L288 440 L290 300 L296 418 L338 420 L348 330 L320 140 L282 120 Z" fill="#5B5E3F"/>
      <path d="M150 104 L200 136 L250 104 L262 128 L200 170 L138 128 Z" fill="#7A5A3A"/>
      <path d="M200 170 L200 440" stroke="#3F422C" stroke-width="4"/>
      <rect x="128" y="300" width="56" height="60" rx="6" fill="#4F5236"/><rect x="216" y="300" width="56" height="60" rx="6" fill="#4F5236"/>
      <path d="M128 312 h56 M216 312 h56" stroke="#3F422C" stroke-width="3"/>
      ${stitch('M112 436 h176')}${stitch('M200 180 v250', '#fff', 0.2)}
      <circle cx="200" cy="200" r="5" fill="#C8B28A"/><circle cx="200" cy="250" r="5" fill="#C8B28A"/><circle cx="200" cy="300" r="5" fill="#C8B28A"/>`,
  },
  'example-2': { // floral midi dress
    bg: BG.blush, detail: [140, 200, 130, 160],
    art: () => {
      const flowers = [[160, 220], [230, 250], [180, 300], [250, 330], [150, 370], [215, 400], [270, 420], [130, 440], [200, 190]]
        .map(([x, y]) => `<g transform="translate(${x} ${y})"><circle r="9" fill="#E9C9B5"/><circle cx="9" r="7" fill="#E9C9B5"/><circle cx="-9" r="7" fill="#E9C9B5"/><circle cy="9" r="7" fill="#E9C9B5"/><circle cy="-9" r="7" fill="#E9C9B5"/><circle r="5" fill="#C9884F"/></g>`).join('');
      return `${shadow(200, 468, 120)}
        <path d="M168 70 L176 120 L150 150 L156 190 L110 460 L290 460 L244 190 L250 150 L224 120 L232 70 L214 70 L200 100 L186 70 Z" fill="#33415C"/>
        <path d="M150 190 Q200 210 250 190" stroke="#26314A" stroke-width="5" fill="none"/>${flowers}`;
    },
  },
  'example-3': { // table lamp
    bg: BG.sage, detail: [120, 250, 160, 200],
    art: () => `${shadow(200, 452, 90)}
      <path d="M110 80 L290 80 L330 210 L70 210 Z" fill="#EFE6D6"/><path d="M110 80 L290 80 L296 98 L104 98 Z" fill="#E2D6C1"/>
      <path d="M70 210 L330 210" stroke="#D9CBB2" stroke-width="4"/>
      <rect x="194" y="210" width="12" height="36" fill="#B9B29A"/>
      <path d="M200 246 C120 250 118 330 140 380 C150 410 170 440 200 444 C230 440 250 410 260 380 C282 330 280 250 200 246 Z" fill="#8FA083"/>
      <path d="M150 300 C180 290 220 290 252 300" stroke="#A9B79D" stroke-width="6" fill="none" opacity=".7"/>
      <ellipse cx="200" cy="444" rx="44" ry="8" fill="#7C8C71"/>`,
  },
  'example-4': { // leather belt, coiled
    bg: BG.cream, detail: [215, 170, 130, 160],
    art: () => `${shadow(200, 380, 140, 18)}
      <circle cx="200" cy="270" r="110" fill="none" stroke="#7A4E2F" stroke-width="38"/>
      <circle cx="200" cy="270" r="66" fill="none" stroke="#6A4127" stroke-width="38"/>
      ${stitch('M200 145 A125 125 0 1 1 199 145', '#E8D2B5', 0.6)}
      <rect x="250" y="190" width="70" height="56" rx="10" fill="none" stroke="#B9B4A8" stroke-width="10"/>
      <rect x="282" y="196" width="8" height="44" rx="3" fill="#9E998D"/>
      <path d="M210 170 l20 -60 l60 0" stroke="#7A4E2F" stroke-width="34" fill="none" stroke-linecap="round"/>
      <circle cx="262" cy="110" r="5" fill="#4E301C"/><circle cx="238" cy="110" r="5" fill="#4E301C"/>`,
  },
  'example-5': { // running shorts
    bg: BG.stone, detail: [210, 140, 120, 150],
    art: () => `${shadow(200, 420, 130)}
      <path d="M100 120 L300 120 L330 390 L218 400 L200 250 L182 400 L70 390 Z" fill="#26262A"/>
      <rect x="100" y="120" width="200" height="28" rx="6" fill="#1B1B1E"/>
      <path d="M190 148 q10 30 0 60 M210 148 q-10 30 0 60" stroke="#4A4A50" stroke-width="3" fill="none"/>
      <path d="M232 170 v60" stroke="#55555C" stroke-width="4"/><rect x="228" y="166" width="8" height="10" rx="2" fill="#8C8C94"/>
      ${stitch('M74 380 L182 390 M218 390 L326 380', '#fff', 0.25)}`,
  },
  'example-6': { // structured designer bag (no logo)
    bg: BG.blush, detail: [150, 230, 110, 130],
    art: () => `${shadow(200, 440, 130)}
      <path d="M118 140 C118 60 282 60 282 140" fill="none" stroke="#C9A55C" stroke-width="7" stroke-dasharray="14 6"/>
      <rect x="90" y="150" width="220" height="280" rx="18" fill="#1E1D1F"/>
      <path d="M90 168 Q200 300 310 168 L310 168 L90 168 Z" fill="#2A292C"/>
      <path d="M90 168 Q200 300 310 168" fill="none" stroke="#0F0F10" stroke-width="3"/>
      <rect x="186" y="236" width="28" height="28" rx="5" fill="none" stroke="#C9A55C" stroke-width="5"/>
      ${stitch('M104 420 h192', '#fff', 0.18)}`,
  },
  'example-7': { // compact camera (no brand)
    bg: BG.cream, detail: [140, 190, 150, 170],
    art: () => `${shadow(200, 380, 150, 16)}
      <rect x="70" y="190" width="260" height="170" rx="16" fill="#2B2B2E"/>
      <rect x="70" y="190" width="260" height="60" rx="16" fill="#C9C8C4"/><rect x="70" y="230" width="260" height="20" fill="#C9C8C4"/>
      <rect x="96" y="170" width="44" height="24" rx="5" fill="#B5B3AE"/><rect x="250" y="172" width="34" height="22" rx="6" fill="#9F9D98"/>
      <rect x="252" y="206" width="56" height="30" rx="4" fill="#3A3A3E"/><rect x="258" y="212" width="44" height="18" rx="2" fill="#6E7E86" opacity=".6"/>
      <circle cx="200" cy="292" r="62" fill="#1A1A1C"/><circle cx="200" cy="292" r="46" fill="#2F3134"/><circle cx="200" cy="292" r="28" fill="#3E4A55"/>
      <circle cx="190" cy="282" r="9" fill="#9DB0BF" opacity=".55"/>`,
  },
  'example-8': { // rollneck jumper
    bg: BG.sand, detail: [150, 70, 110, 140],
    art: () => {
      const ribs = Array.from({ length: 12 }, (_, i) => `<path d="M${140 + i * 10} 400 v34" stroke="#CDBFA5" stroke-width="3"/>`).join('');
      return `${shadow(200, 450, 150)}
        <path d="M150 110 L82 140 L44 380 L88 390 L116 220 L120 440 L280 440 L284 220 L312 390 L356 380 L318 140 L250 110 Z" fill="#DCCFB6"/>
        <rect x="160" y="70" width="80" height="54" rx="12" fill="#D2C3A6"/>
        ${Array.from({ length: 7 }, (_, i) => `<path d="M${170 + i * 10} 74 v46" stroke="#C4B496" stroke-width="3"/>`).join('')}
        ${ribs}<path d="M44 380 L88 390" stroke="#C4B496" stroke-width="10"/><path d="M312 390 L356 380" stroke="#C4B496" stroke-width="10"/>`;
    },
  },
  'example-9': { // children's rain jacket
    bg: BG.sage, detail: [130, 240, 150, 150],
    art: () => `${shadow(200, 440, 130)}
      <path d="M150 110 C150 50 250 50 250 110 L230 120 C230 80 170 80 170 120 Z" fill="#26345A"/>
      <path d="M150 112 L98 136 L70 330 L108 336 L120 250 L124 430 L276 430 L280 250 L292 336 L330 330 L302 136 L250 112 L200 140 Z" fill="#2E3E6B"/>
      <path d="M200 140 V430" stroke="#1F2B4D" stroke-width="5"/>
      <rect x="124" y="300" width="152" height="12" fill="#D9DDE3"/><rect x="72" y="300" width="40" height="10" fill="#D9DDE3"/><rect x="288" y="300" width="40" height="10" fill="#D9DDE3"/>
      <rect x="138" y="340" width="44" height="36" rx="4" fill="#26345A"/><rect x="218" y="340" width="44" height="36" rx="4" fill="#26345A"/>`,
  },
  'example-10': { // stack of paperbacks
    bg: BG.cream, detail: [100, 260, 200, 120],
    art: () => {
      const colours = ['#C9784A', '#8FA083', '#3E4A55', '#D9B36C', '#9C5238', '#5E5A4F', '#C9784A', '#7D8DA0'];
      const books = colours.map((c, i) => {
        const y = 420 - i * 36, w = 230 - (i % 3) * 14, x = 200 - w / 2 + ((i % 2) ? 8 : -6);
        return `<rect x="${x}" y="${y}" width="${w}" height="32" rx="3" fill="${c}"/><rect x="${x + 14}" y="${y + 12}" width="${w * 0.5}" height="8" rx="2" fill="#F4EEE3" opacity=".8"/>`;
      }).join('');
      return `${shadow(200, 458, 140)}${books}`;
    },
  },
  'example-11': { // construction brick set box (no brand)
    bg: BG.blush, detail: [150, 220, 160, 150],
    art: () => {
      const studs = (x, y, n, c) => Array.from({ length: n }, (_, i) => `<rect x="${x + 6 + i * 22}" y="${y - 8}" width="14" height="8" rx="2" fill="${c}"/>`).join('');
      return `${shadow(200, 450, 150)}
        <path d="M70 140 L300 120 L340 150 L340 430 L110 450 L70 420 Z" fill="#2F3B4A"/>
        <path d="M70 140 L300 120 L340 150 L110 172 Z" fill="#3A4859"/><path d="M110 172 L110 450 L70 420 L70 140 Z" fill="#26303C"/>
        <rect x="140" y="260" width="140" height="44" rx="4" fill="#C9784A"/>${studs(140, 260, 6, '#C9784A')}
        <rect x="160" y="216" width="96" height="44" rx="4" fill="#D9B36C"/>${studs(160, 216, 4, '#D9B36C')}
        <rect x="150" y="304" width="40" height="40" rx="20" fill="#1A1A1C"/><rect x="236" y="304" width="40" height="40" rx="20" fill="#1A1A1C"/>
        <rect x="130" y="380" width="120" height="14" rx="3" fill="#F4EEE3" opacity=".85"/><rect x="130" y="402" width="70" height="10" rx="3" fill="#F4EEE3" opacity=".5"/>`;
    },
  },
  'example-12': { // trail running shoe
    bg: BG.stone, detail: [80, 280, 170, 140],
    art: () => {
      const lugs = Array.from({ length: 11 }, (_, i) => `<rect x="${72 + i * 24}" y="372" width="14" height="14" rx="3" fill="#1B1B1E"/>`).join('');
      return `${shadow(200, 398, 160, 12)}
        <path d="M60 330 C60 290 110 270 150 250 L210 200 C230 190 250 196 262 210 L300 250 C330 270 350 290 350 330 L350 360 L60 360 Z" fill="#9C5238"/>
        <path d="M60 340 L350 340 L350 372 L60 372 Z" fill="#E7E1D6"/>${lugs}
        <path d="M150 250 L200 296 M180 228 L226 276 M210 208 L248 248" stroke="#E7E1D6" stroke-width="5"/>
        <path d="M262 210 C280 200 300 196 316 210 L300 250" fill="#7E4029"/>
        <path d="M90 320 C150 300 250 300 330 320" stroke="#C9784A" stroke-width="6" fill="none"/>`;
    },
  },
};

// Size and condition from the catalogue seeds, for the label view.
const LABELS = {
  'example-1': ['M', 'Very good'], 'example-2': ['10', 'Good'], 'example-3': ['E27', 'Good'], 'example-4': ['34', 'Very good'],
  'example-5': ['M', 'Good'], 'example-6': ['One size', 'Very good'], 'example-7': ['4,200 shots', 'Very good'], 'example-8': ['S', 'New with tags'],
  'example-9': ['5–6 yrs', 'Good'], 'example-10': ['12 books', 'Good'], 'example-11': ['Complete', 'Very good'], 'example-12': ['UK 9', 'Good'],
};

const svg = (bg, body, viewBox = `0 0 ${W} ${H}`) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"><rect x="-100" y="-100" width="${W + 200}" height="${H + 200}" fill="${bg}"/>${body}</svg>\n`;

function label(id, bg) {
  const [size, condition] = LABELS[id];
  return svg(bg, `${shadow(200, 400, 110)}
    <path d="M110 120 L290 120 L290 380 L110 380 Z" fill="#FBF8F2"/>
    <circle cx="200" cy="150" r="10" fill="${bg}" stroke="#D8CEBF" stroke-width="2"/>
    <path d="M200 60 Q240 90 200 140" stroke="${INK}" stroke-width="2" fill="none"/>
    <text x="200" y="215" text-anchor="middle" font-family="Georgia, serif" font-size="22" fill="${INK}">${size}</text>
    <path d="M140 240 h120" stroke="#D8CEBF" stroke-width="2"/>
    <text x="200" y="278" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#5E5A4F">${condition}</text>
    <text x="200" y="340" text-anchor="middle" font-family="Courier, monospace" font-size="13" fill="#80776B">${id.toUpperCase()}</text>`);
}

const out = new URL('../public/examples/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const [id, item] of Object.entries(ITEMS)) {
  const body = item.art();
  const [x, y, w] = item.detail;
  writeFileSync(new URL(`${id}-front.svg`, out), svg(item.bg, body));
  writeFileSync(new URL(`${id}-detail.svg`, out), svg(item.bg, body, `${x} ${y} ${w} ${w * (H / W)}`));
  writeFileSync(new URL(`${id}-label.svg`, out), label(id, item.bg));
}
console.log(`Drew ${Object.keys(ITEMS).length * 3} pictures in public/examples/`);
