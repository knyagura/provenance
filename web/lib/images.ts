// Smaller, faster photos. On Netlify, listing photos (stored full-size in Supabase) are served through
// Netlify's image CDN at the width each screen needs, as WebP or AVIF. Elsewhere (local runs, tests,
// example SVGs, data: and blob: previews) the original is used unchanged, so nothing depends on the CDN.

const CDN = process.env.NEXT_PUBLIC_IMAGE_CDN === 'netlify';

const resizable = (url: string) => /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\//.test(url) && !/\.svg(\?|$)/i.test(url);

export function cdnUrl(url: string, width: number): string {
  return `/.netlify/images?url=${encodeURIComponent(url)}&w=${width}&q=75`;
}

/** src, srcSet and sizes for an <img>. `sizes` says how wide the image shows on screen. */
export function photo(url: string, sizes: string, widths: number[] = [240, 360, 480, 720, 960]) {
  if (!CDN || !resizable(url)) return { src: url };
  return {
    src: cdnUrl(url, widths[Math.min(2, widths.length - 1)]),
    srcSet: widths.map((w) => `${cdnUrl(url, w)} ${w}w`).join(', '),
    sizes,
  };
}

export const SIZES = {
  card: '(min-width: 1280px) 260px, (min-width: 768px) 30vw, 46vw',
  gallery: '(min-width: 1024px) 560px, 90vw',
  thumb: '80px',
} as const;
export const THUMB_WIDTHS = [96, 160, 240];
