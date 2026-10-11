import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lets the browser bundle know when the site runs on example data (tests); see lib/selling/index.ts.
  env: { NEXT_PUBLIC_PV_DATA_SOURCE: process.env.PV_DATA_SOURCE ?? '' },
};

export default nextConfig;
