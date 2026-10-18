import type { NextConfig } from 'next';

// Security headers on every page. The Content Security Policy lists every outside service the site talks to:
// Supabase (data, sign-in, photos, functions), Stripe (card form and its frames), postcodes.io ("near me").
// Next.js needs inline scripts for its pages, so script-src keeps 'unsafe-inline'; everything else is locked down.
const SUPABASE = 'https://tkjmnivvcrcqkqjywafb.supabase.co';
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.js.stripe.com",
  `connect-src 'self' ${SUPABASE} wss://tkjmnivvcrcqkqjywafb.supabase.co https://api.stripe.com https://api.postcodes.io`,
  `img-src 'self' data: blob: ${SUPABASE} https://*.stripe.com`,
  `media-src 'self' blob: ${SUPABASE}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  'frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com',
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The camera and microphone are for evidence photos and videos; location for "near me"; payment for Stripe.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self), payment=(self "https://js.stripe.com")' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  reactStrictMode: true,
  poweredByHeader: false,
  // Lets the browser bundle know when the site runs on example data (tests); see lib/selling/index.ts.
  env: {
    NEXT_PUBLIC_PV_DATA_SOURCE: process.env.PV_DATA_SOURCE ?? '',
    // Netlify sets NETLIFY=true on its builds: photos then go through its image CDN (lib/images.ts).
    NEXT_PUBLIC_IMAGE_CDN: process.env.NETLIFY === 'true' && process.env.PV_DATA_SOURCE !== 'examples' ? 'netlify' : '',
  },
};

export default nextConfig;
