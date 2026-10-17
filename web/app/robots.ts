import type { MetadataRoute } from 'next';
import { config } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/checkout/', '/orders/', '/inbox', '/notifications', '/basket', '/gift/', '/staff', '/sell', '/profile', '/saved', '/auth/', '/passkey', '/reset'] }],
    sitemap: `${config.siteUrl}/sitemap.xml`,
    host: config.siteUrl,
  };
}
