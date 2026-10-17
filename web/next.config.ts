import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
